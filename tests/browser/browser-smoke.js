'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') throw new Error('Browser smoke requires Node.js 22 or newer.');

const projectRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const reportFixture = path.join(projectRoot, 'dataset', 'documents', 'pension_report', 'high', 'pension-report-03-fee_heavy.pdf');

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
    '.mjs': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.gz': 'application/gzip',
    '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf',
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
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function setFile(cdp, selector, filePath) {
  const documentNode = await cdp.command('DOM.getDocument', { depth: 1 });
  const selected = await cdp.command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
  if (!selected.nodeId) throw new Error(`Input not found: ${selector}`);
  await cdp.command('DOM.setFileInputFiles', { nodeId: selected.nodeId, files: [filePath] });
}

async function click(cdp, selector) {
  const result = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  if (!result) throw new Error(`Element not found: ${selector}`);
}

async function runRoutingUiChecks(cdp, baseUrl) {
  await cdp.command('Page.navigate', { url: baseUrl });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 20000, 'routing UI app load');

  const oldState = await evaluate(cdp, `window.PensionLabTest.applyParsedText(${JSON.stringify('דוח שנתי קרן פנסיה ותיקה לשנת 2025')})`);
  const oldUi = await evaluate(cdp, `({
    flow: window.PensionLabTest.getFlowStep(),
    message: document.querySelector('#routingMessage').textContent,
    metricsHidden: document.querySelector('#reviewMetrics').classList.contains('hidden'),
    historyHidden: document.querySelector('#contributionDisclosure').classList.contains('hidden'),
    continueHidden: document.querySelector('#continueToYears').classList.contains('hidden')
  })`);
  if (oldState.fundType !== 'old_pension' || oldState.supportedForCurrentForecast !== false) throw new Error('Old-pension text was not routed to the unsupported state.');
  if (oldUi.flow !== 2 || !oldUi.message.includes('זכויות') || !oldUi.metricsHidden || !oldUi.historyHidden || !oldUi.continueHidden) {
    throw new Error(`Old-pension review did not fail closed: ${JSON.stringify(oldUi)}`);
  }

  await evaluate(cdp, 'window.PensionLabTest.reset()');
  const unknownState = await evaluate(cdp, `window.PensionLabTest.applyParsedText(${JSON.stringify('דוח פנסיה כללי לשנת 2025')})`);
  const unknownUi = await evaluate(cdp, `({
    flow: window.PensionLabTest.getFlowStep(),
    confirmationVisible: !document.querySelector('#fundTypeConfirmationWrap').classList.contains('hidden'),
    continueDisabled: document.querySelector('#continueToYears').disabled
  })`);
  if (unknownState.fundType !== 'unknown' || unknownState.supportedForCurrentForecast !== false || !unknownState.review.requiresReview) {
    throw new Error('Unknown fund type was not held for confirmation.');
  }
  if (unknownUi.flow !== 2 || !unknownUi.confirmationVisible || !unknownUi.continueDisabled) throw new Error(`Unknown-fund review did not require confirmation: ${JSON.stringify(unknownUi)}`);

  const confirmed = await evaluate(cdp, `(() => {
    const select = document.querySelector('#fundTypeConfirmation');
    select.value = 'new_pension';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return window.PensionLabTest.getPensionReportState();
  })()`);
  if (confirmed.fundType !== 'new_pension' || confirmed.supportedForCurrentForecast !== true || confirmed.decision.automaticAccepted !== false) {
    throw new Error('Explicit user confirmation did not create a manual new-pension route.');
  }
  await evaluate(cdp, 'window.PensionLabTest.reset()');
  console.log('✓ routing UI: old pension blocked; unknown requires explicit confirmation');
}

async function runFlow(cdp, baseUrl, viewport) {
  await cdp.command('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 500 });
  await cdp.command('Page.navigate', { url: baseUrl });
  await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 20000, `${viewport.name} app load`);

  const initial = await evaluate(cdp, `({
    flow: window.PensionLabTest.getFlowStep(),
    hasPayslip: Boolean(document.querySelector('#salarySlipFile')),
    hasCurrentAge: Boolean(document.querySelector('#currentAge, #currentAgeDisplay')),
    hasRetirementAge: Boolean(document.querySelector('#retirementAge, #retirementAgeMirror')),
    mentionsPayslip: document.body.innerText.includes('תלוש'),
    dir: document.documentElement.dir,
    overflow: document.documentElement.scrollWidth - window.innerWidth
  })`);
  if (initial.flow !== 1) throw new Error(`${viewport.name}: initial flow is not upload.`);
  if (initial.hasPayslip || initial.mentionsPayslip) throw new Error(`${viewport.name}: payslip remains in the primary product.`);
  if (initial.hasCurrentAge || initial.hasRetirementAge) throw new Error(`${viewport.name}: age fields remain in the primary product.`);
  if (initial.dir !== 'rtl') throw new Error(`${viewport.name}: document is not RTL.`);
  if (initial.overflow > 1) throw new Error(`${viewport.name}: horizontal overflow on upload (${initial.overflow}px).`);

  await setFile(cdp, '#pensionReportFile', reportFixture);
  await waitFor(async () => Boolean(await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")')), 60000, `${viewport.name} report extraction`);
  await waitFor(async () => !(await evaluate(cdp, 'window.PensionLabTest.isReportProcessing()')), 60000, `${viewport.name} extraction completion`);
  const review = await evaluate(cdp, `({
    flow: window.PensionLabTest.getFlowStep(),
    state: window.PensionLabTest.getPensionReportState(),
    balance: Number(document.querySelector('#currentBalance').value),
    contribution: Number(document.querySelector('#baselineMonthlyContribution').value),
    overflow: document.documentElement.scrollWidth - window.innerWidth
  })`);
  if (review.flow !== 2) throw new Error(`${viewport.name}: report did not advance to review.`);
  if (!(review.state?.derived?.monthsUsed >= 1)) throw new Error(`${viewport.name}: contribution history was not normalized.`);
  if (!(review.balance > 0 && review.contribution > 0)) throw new Error(`${viewport.name}: critical report values were not populated.`);
  if (review.overflow > 1) throw new Error(`${viewport.name}: horizontal overflow on review (${review.overflow}px).`);

  await click(cdp, '#continueToYears');
  await waitFor(() => evaluate(cdp, 'window.PensionLabTest.getFlowStep() === 3'), 5000, `${viewport.name} years step`);
  await evaluate(cdp, `(() => { const input = document.querySelector('#yearsUntilRetirement'); input.value = '12'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(cdp, '#calculateForecast');
  await waitFor(() => evaluate(cdp, 'window.PensionLabTest.getFlowStep() === 4'), 5000, `${viewport.name} forecast step`);
  const forecast = await evaluate(cdp, `({
    projection: window.PensionLabTest.getProjection(),
    pension: document.querySelector('#headlinePension').textContent,
    hasAdvanced: Boolean(document.querySelector('#advancedShell, #comparisonPanel, #improvePanel')),
    overflow: document.documentElement.scrollWidth - window.innerWidth
  })`);
  if (forecast.projection?.monthsUntilRetirement !== 144 || forecast.projection?.months !== 144) throw new Error(`${viewport.name}: 12 years did not produce exactly 144 months.`);
  if (!forecast.pension.includes('₪')) throw new Error(`${viewport.name}: baseline pension was not rendered.`);
  if (forecast.hasAdvanced) throw new Error(`${viewport.name}: PR2 controls are exposed in PR1.`);
  if (forecast.overflow > 1) throw new Error(`${viewport.name}: horizontal overflow on forecast (${forecast.overflow}px).`);

  const realPension = forecast.pension;
  await click(cdp, '[data-money-mode="nominal"]');
  const nominal = await evaluate(cdp, `({ pension: document.querySelector('#headlinePension').textContent, pressed: document.querySelector('[data-money-mode="nominal"]').getAttribute('aria-pressed') })`);
  if (nominal.pressed !== 'true' || nominal.pension === realPension) throw new Error(`${viewport.name}: real/nominal display did not update consistently.`);

  return { name: viewport.name, monthsUsed: review.state.derived.monthsUsed, balance: review.balance, contribution: review.contribution };
}

(async () => {
  if (!fs.existsSync(reportFixture)) throw new Error(`Missing report fixture: ${reportFixture}`);
  const { server, port, requests } = await startServer();
  const devToolsPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pension-lab-report-first-chrome-'));
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
    await cdp.command('DOM.enable');
    await cdp.command('Network.enable');

    await runRoutingUiChecks(cdp, `http://127.0.0.1:${port}/`);

    const results = [];
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile-390', width: 390, height: 844 }]) {
      await evaluate(cdp, 'sessionStorage.clear()');
      results.push(await runFlow(cdp, `http://127.0.0.1:${port}/`, viewport));
      if (process.argv.includes('--capture')) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const screenshotPath = path.join(os.tmpdir(), `pension-lab-${viewport.name}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
        console.log(`  screenshot: ${screenshotPath}`);
      }
      console.log(`✓ ${viewport.name}: report-only flow, exact horizon, real/nominal, no overflow`);
    }

    const missing = requests.filter((request) => request.status === 404);
    const browserErrors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') ||
      (event.method === 'Network.loadingFailed' && !event.params.canceled));
    if (missing.length) throw new Error(`Browser smoke produced 404 requests: ${JSON.stringify(missing.slice(0, 10))}`);
    if (browserErrors.length) throw new Error(`Browser smoke errors: ${JSON.stringify(browserErrors.slice(0, 5))}`);
    console.log(`Browser smoke passed in ${results.length} viewports. Extracted months: ${results.map((item) => `${item.name}=${item.monthsUsed}`).join(', ')}.`);
  } finally {
    cdp?.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
