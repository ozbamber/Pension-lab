'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') throw new Error('Synthetic demo browser test requires Node.js 22 or newer.');

const projectRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const SESSION_KEY = 'pension-lab-report-first-session-v1';

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
    requests.push({ path: url.pathname, query: url.search, status: valid ? 200 : 404 });
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

async function navigate(cdp, url, viewport) {
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 500 });
  await cdp.command('Page.navigate', { url });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 15000, `${viewport.name} app load`);
}

async function click(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  if (!clicked) throw new Error(`Element not found: ${selector}`);
}

async function setSlider(cdp, key, value) {
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-simulator-input="${key}"]');
    input.value = String(${Number(value)} * 100);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(async () => Math.abs(Number((await evaluate(cdp, `window.PensionLabTest.getSimulatorControls()[${JSON.stringify(key)}]`)) - value)) <= 0.00051, 2000, `${key} slider`);
}

async function setScenario(cdp, controls) {
  await evaluate(cdp, `(() => {
    const controls = ${JSON.stringify(controls)};
    for (const [key, value] of Object.entries(controls)) window.PensionLabTest.setSimulatorControl(key, value);
  })()`);
  await waitFor(async () => {
    const selected = await evaluate(cdp, 'window.PensionLabTest.getSimulatorComparison()');
    return selected &&
      Math.abs(selected.selectedNominalReturn - controls.nominalReturn) < 1e-12 &&
      Math.abs(selected.selectedInflation - controls.inflation) < 1e-12 &&
      Math.abs(selected.selectedMonthlyContribution - 24500 * controls.contribution) < 1e-8 &&
      Math.abs(selected.selectedDepositFee - controls.depositFee) < 1e-12 &&
      Math.abs(selected.selectedBalanceFee - controls.balanceFee) < 1e-12;
  }, 2000, 'combined demo scenario');
  return evaluate(cdp, `(() => {
    const comparison = window.PensionLabTest.getSimulatorComparison();
    return {
      monthlyPensionReal: comparison.scenario.monthlyPensionReal,
      retirementBalanceReal: comparison.scenario.retirementBalanceReal,
      monthlyPensionNominal: comparison.scenario.monthlyPensionNominal,
      retirementBalanceNominal: comparison.scenario.retirementBalanceNominal,
      pensionDeltaReal: comparison.monthlyPensionRealDelta,
      balanceDeltaReal: comparison.retirementBalanceRealDelta,
      impliedRealReturn: comparison.impliedRealReturn,
      visualDelta: document.querySelector('#headlinePensionComparison').dataset.delta,
      headline: document.querySelector('#headlinePension').textContent,
      balanceHeadline: document.querySelector('#headlineBalance').textContent,
    };
  })()`);
}

async function captureScreenshot(cdp, fileName) {
  const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const screenshotPath = path.join(projectRoot, 'qa-output', fileName);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`screenshot: ${screenshotPath}`);
}

function normalSession() {
  return {
    version: 1,
    flowStep: 4,
    yearsUntilRetirement: 12,
    moneyMode: 'real',
    pensionReportState: {
      fundType: 'new_pension',
      supportedForCurrentForecast: true,
      routingReason: 'SUPPORTED_NEW_PENSION',
      currentBalance: 300000,
      provider: 'קרן בדיקת שחזור',
      report: { type: 'annual' },
      fees: { depositRate: 0.008, balanceRate: 0.0015 },
      contributionHistory: [],
      normalizedContributionMonths: [],
      derived: { baselineMonthlyContribution: 4000, averageReportedPensionSalary: 20000, monthsUsed: 3 },
      review: { requiresReview: false, issues: [] },
    },
    userCorrections: {},
  };
}

let passed = 0;
function check(condition, name, details = null) {
  if (!condition) throw new Error(`${name}${details == null ? '' : `: ${JSON.stringify(details)}`}`);
  passed += 1;
  console.log(`✓ ${name}`);
}

function finiteScenario(result) {
  return ['monthlyPensionReal', 'retirementBalanceReal', 'monthlyPensionNominal', 'retirementBalanceNominal', 'pensionDeltaReal', 'balanceDeltaReal', 'impliedRealReturn']
    .every((key) => Number.isFinite(result[key]));
}

(async () => {
  const { server, port, requests } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const devToolsPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pension-lab-demo-chrome-'));
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
    const target = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('Network.enable');

    await navigate(cdp, baseUrl, { name: 'normal-desktop', width: 1440, height: 1000 });
    const normalInitial = await evaluate(cdp, `({
      flowStep: window.PensionLabTest.getFlowStep(),
      demo: window.PensionLabTest.isDemoMode(),
      uploadVisible: !document.querySelector('#uploadStep').classList.contains('hidden'),
      bannerHidden: document.querySelector('#demoBanner').classList.contains('hidden'),
      syntheticProviderVisible: document.body.textContent.includes('קרן לדוגמה')
    })`);
    check(normalInitial.flowStep === 1 && normalInitial.uploadVisible, 'no query opens the normal upload flow', normalInitial);
    check(!normalInitial.demo && normalInitial.bannerHidden && !normalInitial.syntheticProviderVisible, 'normal flow has no demo banner or synthetic data', normalInitial);

    const seededSession = JSON.stringify(normalSession());
    await evaluate(cdp, `sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(seededSession)})`);
    await cdp.command('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__demoStorageAudit = { sessionWrites: 0, sessionRemoves: 0, localWrites: 0, localRemoves: 0, indexedDbOpens: 0 };
      const originalSetItem = Storage.prototype.setItem;
      const originalRemoveItem = Storage.prototype.removeItem;
      Storage.prototype.setItem = function (...args) {
        if (this === window.sessionStorage) window.__demoStorageAudit.sessionWrites += 1;
        if (this === window.localStorage) window.__demoStorageAudit.localWrites += 1;
        return originalSetItem.apply(this, args);
      };
      Storage.prototype.removeItem = function (...args) {
        if (this === window.sessionStorage) window.__demoStorageAudit.sessionRemoves += 1;
        if (this === window.localStorage) window.__demoStorageAudit.localRemoves += 1;
        return originalRemoveItem.apply(this, args);
      };
      if (typeof IDBFactory !== 'undefined') {
        const originalOpen = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...args) {
          window.__demoStorageAudit.indexedDbOpens += 1;
          return originalOpen.apply(this, args);
        };
      }
    })();` });

    await navigate(cdp, `${baseUrl}?demo=1`, { name: 'demo-desktop', width: 1440, height: 1000 });
    await waitFor(() => evaluate(cdp, 'window.PensionLabTest.getFlowStep() === 4 && !document.querySelector("#simulatorPanel").classList.contains("hidden")'), 5000, 'automatic demo forecast');
    const demo = await evaluate(cdp, `(() => {
      const state = window.PensionLabTest.getPensionReportState();
      const baseline = window.PensionLabTest.getSimulatorBaseline();
      const controls = window.PensionLabTest.getSimulatorControls();
      const comparison = window.PensionLabTest.getSimulatorComparison();
      const expected = window.PensionEngine.projectBaseline(state, 25, {
        realReturnRate: window.PensionSimulatorConfig.BASELINE.realReturnRate,
        inflationRate: window.PensionSimulatorConfig.BASELINE.inflationRate,
        coefficient: window.PensionSimulatorConfig.BASELINE.coefficient,
      });
      const keys = ['retirementBalanceReal', 'retirementBalanceNominal', 'monthlyPensionReal', 'monthlyPensionNominal'];
      return {
        isDemo: window.PensionLabTest.isDemoMode(),
        flowStep: window.PensionLabTest.getFlowStep(),
        banner: document.querySelector('#demoBanner').textContent.replace(/\s+/g, ' ').trim(),
        bannerVisible: !document.querySelector('#demoBanner').classList.contains('hidden'),
        title: document.querySelector('#forecastTitle').textContent,
        state,
        years: baseline.yearsUntilRetirement,
        months: baseline.monthsUntilRetirement,
        coefficient: baseline.assumptions.coefficient,
        contributionType: baseline.contribution.type,
        controls,
        controlCount: document.querySelectorAll('[data-simulator-input]').length,
        deltas: [comparison.monthlyPensionRealDelta, comparison.retirementBalanceRealDelta, comparison.monthlyPensionNominalDelta, comparison.retirementBalanceNominalDelta],
        maxProductionDiff: Math.max(...keys.map((key) => Math.abs(expected[key] - baseline.projection[key]))),
        depositTicks: document.querySelector('[data-simulator-control="depositFee"] .simulator-ticks').textContent.replace(/\s+/g, ''),
        balanceTicks: document.querySelector('[data-simulator-control="balanceFee"] .simulator-ticks').textContent.replace(/\s+/g, ''),
        storedSession: sessionStorage.getItem(${JSON.stringify(SESSION_KEY)}),
        storageAudit: { ...window.__demoStorageAudit },
      };
    })()`);
    check(demo.isDemo && demo.flowStep === 4, '?demo=1 opens the simulator automatically', demo);
    check(demo.bannerVisible && demo.banner.includes('מצב הדגמה · נתונים סינתטיים') && demo.title.includes('סינתטית'), 'demo state is persistently and clearly labeled synthetic', demo);
    check(demo.state.fundType === 'new_pension' && demo.state.supportedForCurrentForecast === true, 'demo state satisfies normal new-pension gating', demo.state);
    check(demo.state.currentBalance === 250000 && demo.state.derived.averageReportedPensionSalary === 24500, 'demo balance and reported salary are exact', demo.state.derived);
    check(demo.state.derived.baselineMonthlyContribution === 5103.35 && Math.abs(demo.state.derived.baselineMonthlyContribution / demo.state.derived.averageReportedPensionSalary - 0.2083) < 1e-12, 'demo contribution baseline is ₪5,103.35 and 20.83%', demo.state.derived);
    check(demo.state.fees.depositRate === 0.008 && demo.state.fees.balanceRate === 0.0015, 'demo management fees are stored as 0.8% and 0.15% ratios', demo.state.fees);
    check(demo.state.contributionHistory.length === 12 && demo.state.contributionHistory.every((row) => row.reliable && !row.requiresReview && row.periodType === 'monthly'), 'demo has twelve reliable monthly contribution rows');
    check(demo.years === 25 && demo.months === 300 && demo.coefficient === 200, 'demo uses 25 years, 300 months and coefficient 200', demo);
    check(demo.contributionType === 'rate' && Math.abs(demo.controls.contribution - 0.2083) < 1e-12, 'demo uses the percentage contribution track at its exact baseline', demo.controls);
    check(demo.controlCount === 5 && Object.keys(demo.controls).length === 5, 'demo exposes exactly the five PR2 physical tracks', demo.controls);
    check(demo.deltas.every((value) => value === 0) && demo.maxProductionDiff === 0, 'demo baseline exactly equals the production projection engine result', demo);
    check(demo.depositTicks.includes('0.5%–2.5%') && demo.balanceTicks.includes('0.05%–0.3%'), 'fee reference ticks retain their precise non-zero values', { deposit: demo.depositTicks, balance: demo.balanceTicks });
    check(demo.storedSession === seededSession && demo.storageAudit.sessionWrites === 0 && demo.storageAudit.sessionRemoves === 0, 'demo neither loads into nor overwrites the pre-existing normal session', demo.storageAudit);

    const requestsBeforeInteraction = requests.length;
    await setSlider(cdp, 'nominalReturn', 0.08);
    check(Math.abs((await evaluate(cdp, 'window.PensionLabTest.getSimulatorControls().nominalReturn')) - 0.08) < 1e-12, 'return slider works');
    await setSlider(cdp, 'inflation', 0.03);
    check(Math.abs((await evaluate(cdp, 'window.PensionLabTest.getSimulatorControls().inflation')) - 0.03) < 1e-12, 'inflation slider works');
    await setSlider(cdp, 'contribution', 0.22);
    check(Math.abs((await evaluate(cdp, 'window.PensionLabTest.getSimulatorControls().contribution')) - 0.22) < 0.00051, 'contribution slider works');
    await setSlider(cdp, 'depositFee', 0.005);
    check(Math.abs((await evaluate(cdp, 'window.PensionLabTest.getSimulatorControls().depositFee')) - 0.005) < 1e-12, 'deposit-fee slider works');
    await setSlider(cdp, 'balanceFee', 0.001);
    check(Math.abs((await evaluate(cdp, 'window.PensionLabTest.getSimulatorControls().balanceFee')) - 0.001) < 1e-12, 'balance-fee slider works');

    const optimisticControls = { nominalReturn: 0.08, inflation: 0.02, contribution: 0.2183, depositFee: 0.005, balanceFee: 0.001 };
    const optimistic = await setScenario(cdp, optimisticControls);
    check(finiteScenario(optimistic) && optimistic.pensionDeltaReal > 0 && optimistic.balanceDeltaReal > 0 && optimistic.visualDelta === 'positive', 'optimistic combined scenario produces a positive finite delta', optimistic);
    if (process.argv.includes('--capture')) await captureScreenshot(cdp, 'pr2-demo-desktop-positive-1440.png');

    const conservativeControls = { nominalReturn: 0.04, inflation: 0.03, contribution: 0.185, depositFee: 0.02, balanceFee: 0.003 };
    const conservative = await setScenario(cdp, conservativeControls);
    check(finiteScenario(conservative) && conservative.pensionDeltaReal < 0 && conservative.balanceDeltaReal < 0 && conservative.visualDelta === 'negative', 'conservative combined scenario produces a negative finite delta', conservative);
    if (process.argv.includes('--capture')) await captureScreenshot(cdp, 'pr2-demo-desktop-conservative-1440.png');

    const stressControls = { nominalReturn: 0.02, inflation: 0.1, contribution: 0.15, depositFee: 0.06, balanceFee: 0.02 };
    const stress = await setScenario(cdp, stressControls);
    check(finiteScenario(stress) && stress.impliedRealReturn < 0 && stress.pensionDeltaReal < 0 && stress.visualDelta === 'negative', 'extreme stress scenario supports a negative real return without NaN or Infinity', stress);

    const mixedControls = { nominalReturn: 0.08, inflation: 0.02, contribution: 0.15, depositFee: 0.06, balanceFee: 0.02 };
    const mixed = await setScenario(cdp, mixedControls);
    await click(cdp, '#resetSimulator');
    await waitFor(() => evaluate(cdp, 'window.PensionLabTest.getSimulatorComparison().monthlyPensionRealDelta === 0'), 2000, 'demo reset');
    const highReturnOnly = await setScenario(cdp, { nominalReturn: 0.08, inflation: 0.02, contribution: 0.2083, depositFee: 0.008, balanceFee: 0.0015 });
    check(finiteScenario(mixed) && Math.abs(mixed.monthlyPensionReal - highReturnOnly.monthlyPensionReal) > 1 && mixed.monthlyPensionReal < highReturnOnly.monthlyPensionReal, 'mixed changes are projected as one combined scenario, not a one-variable result', { mixed, highReturnOnly });

    await click(cdp, '#resetSimulator');
    await waitFor(() => evaluate(cdp, 'window.PensionLabTest.getSimulatorComparison().monthlyPensionRealDelta === 0'), 2000, 'exact demo reset');
    const reset = await evaluate(cdp, `({
      controls: window.PensionLabTest.getSimulatorControls(),
      deltas: [window.PensionLabTest.getSimulatorComparison().monthlyPensionRealDelta, window.PensionLabTest.getSimulatorComparison().retirementBalanceNominalDelta],
      comparisonText: document.querySelector('#headlinePensionComparison').textContent
    })`);
    check(Math.abs(reset.controls.contribution - 0.2083) < 1e-12 && reset.deltas.every((value) => value === 0) && !reset.comparisonText.includes('+₪0'), 'reset returns to the exact calm demo baseline', reset);
    if (process.argv.includes('--capture')) await captureScreenshot(cdp, 'pr2-demo-desktop-1440.png');

    await setScenario(cdp, optimisticControls);
    const realHeadline = await evaluate(cdp, 'document.querySelector("#headlinePension").textContent');
    await click(cdp, '[data-money-mode="nominal"]');
    const modes = await evaluate(cdp, `({
      nominalHeadline: document.querySelector('#headlinePension').textContent,
      nominalPressed: document.querySelector('[data-money-mode="nominal"]').getAttribute('aria-pressed'),
      realDelta: window.PensionLabTest.getSimulatorComparison().monthlyPensionRealDelta,
      nominalDelta: window.PensionLabTest.getSimulatorComparison().monthlyPensionNominalDelta
    })`);
    check(modes.nominalPressed === 'true' && modes.nominalHeadline !== realHeadline && Number.isFinite(modes.realDelta) && Number.isFinite(modes.nominalDelta), 'real and nominal display modes use matching finite comparison bases', modes);

    await click(cdp, '[data-simulator-info="nominalReturn"]');
    const desktopInfo = await evaluate(cdp, `({
      visible: !document.querySelector('#simulator-nominalReturn-info').classList.contains('hidden'),
      role: document.querySelector('#simulator-nominalReturn-info').getAttribute('role'),
      expanded: document.querySelector('[data-simulator-info="nominalReturn"]').getAttribute('aria-expanded')
    })`);
    check(desktopInfo.visible && desktopInfo.role === 'dialog' && desktopInfo.expanded === 'true', 'desktop info opens accessibly by click', desktopInfo);

    const privacy = await evaluate(cdp, `({
      storedSession: sessionStorage.getItem(${JSON.stringify(SESSION_KEY)}),
      localKeys: Object.keys(localStorage),
      audit: { ...window.__demoStorageAudit }
    })`);
    check(privacy.storedSession === seededSession && privacy.audit.sessionWrites === 0 && privacy.audit.sessionRemoves === 0, 'demo controls and money mode remain memory-only', privacy);
    check(privacy.localKeys.length === 0 && privacy.audit.localWrites === 0 && privacy.audit.localRemoves === 0 && privacy.audit.indexedDbOpens === 0, 'demo uses no localStorage or IndexedDB', privacy);
    check(requests.length === requestsBeforeInteraction, 'demo interaction causes no network request', { before: requestsBeforeInteraction, after: requests.length });

    await navigate(cdp, `${baseUrl}?demo=1`, { name: 'demo-mobile-390', width: 390, height: 844 });
    await waitFor(() => evaluate(cdp, 'window.PensionLabTest.getFlowStep() === 4'), 5000, 'mobile demo forecast');
    await click(cdp, '[data-simulator-info="inflation"]');
    const mobile = await evaluate(cdp, `(() => {
      const input = document.querySelector('[data-simulator-input="nominalReturn"]');
      const ticks = input.closest('[data-simulator-control]').querySelectorAll('.simulator-ticks > span');
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        bannerVisible: !document.querySelector('#demoBanner').classList.contains('hidden'),
        controls: document.querySelectorAll('[data-simulator-input]').length,
        resultAboveControls: document.querySelector('.forecast-hero').getBoundingClientRect().top < document.querySelector('#simulatorPanel').getBoundingClientRect().top,
        infoPosition: getComputedStyle(document.querySelector('#simulator-inflation-info')).position,
        direction: getComputedStyle(input).direction,
        minTickLeft: ticks[0].getBoundingClientRect().left,
        maxTickLeft: ticks[2].getBoundingClientRect().left,
        storedSession: sessionStorage.getItem(${JSON.stringify(SESSION_KEY)}),
      };
    })()`);
    check(mobile.overflow <= 1 && mobile.bannerVisible && mobile.controls === 5 && mobile.resultAboveControls, '390px demo layout has no horizontal overflow and keeps result above controls', mobile);
    check(mobile.infoPosition === 'fixed', 'mobile info opens as an accessible bottom sheet', mobile);
    check(mobile.direction === 'ltr' && mobile.minTickLeft < mobile.maxTickLeft, 'RTL page keeps numeric slider progression left to right', mobile);
    check(mobile.storedSession === seededSession, 'mobile demo reload still leaves the normal session untouched');
    if (process.argv.includes('--capture')) await captureScreenshot(cdp, 'pr2-demo-mobile-390.png');

    await click(cdp, '#exitDemo');
    await waitFor(() => evaluate(cdp, '!new URL(location.href).searchParams.has("demo") && Boolean(window.PensionLabTest) && !window.PensionLabTest.isDemoMode()'), 10000, 'demo exit and normal restore');
    const exited = await evaluate(cdp, `({
      url: location.href,
      flowStep: window.PensionLabTest.getFlowStep(),
      balance: window.PensionLabTest.getPensionReportState()?.currentBalance,
      bannerHidden: document.querySelector('#demoBanner').classList.contains('hidden'),
      restoreNotice: !document.querySelector('#sessionRestoreNotice').classList.contains('hidden'),
      storedSession: sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})
    })`);
    check(!new URL(exited.url).searchParams.has('demo') && exited.flowStep === 4 && exited.balance === 300000 && exited.bannerHidden && exited.restoreNotice, 'leaving demo restores the previous normal session', exited);
    check(exited.storedSession === seededSession, 'demo exit does not erase or rewrite the previous session');

    await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify({ ...normalSession().pensionReportState, fundType: 'old_pension', supportedForCurrentForecast: false })})`);
    const oldHidden = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
    await evaluate(cdp, `window.PensionLabTest.setPensionReportState(${JSON.stringify({ ...normalSession().pensionReportState, fundType: 'unknown', supportedForCurrentForecast: false })})`);
    const unknownHidden = await evaluate(cdp, 'document.querySelector("#simulatorPanel").classList.contains("hidden")');
    check(oldHidden && unknownHidden, 'old and unknown normal pension routing remain blocked');

    const missing = requests.filter((request) => request.status === 404);
    const errors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (event.method === 'Network.loadingFailed' && !event.params.canceled));
    check(missing.length === 0 && errors.length === 0, 'demo browser run has no 404, console, runtime or network errors', { missing: missing.slice(0, 5), errors: errors.slice(0, 3) });

    console.log(`Manual demo scenario results: ${JSON.stringify({ optimistic, conservative, stress, mixed })}`);
    console.log(`All ${passed} synthetic-demo browser checks passed.`);
  } finally {
    cdp?.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
