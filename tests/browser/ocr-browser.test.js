'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') throw new Error('OCR browser test requires Node.js 22 or newer.');

const projectRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const nativeFixture = path.join(projectRoot, 'dataset', 'documents', 'pension_report', 'high', 'pension-report-03-fee_heavy.pdf');
const scannedFixture = path.join(projectRoot, 'dataset', 'documents', 'pension_report', 'degraded', 'degraded-11-pension-report-05-provider_modern.pdf');

function chromiumPath() {
  const candidates = [process.env.CHROMIUM_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chromium was not found. Set CHROMIUM_PATH.');
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

function mime(filePath) {
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream',
    '.pfb': 'application/octet-stream', '.ttf': 'font/ttf',
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function startServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const absolute = path.resolve(appRoot, relative);
    const valid = absolute.startsWith(`${appRoot}${path.sep}`) && fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    requests.push({ method: request.method, path: url.pathname, status: valid ? 200 : 404, bodyBytes: Number(request.headers['content-length'] || 0) });
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
    await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }); });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result || {});
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

async function setFile(cdp, filePath) {
  const documentNode = await cdp.command('DOM.getDocument', { depth: 1 });
  const selected = await cdp.command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#pensionReportFile' });
  if (!selected.nodeId) throw new Error('Pension report input was not found.');
  await cdp.command('DOM.setFileInputFiles', { nodeId: selected.nodeId, files: [filePath] });
}

async function startProgressRecording(cdp) {
  await evaluate(cdp, `(() => {
    const track = document.getElementById('processingTrack');
    const bar = document.getElementById('processingBar');
    const panel = document.getElementById('reportProcessing');
    if (!track || !bar || !panel) throw new Error('OCR progress controls were not found.');
    window.__ocrProgressEvents = [];
    if (track.__pensionLabOriginalSetAttribute) return;
    track.__pensionLabOriginalSetAttribute = track.setAttribute.bind(track);
    track.setAttribute = (name, value) => {
      track.__pensionLabOriginalSetAttribute(name, value);
      if (name !== 'aria-valuenow') return;
      window.__ocrProgressEvents.push({
        ariaValue: Number(value),
        barWidth: Number.parseFloat(bar.style.width || '0'),
        active: !panel.classList.contains('hidden'),
      });
    };
  })()`);
}

async function progressEvents(cdp) {
  return evaluate(cdp, 'window.__ocrProgressEvents || []');
}

function assertMonotonic(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    assert(values[index] >= values[index - 1], `${label} moved backwards: ${values[index - 1]} -> ${values[index]}.`);
  }
}

function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  if (!fs.existsSync(nativeFixture) || !fs.existsSync(scannedFixture)) throw new Error('Pension report fixtures are missing.');
  const { server, port, requests } = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  const devToolsPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pension-lab-report-ocr-'));
  const chrome = spawn(chromiumPath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${devToolsPort}`, '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    await waitFor(async () => { try { return (await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json()).length > 0; } catch (_) { return false; } }, 15000, 'Chromium DevTools');
    const target = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/new?${encodeURIComponent(`${origin}/`)}`, { method: 'PUT' })).json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.command('Page.enable'); await cdp.command('Runtime.enable'); await cdp.command('DOM.enable'); await cdp.command('Network.enable');
    await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 20000, 'application load');

    const nativeRequestStart = requests.length;
    await setFile(cdp, nativeFixture);
    await waitFor(async () => (await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")?.method')) === 'pdf-text', 60000, 'native report extraction');
    const nativeDocument = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")');
    assert(nativeDocument.pensionReportState.currentBalance === 340842, 'Native report balance was not extracted.');
    assert(nativeDocument.pensionReportState.derived.monthsUsed === 5, 'Native report contribution history was not normalized.');
    const nativeRequests = requests.slice(nativeRequestStart);
    assert(!nativeRequests.some((request) => /tesseract|tessdata/.test(request.path)), 'Healthy text PDF loaded OCR assets.');
    console.log('✓ native pension report used PDF text and normalized five contribution months without OCR');

    await evaluate(cdp, 'window.PensionLabTest.reset()');
    const scanRequestStart = requests.length;
    await startProgressRecording(cdp);
    await setFile(cdp, scannedFixture);
    await waitFor(() => evaluate(cdp, `(() => {
      const panel = document.getElementById('reportProcessing');
      const track = document.getElementById('processingTrack');
      return !panel.classList.contains('hidden') && track.getAttribute('aria-valuenow') === '100';
    })()`), 180000, 'visible OCR completion state');
    assert((await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")')) === null, 'OCR review opened before the visible completion state was painted.');
    await waitFor(async () => (await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")?.method')) === 'ocr', 180000, 'scanned report OCR');
    const scannedDocument = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")');
    assert(scannedDocument.pensionReportState.derived.monthsUsed >= 1, 'OCR report did not preserve a reliable contribution month.');
    assert((await evaluate(cdp, 'window.PensionLabTest.getFlowStep()')) === 2, 'OCR report did not reach the review step.');
    const scanRequests = requests.slice(scanRequestStart);
    for (const required of ['tesseract.min.js', 'worker.min.js', 'tesseract-core-lstm.wasm.js', 'heb.traineddata.gz', 'eng.traineddata.gz']) {
      assert(scanRequests.some((request) => request.path.includes(required)), `Missing local OCR asset request: ${required}`);
    }
    assert(scanRequests.every((request) => request.method === 'GET' && request.bodyBytes === 0), 'Document processing sent request bodies or non-GET requests.');
    console.log('✓ scanned pension report used same-origin local OCR and reached editable review');

    const completedProgress = await progressEvents(cdp);
    const activeProgress = completedProgress.filter((event) => event.active);
    const ariaValues = activeProgress.map((event) => event.ariaValue);
    const barWidths = activeProgress.map((event) => event.barWidth);
    assert(activeProgress.length >= 5, `OCR progress exposed too few updates: ${JSON.stringify(activeProgress)}.`);
    assertMonotonic(ariaValues, 'OCR aria-valuenow');
    assertMonotonic(barWidths, 'OCR progress bar');
    assert(activeProgress.some((event) => event.ariaValue === 100 && event.barWidth === 100), 'OCR progress did not reach 100% before completion.');
    assert((await evaluate(cdp, 'document.getElementById("processingTrack").getAttribute("aria-valuenow")')) === '0', 'Completed OCR did not reset the inactive progressbar state.');
    console.log('✓ OCR progress stayed monotonic, reached 100%, and reset its inactive ARIA state');

    const stored = await evaluate(cdp, 'JSON.stringify(sessionStorage)');
    assert(!stored.includes(path.basename(scannedFixture)), 'Document filename was persisted.');
    assert(!stored.includes('rawText'), 'Raw extracted OCR text was persisted.');
    await cdp.command('Page.reload', { ignoreCache: true });
    await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 20000, 'session refresh');
    const restored = await evaluate(cdp, 'window.PensionLabTest.getPensionReportState()');
    assert(restored?.derived?.monthsUsed >= 1, 'Confirmed normalized values did not survive session refresh.');
    assert((await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")')) === null, 'The source document was restored after refresh.');
    console.log('✓ session refresh retained normalized values without filename, document, or raw OCR text');

    await cdp.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const overflow = await evaluate(cdp, 'document.documentElement.scrollWidth - window.innerWidth');
    assert(overflow <= 1, `390px review has horizontal overflow: ${overflow}px.`);
    console.log('✓ OCR review has no horizontal overflow at 390px');

    await evaluate(cdp, 'window.PensionLabTest.reset()');
    await startProgressRecording(cdp);
    await setFile(cdp, scannedFixture);
    await waitFor(() => evaluate(cdp, `(() => {
      const title = document.getElementById('processingTitle').textContent;
      const value = Number(document.getElementById('processingTrack').getAttribute('aria-valuenow'));
      return window.PensionLabTest.isReportProcessing() && title === 'מזהים טקסט בדוח…' && value >= 42 && value < 100;
    })()`), 30000, 'active OCR recognition');
    const restartedProgress = (await progressEvents(cdp)).filter((event) => event.active);
    assert(restartedProgress.length >= 1, 'A new OCR upload did not expose a progress update.');
    assert(restartedProgress[0].ariaValue < 100 && restartedProgress[0].barWidth < 100, 'A new OCR upload reused the previous completed progress.');
    const activeCancelStartedAt = Date.now();
    await evaluate(cdp, 'document.getElementById("cancelProcessing").click()');
    await waitFor(async () => !(await evaluate(cdp, 'window.PensionLabTest.isReportProcessing()')), 3000, 'active OCR cancellation');
    const activeCancelElapsed = Date.now() - activeCancelStartedAt;
    assert(activeCancelElapsed < 1000, `Active OCR cancellation took ${activeCancelElapsed}ms instead of returning immediately.`);
    assert((await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")')) === null, 'Cancellation imported a partial document.');
    assert((await evaluate(cdp, 'document.getElementById("processingTrack").getAttribute("aria-valuenow")')) === '0', 'Cancellation did not reset the inactive progressbar state.');
    assert((await evaluate(cdp, 'document.getElementById("pensionReportStatus").textContent')) === 'העיבוד בוטל.', 'Cancellation left a stale processing status.');

    await cdp.command('Page.reload', { ignoreCache: true });
    await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 20000, 'cold-cancellation test reload');
    await evaluate(cdp, `(() => {
      window.__coldOcrInitializationStarted = false;
      window.__lateOcrWorkerTerminated = false;
      window.Tesseract = {
        createWorker() {
          window.__coldOcrInitializationStarted = true;
          return new Promise((resolve) => window.setTimeout(() => resolve({
            terminate() {
              window.__lateOcrWorkerTerminated = true;
              return Promise.resolve();
            },
          }), 1200));
        },
      };
    })()`);
    await setFile(cdp, scannedFixture);
    await waitFor(() => evaluate(cdp, 'window.__coldOcrInitializationStarted'), 10000, 'cold OCR initialization');
    const coldCancelStartedAt = Date.now();
    await evaluate(cdp, 'document.getElementById("cancelProcessing").click()');
    await waitFor(async () => !(await evaluate(cdp, 'window.PensionLabTest.isReportProcessing()')), 3000, 'cold OCR cancellation');
    const coldCancelElapsed = Date.now() - coldCancelStartedAt;
    assert(coldCancelElapsed < 1000, `Cold OCR cancellation took ${coldCancelElapsed}ms instead of returning immediately.`);
    assert((await evaluate(cdp, 'document.getElementById("pensionReportStatus").textContent')) === 'העיבוד בוטל.', 'Cold OCR cancellation left a stale processing status.');
    await waitFor(() => evaluate(cdp, 'window.__lateOcrWorkerTerminated'), 5000, 'late OCR worker cleanup');
    assert((await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")')) === null, 'Cold cancellation imported a partial document.');
    console.log(`✓ active-recognition and cold-start cancellation returned immediately, reset status/progress, and cleaned the late worker (${activeCancelElapsed}ms / ${coldCancelElapsed}ms)`);

    const missing = requests.filter((request) => request.status === 404);
    const browserErrors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') ||
      (event.method === 'Network.loadingFailed' && !event.params.canceled));
    assert(missing.length === 0, `OCR browser test produced 404s: ${JSON.stringify(missing)}`);
    assert(browserErrors.length === 0, `OCR browser errors: ${JSON.stringify(browserErrors.slice(0, 3))}`);
    console.log('All 6 pension-report OCR/privacy browser groups passed.');
  } finally {
    cdp?.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
