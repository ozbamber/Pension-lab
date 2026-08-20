const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
  throw new Error('browser-smoke.js requires Node.js 22 or newer.');
}

const projectRoot = path.resolve(__dirname, '..', '..');
const standalonePath = path.join(projectRoot, 'dist', 'pension-lab-he-standalone.html');
const outputDir = path.join(projectRoot, 'qa-output');

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const candidate of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const candidate of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      return execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
    } catch (_) {}
  }
  throw new Error('Chromium was not found. Set CHROMIUM_PATH to its executable.');
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

async function waitForDevTools(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for Chromium DevTools.');
}

class CDP {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out.')), 10000);
      this.ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket connection failed.')); }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result || {});
      } else {
        this.events.push(message);
      }
    });
  }

  command(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
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
  const result = await cdp.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
  return result.result ? result.result.value : undefined;
}

async function waitForApp(cdp) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, `document.getElementById('headlinePension')?.textContent || ''`);
    if (value && value !== '—') return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The app did not finish rendering.');
}

async function createTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Could not create a Chromium target: ${response.status}`);
  return response.json();
}

async function closeTarget(port, id) {
  try { await fetch(`http://127.0.0.1:${port}/json/close/${id}`); } catch (_) {}
}

async function runViewport(port, html, { name, width, height, mobile }) {
  const target = await createTarget(port);
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();

  try {
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('Log.enable');
    await cdp.command('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile,
      screenWidth: width, screenHeight: height,
    });
    const frameTree = await cdp.command('Page.getFrameTree');
    await cdp.command('Page.setDocumentContent', {
      frameId: frameTree.frameTree.frame.id,
      html,
    }, 30000);
    await waitForApp(cdp);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const initialUx = JSON.parse(await evaluate(cdp, `JSON.stringify({
      quickStartVisible: !document.getElementById('quickStart').classList.contains('hidden'),
      forecastHidden: document.getElementById('forecastShell').classList.contains('hidden'),
      currentAge: Number(document.getElementById('currentAge').value),
      retirementAge: Number(document.getElementById('retirementAge').value),
      inflation: Number(document.getElementById('inflation').value),
      returnRate: Number(document.getElementById('quickRealReturn').value),
      quickFieldCount: document.querySelectorAll('.quick-form .quick-field').length,
      improveHidden: document.getElementById('improvePanel').classList.contains('hidden'),
      advancedHidden: document.getElementById('advancedShell').classList.contains('hidden'),
      currentAgeSource: window.PensionLabTest.getFieldSource('currentAge')
    })`));
    if (!initialUx.quickStartVisible || !initialUx.forecastHidden) throw new Error(`${name}: quick-start progressive disclosure is incorrect.`);
    if (initialUx.quickFieldCount !== 4 || !initialUx.improveHidden || !initialUx.advancedHidden) throw new Error(`${name}: first step is not limited to four fields.`);
    if (initialUx.currentAge !== 35 || initialUx.retirementAge !== 67 || initialUx.inflation !== 2 || initialUx.returnRate !== 4) {
      throw new Error(`${name}: quick-forecast defaults are incorrect.`);
    }
    if (initialUx.currentAgeSource !== 'system') throw new Error(`${name}: default provenance is not marked as system.`);

    await evaluate(cdp, `document.getElementById('generateForecastBtn').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const forecastVisible = await evaluate(cdp, `!document.getElementById('forecastShell').classList.contains('hidden')`);
    if (!forecastVisible) throw new Error(`${name}: quick forecast did not open.`);

    const resultBeforeAdvanced = await evaluate(cdp, `document.getElementById('headlinePension').textContent`);
    await evaluate(cdp, `document.getElementById('improveForecastBtn').click()`);
    await evaluate(cdp, `document.getElementById('advancedToggleBtn').click()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const resultAfterAdvanced = await evaluate(cdp, `document.getElementById('headlinePension').textContent`);
    if (resultAfterAdvanced !== resultBeforeAdvanced) throw new Error(`${name}: opening advanced assumptions changed the result.`);
    const tooltipCopy = await evaluate(cdp, `document.querySelector('[data-money-mode="real"]').dataset.tooltip`);
    if (!tooltipCopy || !tooltipCopy.includes('אינפלציה')) throw new Error(`${name}: explanatory tooltip copy is missing.`);

    const summary = JSON.parse(await evaluate(cdp, `JSON.stringify({
      pension: document.getElementById('headlinePension').textContent,
      balance: document.getElementById('headlineBalance').textContent,
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      innerWidth,
      saveDisplay: getComputedStyle(document.getElementById('saveScenarioBtn')).display,
      resetDisplay: getComputedStyle(document.getElementById('resetBtn')).display,
      balanceCanvasWidth: document.getElementById('balanceChart').getBoundingClientRect().width,
      retirementCanvasWidth: document.getElementById('retirementChart').getBoundingClientRect().width,
      overflowElements: [...document.querySelectorAll('body *')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id, className: String(element.className || ''), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      }).filter((element) => element.left < -1 || element.right > innerWidth + 1).slice(0, 10)
    })`));

    if (summary.bodyWidth > summary.innerWidth + 1 || summary.documentWidth > summary.innerWidth + 1) {
      throw new Error(`${name}: horizontal overflow detected (${summary.bodyWidth}/${summary.documentWidth}/${summary.innerWidth}; ${JSON.stringify(summary.overflowElements)}).`);
    }
    if (summary.balanceCanvasWidth <= 0 || summary.retirementCanvasWidth <= 0) {
      throw new Error(`${name}: a chart has no visible width.`);
    }
    if (mobile && (summary.saveDisplay === 'none' || summary.resetDisplay === 'none')) {
      throw new Error(`${name}: save/reset actions are hidden on mobile.`);
    }

    const pensionBefore = summary.pension;
    const typedBalance = await evaluate(cdp, `(() => {
      const input = document.getElementById('currentBalance');
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = '123456';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const typed = input.value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed, committed: window.PensionLabTest.getState().profile.currentBalance };
    })()`);
    if (typedBalance.typed !== '123456' || typedBalance.committed !== 123456) {
      throw new Error(`${name}: numeric fields do not accept direct typing.`);
    }
    await evaluate(cdp, `(() => {
      const input = document.getElementById('retirementAge');
      input.value = Number(input.value) + 1;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pensionAfter = await evaluate(cdp, `document.getElementById('headlinePension').textContent`);
    if (pensionAfter === pensionBefore) throw new Error(`${name}: retirement-age interaction did not update the result.`);
    const retirementSource = await evaluate(cdp, `window.PensionLabTest.getFieldSource('retirementAge')`);
    if (retirementSource !== 'user') throw new Error(`${name}: edited field provenance did not change to user.`);

    await evaluate(cdp, `document.getElementById('addCareerBreak').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const breakCount = await evaluate(cdp, `document.querySelectorAll('.break-card').length`);
    if (breakCount < 1) throw new Error(`${name}: adding a career break failed.`);

    await evaluate(cdp, `document.getElementById('blendProtected').click()`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const protectedCheck = JSON.parse(await evaluate(cdp, `JSON.stringify({
      visible: !document.getElementById('protectedFields').classList.contains('hidden'),
      warning: document.getElementById('protectedFields').textContent.includes('לא חישוב זכאות'),
      bodyWidth: document.body.scrollWidth,
      innerWidth
    })`));
    if (!protectedCheck.visible || !protectedCheck.warning) {
      throw new Error(`${name}: protected-return planning warning was not rendered.`);
    }
    if (protectedCheck.bodyWidth > protectedCheck.innerWidth + 1) {
      throw new Error(`${name}: protected-return fields caused horizontal overflow.`);
    }

    await evaluate(cdp, `(() => {
      const input = document.getElementById('inflation');
      input.value = 20;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const clampedInflation = await evaluate(cdp, `Number(document.getElementById('inflation').value)`);
    if (clampedInflation !== 10) throw new Error(`${name}: committed numeric input was not clamped in the UI.`);

    await evaluate(cdp, `document.querySelectorAll('[data-money-mode="nominal"]')[1].click()`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const modeLabel = await evaluate(cdp, `document.getElementById('chartModeLabel').textContent`);
    if (!modeLabel.includes('עתידיים')) {
      const modeDebug = await evaluate(cdp, `JSON.stringify({mode: window.PensionLabTest.getMoneyMode(), toast: document.getElementById('toast').textContent, buttons: [...document.querySelectorAll('[data-money-mode]')].map((button) => ({value: button.dataset.moneyMode, active: button.classList.contains('active'), pressed: button.getAttribute('aria-pressed')}))})`);
      throw new Error(`${name}: money-mode switch failed (${modeLabel}; ${modeDebug}).`);
    }

    await evaluate(cdp, `(() => {
      window.prompt = () => 'תרחיש QA';
      document.getElementById('saveScenarioBtn').click();
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const savedCount = await evaluate(cdp, `document.querySelectorAll('.scenario-card').length`);
    if (savedCount !== 1) throw new Error(`${name}: saving a scenario failed.`);

    await evaluate(cdp, `(() => {
      window.confirm = () => true;
      document.getElementById('resetBtn').click();
      document.querySelector('[data-money-mode="real"]').click();
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
      document.getElementById('toast').classList.remove('show');
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await evaluate(cdp, `window.scrollTo({ top: 0, left: 0, behavior: 'instant' })`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const resetAge = await evaluate(cdp, `Number(document.getElementById('currentAge').value)`);
    if (resetAge !== 35) throw new Error(`${name}: reset action did not restore the example scenario.`);
    const resetSource = await evaluate(cdp, `window.PensionLabTest.getFieldSource('currentAge')`);
    if (resetSource !== 'system') throw new Error(`${name}: reset did not restore system provenance.`);

    const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
    fs.writeFileSync(path.join(outputDir, `${name}.png`), Buffer.from(screenshot.data, 'base64'));

    const errors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded');
    if (errors.length) throw new Error(`${name}: browser console/runtime errors were reported.`);

    console.log(`✓ ${name}: ${summary.pension}, ${summary.balance}, no overflow, interactions passed`);
  } finally {
    cdp.close();
    await closeTarget(port, target.id);
  }
}

async function runMasterViewport(port, html, { name, width, height, mobile }) {
  const target = await createTarget(port);
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  try {
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('Log.enable');
    await cdp.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
    const frameTree = await cdp.command('Page.getFrameTree');
    await cdp.command('Page.setDocumentContent', { frameId: frameTree.frameTree.frame.id, html }, 30000);
    await waitForApp(cdp);
    await new Promise((resolve) => setTimeout(resolve, 220));

    const initial = JSON.parse(await evaluate(cdp, `JSON.stringify({
      h1Count: document.querySelectorAll('h1').length,
      uploadCards: document.querySelectorAll('.upload-card').length,
      quickVisible: !document.getElementById('quickStart').classList.contains('hidden'),
      reviewHidden: document.getElementById('reviewShell').classList.contains('hidden'),
      forecastHidden: document.getElementById('forecastShell').classList.contains('hidden'),
      moneyButtons: document.querySelectorAll('[data-money-mode]').length,
      privacy: document.querySelector('.privacy-note').textContent,
      bodyWidth: document.body.scrollWidth, documentWidth: document.documentElement.scrollWidth, innerWidth
    })`));
    if (initial.h1Count !== 1 || initial.uploadCards !== 2 || !initial.quickVisible || !initial.reviewHidden || !initial.forecastHidden) throw new Error(`${name}: document-first landing structure is incorrect.`);
    if (initial.moneyButtons !== 2) throw new Error(`${name}: money-mode control is duplicated.`);
    if (!initial.privacy.includes('אינם נשלחים לשרת')) throw new Error(`${name}: local-processing privacy statement is missing.`);
    if (initial.bodyWidth > initial.innerWidth + 1 || initial.documentWidth > initial.innerWidth + 1) throw new Error(`${name}: landing has horizontal overflow.`);

    await evaluate(cdp, `document.getElementById('manualFlowBtn').click()`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const reviewVisible = await evaluate(cdp, `!document.getElementById('reviewShell').classList.contains('hidden')`);
    if (!reviewVisible) throw new Error(`${name}: manual flow did not open review.`);

    await evaluate(cdp, `(() => {
      const year = document.getElementById('birthYear'); year.value = String(new Date().getFullYear() - 35); year.dispatchEvent(new Event('change', {bubbles:true}));
      document.querySelector('[data-retirement-track="female"]').click();
      const salary = document.getElementById('pensionableSalary'); salary.value = ''; salary.dispatchEvent(new Event('input',{bubbles:true})); salary.value = '23500'; salary.dispatchEvent(new Event('change',{bubbles:true}));
      const balance = document.getElementById('currentBalance'); balance.value = '487000'; balance.dispatchEvent(new Event('change',{bubbles:true}));
      const confirm = document.getElementById('confirmContributionDefaults'); confirm.checked = true; confirm.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`);
    const typed = JSON.parse(await evaluate(cdp, `JSON.stringify({salary:document.getElementById('pensionableSalary').value,balance:document.getElementById('currentBalance').value,track:window.PensionLabTest.getState().profile.retirementTrack})`));
    if (typed.salary !== '23500' || typed.balance !== '487000' || typed.track !== 'female') throw new Error(`${name}: review inputs did not commit.`);

    await evaluate(cdp, `document.getElementById('generateForecastBtn').click()`);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const forecast = JSON.parse(await evaluate(cdp, `JSON.stringify({
      visible: !document.getElementById('forecastShell').classList.contains('hidden'),
      pension: document.getElementById('headlinePension').textContent,
      assumptions: document.querySelectorAll('.assumption-item').length,
      retirementAge: window.PensionLabTest.getState().retirement.retirementAge,
      storageScope: window.PensionLabTest.getStorageScope(),
      bodyWidth: document.body.scrollWidth, documentWidth: document.documentElement.scrollWidth, innerWidth
    })`));
    if (!forecast.visible || forecast.assumptions !== 4 || !forecast.pension.includes('בחודש')) throw new Error(`${name}: first forecast is incomplete.`);
    if (forecast.retirementAge !== 65) throw new Error(`${name}: statutory female retirement-age default is incorrect.`);
    if (forecast.storageScope !== 'session') throw new Error(`${name}: session-only storage boundary is incorrect.`);
    if (forecast.bodyWidth > forecast.innerWidth + 1 || forecast.documentWidth > forecast.innerWidth + 1) throw new Error(`${name}: forecast has horizontal overflow.`);
    await evaluate(cdp, `window.scrollTo({top:document.getElementById('forecastShell').offsetTop,left:0,behavior:'instant'})`);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const forecastScreenshot = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
    fs.writeFileSync(path.join(outputDir, `${name}-forecast.png`), Buffer.from(forecastScreenshot.data, 'base64'));

    await evaluate(cdp, `document.getElementById('compareScenariosBtn').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const comparison = JSON.parse(await evaluate(cdp, `JSON.stringify({visible:!document.getElementById('comparisonPanel').classList.contains('hidden'),cards:document.querySelectorAll('.comparison-card').length,fallback:document.querySelectorAll('.comparison-fallback > div').length,canvas:document.getElementById('comparisonChart').getBoundingClientRect().width})`));
    if (!comparison.visible || comparison.cards !== 3 || comparison.fallback !== 3 || comparison.canvas <= 0) throw new Error(`${name}: return comparison is incomplete.`);

    await evaluate(cdp, `document.getElementById('improveForecastBtn').click()`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const pensionBefore = await evaluate(cdp, `document.getElementById('headlinePension').textContent`);
    await evaluate(cdp, `document.querySelector('[data-simple-investment="high"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pensionAfter = await evaluate(cdp, `document.getElementById('headlinePension').textContent`);
    if (pensionBefore === pensionAfter) throw new Error(`${name}: improve-return control did not update the result.`);

    await evaluate(cdp, `document.querySelector('[data-simple-break="yes"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const advanced = JSON.parse(await evaluate(cdp, `JSON.stringify({visible:!document.getElementById('advancedShell').classList.contains('hidden'),breaks:document.querySelectorAll('.break-card').length,balanceCanvas:document.getElementById('balanceChart').getBoundingClientRect().width,retirementCanvas:document.getElementById('retirementChart').getBoundingClientRect().width})`));
    if (!advanced.visible || advanced.breaks < 1 || advanced.balanceCanvas <= 0 || advanced.retirementCanvas <= 0) throw new Error(`${name}: advanced flow or career breaks failed.`);

    await evaluate(cdp, `document.querySelector('[data-money-mode="nominal"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const mode = await evaluate(cdp, `window.PensionLabTest.getMoneyMode()`);
    if (mode !== 'nominal') throw new Error(`${name}: money-mode switch failed.`);

    const finalLayout = JSON.parse(await evaluate(cdp, `JSON.stringify({bodyWidth:document.body.scrollWidth,documentWidth:document.documentElement.scrollWidth,innerWidth,touchTargets:[...document.querySelectorAll('button:not(.hidden), .upload-button')].filter(el=>getComputedStyle(el).display!=='none').map(el=>Math.round(el.getBoundingClientRect().height)).filter(height=>height>0)})`));
    if (finalLayout.bodyWidth > finalLayout.innerWidth + 1 || finalLayout.documentWidth > finalLayout.innerWidth + 1) throw new Error(`${name}: progressed flow has horizontal overflow.`);
    if (mobile && finalLayout.touchTargets.some((height) => height < 36)) throw new Error(`${name}: a primary interactive target is too small for touch.`);

    await evaluate(cdp, `(() => { window.confirm=()=>true; document.getElementById('resetBtn').click(); return true; })()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const reset = JSON.parse(await evaluate(cdp, `JSON.stringify({documents:!document.getElementById('quickStart').classList.contains('hidden'),reviewHidden:document.getElementById('reviewShell').classList.contains('hidden')})`));
    if (!reset.documents || !reset.reviewHidden) throw new Error(`${name}: session reset did not return to documents.`);

    const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
    fs.writeFileSync(path.join(outputDir, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
    const errors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded');
    if (errors.length) {
      const summary = errors.map((event) => event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text || event.params?.entry?.text || event.method);
      throw new Error(`${name}: browser console/runtime errors were reported: ${JSON.stringify(summary)}`);
    }
    console.log(`✓ ${name}: document review, forecast, comparison and advanced flow passed`);
  } finally {
    cdp.close();
    await closeTarget(port, target.id);
  }
}

(async () => {
  const chromium = findChromium();
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pension-lab-chromium-'));
  const html = fs.readFileSync(standalonePath, 'utf8');
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  browser.stderr.on('data', (chunk) => { stderr += String(chunk); });

  try {
    await waitForDevTools(port);
    await runMasterViewport(port, html, { name: 'desktop', width: 1440, height: 1000, mobile: false });
    await runMasterViewport(port, html, { name: 'tablet', width: 822, height: 950, mobile: false });
    await runMasterViewport(port, html, { name: 'mobile', width: 390, height: 844, mobile: true });
    await runMasterViewport(port, html, { name: 'mobile-320', width: 320, height: 800, mobile: true });
    console.log(`Browser smoke test passed. Screenshots: ${outputDir}`);
  } catch (error) {
    if (stderr) console.error(stderr.slice(-3000));
    throw error;
  } finally {
    if (browser.exitCode === null) {
      browser.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => browser.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    if (browser.exitCode === null) {
      browser.kill('SIGKILL');
      await Promise.race([
        new Promise((resolve) => browser.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 2) console.warn(`Could not remove temporary Chromium profile: ${error.message}`);
        else await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
