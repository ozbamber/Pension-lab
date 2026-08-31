'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

if (typeof fetch === 'undefined') throw new Error('Live verification requires Node.js 22 or newer.');

const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const requestedBase = process.argv[2] || process.env.PENSION_LAB_LIVE_URL;
if (!requestedBase) throw new Error('Usage: npm run verify:live -- https://deployment.example.pages.dev/');
const baseUrl = new URL(requestedBase);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('Live URL must use HTTP or HTTPS.');
baseUrl.pathname = baseUrl.pathname.replace(/\/*$/, '/');
baseUrl.search = '';
baseUrl.hash = '';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(relativePath) {
  const url = new URL(relativePath, baseUrl);
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { url: response.url, response, bytes, text: bytes.toString('utf8') };
}

async function verifyAsset(relativePath, contentTypePattern, requiredText) {
  const live = await request(relativePath);
  const localPath = path.join(distRoot, relativePath.replace(/^\/+/, '').split('?')[0]);
  assert(live.response.status === 200, `${relativePath} returned HTTP ${live.response.status}`);
  assert(contentTypePattern.test(live.response.headers.get('content-type') || ''), `${relativePath} returned an unexpected Content-Type`);
  assert(fs.existsSync(localPath), `Local release asset is missing: ${localPath}`);
  const localBytes = fs.readFileSync(localPath);
  const localHash = sha256(localBytes);
  const liveHash = sha256(live.bytes);
  assert(localHash === liveHash, `${relativePath} hash differs from the tested dist artifact`);
  if (requiredText) assert(live.text.includes(requiredText), `${relativePath} is missing its release marker`);
  return { path: relativePath, status: live.response.status, contentType: live.response.headers.get('content-type'), sha256: liveHash };
}

(async () => {
  assert(fs.existsSync(path.join(distRoot, 'index.html')), 'Run npm run build before live verification.');
  const index = await request('/');
  assert(index.response.status === 200, `/ returned HTTP ${index.response.status}`);
  assert(/text\/html/i.test(index.response.headers.get('content-type') || ''), '/ did not return HTML');
  assert(index.text.includes('20260831-audit'), '/ does not contain the audited asset version');
  assert(sha256(index.bytes) === sha256(fs.readFileSync(path.join(distRoot, 'index.html'))), '/ differs from dist/index.html');

  const expectedHeaders = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  };
  for (const [name, expected] of Object.entries(expectedHeaders)) {
    assert(index.response.headers.get(name) === expected, `Missing or incorrect ${name} header`);
  }
  assert((index.response.headers.get('permissions-policy') || '').includes('camera=()'), 'Missing restrictive Permissions-Policy header');

  const assets = [];
  assets.push(await verifyAsset('/app.js', /(?:application|text)\/javascript/i, 'SESSION_SENSITIVE_KEYS'));
  assets.push(await verifyAsset('/engine.js', /(?:application|text)\/javascript/i, 'Career breaks must not overlap'));
  assets.push(await verifyAsset('/simulator.js', /(?:application|text)\/javascript/i, 'snapToStep'));
  assets.push(await verifyAsset('/demo-fixture.js', /(?:application|text)\/javascript/i, 'PensionDemo'));
  assets.push(await verifyAsset('/styles.css', /text\/css/i, 'simulator-range-status'));

  const demoShell = await request('/?demo=1');
  assert(demoShell.response.status === 200 && demoShell.text.includes('demo-fixture.js'), 'Demo route did not return the audited application shell');
  assert(sha256(demoShell.bytes) === sha256(index.bytes), 'Demo route returned different application bytes');

  const missing = await request(`/missing-release-asset-${Date.now()}.js`);
  assert(missing.response.status === 404, `Unknown asset returned HTTP ${missing.response.status} instead of 404`);
  assert(/text\/html/i.test(missing.response.headers.get('content-type') || ''), '404 response did not return HTML');
  assert(missing.text.includes('העמוד לא נמצא'), '404 response did not return the Pension Lab error page');
  assert(sha256(missing.bytes) === sha256(fs.readFileSync(path.join(distRoot, '404.html'))), '404 response differs from dist/404.html');

  console.log(JSON.stringify({
    verifiedAt: new Date().toISOString(),
    baseUrl: baseUrl.href,
    indexSha256: sha256(index.bytes),
    headers: Object.fromEntries(['x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'].map((name) => [name, index.response.headers.get(name)])),
    assets,
    missingAsset: { status: missing.response.status, sha256: sha256(missing.bytes) },
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
