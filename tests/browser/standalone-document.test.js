const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
  throw new Error('standalone-document.test.js requires Node.js 22 or newer.');
}

const projectRoot = path.resolve(__dirname, '..', '..');
const distRoot = path.join(projectRoot, 'dist');
const nativeFixture = path.join(projectRoot, 'dataset', 'documents', 'pension_report', 'high', 'pension-report-03-fee_heavy.pdf');
const scannedFixture = path.join(projectRoot, 'dataset', 'documents', 'pension_report', 'degraded', 'degraded-11-pension-report-05-provider_modern.pdf');
const requiredVendorPaths = [
  '/vendor/pdfjs/pdf.min.mjs',
  '/vendor/pdfjs/pdf.worker.min.mjs',
  '/vendor/pdfjs/cmaps/78-H.bcmap',
  '/vendor/pdfjs/standard_fonts/FoxitFixed.pfb',
  '/vendor/pdfjs/wasm/openjpeg.wasm',
  '/vendor/tesseract/tesseract.min.js',
  '/vendor/tesseract/worker.min.js',
  '/vendor/tesseract/tesseract-core-lstm.wasm.js',
  '/vendor/tessdata/heb.traineddata.gz',
  '/vendor/tessdata/eng.traineddata.gz',
];

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
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.gz': 'application/gzip',
    '.pdf': 'application/pdf',
    '.bcmap': 'application/octet-stream',
    '.pfb': 'application/octet-stream',
  }[extension] || 'application/octet-stream';
}

async function startServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const absolute = path.resolve(distRoot, relative);
    const valid = absolute.startsWith(`${distRoot}${path.sep}`) && fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    requests.push({ method: request.method, url: url.pathname, status: valid ? 200 : 404 });
    if (!valid) {
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
    });
  }

  command(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
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
  const standalone = path.join(distRoot, 'pension-lab-he-standalone.html');
  if (!fs.existsSync(standalone)) throw new Error('Run npm run build before the standalone document test.');
  if (!fs.existsSync(nativeFixture) || !fs.existsSync(scannedFixture)) throw new Error('Synthetic PDF fixtures are missing.');

  const { server, port, requests } = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  const devToolsPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pension-lab-standalone-chrome-'));
  const chrome = spawn(chromiumPath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${devToolsPort}`, '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    await waitFor(async () => {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json();
        return pages.length > 0;
      } catch (_) {
        return false;
      }
    }, 15000, 'Chromium DevTools');

    const targetResponse = await fetch(`http://127.0.0.1:${devToolsPort}/json/new?${encodeURIComponent(`${origin}/pension-lab-he-standalone.html`)}`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`Could not create Chromium target: ${targetResponse.status}`);
    const target = await targetResponse.json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('DOM.enable');
    await cdp.command('Network.enable');
    await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest) && Boolean(document.querySelector("#pensionReportFile"))'), 20000, 'standalone application load');

    const root = await evaluate(cdp, 'window.PensionLocalDocuments.assetRoot().href');
    assert(root === `${origin}/`, `Standalone asset root is incorrect: ${root}`);
    const vendorResults = await evaluate(cdp, `(async () => Promise.all(${JSON.stringify(requiredVendorPaths)}.map(async (path) => {
      const response = await fetch(path, { cache: 'no-store' });
      return { path, status: response.status, ok: response.ok };
    })))()`);
    assert(vendorResults.every((item) => item.ok), `Required vendor assets did not resolve: ${JSON.stringify(vendorResults)}`);
    console.log(`✓ all ${requiredVendorPaths.length} standalone vendor URLs resolved from dist/vendor`);

    await setFile(cdp, '#pensionReportFile', nativeFixture);
    await waitFor(async () => {
      const document = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")');
      return document && document.method === 'pdf-text';
    }, 30000, 'standalone native PDF extraction');
    const nativeDocument = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")');
    assert(nativeDocument.pensionReportState.currentBalance === 340842, `Standalone native balance mismatch: ${JSON.stringify(nativeDocument.fields)}`);
    assert(nativeDocument.pensionReportState.derived.monthsUsed === 5, `Standalone native history mismatch: ${JSON.stringify(nativeDocument.pensionReportState.derived)}`);
    console.log('✓ standalone native PDF extracted balance and five contribution months through PDF.js');

    await evaluate(cdp, 'document.getElementById("pensionReportFile").value = ""');
    await setFile(cdp, '#pensionReportFile', scannedFixture);
    await waitFor(async () => {
      const document = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")');
      return document && document.method === 'ocr';
    }, 180000, 'standalone scanned PDF extraction');
    const scannedDocument = await evaluate(cdp, 'window.PensionLabTest.getSelectedDocument("pensionReport")');
    assert(scannedDocument.pensionReportState.derived.monthsUsed >= 1, `Standalone OCR did not retain a reliable contribution month: ${JSON.stringify(scannedDocument.pensionReportState)}`);
    console.log('✓ standalone scanned pension report reached report review with local heb+eng OCR');

    const missing = requests.filter((request) => request.status === 404);
    const legacy = requests.filter((request) => request.url.includes('/pension-lab-he/'));
    const browserErrors = cdp.events.filter((event) =>
      event.method === 'Runtime.exceptionThrown' ||
      event.method === 'Network.loadingFailed' ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') ||
      (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'));
    assert(missing.length === 0, `Standalone produced 404 requests: ${JSON.stringify(missing)}`);
    assert(legacy.length === 0, `Standalone requested the removed legacy asset path: ${JSON.stringify(legacy)}`);
    assert(browserErrors.length === 0, `Standalone browser errors were reported: ${JSON.stringify(browserErrors.slice(0, 3))}`);
    console.log('✓ standalone emitted no 404, legacy-path, console, runtime or network-loading errors');
    console.log('All 4 standalone document browser checks passed.');
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
