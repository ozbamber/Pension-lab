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
    contributionHistory: [],
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
    const baseline = window.PensionLabTest.getSimulatorBaseline();
    const config = baseline.controlsConfig[${JSON.stringify(key)}];
    const input = document.querySelector('[data-simulator-input="${key}"]');
    input.value = String(window.PensionSimulator.valueToPosition(config, ${Number(value)}));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function waitForControl(cdp, key, expected) {
  await waitFor(async () => Math.abs(Number((await evaluate(cdp, `window.PensionLabTest.getSimulatorControls()[${JSON.stringify(key)}]`)) - expected)) < 1e-10, 2000, `${key} slider update`);
}

async function runDesktopChecks(cdp, baseUrl, requests) {
  await navigate(cdp, baseUrl, { name: 'desktop', width: 1440, height: 1000 });
  const initial = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
  if (!initial) throw new Error('Simulator is visible before a supported report baseline exists.');

  await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify(supportedState({ fundType: 'old_pension', supportedForCurrentForecast: false }))})`);
  const oldHidden = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
  if (!oldHidden) throw new Error('Simulator is exposed for an old-pension state.');

  await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify(supportedState({ fundType: 'unknown', supportedForCurrentForecast: false }))})`);
  const unknownHidden = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
  if (!unknownHidden) throw new Error('Simulator is exposed for an unknown-fund state.');

  await seedForecast(cdp, supportedState());
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
