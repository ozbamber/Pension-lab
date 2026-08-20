const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
  throw new Error('ocr-browser-tests.js requires Node.js 22 or newer.');
}

const projectRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const nativeFixture = path.join(projectRoot, 'tests', 'fixtures', 'payslips', 'synthetic-native-text-payslip.pdf');
const scannedFixture = path.join(projectRoot, 'tests', 'fixtures', 'payslips', 'synthetic-scanned-payslip.pdf');

function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chromium was not found. Set CHROMIUM_PATH.');
  return found;
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
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm', '.gz': 'application/gzip', '.pdf': 'application/pdf',
    '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  }[extension] || 'application/octet-stream';
}

async function startServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
    const absolute = path.resolve(appRoot, relative);
    requests.push({ method: request.method, url: url.pathname });
    if (!absolute.startsWith(`${appRoot}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime(absolute),
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    fs.createReadStream(absolute).pipe(response);
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, port, requests };
}

class CDP {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }
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
        return;
      }
      this.events.push(message);
      if (message.method === 'Target.attachedToTarget') {
        const sessionId = message.params.sessionId;
        this.command('Network.enable', {}, 20000, sessionId).catch(() => {});
        this.command('Runtime.enable', {}, 20000, sessionId).catch(() => {});
        this.command('Runtime.runIfWaitingForDebugger', {}, 20000, sessionId).catch(() => {});
      }
    });
  }
  command(method, params = {}, timeoutMs = 20000, sessionId = null) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { if (this.ws) this.ws.close(); }
}

async function evaluate(cdp, expression) {
  const response = await cdp.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed.');
  return response.result && response.result.value;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function setFile(cdp, selector, filePath) {
  const documentNode = await cdp.command('DOM.getDocument', { depth: 1 });
  const selected = await cdp.command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
  if (!selected.nodeId) throw new Error(`Input was not found: ${selector}`);
  await cdp.command('DOM.setFileInputFiles', { nodeId: selected.nodeId, files: [filePath] });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  if (!fs.existsSync(nativeFixture) || !fs.existsSync(scannedFixture)) throw new Error('Synthetic PDF fixtures are missing.');
  const { server, port, requests } = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  const devToolsPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pension-lab-ocr-chrome-'));
  const chrome = spawn(chromiumPath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${devToolsPort}`, '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    let pages;
    await waitFor(async () => {
      try { pages = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json(); return pages.length > 0; }
      catch (_) { return false; }
    }, 15000, 'Chromium DevTools');
    const targetResponse = await fetch(`http://127.0.0.1:${devToolsPort}/json/new?${encodeURIComponent(`${origin}/index.html`)}`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`Could not create Chromium target: ${targetResponse.status}`);
    const target = await targetResponse.json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('DOM.enable');
    await cdp.command('Network.enable');
    await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    try {
      await waitFor(() => evaluate(cdp, `location.origin === ${JSON.stringify(origin)} && document.readyState === "complete" && Boolean(document.querySelector("#salarySlipFile"))`), 20000, 'application load');
    } catch (error) {
      const diagnostic = await evaluate(cdp, '({ href: location.href, ready: document.readyState, title: document.title })');
      throw new Error(`${error.message} ${JSON.stringify(diagnostic)} requests=${JSON.stringify(requests.slice(-5))}`);
    }

    const nativeRequestStart = cdp.events.length;
    await setFile(cdp, '#salarySlipFile', nativeFixture);
    try {
      await waitFor(async () => {
        const document = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("payslip")');
        return document && document.method === 'pdf-text';
      }, 30000, 'native PDF extraction');
    } catch (error) {
      const diagnostic = await evaluate(cdp, '({ status: document.getElementById("salarySlipStatus").textContent, selected: window.PensionLabTest.getSelectedDocument("payslip"), processing: window.PensionLabTest.isPayslipProcessing() })');
      const exceptions = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded').slice(-4);
      throw new Error(`${error.message} diagnostic=${JSON.stringify(diagnostic)} exceptions=${JSON.stringify(exceptions)} requests=${JSON.stringify(requests.slice(-12))}`);
    }
    const nativeDocument = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("payslip")');
    assert(nativeDocument.method === 'pdf-text', 'Native fixture did not use the PDF text path.');
    assert(nativeDocument.fields.insuredSalary.value === 23500, 'Native fixture insured salary was not extracted.');
    const nativeUrls = cdp.events.slice(nativeRequestStart)
      .filter((event) => event.method === 'Network.requestWillBeSent')
      .map((event) => event.params.request.url);
    assert(!nativeUrls.some((url) => /tesseract|tessdata/i.test(url)), 'Native PDF loaded OCR assets unnecessarily.');
    console.log('✓ native text PDF used pdf-text and did not invoke OCR');

    const scanEventStart = cdp.events.length;
    const scanServerStart = requests.length;
    await setFile(cdp, '#salarySlipFile', scannedFixture);
    await waitFor(async () => {
      const document = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("payslip")');
      return document && document.method === 'ocr';
    }, 180000, 'local OCR extraction');
    const scannedDocument = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("payslip")');
    assert(scannedDocument.fields.insuredSalary.value === 23500, `OCR insured salary mismatch: ${JSON.stringify(scannedDocument.fields)}.`);
    assert(Math.abs(scannedDocument.fields.employeeContributionRate.value - 0.07) < 0.001, 'OCR employee contribution mismatch.');
    assert(Math.abs(scannedDocument.fields.employerContributionRate.value - 0.065) < 0.001, 'OCR employer contribution mismatch.');
    assert(Math.abs(scannedDocument.fields.severanceRate.value - 0.0833) < 0.001, `OCR severance contribution mismatch: ${JSON.stringify(scannedDocument.fields.severanceRate)}.`);
    assert(scannedDocument.fields.insuredSalary.requiresConfirmation, 'OCR salary did not require review.');
    const review = await evaluate(cdp, `(() => {
      document.getElementById('continueToReviewBtn').click();
      return {
        visible: !document.getElementById('reviewShell').classList.contains('hidden'),
        salary: Number(document.getElementById('pensionableSalary').value),
        employee: Number(document.getElementById('employeeRate').value),
        employer: Number(document.getElementById('employerRate').value),
        severance: Number(document.getElementById('severanceRate').value),
        source: window.PensionLabTest.getFieldSource('pensionableSalary')
      };
    })()`);
    assert(review.visible && review.salary === 23500, 'OCR values did not flow into the existing review screen.');
    assert(Math.abs(review.employee - 7) < 0.01 && Math.abs(review.employer - 6.5) < 0.01 && Math.abs(review.severance - 8.33) < 0.02, `Contribution values were not editable review inputs: ${JSON.stringify(review)}.`);
    assert(review.source === 'payslip', 'Direct OCR provenance was not preserved in review.');

    const scanEvents = cdp.events.slice(scanEventStart).filter((event) => event.method === 'Network.requestWillBeSent');
    const scanUrls = scanEvents.map((event) => event.params.request.url);
    assert(scanUrls.some((url) => /vendor\/tesseract\/tesseract\.min\.js/.test(url)), 'OCR runtime was not lazy-loaded.');
    assert(requests.slice(scanServerStart).some((request) => /vendor\/tessdata\/heb\.traineddata\.gz/.test(request.url)), 'Hebrew data was not served locally.');
    assert(requests.slice(scanServerStart).some((request) => /vendor\/tessdata\/eng\.traineddata\.gz/.test(request.url)), 'English data was not served locally.');
    assert(scanEvents.every((event) => {
      const request = event.params.request;
      return request.url.startsWith(origin) || request.url.startsWith('blob:') || request.url.startsWith('data:');
    }), 'A scanned-PDF processing request left the application origin.');
    assert(scanEvents.every((event) => !event.params.request.postData), 'Document processing transmitted request bodies.');
    assert(requests.slice(scanServerStart).every((request) => request.method === 'GET'), 'OCR used a non-GET request.');
    console.log('✓ scanned PDF used local heb+eng OCR and extracted all pension fields');
    console.log('✓ network inspection found only same-origin GET asset requests and no request bodies');

    await evaluate(cdp, `(() => {
      document.querySelector('[data-retirement-track="male"]').click();
      document.getElementById('confirmContributionDefaults').checked = true;
      document.getElementById('confirmContributionDefaults').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('generateForecastBtn').click();
      return true;
    })()`);
    const stored = await evaluate(cdp, 'JSON.stringify(Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])))');
    assert(!stored.includes('synthetic-scanned-payslip.pdf'), 'Filename was persisted in session storage.');
    assert(!stored.includes('Pensionable salary'), 'OCR text was persisted in session storage.');
    await cdp.command('Page.reload');
    await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 20000, 'session refresh');
    const restored = await evaluate(cdp, '({ state: window.PensionLabTest.getState(), source: window.PensionLabTest.getFieldSource("pensionableSalary") })');
    assert(restored.state.profile.pensionableSalary === 23500 && Math.abs(restored.state.contribution.employeeRate - 0.07) < 0.001, 'Confirmed numeric values did not survive session refresh.');
    assert(restored.source === 'payslip', 'Document provenance did not survive session refresh.');
    console.log('✓ confirmed values survived refresh while raw PDF, filename and OCR text did not persist');

    await evaluate(cdp, '(() => { window.confirm = () => true; document.getElementById("resetBtn").click(); return true; })()');
    await cdp.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    await evaluate(cdp, 'document.getElementById("salarySlipFile").value = ""');
    await setFile(cdp, '#salarySlipFile', scannedFixture);
    const mobileProgress = await evaluate(cdp, `(() => {
      const panel = document.getElementById('salarySlipProcessing');
      const cancel = document.getElementById('cancelPayslipProcessing');
      return { active: window.PensionLabTest.isPayslipProcessing(), visible: !panel.classList.contains('hidden'), cancelHeight: cancel.getBoundingClientRect().height };
    })()`);
    assert(mobileProgress.active && mobileProgress.visible && mobileProgress.cancelHeight >= 34, 'Mobile OCR progress/cancel UI was not usable.');
    await waitFor(async () => {
      const document = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("payslip")');
      return document && document.method === 'ocr';
    }, 180000, 'mobile local OCR extraction');
    const mobileLayout = await evaluate(cdp, '({ body: document.body.scrollWidth, document: document.documentElement.scrollWidth, inner: innerWidth })');
    assert(mobileLayout.body <= mobileLayout.inner + 1 && mobileLayout.document <= mobileLayout.inner + 1, 'Mobile OCR flow has horizontal overflow.');
    console.log('✓ mobile OCR progress, extraction and overflow checks passed at 390×844');

    const stateBeforeCancel = await evaluate(cdp, 'JSON.stringify(window.PensionLabTest.getState())');
    await evaluate(cdp, 'document.getElementById("salarySlipFile").value = ""');
    await setFile(cdp, '#salarySlipFile', scannedFixture);
    const cancellationStarted = await evaluate(cdp, '(() => { const active = window.PensionLabTest.isPayslipProcessing(); window.PensionLabTest.cancelPayslipProcessing(); return active; })()');
    assert(cancellationStarted, 'The cancel action was not available during processing.');
    await waitFor(() => evaluate(cdp, '!window.PensionLabTest.isPayslipProcessing()'), 30000, 'OCR cancellation');
    const stateAfterCancel = await evaluate(cdp, 'JSON.stringify(window.PensionLabTest.getState())');
    assert(stateBeforeCancel === stateAfterCancel, 'Cancellation changed confirmed session values.');
    const cancelStatus = await evaluate(cdp, 'document.getElementById("salarySlipStatus").textContent');
    assert(cancelStatus.includes('בוטלה'), `Cancellation status was not shown: ${cancelStatus}`);
    console.log('✓ cancel terminated processing without changing session values');

    const errors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'));
    assert(errors.length === 0, `Browser errors were reported: ${JSON.stringify(errors.slice(0, 2))}`);
    console.log('All 5 browser OCR/privacy tests passed.');
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

function windowBoolean(value) {
  return Boolean(value);
}
