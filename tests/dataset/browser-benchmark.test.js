'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { loadDataset, evaluatePredictions, evaluatePensionReportExtraction } = require('../../scripts/dataset/lib/dataset-core');
const { printPensionExtractionMetrics } = require('../../scripts/dataset/lib/benchmark-report');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
  throw new Error('dataset browser benchmark requires Node.js 22 or newer.');
}

const projectRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(projectRoot, 'app');
const dataset = loadDataset(projectRoot);

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
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.pdf': 'application/pdf',
    '.wasm': 'application/wasm', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  }[extension] || 'application/octet-stream';
}

async function startServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const datasetRequest = url.pathname.startsWith('/dataset/');
    const root = datasetRequest ? projectRoot : appRoot;
    const relative = datasetRequest ? url.pathname.replace(/^\/+/, '') : (url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
    const absolute = path.resolve(root, decodeURIComponent(relative));
    const valid = absolute.startsWith(`${root}${path.sep}`) && fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    requests.push({ url: url.pathname, status: valid ? 200 : 404 });
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
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result || {});
      } else this.events.push(message);
    });
  }
  command(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function setFile(cdp, selector, filePath) {
  const documentNode = await cdp.command('DOM.getDocument', { depth: 1 });
  const selected = await cdp.command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
  if (!selected.nodeId) throw new Error(`Input not found: ${selector}`);
  await cdp.command('DOM.setFileInputFiles', { nodeId: selected.nodeId, files: [filePath] });
}

function pct(value) { return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`; }

function aggregateDocuments(documents) {
  const fields = documents.flatMap((document) => document.fields);
  return {
    documents: documents.length,
    fieldAccuracy: fields.length ? fields.filter((field) => field.pass).length / fields.length : null,
    criticalAccuracy: documents.length ? documents.filter((document) => document.critical_document_pass).length / documents.length : null,
  };
}

(async () => {
  const splitArg = process.argv.indexOf('--split');
  const split = splitArg >= 0 ? process.argv[splitArg + 1] : 'all';
  const idArg = process.argv.indexOf('--id');
  const selectedId = idArg >= 0 ? process.argv[idArg + 1] : null;
  const records = dataset.records.filter((record) => record.document_type === 'pension_report' &&
    (split === 'all' || record.split === split) && (!selectedId || record.id === selectedId));
  if (!records.length) throw new Error(`No pension-report records matched split=${split}${selectedId ? ` and id=${selectedId}` : ''}.`);
  const { server, port, requests } = await startServer();
  const devToolsPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pension-lab-dataset-chrome-'));
  const chrome = spawn(chromiumPath(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${devToolsPort}`, '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  const predictions = [];
  try {
    await waitFor(async () => {
      try { return (await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json()).length > 0; }
      catch (_) { return false; }
    }, 15000, 'Chromium DevTools');
    const target = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/`)}`, { method: 'PUT' })).json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.command('Page.enable'); await cdp.command('Runtime.enable'); await cdp.command('DOM.enable'); await cdp.command('Network.enable');

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      await cdp.command('Page.navigate', { url: `http://127.0.0.1:${port}/` });
      await waitFor(() => evaluate(cdp, 'document.readyState === "complete" && Boolean(window.PensionLabTest)'), 20000, 'application load');
      const absolute = path.join(projectRoot, record.path);
      await setFile(cdp, '#pensionReportFile', absolute);
      const kind = 'pensionReport';
      const timeout = record.has_text_layer ? 60000 : 180000;
      await waitFor(async () => Boolean(await evaluate(cdp, `window.PensionLabTest.getSelectedDocument(${JSON.stringify(kind)})`)), timeout, `${record.id} extraction`);
      await waitFor(async () => !(await evaluate(cdp, 'window.PensionLabTest.isReportProcessing()')), timeout, `${record.id} processing completion`);
      const extraction = await evaluate(cdp, `window.PensionLabTest.getSelectedDocument(${JSON.stringify(kind)})`);
      predictions.push({
        id: record.id,
        fields: extraction?.fields || {},
        pensionReportState: extraction?.pensionReportState || null,
        status: extraction?.status || null,
        method: extraction?.method || null,
      });
      console.log(`[${index + 1}/${records.length}] ${record.id} ${record.family}: ${extraction?.status || 'unknown'} / ${extraction?.method || 'unknown'}`);
    }

    const browserErrors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Network.loadingFailed' && !(event.params.type === 'Document' && event.params.errorText === 'net::ERR_ABORTED' && event.params.canceled)) ||
      (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'));
    const missing = requests.filter((request) => request.status === 404);
    if (missing.length) throw new Error(`Dataset benchmark produced 404 requests: ${JSON.stringify(missing.slice(0, 10))}`);
    if (browserErrors.length) throw new Error(`Dataset benchmark browser errors: ${JSON.stringify(browserErrors.slice(0, 5))}`);

    const metrics = evaluatePredictions(projectRoot, predictions, { split, profile: 'core', documentType: 'pension_report' });
    const extractionMetrics = evaluatePensionReportExtraction(projectRoot, predictions, { split });
    const annual = aggregateDocuments(metrics.documents.filter((document) => document.family !== 'quarterly'));
    const quarterly = aggregateDocuments(metrics.documents.filter((document) => document.family === 'quarterly'));
    const extractedRows = predictions.reduce((sum, prediction) => sum + (prediction.pensionReportState?.contributionHistory?.length || 0), 0);
    const reliableMonths = predictions.reduce((sum, prediction) => sum + (prediction.pensionReportState?.derived?.monthsUsed || 0), 0);
    console.log('Pension-report-only browser benchmark:');
    console.log(`  Field accuracy: ${pct(metrics.summary.field_accuracy)}`);
    console.log(`  Critical-document accuracy: ${pct(metrics.summary.critical_document_accuracy)}`);
    console.log(`  Extraction coverage: ${metrics.summary.predictions}/${metrics.summary.documents} (${pct(metrics.summary.predictions / metrics.summary.documents)})`);
    console.log(`  Validation accuracy: ${pct(metrics.summary.validation_accuracy)}`);
    console.log(`  Validation checks: ${metrics.summary.validation_checks_passed}/${metrics.summary.validation_checks_run} passed; ${metrics.summary.validation_checks_run}/${metrics.summary.validation_checks_possible} run; coverage=${pct(metrics.summary.validation_coverage)}`);
    console.log(`  Annual: fields=${pct(annual.fieldAccuracy)}, critical=${pct(annual.criticalAccuracy)}, n=${annual.documents}`);
    console.log(`  Quarterly: fields=${pct(quarterly.fieldAccuracy)}, critical=${pct(quarterly.criticalAccuracy)}, n=${quarterly.documents}`);
    for (const [layer, group] of Object.entries(metrics.groups.text_layer)) {
      console.log(`  ${layer}: fields=${pct(group.field_accuracy)}, critical=${pct(group.critical_document_accuracy)}, coverage=${pct(group.predictions / group.documents)}, n=${group.documents}`);
    }
    console.log(`  Contribution history: ${extractedRows} raw rows; ${reliableMonths} reliable normalized months.`);
    printPensionExtractionMetrics(extractionMetrics, 'Safety-aware full-browser pension benchmark');
    const outputArg = process.argv.indexOf('--json-out');
    if (outputArg >= 0 && process.argv[outputArg + 1]) {
      const output = path.resolve(process.cwd(), process.argv[outputArg + 1]);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify({ coreMetrics: metrics, extractionMetrics, predictions }, null, 2)}\n`);
      console.log(`Wrote ${output}`);
    }
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
