'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') throw new Error('Simulator browser test requires Node.js 22 or newer.');

const projectRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(projectRoot, 'app');

function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  for (const candidate of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try { return execFileSync('which', [candidate], { encoding: 'utf8' }).trim(); }
    catch (_) {}
  }
  throw new Error('Chromium was not found. Set CHROMIUM_PATH.');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function mime(filePath) {
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream',
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function startServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const absolute = path.resolve(appRoot, relative);
    const valid = absolute.startsWith(`${appRoot}${path.sep}`) && fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    requests.push({ path: url.pathname, status: valid ? 200 : 404 });
    if (!valid) return response.writeHead(404).end('Not found');
    response.writeHead(200, { 'Content-Type': mime(absolute), 'Cache-Control': 'no-store' });
    fs.createReadStream(absolute).pipe(response);
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, port, requests };
}

class CDP {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.events = []; }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result || {});
      } else this.events.push(message);
    });
  }
  command(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws?.close(); }
}

async function evaluate(cdp, expression) {
  const response = await cdp.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime evaluation failed.');
  return response.result?.value;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function click(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  if (!clicked) throw new Error(`Element not found: ${selector}`);
}

function supportedState(overrides = {}) {
  return {
    fundType: 'new_pension',
    supportedForCurrentForecast: true,
    currentBalance: 300000,
    fees: { depositRate: 0.008, balanceRate: 0.0015 },
    derived: { baselineMonthlyContribution: 4000, averageReportedPensionSalary: 20000, monthsUsed: 3 },
    contributionHistory: [{
      salaryMonth: '01/2025', employerName: null, reportedSalary: 20000,
      employeeContribution: 1200, employerContribution: 1300, severanceContribution: null,
      totalContribution: 2500, sourcePage: 1, confidence: null, reliable: false,
      requiresReview: true, normalizationStatus: 'excluded',
      evidence: { rowId: 'safe-row-id', method: 'pdf-text', rawText: 'PRIVATE_ROW_RAW_SENTINEL' },
    }],
    evidence: {
      currentBalance: { aliasId: 'closing-balance', page: 1, rowId: 'balance-row', method: 'pdf-text', raw: 'PRIVATE_TOP_RAW_SENTINEL' },
    },
    report: { type: 'annual' },
    review: { issues: [] },
    ...overrides,
  };
}

async function navigate(cdp, baseUrl, viewport) {
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 500 });
  await cdp.command('Page.navigate', { url: baseUrl });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 15000, `${viewport.name} app load`);
}

async function seedForecast(cdp, state, years = 12) {
  await evaluate(cdp, `(() => {
    window.PensionLabTest.setPensionReportState(${JSON.stringify(state)});
    window.PensionLabTest.setYearsUntilRetirement(${Number(years)});
    window.PensionLabTest.calculateForecast();
  })()`);
  await waitFor(() => evaluate(cdp, 'window.PensionLabTest.getFlowStep() === 4 && !document.querySelector("#simulatorPanel").classList.contains("hidden")'), 5000, 'supported-new simulator');
}

async function setSlider(cdp, key, value) {
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-simulator-input="${key}"]');
    input.value = String(${Number(value)} * 100);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function waitForControl(cdp, key, expected) {
  await waitFor(async () => Math.abs(Number((await evaluate(cdp, `window.PensionLabTest.getSimulatorControls()[${JSON.stringify(key)}]`)) - expected)) < 1e-10, 2000, `${key} slider update`);
}

async function runDesktopChecks(cdp, baseUrl, requests) {
  await navigate(cdp, baseUrl, { name: 'desktop', width: 1440, height: 1000 });
  await evaluate(cdp, `sessionStorage.setItem('pension-lab-report-first-session-v1', ${JSON.stringify(JSON.stringify({
    version: 1, flowStep: 4, yearsUntilRetirement: 81, moneyMode: 'real',
    pensionReportState: supportedState(), userCorrections: {},
  }))})`);
  await cdp.command('Page.reload', { ignoreCache: true });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 15000, 'invalid-session reload');
  const invalidSession = await evaluate(cdp, `(() => {
    const stored = sessionStorage.getItem('pension-lab-report-first-session-v1') || '';
    return {
      step: window.PensionLabTest.getFlowStep(), projection: window.PensionLabTest.getProjection(),
      years: document.querySelector('#yearsUntilRetirement').value,
      legacyRawRemoved: !/PRIVATE_(?:TOP|ROW)_RAW_SENTINEL/.test(stored) && !/"(?:raw|rawText)"/.test(stored),
    };
  })()`);
  if (invalidSession.step !== 3 || invalidSession.projection !== null || invalidSession.years !== '' || !invalidSession.legacyRawRemoved) {
    throw new Error(`Invalid saved horizon did not fall back safely: ${JSON.stringify(invalidSession)}`);
  }
  await evaluate(cdp, `sessionStorage.setItem('pension-lab-report-first-session-v1', ${JSON.stringify(JSON.stringify({
    version: 1, flowStep: 2.5, yearsUntilRetirement: null, moneyMode: 'real',
    pensionReportState: {
      fundType: 'new_pension', supportedForCurrentForecast: true, currentBalance: '',
      fees: { depositRate: '', balanceRate: '' }, derived: null,
      contributionHistory: [null], normalizedContributionMonths: [null], review: { issues: [null] },
      evidence: { currentBalance: { raw: 'PRIVATE_LEGACY_RAW' } },
    },
    userCorrections: { currentBalance: true, unexpected: true },
  }))})`);
  await cdp.command('Page.reload', { ignoreCache: true });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 15000, 'malformed-session reload');
  const malformedSession = await evaluate(cdp, `(() => {
    const inputs = ['currentBalance', 'baselineMonthlyContribution', 'depositFee', 'balanceFee'].map((id) => document.querySelector('#' + id).value);
    const current = document.querySelector('#currentBalance');
    current.value = '100000';
    current.dispatchEvent(new Event('input', { bubbles: true }));
    const stored = sessionStorage.getItem('pension-lab-report-first-session-v1') || '';
    return {
      step: window.PensionLabTest.getFlowStep(), inputs,
      reviewVisible: !document.querySelector('#reviewStep').classList.contains('hidden'),
      contributionSource: document.querySelector('#contributionSource').textContent,
      feesSource: document.querySelector('#feesSource').textContent,
      committedBalance: window.PensionLabTest.getPensionReportState().currentBalance,
      rawRemoved: !stored.includes('PRIVATE_LEGACY_RAW') && !stored.includes('"raw"'),
    };
  })()`);
  if (malformedSession.step !== 2 || !malformedSession.reviewVisible || malformedSession.inputs.some(Boolean) || !malformedSession.contributionSource.includes('נדרש אישור') || !malformedSession.feesSource.includes('נדרש אישור') || malformedSession.committedBalance !== 100000 || !malformedSession.rawRemoved) {
    throw new Error(`Malformed saved report state was not normalized safely: ${JSON.stringify(malformedSession)}`);
  }
  await evaluate(cdp, `sessionStorage.setItem('pension-lab-report-first-session-v1', ${JSON.stringify(JSON.stringify({
    version: 1, flowStep: 4, yearsUntilRetirement: 12, moneyMode: 'real',
    pensionReportState: {
      ...supportedState(), currentBalance: false,
      fees: { depositRate: false, balanceRate: [] },
      derived: { baselineMonthlyContribution: [], averageReportedPensionSalary: '20000', monthsUsed: true },
    },
    userCorrections: {},
  }))})`);
  await cdp.command('Page.reload', { ignoreCache: true });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 15000, 'type-coercion session reload');
  const coercionSession = await evaluate(cdp, `(() => {
    const state = window.PensionLabTest.getPensionReportState();
    return {
      step: window.PensionLabTest.getFlowStep(), projection: window.PensionLabTest.getProjection(),
      balance: state.currentBalance, contribution: state.derived.baselineMonthlyContribution,
      salary: state.derived.averageReportedPensionSalary, depositFee: state.fees.depositRate,
      balanceFee: state.fees.balanceRate,
    };
  })()`);
  if (coercionSession.step !== 2 || coercionSession.projection !== null || [coercionSession.balance, coercionSession.contribution, coercionSession.salary, coercionSession.depositFee, coercionSession.balanceFee].some((value) => value !== null)) {
    throw new Error(`Non-numeric saved values were coerced into financial inputs: ${JSON.stringify(coercionSession)}`);
  }
  await evaluate(cdp, `sessionStorage.setItem('pension-lab-report-first-session-v1', ${JSON.stringify(JSON.stringify({
    version: 1, flowStep: 4, yearsUntilRetirement: 12, moneyMode: 'real',
    pensionReportState: supportedState({ fees: { depositRate: 0.2001, balanceRate: 1e9 } }),
    userCorrections: {},
  }))})`);
  await cdp.command('Page.reload', { ignoreCache: true });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 15000, 'out-of-range fee session reload');
  const feeSession = await evaluate(cdp, `({ step: window.PensionLabTest.getFlowStep(), projection: window.PensionLabTest.getProjection() })`);
  if (feeSession.step !== 2 || feeSession.projection !== null) {
    throw new Error(`Out-of-range saved fees bypassed review: ${JSON.stringify(feeSession)}`);
  }
  await evaluate(cdp, 'sessionStorage.clear()');
  await navigate(cdp, baseUrl, { name: 'desktop', width: 1440, height: 1000 });
  const initial = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
  if (!initial) throw new Error('Simulator is visible before a supported report baseline exists.');

  await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify(supportedState({ currentBalance: 1e308 }))})`);
  await click(cdp, '#continueToYears');
  await evaluate(cdp, `window.PensionLabTest.setYearsUntilRetirement(80)`);
  await click(cdp, '#calculateForecast');
  const overflowGuard = await evaluate(cdp, `({
    step: window.PensionLabTest.getFlowStep(), projection: window.PensionLabTest.getProjection(),
    error: document.querySelector('#yearsError').textContent,
    alert: document.querySelector('#yearsError').getAttribute('role'),
    focus: document.activeElement?.id,
  })`);
  if (overflowGuard.step !== 3 || overflowGuard.projection !== null || !overflowGuard.error || overflowGuard.alert !== 'alert' || overflowGuard.focus !== 'yearsUntilRetirement') {
    throw new Error(`Non-finite projection was not blocked accessibly: ${JSON.stringify(overflowGuard)}`);
  }

  await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify(supportedState({ fundType: 'old_pension', supportedForCurrentForecast: false }))})`);
  const oldHidden = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
  if (!oldHidden) throw new Error('Simulator is exposed for an old-pension state.');

  await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify(supportedState({ fundType: 'unknown', supportedForCurrentForecast: false }))})`);
  const unknownHidden = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
  if (!unknownHidden) throw new Error('Simulator is exposed for an unknown-fund state.');

  await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify(supportedState({
    currentBalance: null,
    fees: { depositRate: null, balanceRate: null },
    derived: { baselineMonthlyContribution: null, averageReportedPensionSalary: null, monthsUsed: 0 },
  }))})`);
  await click(cdp, '#continueToYears');
  await waitFor(() => evaluate(cdp, 'document.activeElement?.id === "currentBalance"'), 2000, 'first invalid review field focus');
  const validation = await evaluate(cdp, `(() => ({
    invalidCount: document.querySelectorAll('#reviewStep [aria-invalid="true"]').length,
    alertCount: document.querySelectorAll('#reviewStep .field-error[role="alert"]').length,
    feesSource: document.querySelector('#feesSource').textContent,
    salarySource: document.querySelector('#salarySource').textContent,
  }))()`);
  if (validation.invalidCount !== 4 || validation.alertCount !== 4 || !validation.feesSource.includes('נדרש אישור') || !validation.salarySource.includes('לפי סכום')) {
    throw new Error(`Review validation is not accessible or provenance-safe: ${JSON.stringify(validation)}`);
  }
  const isolatedError = await evaluate(cdp, `(() => {
    const input = document.querySelector('#currentBalance');
    input.value = '100000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const remainingAfterEdit = ['baselineContributionError', 'depositFeeError', 'balanceFeeError'].map((id) => document.querySelector('#' + id).textContent);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      remainingAfterEdit,
      source: document.querySelector('#currentBalanceSource').textContent,
      userSource: document.querySelector('#currentBalanceSource').classList.contains('user-source'),
    };
  })()`);
  if (isolatedError.remainingAfterEdit.some((text) => !text) || !isolatedError.source.includes('נדרש אישור') || isolatedError.userSource) {
    throw new Error(`Editing one field cleared unrelated errors or invented provenance: ${JSON.stringify(isolatedError)}`);
  }

  await seedForecast(cdp, supportedState());
  await waitFor(() => evaluate(cdp, 'document.activeElement?.id === "forecastTitle"'), 2000, 'forecast heading focus');
  await click(cdp, '#editYears');
  await waitFor(() => evaluate(cdp, 'document.activeElement?.id === "yearsUntilRetirement"'), 2000, 'years input focus after edit');
  await click(cdp, '#backToReview');
  await waitFor(() => evaluate(cdp, 'document.activeElement?.id === "reviewTitle"'), 2000, 'review heading focus after back');
  await click(cdp, '#backToUpload');
  await waitFor(() => evaluate(cdp, 'document.activeElement?.id === "uploadTitle"'), 2000, 'upload heading focus after back');
  await seedForecast(cdp, supportedState());
  const safety = await evaluate(cdp, `(() => {
    const stored = sessionStorage.getItem('pension-lab-report-first-session-v1') || '';
    const historyValues = [...document.querySelectorAll('.history-row dd')].map((node) => node.textContent.trim());
    const rawKeys = [];
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (['raw', 'rawText', 'directText', 'tokenText', 'tokens', 'evidenceTokens', 'sourceText', 'ocrText'].includes(key)) rawKeys.push(key);
        walk(child);
      }
    };
    walk(JSON.parse(stored).pensionReportState);
    const before = window.PensionLabTest.getSimulatorControls();
    window.PensionLabTest.setSimulatorControl('nominalReturn', null);
    window.PensionLabTest.setSimulatorControl('inflation', NaN);
    const after = window.PensionLabTest.getSimulatorControls();
    const nominalInput = document.querySelector('[data-simulator-input="nominalReturn"]');
    const inflationTicks = document.querySelector('[data-simulator-control="inflation"] .simulator-ticks').textContent;
    const nativeBefore = nominalInput.value;
    const nativeBaseline = window.PensionLabTest.getSimulatorControls().nominalReturn;
    nominalInput.stepDown();
    nominalInput.dispatchEvent(new Event('input', { bubbles: true }));
    const nativeDown = window.PensionLabTest.getSimulatorControls().nominalReturn;
    window.PensionLabTest.setSimulatorControl('nominalReturn', nativeBaseline);
    nominalInput.value = nativeBefore;
    nominalInput.stepUp();
    nominalInput.dispatchEvent(new Event('input', { bubbles: true }));
    const nativeUp = window.PensionLabTest.getSimulatorControls().nominalReturn;
    window.PensionLabTest.setSimulatorControl('nominalReturn', nativeBaseline);
    nominalInput.value = nativeBefore;
    return {
      rawKeys, leakedSentinel: /PRIVATE_(?:TOP|ROW)_RAW_SENTINEL/.test(stored), historyValues,
      confidence: document.querySelector('.history-row > small').textContent,
      controlsUnchanged: JSON.stringify(before) === JSON.stringify(after),
      nativeValue: nominalInput.value, ariaValue: nominalInput.getAttribute('aria-valuenow'),
      nativeAriaText: nominalInput.getAttribute('aria-valuetext'),
      nativeStep: nominalInput.step, nativeStepMismatch: nominalInput.validity.stepMismatch,
      nativeDown, nativeBaseline, nativeUp, inflationTicks,
    };
  })()`);
  if (safety.rawKeys.length || safety.leakedSentinel || safety.historyValues[3] !== '—' || !safety.confidence.includes('—') || !safety.controlsUnchanged || safety.nativeValue !== '6.08' || safety.ariaValue !== '6.08' || !safety.nativeAriaText.includes('6.08%') || safety.nativeStep !== '0.02' || safety.nativeStepMismatch || !(safety.nativeDown < safety.nativeBaseline && safety.nativeUp > safety.nativeBaseline) || !safety.inflationTicks.includes('10%')) {
    throw new Error(`Privacy, missing-value, invalid-control or semantic-range regression: ${JSON.stringify(safety)}`);
  }
  await cdp.command('Accessibility.enable');
  const accessibilityTree = await cdp.command('Accessibility.getFullAXTree');
  const sliderNames = accessibilityTree.nodes
    .filter((node) => node.role?.value === 'slider')
    .map((node) => String(node.name?.value || ''));
  if (sliderNames.length !== 5 || sliderNames.some((name) => !name.includes('אחוז'))) {
    throw new Error(`Slider units are missing from the Chromium accessibility tree: ${JSON.stringify(sliderNames)}`);
  }
  const baselineUi = await evaluate(cdp, `(() => {
    const comparison = window.PensionLabTest.getSimulatorComparison();
    return {
      pensionDelta: comparison.monthlyPensionRealDelta,
      balanceDelta: comparison.retirementBalanceRealDelta,
      headline: document.querySelector('#headlinePension').textContent,
      comparisonText: document.querySelector('#headlinePensionComparison').textContent,
      controls: document.querySelectorAll('[data-simulator-input]').length,
      coefficient: comparison.baseline.assumptions.coefficient,
    };
  })()`);
  if (baselineUi.pensionDelta !== 0 || baselineUi.balanceDelta !== 0 || !baselineUi.headline.includes('₪') || baselineUi.comparisonText.includes('+₪0') || baselineUi.controls !== 5 || baselineUi.coefficient !== 200) {
    throw new Error(`Default simulator does not preserve the PR1 baseline: ${JSON.stringify(baselineUi)}`);
  }

  const markerBefore = await evaluate(cdp, `(() => {
    const marker = document.querySelector('[data-simulator-control="nominalReturn"] .simulator-baseline-marker');
    const input = document.querySelector('[data-simulator-input="nominalReturn"]');
    return { left: marker.getBoundingClientRect().left, value: input.value, position: marker.closest('[data-simulator-control]').style.getPropertyValue('--baseline-position') };
  })()`);
  const requestCountBeforeInteraction = requests.length;
  await setSlider(cdp, 'nominalReturn', 0.07);
  await waitForControl(cdp, 'nominalReturn', 0.07);
  const markerAfter = await evaluate(cdp, `(() => {
    const marker = document.querySelector('[data-simulator-control="nominalReturn"] .simulator-baseline-marker');
    const input = document.querySelector('[data-simulator-input="nominalReturn"]');
    return { left: marker.getBoundingClientRect().left, value: input.value, position: marker.closest('[data-simulator-control]').style.getPropertyValue('--baseline-position'), valueText: document.querySelector('[data-simulator-value="nominalReturn"]').textContent };
  })()`);
  if (markerAfter.value === markerBefore.value || markerAfter.position !== markerBefore.position || Math.abs(markerAfter.left - markerBefore.left) > 0.1 || !markerAfter.valueText.includes('7')) {
    throw new Error(`Selection thumb changed without preserving the baseline marker: ${JSON.stringify({ markerBefore, markerAfter })}`);
  }

  await setSlider(cdp, 'inflation', 0.025);
  await setSlider(cdp, 'contribution', 0.21);
  await setSlider(cdp, 'depositFee', 0.006);
  await setSlider(cdp, 'balanceFee', 0.0012);
  await Promise.all([
    waitForControl(cdp, 'inflation', 0.025),
    waitForControl(cdp, 'contribution', 0.21),
    waitForControl(cdp, 'depositFee', 0.006),
    waitForControl(cdp, 'balanceFee', 0.0012),
  ]);
  await waitFor(async () => Math.abs(Number((await evaluate(cdp, 'window.PensionLabTest.getSimulatorComparison().selectedBalanceFee')) - 0.0012)) < 1e-10, 2000, 'combined scenario projection');
  const changed = await evaluate(cdp, `(() => {
    const comparison = window.PensionLabTest.getSimulatorComparison();
    const persisted = JSON.parse(sessionStorage.getItem('pension-lab-report-first-session-v1'));
    return {
      pensionDelta: comparison.monthlyPensionRealDelta,
      balanceDelta: comparison.retirementBalanceRealDelta,
      selectedMonthlyContribution: comparison.selectedMonthlyContribution,
      positive: document.querySelector('#headlinePensionComparison').dataset.delta,
      persistedKeys: Object.keys(persisted),
    };
  })()`);
  if (!(changed.pensionDelta > 0 && changed.balanceDelta > 0 && changed.selectedMonthlyContribution === 4200 && changed.positive === 'positive') || changed.persistedKeys.some((key) => /simulator|scenario|controls/i.test(key))) {
    throw new Error(`Combined controls did not produce a session-only positive scenario: ${JSON.stringify(changed)}`);
  }
  if (requests.length !== requestCountBeforeInteraction) throw new Error('Simulator interaction made a network request.');

  await setSlider(cdp, 'nominalReturn', 0.04);
  await setSlider(cdp, 'inflation', 0.03);
  await setSlider(cdp, 'contribution', 0.17);
  await setSlider(cdp, 'depositFee', 0.04);
  await setSlider(cdp, 'balanceFee', 0.01);
  await waitForControl(cdp, 'balanceFee', 0.01);
  await waitFor(async () => Math.abs(Number((await evaluate(cdp, 'window.PensionLabTest.getSimulatorComparison().selectedBalanceFee')) - 0.01)) < 1e-10, 2000, 'negative scenario projection');
  const negative = await evaluate(cdp, '({ delta: window.PensionLabTest.getSimulatorComparison().monthlyPensionRealDelta, visual: document.querySelector("#headlinePensionComparison").dataset.delta })');
  if (!(negative.delta < 0) || negative.visual !== 'negative') throw new Error(`Negative scenario is not represented correctly: ${JSON.stringify(negative)}`);

  await click(cdp, '#resetSimulator');
  await waitFor(async () => (await evaluate(cdp, 'window.PensionLabTest.getSimulatorComparison().monthlyPensionRealDelta')) === 0, 2000, 'global simulator reset');
  const reset = await evaluate(cdp, `(() => ({ controls: window.PensionLabTest.getSimulatorControls(), comparison: window.PensionLabTest.getSimulatorComparison(), text: document.querySelector('#headlinePensionComparison').textContent }))()`);
  if (Math.abs(reset.controls.nominalReturn - 0.0608) > 1e-12 || reset.comparison.retirementBalanceNominalDelta !== 0 || reset.text.includes('+₪0')) {
    throw new Error(`Reset did not restore exact defaults: ${JSON.stringify(reset)}`);
  }
  const keyboardSteps = await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-simulator-input="nominalReturn"]');
    const press = (key) => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const baseline = window.PensionLabTest.getSimulatorControls().nominalReturn;
    press('ArrowRight');
    const right = window.PensionLabTest.getSimulatorControls().nominalReturn;
    press('ArrowLeft');
    const restored = window.PensionLabTest.getSimulatorControls().nominalReturn;
    press('ArrowLeft');
    const left = window.PensionLabTest.getSimulatorControls().nominalReturn;
    press('ArrowRight');
    return { baseline, right, restored, left, final: window.PensionLabTest.getSimulatorControls().nominalReturn };
  })()`);
  if (Math.abs((keyboardSteps.right - keyboardSteps.baseline) - 0.001) > 1e-12 || Math.abs((keyboardSteps.baseline - keyboardSteps.left) - 0.001) > 1e-12 || Math.abs(keyboardSteps.restored - keyboardSteps.baseline) > 1e-12 || Math.abs(keyboardSteps.final - keyboardSteps.baseline) > 1e-12) {
    throw new Error(`Keyboard steps are not symmetric around the exact report baseline: ${JSON.stringify(keyboardSteps)}`);
  }

  await setSlider(cdp, 'nominalReturn', 0.07);
  await waitForControl(cdp, 'nominalReturn', 0.07);
  const realText = await evaluate(cdp, 'document.querySelector("#headlinePension").textContent');
  await click(cdp, '[data-money-mode="nominal"]');
  const nominal = await evaluate(cdp, `({ text: document.querySelector('#headlinePension').textContent, pressed: document.querySelector('[data-money-mode="nominal"]').getAttribute('aria-pressed'), realDelta: window.PensionLabTest.getSimulatorComparison().monthlyPensionRealDelta, nominalDelta: window.PensionLabTest.getSimulatorComparison().monthlyPensionNominalDelta })`);
  if (nominal.pressed !== 'true' || nominal.text === realText || !Number.isFinite(nominal.realDelta) || !Number.isFinite(nominal.nominalDelta)) {
    throw new Error(`Real/nominal scenario comparison is inconsistent: ${JSON.stringify(nominal)}`);
  }

  await click(cdp, '[data-simulator-info="nominalReturn"]');
  const info = await evaluate(cdp, `(() => {
    const button = document.querySelector('[data-simulator-info="nominalReturn"]');
    const panel = document.querySelector('#simulator-nominalReturn-info');
    const input = document.querySelector('[data-simulator-input="nominalReturn"]');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return { hidden: panel.classList.contains('hidden'), expanded: button.getAttribute('aria-expanded'), role: panel.getAttribute('role'), inputValueText: input.getAttribute('aria-valuetext'), focus: document.activeElement === input };
  })()`);
  if (info.hidden || info.expanded !== 'true' || info.role !== 'dialog' || !info.inputValueText || !info.focus) {
    throw new Error(`Info or keyboard accessibility failed: ${JSON.stringify(info)}`);
  }
  console.log('✓ desktop: supported routing, immutable baseline marker, all five controls, reset, real/nominal, info, keyboard and no interaction network');
}

async function runMobileChecks(cdp, baseUrl) {
  await evaluate(cdp, 'sessionStorage.clear()');
  await navigate(cdp, baseUrl, { name: 'mobile-390', width: 390, height: 844 });
  await seedForecast(cdp, supportedState());
  await click(cdp, '[data-simulator-info="inflation"]');
  const mobile = await evaluate(cdp, `(() => {
    const panel = document.querySelector('#simulator-inflation-info');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      infoVisible: !panel.classList.contains('hidden'),
      infoPosition: getComputedStyle(panel).position,
      resultAboveControls: document.querySelector('.forecast-hero').getBoundingClientRect().top < document.querySelector('#simulatorPanel').getBoundingClientRect().top,
      thumbWidth: getComputedStyle(document.querySelector('[data-simulator-input="nominalReturn"]'), '::-webkit-slider-thumb').width,
    };
  })()`);
  if (mobile.overflow > 1 || !mobile.infoVisible || mobile.infoPosition !== 'fixed' || !mobile.resultAboveControls) {
    throw new Error(`Mobile simulator layout or tap info failed: ${JSON.stringify(mobile)}`);
  }
  console.log('✓ mobile-390: no overflow, central result above controls, and tap info bottom sheet');
}

async function captureScreenshot(cdp, fileName) {
  const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const screenshotPath = path.join(projectRoot, 'qa-output', fileName);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`screenshot: ${screenshotPath}`);
}

(async () => {
  const { server, port, requests } = await startServer();
  const devToolsPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pension-lab-simulator-chrome-'));
  const chrome = spawn(chromiumPath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${devToolsPort}`, '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    await waitFor(async () => {
      try { return (await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json()).length > 0; }
      catch (_) { return false; }
    }, 15000, 'Chromium DevTools');
    const target = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/`)}`, { method: 'PUT' })).json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('Network.enable');

    await runDesktopChecks(cdp, `http://127.0.0.1:${port}/`, requests);
    if (process.argv.includes('--capture')) {
      await evaluate(cdp, 'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await captureScreenshot(cdp, 'pr2-simulator-desktop-1440.png');
    }
    await runMobileChecks(cdp, `http://127.0.0.1:${port}/`);

    if (process.argv.includes('--capture')) {
      await captureScreenshot(cdp, 'pr2-simulator-mobile-390.png');
    }
    const missing = requests.filter((request) => request.status === 404);
    const errors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (event.method === 'Network.loadingFailed' && !event.params.canceled));
    if (missing.length) throw new Error(`Simulator browser test produced 404 requests: ${JSON.stringify(missing.slice(0, 10))}`);
    if (errors.length) throw new Error(`Simulator browser errors: ${JSON.stringify(errors.slice(0, 5))}`);
    console.log('Interactive simulator browser test passed.');
  } finally {
    cdp?.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
