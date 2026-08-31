(function () {
  'use strict';

  const E = window.PensionEngine;
  const D = window.PensionDocuments;
  const R = window.PensionReportParser;
  const DEMO = window.PensionDemo;
  const S = window.PensionSimulator;
  const C = window.PensionSimulatorConfig;
  if (!E || !D || !R || !DEMO || !S || !C) throw new Error('Pension Lab dependencies are missing.');

  const SESSION_KEY = 'pension-lab-report-first-session-v1';
  const SESSION_SENSITIVE_KEYS = new Set([
    'raw', 'rawText', 'directText', 'tokenText', 'tokens', 'evidenceTokens', 'sourceText', 'ocrText',
  ]);
  const DEFAULT_ASSUMPTIONS = C.BASELINE;
  const demoMode = DEMO.isDemoMode();
  const volatileStorage = new Map();
  const $ = (id) => document.getElementById(id);

  let selectedDocument = null;
  let pensionReportState = null;
  let projection = null;
  let yearsUntilRetirement = null;
  let flowStep = 1;
  let moneyMode = 'real';
  let processingController = null;
  let processingProgress = 0;
  let userCorrections = {};
  let simulatorBaseline = null;
  let simulatorControls = null;
  let selectedSimulatorScenario = null;
  let simulatorComparison = null;
  let simulatorRenderFrame = null;
  let renderedSimulatorBaseline = null;
  let simulatorAnnouncementTimer = null;

  function storageGet(key) {
    if (volatileStorage.has(key)) return volatileStorage.get(key);
    try { return window.sessionStorage.getItem(key); }
    catch (_) { return null; }
  }

  function storageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
      volatileStorage.delete(key);
    }
    catch (_) { volatileStorage.set(key, value); }
  }

  function storageRemove(key) {
    volatileStorage.delete(key);
    try { window.sessionStorage.removeItem(key); }
    catch (_) {}
  }

  function deepClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function stripSessionSensitiveData(value) {
    if (Array.isArray(value)) return value.map(stripSessionSensitiveData);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SESSION_SENSITIVE_KEYS.has(key))
      .map(([key, child]) => [key, stripSessionSensitiveData(child)]));
  }

  function sessionSafeReportState(state) {
    const copy = stripSessionSensitiveData(deepClone(state));
    if (!copy || typeof copy !== 'object') return copy;
    copy.contributionHistory = (copy.contributionHistory || []).map((row) => ({
      ...row,
      evidence: row.evidence ? {
        aliasId: row.evidence.aliasId || null,
        rowId: row.evidence.rowId || null,
        sourcePage: row.evidence.sourcePage || null,
        method: row.evidence.method || null,
        headerRowId: row.evidence.headerRowId || null,
        explicitTotal: Boolean(row.evidence.explicitTotal),
      } : null,
    }));
    return copy;
  }

  function finiteInput(id) {
    const raw = String($(id).value ?? '').trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function setInput(id, value, scale = 1) {
    const missing = value == null || (typeof value === 'string' && !value.trim());
    const numeric = Number(value);
    const scaled = numeric * scale;
    if (missing || !Number.isFinite(numeric) || !Number.isFinite(scaled)) {
      $(id).value = '';
      return;
    }
    const rounded = Math.round(scaled * 10000) / 10000;
    $(id).value = String(Number.isFinite(rounded) ? rounded : scaled);
  }

  function formatMoney(value, options = {}) {
    if (value == null || (typeof value === 'string' && !value.trim())) return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    const digits = options.decimals == null ? 0 : options.decimals;
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(numeric);
  }

  function formatPercentRatio(value, digits = 2) {
    if (value == null || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) return '—';
    const fixed = (Number(value) * 100).toFixed(digits);
    const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
    return `${trimmed}%`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }

  function emptyReportState() {
    return {
      fundType: 'unknown',
      supportedForCurrentForecast: false,
      routingReason: 'FUND_TYPE_CONFIRMATION_REQUIRED',
      currentBalance: null,
      provider: null,
      report: { type: 'unknown', reportDate: null, period: null },
      fees: { depositRate: null, balanceRate: null },
      contributionHistory: [],
      normalizedContributionMonths: [],
      derived: {
        monthsUsed: 0,
        baselineMonthlyContribution: null,
        averageReportedPensionSalary: null,
        employeeContributionRate: null,
        employerContributionRate: null,
        severanceRate: null,
      },
      evidence: {},
      review: { requiresReview: true, issues: [] },
    };
  }

  function normalizedPersistedNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function normalizeSessionReportState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const objectRows = (candidate) => (Array.isArray(candidate)
      ? candidate.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      : []);
    const incoming = stripSessionSensitiveData(deepClone(value));
    const base = emptyReportState();
    const fees = incoming.fees && typeof incoming.fees === 'object' && !Array.isArray(incoming.fees) ? incoming.fees : {};
    const derived = incoming.derived && typeof incoming.derived === 'object' && !Array.isArray(incoming.derived) ? incoming.derived : {};
    const report = incoming.report && typeof incoming.report === 'object' && !Array.isArray(incoming.report) ? incoming.report : {};
    const review = incoming.review && typeof incoming.review === 'object' && !Array.isArray(incoming.review) ? incoming.review : {};
    return {
      ...base,
      ...incoming,
      currentBalance: normalizedPersistedNumber(incoming.currentBalance),
      report: { ...base.report, ...report },
      fees: {
        ...base.fees,
        ...fees,
        depositRate: normalizedPersistedNumber(fees.depositRate),
        balanceRate: normalizedPersistedNumber(fees.balanceRate),
      },
      derived: {
        ...base.derived,
        ...derived,
        monthsUsed: normalizedPersistedNumber(derived.monthsUsed) ?? 0,
        baselineMonthlyContribution: normalizedPersistedNumber(derived.baselineMonthlyContribution),
        averageReportedPensionSalary: normalizedPersistedNumber(derived.averageReportedPensionSalary),
        employeeContributionRate: normalizedPersistedNumber(derived.employeeContributionRate),
        employerContributionRate: normalizedPersistedNumber(derived.employerContributionRate),
        severanceRate: normalizedPersistedNumber(derived.severanceRate),
      },
      contributionHistory: objectRows(incoming.contributionHistory),
      normalizedContributionMonths: objectRows(incoming.normalizedContributionMonths),
      evidence: incoming.evidence && typeof incoming.evidence === 'object' && !Array.isArray(incoming.evidence) ? incoming.evidence : {},
      review: {
        ...base.review,
        ...review,
        issues: objectRows(review.issues),
      },
    };
  }

  function stateFromExtraction(extraction) {
    if (extraction?.pensionReportState) return deepClone(extraction.pensionReportState);
    const state = emptyReportState();
    const fields = extraction?.fields || {};
    state.currentBalance = fields.currentBalance?.value ?? null;
    state.provider = fields.pensionProvider?.value ?? null;
    state.report.type = extraction?.classification === 'ANNUAL_PENSION_REPORT' ? 'annual'
      : extraction?.classification === 'QUARTERLY_PENSION_REPORT' ? 'quarterly' : 'unknown';
    state.report.reportDate = fields.reportDate?.value ?? null;
    state.report.period = fields.balanceDate?.value ?? null;
    state.fees.depositRate = fields.depositManagementFeeRate?.value ?? null;
    state.fees.balanceRate = fields.balanceManagementFeeRate?.value ?? null;
    state.contributionHistory = deepClone(extraction?.contributionHistory || []);
    const baseline = R.deriveContributionBaseline(state.contributionHistory);
    state.normalizedContributionMonths = deepClone(extraction?.normalizedContributionMonths || baseline.normalizedMonths);
    state.derived = baseline.derived;
    return state;
  }

  function persistSession() {
    if (demoMode || !pensionReportState) return;
    const payload = {
      version: 1,
      flowStep,
      yearsUntilRetirement,
      moneyMode,
      pensionReportState: sessionSafeReportState(pensionReportState),
      userCorrections,
    };
    storageSet(SESSION_KEY, JSON.stringify(payload));
  }

  function loadSession() {
    if (demoMode) return false;
    const raw = storageGet(SESSION_KEY);
    if (!raw) return false;
    try {
      const payload = JSON.parse(raw);
      if (payload.version !== 1 || !payload.pensionReportState) return false;
      const scrubbedSessionState = stripSessionSensitiveData(payload.pensionReportState);
      const mustRewriteSensitiveSession = JSON.stringify(scrubbedSessionState) !== JSON.stringify(payload.pensionReportState);
      pensionReportState = normalizeSessionReportState(scrubbedSessionState);
      if (!pensionReportState) return false;
      const restoredYears = payload.yearsUntilRetirement;
      yearsUntilRetirement = Number.isInteger(restoredYears) && restoredYears >= 1 && restoredYears <= 80 ? restoredYears : null;
      moneyMode = payload.moneyMode === 'nominal' ? 'nominal' : 'real';
      userCorrections = {};
      ['currentBalance', 'baselineMonthlyContribution', 'averageReportedPensionSalary', 'depositFee', 'balanceFee'].forEach((key) => {
        if (payload.userCorrections?.[key] === true) userCorrections[key] = true;
      });
      flowStep = [2, 3, 4].includes(payload.flowStep) ? payload.flowStep : 2;
      if (flowStep === 4) {
        if (yearsUntilRetirement == null) flowStep = 3;
        else {
          try {
            initializeSimulator();
            projection = simulatorBaseline.projection;
          } catch (_) {
            flowStep = 2;
            projection = null;
            resetSimulatorState();
          }
        }
      }
      if (mustRewriteSensitiveSession) persistSession();
      return true;
    } catch (_) {
      return false;
    }
  }

  function showStep(step, options = {}) {
    flowStep = Math.max(1, Math.min(4, Number(step) || 1));
    const sectionIds = ['uploadStep', 'reviewStep', 'yearsStep', 'forecastStep'];
    sectionIds.forEach((id, index) => $(id).classList.toggle('hidden', index + 1 !== flowStep));
    document.querySelectorAll('[data-progress-step]').forEach((item) => {
      const itemStep = Number(item.dataset.progressStep);
      item.classList.toggle('active', itemStep === flowStep);
      item.classList.toggle('complete', itemStep < flowStep);
      if (itemStep === flowStep) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    $('moneyModeControl').classList.toggle('hidden', flowStep !== 4);
    if (!options.skipPersist && pensionReportState) persistSession();
    if (!options.skipScroll) window.scrollTo({ top: 0, behavior: options.instant ? 'auto' : 'smooth' });
    if (options.focusTarget) {
      window.requestAnimationFrame(() => $(options.focusTarget)?.focus({ preventScroll: true }));
    }
  }

  function setSourceChip(id, value, correctionKey) {
    const chip = $(id);
    const corrected = Boolean(userCorrections[correctionKey]);
    const missing = value == null || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value));
    chip.textContent = missing ? 'נדרש אישור' : corrected ? 'תוקן ידנית' : 'מהדוח';
    chip.classList.toggle('needs-review', missing);
    chip.classList.toggle('user-source', corrected && !missing);
  }

  function setSalarySourceChip(value) {
    if (value == null || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) {
      $('salarySource').textContent = 'לא נמצא · לפי סכום';
      $('salarySource').classList.remove('needs-review', 'user-source');
      return;
    }
    setSourceChip('salarySource', value, 'averageReportedPensionSalary');
  }

  function updateFeesSourceChip() {
    const depositValue = pensionReportState?.fees?.depositRate;
    const balanceValue = pensionReportState?.fees?.balanceRate;
    const depositMissing = depositValue == null || (typeof depositValue === 'string' && !depositValue.trim()) || !Number.isFinite(Number(depositValue));
    const balanceMissing = balanceValue == null || (typeof balanceValue === 'string' && !balanceValue.trim()) || !Number.isFinite(Number(balanceValue));
    const missing = depositMissing || balanceMissing;
    const corrected = Boolean(userCorrections.depositFee || userCorrections.balanceFee);
    $('feesSource').textContent = missing ? 'נדרש אישור' : corrected ? 'תוקן ידנית' : 'מהדוח';
    $('feesSource').classList.toggle('needs-review', missing);
    $('feesSource').classList.toggle('user-source', corrected && !missing);
  }

  function renderHistory() {
    const rows = Array.isArray(pensionReportState?.contributionHistory) ? pensionReportState.contributionHistory : [];
    $('historyCount').textContent = `${rows.length} ${rows.length === 1 ? 'שורה' : 'שורות'}`;
    const reviewRows = rows.filter((row) => row.requiresReview || ['ambiguous', 'excluded'].includes(row.normalizationStatus));
    $('historyReviewNote').classList.toggle('hidden', !reviewRows.length);
    $('historyReviewNote').textContent = reviewRows.length ? `${reviewRows.length} שורות אינן משתתפות כרגע בממוצע ודורשות בדיקה.` : '';
    if (!rows.length) {
      $('contributionHistory').innerHTML = '<p class="empty-history">לא נמצאו שורות הפקדה אמינות. אפשר להזין למעלה סכום הפקדה חודשי לפי הדוח.</p>';
      return;
    }
    $('contributionHistory').innerHTML = rows.map((row) => {
      const status = row.requiresReview || ['ambiguous', 'excluded'].includes(row.normalizationStatus) ? 'לבדיקה'
        : row.normalizationStatus === 'duplicate-preserved' ? 'כפילות שמורה' : 'נכלל בממוצע';
      const statusClass = status === 'נכלל בממוצע' ? 'included' : 'review';
      const confidence = row.confidence == null || (typeof row.confidence === 'string' && !row.confidence.trim())
        ? null
        : Number(row.confidence);
      const confidenceText = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : '—';
      return `<article class="history-row ${statusClass}">
        <div class="history-month"><strong>${escapeHtml(row.salaryMonth || 'חודש לא מזוהה')}</strong><span>${escapeHtml(row.employerName || 'מעסיק לא צוין בדוח')}</span><b>${status}</b></div>
        <dl>
          <div><dt>שכר מדווח</dt><dd>${formatMoney(row.reportedSalary)}</dd></div>
          <div><dt>עובד</dt><dd>${formatMoney(row.employeeContribution)}</dd></div>
          <div><dt>מעסיק</dt><dd>${formatMoney(row.employerContribution)}</dd></div>
          <div><dt>פיצויים</dt><dd>${formatMoney(row.severanceContribution)}</dd></div>
          <div class="history-total"><dt>סה״כ הפקדה</dt><dd>${formatMoney(row.totalContribution)}</dd></div>
        </dl>
        <small>עמוד ${escapeHtml(row.sourcePage || '—')} · ביטחון ${confidenceText}</small>
      </article>`;
    }).join('');
  }

  function renderReview() {
    if (!pensionReportState) return;
    const oldPension = pensionReportState.fundType === 'old_pension';
    const unknownFund = pensionReportState.fundType !== 'new_pension' && !oldPension;
    const routingMessage = oldPension
      ? 'הדוח הוא של קרן פנסיה ותיקה.\n\nהחישוב הנוכחי של Pension Lab מיועד לקרן פנסיה חדשה, שבה התחזית מבוססת על יתרה צבורה, הפקדות ותשואה.\n\nבקרן ותיקה הקצבה מחושבת לפי זכויות וכללים אחרים, ולכן לא נציג חישוב שעלול להיות שגוי.'
      : unknownFund ? 'לא הצלחנו לקבוע בביטחון אם זהו דוח של קרן פנסיה חדשה או ותיקה. לא נריץ תחזית לפני אישור סוג הקרן.' : '';
    $('routingNotice').classList.toggle('hidden', !routingMessage);
    $('routingMessage').textContent = routingMessage;
    $('fundTypeConfirmationWrap').classList.toggle('hidden', !unknownFund);
    $('fundTypeConfirmation').value = unknownFund ? '' : pensionReportState.fundType;
    $('reviewMetrics').classList.toggle('hidden', oldPension);
    $('derivedRates').classList.toggle('routing-hidden', oldPension);
    $('contributionDisclosure').classList.toggle('hidden', oldPension);
    $('continueToYears').classList.toggle('hidden', oldPension);
    $('continueToYears').disabled = unknownFund;
    setInput('currentBalance', pensionReportState.currentBalance);
    setInput('baselineMonthlyContribution', pensionReportState.derived?.baselineMonthlyContribution);
    setInput('averageReportedPensionSalary', pensionReportState.derived?.averageReportedPensionSalary);
    setInput('depositFee', pensionReportState.fees?.depositRate, 100);
    setInput('balanceFee', pensionReportState.fees?.balanceRate, 100);
    setSourceChip('currentBalanceSource', pensionReportState.currentBalance, 'currentBalance');
    setSourceChip('contributionSource', pensionReportState.derived?.baselineMonthlyContribution, 'baselineMonthlyContribution');
    setSalarySourceChip(pensionReportState.derived?.averageReportedPensionSalary);
    updateFeesSourceChip();

    const monthsUsed = Number(pensionReportState.derived?.monthsUsed) || 0;
    $('contributionMonthsNote').textContent = monthsUsed ? `מבוסס על ${monthsUsed} ${monthsUsed === 1 ? 'חודש הפקדה' : 'חודשי הפקדה'}` : 'לא נמצא חודש הפקדה אמין — נדרש אישור ידני';
    const rates = pensionReportState.derived || {};
    const rateParts = [
      rates.employeeContributionRate == null ? null : `עובד כ־${formatPercentRatio(rates.employeeContributionRate, 1)}`,
      rates.employerContributionRate == null ? null : `מעסיק כ־${formatPercentRatio(rates.employerContributionRate, 1)}`,
      rates.severanceRate == null ? null : `פיצויים כ־${formatPercentRatio(rates.severanceRate, 2)}`,
    ].filter(Boolean);
    $('derivedRates').classList.toggle('hidden', !rateParts.length || oldPension);
    $('derivedRates').textContent = rateParts.join(' · ');

    const typeLabel = pensionReportState.report?.type === 'annual' ? 'דוח שנתי' : pensionReportState.report?.type === 'quarterly' ? 'דוח רבעוני' : 'דוח פנסיה';
    const meta = [typeLabel, pensionReportState.provider, pensionReportState.report?.reportDate].filter(Boolean);
    $('reportMeta').textContent = meta.length ? `${meta.join(' · ')}. בדקו שהמספרים המרכזיים תואמים לדוח.` : 'בדקו שהמספרים המרכזיים תואמים לדוח. אפשר לתקן כל ערך לפני החישוב.';
    const issues = pensionReportState.review?.issues || [];
    const ambiguous = issues.filter((issue) => issue.code === 'AMBIGUOUS_SALARY_MONTH').length;
    $('reviewWarning').classList.toggle('hidden', !ambiguous);
    $('reviewWarning').textContent = ambiguous ? `מצאנו ${ambiguous} חודשי שכר עם כפילות או תיקון לא חד־משמעיים. הם נשמרו בפירוט ואינם נכללים בממוצע.` : '';
    renderHistory();
  }

  function clearErrors() {
    [
      ['currentBalance', 'currentBalanceError'],
      ['baselineMonthlyContribution', 'baselineContributionError'],
      ['depositFee', 'depositFeeError'],
      ['balanceFee', 'balanceFeeError'],
      ['yearsUntilRetirement', 'yearsError'],
    ].forEach(([inputId, errorId]) => clearFieldError(inputId, errorId));
  }

  function clearFieldError(inputId, errorId) {
    $(inputId).classList.remove('invalid');
    $(inputId).setAttribute('aria-invalid', 'false');
    $(errorId).textContent = '';
    $(errorId).removeAttribute('role');
  }

  function errorFor(inputId, errorId, message) {
    $(inputId).classList.add('invalid');
    $(inputId).setAttribute('aria-invalid', 'true');
    $(errorId).setAttribute('role', 'alert');
    $(errorId).textContent = message;
  }

  function commitReviewInputs() {
    const currentBalance = finiteInput('currentBalance');
    const baselineMonthlyContribution = finiteInput('baselineMonthlyContribution');
    const averageReportedPensionSalary = finiteInput('averageReportedPensionSalary');
    const depositFeePercent = finiteInput('depositFee');
    const balanceFeePercent = finiteInput('balanceFee');
    pensionReportState.currentBalance = currentBalance;
    pensionReportState.derived.baselineMonthlyContribution = baselineMonthlyContribution;
    pensionReportState.derived.averageReportedPensionSalary = averageReportedPensionSalary;
    pensionReportState.fees.depositRate = depositFeePercent == null ? null : depositFeePercent / 100;
    pensionReportState.fees.balanceRate = balanceFeePercent == null ? null : balanceFeePercent / 100;
  }

  function validateReview() {
    clearErrors();
    if (pensionReportState.fundType === 'old_pension' || pensionReportState.supportedForCurrentForecast !== true) {
      renderReview();
      return false;
    }
    commitReviewInputs();
    let valid = true;
    if (pensionReportState.currentBalance == null || pensionReportState.currentBalance < 0) {
      errorFor('currentBalance', 'currentBalanceError', 'צריך לאשר יתרה נוכחית לפני החישוב.'); valid = false;
    }
    if (pensionReportState.derived.baselineMonthlyContribution == null || pensionReportState.derived.baselineMonthlyContribution < 0) {
      errorFor('baselineMonthlyContribution', 'baselineContributionError', 'צריך לאשר את סכום ההפקדה החודשית.'); valid = false;
    }
    if (pensionReportState.fees.depositRate == null || pensionReportState.fees.depositRate < 0 || pensionReportState.fees.depositRate > 0.2) {
      errorFor('depositFee', 'depositFeeError', 'הזינו דמי ניהול מהפקדה בין 0% ל־20%.'); valid = false;
    }
    if (pensionReportState.fees.balanceRate == null || pensionReportState.fees.balanceRate < 0 || pensionReportState.fees.balanceRate > 0.2) {
      errorFor('balanceFee', 'balanceFeeError', 'הזינו דמי ניהול מצבירה בין 0% ל־20%.'); valid = false;
    }
    if (valid) persistSession();
    else {
      const firstInvalid = document.querySelector('#reviewStep .invalid');
      window.requestAnimationFrame(() => firstInvalid?.focus());
    }
    return valid;
  }

  function signedMoney(value) {
    if (value == null || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) return '';
    const numeric = Number(value);
    if (Math.abs(numeric) < 0.005) return '';
    return new Intl.NumberFormat('he-IL', {
      style: 'currency', currency: 'ILS', maximumFractionDigits: 0, minimumFractionDigits: 0, signDisplay: 'always',
    }).format(numeric);
  }

  function resetSimulatorState() {
    if (simulatorRenderFrame != null) {
      if (window.cancelAnimationFrame) window.cancelAnimationFrame(simulatorRenderFrame);
      else window.clearTimeout(simulatorRenderFrame);
    }
    if (simulatorAnnouncementTimer != null) window.clearTimeout(simulatorAnnouncementTimer);
    simulatorBaseline = null;
    simulatorControls = null;
    selectedSimulatorScenario = null;
    simulatorComparison = null;
    simulatorRenderFrame = null;
    renderedSimulatorBaseline = null;
    simulatorAnnouncementTimer = null;
    if ($('simulatorPanel')) $('simulatorPanel').classList.add('hidden');
    if ($('simulatorControls')) $('simulatorControls').innerHTML = '';
  }

  function initializeSimulator() {
    simulatorBaseline = S.buildSimulatorBaseline(pensionReportState, yearsUntilRetirement, {
      salaryConfirmed: Boolean(userCorrections.averageReportedPensionSalary),
    });
    simulatorControls = S.resetSimulatorControls(simulatorBaseline);
    selectedSimulatorScenario = S.applySimulatorOverrides(simulatorBaseline, simulatorControls);
    simulatorComparison = S.compareSimulatorScenario(simulatorBaseline, selectedSimulatorScenario);
    return simulatorBaseline;
  }

  function simulatorStatusText(status) {
    if (status === 'central') return C.COPY.centralStatus;
    if (status === 'moderate') return C.COPY.moderateStatus;
    return C.COPY.extremeStatus;
  }

  function simulatorStatusShortText(status) {
    if (status === 'central') return 'טווח מרכזי';
    if (status === 'moderate') return 'מחוץ למרכז';
    return 'קיצון';
  }

  function percentageForConfigValue(config, value, digits = config.valueDigits || 0) {
    return formatPercentRatio(value, digits);
  }

  function contributionAmountForValue(value) {
    if (!simulatorBaseline) return 0;
    const contribution = simulatorBaseline.contribution;
    return contribution.type === 'rate'
      ? contribution.averageReportedPensionSalary * value
      : contribution.baselineMonthlyContribution * value;
  }

  function formatSimulatorValue(key, config, value) {
    if (key === 'contribution' && config.unit === 'multiplier') return formatMoney(contributionAmountForValue(value));
    return percentageForConfigValue(config, value);
  }

  function simulatorValueAriaText(key, config, value) {
    const status = simulatorStatusText(S.scenarioRangeStatus(config, value));
    if (key === 'contribution' && config.unit === 'multiplier') {
      return `${config.label}: ${formatMoney(contributionAmountForValue(value))}, ${Math.round(value * 100)}% מנקודת הבסיס. ${status}.`;
    }
    const amount = key === 'contribution' ? `, כ-${formatMoney(contributionAmountForValue(value))} לחודש` : '';
    return `${config.label}: ${formatSimulatorValue(key, config, value)}${amount}. ${status}.`;
  }

  function sliderPercent(config, value) {
    return ((Number(value) - config.min) / (config.max - config.min)) * 100;
  }

  function sliderStyle(config, value) {
    return [
      `--central-start:${sliderPercent(config, config.centralMin)}%`,
      `--central-end:${sliderPercent(config, config.centralMax)}%`,
      `--moderate-start:${sliderPercent(config, config.moderateMin)}%`,
      `--moderate-end:${sliderPercent(config, config.moderateMax)}%`,
      `--baseline-position:${sliderPercent(config, config.baselineValue)}%`,
      `--selection-position:${sliderPercent(config, value)}%`,
    ].join(';');
  }

  function sourceLinksFor(config) {
    const sources = (config.sourceIds || []).map((id) => C.SOURCES[id]).filter(Boolean);
    if (!sources.length) return '';
    return `<div class="simulator-info-sources"><strong>מקורות שנבדקו ב-${escapeHtml(C.REVIEWED_DATE)}</strong>${sources.map((source) => `
      <a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.sourceOrganization)} · ${escapeHtml(source.sourceTitle)}</a>
      <small>${escapeHtml(source.note)}</small>`).join('')}</div>`;
  }

  function sliderTickLabel(config, value) {
    if (config.unit === 'multiplier') return `${Math.round(value * 100)}% מהבסיס`;
    return percentageForConfigValue(config, value, config.tickDigits || 0);
  }

  function nativeRangeStep(config) {
    const scaled = [config.min, config.max, config.baselineValue, config.step].map((value) => Number(value) * 100);
    const decimalPlaces = Math.min(6, scaled.reduce((maximum, value) => {
      const normalized = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
      return Math.max(maximum, normalized.includes('.') ? normalized.split('.')[1].length : 0);
    }, 0));
    const scale = 10 ** decimalPlaces;
    const integers = scaled.map((value) => Math.round(value * scale));
    const gcd = (left, right) => {
      let a = Math.abs(left);
      let b = Math.abs(right);
      while (b) [a, b] = [b, a % b];
      return a;
    };
    const step = [integers[3], integers[2] - integers[0], integers[1] - integers[0]]
      .reduce((current, value) => gcd(current, value));
    return String(step / scale);
  }

  function renderSimulatorSlider(key, config, options = {}) {
    const value = simulatorControls[key];
    const status = S.scenarioRangeStatus(config, value);
    const id = `simulator-${key}`;
    const amountLine = key === 'contribution'
      ? `<span class="simulator-control-subvalue" data-simulator-amount="${key}">${config.unit === 'multiplier' ? `${Math.round(value * 100)}% מנקודת הבסיס` : `≈ ${formatMoney(contributionAmountForValue(value))} לחודש`}</span>`
      : '';
    const info = config.info || { title: config.label, paragraphs: [] };
    return `<article class="simulator-control${options.compact ? ' simulator-control-compact' : ''}" data-simulator-control="${key}" data-range-status="${status}" style="${sliderStyle(config, value)}">
      <div class="simulator-control-header">
        <div class="simulator-control-title">
          <h3 id="${id}-label">${escapeHtml(config.label)}</h3>
          <span id="${id}-unit" class="visually-hidden">${config.unit === 'multiplier' ? 'אחוז מנקודת הבסיס' : 'באחוזים'}</span>
          <button type="button" class="simulator-info-button" data-simulator-info="${key}" aria-controls="${id}-info" aria-expanded="false" aria-label="מידע על ${escapeHtml(config.label)}">ⓘ</button>
          <span class="simulator-range-status" data-simulator-status-visible="${key}" aria-hidden="true">${escapeHtml(simulatorStatusShortText(status))}</span>
        </div>
        <div class="simulator-selected-value">
          <output id="${id}-value" data-simulator-value="${key}">${escapeHtml(formatSimulatorValue(key, config, value))}</output>
          ${amountLine}
        </div>
      </div>
      <div class="simulator-range-wrap" dir="ltr">
        <input id="${id}-input" class="simulator-range" data-simulator-input="${key}" type="range" min="${config.min * 100}" max="${config.max * 100}" step="${nativeRangeStep(config)}" value="${value * 100}" aria-labelledby="${id}-label ${id}-unit" aria-describedby="${id}-status" aria-valuemin="${config.min * 100}" aria-valuemax="${config.max * 100}" aria-valuenow="${value * 100}" aria-valuetext="${escapeHtml(simulatorValueAriaText(key, config, value))}" />
        <span class="simulator-baseline-marker" aria-hidden="true"><i></i><b>${escapeHtml(C.COPY.baseline)}</b></span>
      </div>
      <div class="simulator-ticks" dir="ltr" aria-hidden="true"><span>${escapeHtml(sliderTickLabel(config, config.min))}</span><span class="simulator-central-tick">${escapeHtml(sliderTickLabel(config, config.centralMin))}–${escapeHtml(sliderTickLabel(config, config.centralMax))}</span><span>${escapeHtml(sliderTickLabel(config, config.max))}</span></div>
      <span id="${id}-status" class="visually-hidden" data-simulator-status="${key}">${escapeHtml(simulatorStatusText(status))}</span>
      <section id="${id}-info" class="simulator-info hidden" role="dialog" aria-label="${escapeHtml(info.title)}" aria-modal="false">
        <button type="button" class="simulator-info-close" data-simulator-info-close="${key}" aria-label="סגירת מידע">×</button>
        <h4>${escapeHtml(info.title)}</h4>
        ${info.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
        ${sourceLinksFor(config)}
        <p class="simulator-info-disclaimer">המידע מיועד להשוואת תרחישים בלבד, ואינו ייעוץ פנסיוני אישי.</p>
      </section>
    </article>`;
  }

  function closeSimulatorInfo(exceptKey = null) {
    document.querySelectorAll('.simulator-info').forEach((panel) => {
      const key = panel.closest('[data-simulator-control]')?.dataset.simulatorControl;
      if (key === exceptKey) return;
      panel.classList.add('hidden');
      const button = document.querySelector(`[data-simulator-info="${key}"]`);
      if (button) {
        button.setAttribute('aria-expanded', 'false');
        delete button.dataset.pinned;
      }
    });
  }

  function setSimulatorInfoOpen(key, open, pinned = false) {
    const panel = $(`simulator-${key}-info`);
    const button = document.querySelector(`[data-simulator-info="${key}"]`);
    if (!panel || !button) return;
    if (open) closeSimulatorInfo(key);
    panel.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open && pinned) button.dataset.pinned = 'true';
    if (!open) delete button.dataset.pinned;
  }

  function focusSimulatorInfoTrigger(key) {
    const button = document.querySelector(`[data-simulator-info="${key}"]`);
    if (!button) return;
    button.dataset.suppressFocusOpen = 'true';
    button.focus({ preventScroll: true });
    window.queueMicrotask(() => { delete button.dataset.suppressFocusOpen; });
  }

  function syncSimulatorControlUi(key) {
    if (!simulatorBaseline || !simulatorControls) return;
    const config = simulatorBaseline.controlsConfig[key];
    const value = simulatorControls[key];
    const control = document.querySelector(`[data-simulator-control="${key}"]`);
    if (!control) return;
    const status = S.scenarioRangeStatus(config, value);
    control.dataset.rangeStatus = status;
    control.style.setProperty('--selection-position', `${sliderPercent(config, value)}%`);
    const input = control.querySelector('[data-simulator-input]');
    const output = control.querySelector('[data-simulator-value]');
    const statusNode = control.querySelector('[data-simulator-status]');
    if (input) {
      input.value = String(value * 100);
      input.setAttribute('aria-valuenow', String(value * 100));
      input.setAttribute('aria-valuetext', simulatorValueAriaText(key, config, value));
    }
    if (output) output.textContent = formatSimulatorValue(key, config, value);
    if (statusNode) statusNode.textContent = simulatorStatusText(status);
    const visualStatus = control.querySelector('[data-simulator-status-visible]');
    if (visualStatus) visualStatus.textContent = simulatorStatusShortText(status);
    const amount = control.querySelector('[data-simulator-amount]');
    if (amount && key === 'contribution') {
      amount.textContent = config.unit === 'multiplier'
        ? `${Math.round(value * 100)}% מנקודת הבסיס`
        : `≈ ${formatMoney(contributionAmountForValue(value))} לחודש`;
    }
  }

  function renderSimulatorControls() {
    if (!simulatorBaseline) return;
    const controls = simulatorBaseline.controlsConfig;
    $('simulatorControls').innerHTML = [
      renderSimulatorSlider('nominalReturn', controls.nominalReturn),
      renderSimulatorSlider('inflation', controls.inflation),
      renderSimulatorSlider('contribution', controls.contribution),
      `<section class="simulator-fees" aria-labelledby="simulatorFeesTitle"><div class="simulator-fees-heading"><span class="eyebrow">שני רכיבים, תרחיש אחד</span><h3 id="simulatorFeesTitle">דמי ניהול</h3></div>${renderSimulatorSlider('depositFee', controls.depositFee, { compact: true })}${renderSimulatorSlider('balanceFee', controls.balanceFee, { compact: true })}</section>`,
    ].join('');
    renderedSimulatorBaseline = simulatorBaseline;
    $('simulatorPanel').classList.remove('hidden');

    document.querySelectorAll('[data-simulator-input]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.simulatorInput;
        setSimulatorControlValue(key, Number(input.value) / 100, { snap: false });
      });
      input.addEventListener('keydown', (event) => {
        const key = input.dataset.simulatorInput;
        const config = simulatorBaseline.controlsConfig[key];
        const stepDirection = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
        if (event.key === 'Home' || event.key === 'End' || stepDirection) {
          event.preventDefault();
          const raw = event.key === 'Home' ? config.min : event.key === 'End' ? config.max
            : simulatorControls[key] + stepDirection * config.step;
          setSimulatorControlValue(key, raw, { snap: false });
        }
      });
    });
    document.querySelectorAll('[data-simulator-info]').forEach((button) => {
      const key = button.dataset.simulatorInfo;
      button.addEventListener('click', () => {
        const pinned = button.dataset.pinned === 'true';
        if (pinned) {
          setSimulatorInfoOpen(key, false);
          return;
        }
        setSimulatorInfoOpen(key, true, true);
        $(`simulator-${key}-info`)?.querySelector('[data-simulator-info-close]')?.focus({ preventScroll: true });
      });
      button.addEventListener('mouseenter', () => { if (button.dataset.pinned !== 'true') setSimulatorInfoOpen(key, true); });
      button.addEventListener('focus', () => {
        if (button.dataset.pinned !== 'true' && button.dataset.suppressFocusOpen !== 'true') setSimulatorInfoOpen(key, true);
      });
      const control = button.closest('[data-simulator-control]');
      control?.addEventListener('mouseleave', () => {
        if (button.dataset.pinned !== 'true' && !control.matches(':focus-within')) setSimulatorInfoOpen(key, false);
      });
      control?.addEventListener('focusout', () => {
        window.queueMicrotask(() => {
          if (button.dataset.pinned !== 'true' && !control.contains(document.activeElement)) setSimulatorInfoOpen(key, false);
        });
      });
    });
    document.querySelectorAll('[data-simulator-info-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.simulatorInfoClose;
        setSimulatorInfoOpen(key, false);
        focusSimulatorInfoTrigger(key);
      });
    });
  }

  function updateForecastResult() {
    if (!projection) return;
    const real = moneyMode === 'real';
    const baseline = simulatorComparison?.baseline || projection;
    const atBaseline = simulatorBaseline && S.controlsAtBaseline(simulatorBaseline, simulatorControls);
    const scenario = atBaseline ? baseline : (simulatorComparison?.scenario || projection);
    const pension = real ? scenario.monthlyPensionReal : scenario.monthlyPensionNominal;
    const balance = real ? scenario.retirementBalanceReal : scenario.retirementBalanceNominal;
    const baselinePension = real ? baseline.monthlyPensionReal : baseline.monthlyPensionNominal;
    const baselineBalance = real ? baseline.retirementBalanceReal : baseline.retirementBalanceNominal;
    const pensionDelta = pension - baselinePension;
    const balanceDelta = balance - baselineBalance;
    $('headlinePension').textContent = formatMoney(pension);
    $('headlineBalance').textContent = formatMoney(balance);
    $('headlinePensionComparison').textContent = `בסיס ${formatMoney(baselinePension)}${atBaseline ? '' : ` · ${signedMoney(pensionDelta)}`}`;
    $('headlineBalanceComparison').textContent = `בסיס ${formatMoney(baselineBalance)}${atBaseline ? '' : ` · ${signedMoney(balanceDelta)}`}`;
    $('headlinePensionComparison').dataset.delta = atBaseline ? 'neutral' : pensionDelta >= 0 ? 'positive' : 'negative';
    $('headlineBalanceComparison').dataset.delta = atBaseline ? 'neutral' : balanceDelta >= 0 ? 'positive' : 'negative';
    $('forecastTitle').textContent = atBaseline
      ? (demoMode ? 'נקודת פתיחה סינתטית' : 'זו נקודת הפתיחה שלך')
      : 'התרחיש שבחרת';
    $('horizonSummary').textContent = `בעוד ${yearsUntilRetirement} שנים · ${baseline.monthsUntilRetirement} חודשים בדיוק`;
    $('forecastModeDescription').textContent = real
      ? 'הסכומים מוצגים בשקלים של היום, לאחר קיזוז השפעת האינפלציה.'
      : 'הסכומים מוצגים בשקלים עתידיים וכוללים את הנחת האינפלציה.';
    document.querySelectorAll('[data-money-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.moneyMode === moneyMode)));
    if (simulatorAnnouncementTimer != null) window.clearTimeout(simulatorAnnouncementTimer);
    simulatorAnnouncementTimer = window.setTimeout(() => {
      simulatorAnnouncementTimer = null;
      $('forecastAnnouncement').textContent = `קצבה חודשית ${formatMoney(pension)}. צבירה בפרישה ${formatMoney(balance)}.${atBaseline ? ' תרחיש הבסיס.' : ` שינוי בקצבה ${signedMoney(pensionDelta)}.`}`;
    }, 320);
  }

  function renderForecastAssumptions() {
    const assumptions = [
      ['יתרה נוכחית', formatMoney(pensionReportState.currentBalance)],
      ['הפקדה חודשית בבסיס', `${formatMoney(pensionReportState.derived.baselineMonthlyContribution)} במונחים ריאליים`],
      ['תשואה בבסיס', `${formatPercentRatio(DEFAULT_ASSUMPTIONS.realReturnRate, 0)} ריאלית · ${formatPercentRatio(DEFAULT_ASSUMPTIONS.nominalReturnRate, 2)} נומינלית`],
      ['אינפלציה בבסיס', `${formatPercentRatio(DEFAULT_ASSUMPTIONS.inflationRate, 0)} לשנה`],
      ['דמי ניהול בבסיס', `${formatPercentRatio(pensionReportState.fees.depositRate)} מהפקדה · ${formatPercentRatio(pensionReportState.fees.balanceRate)} מצבירה`],
      ['אופק ומקדם', `${yearsUntilRetirement} שנים · מקדם ${DEFAULT_ASSUMPTIONS.coefficient}`],
    ];
    $('forecastAssumptions').innerHTML = assumptions.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  }

  function renderForecast() {
    if (!projection) return;
    if (!simulatorBaseline) initializeSimulator();
    if (renderedSimulatorBaseline !== simulatorBaseline) renderSimulatorControls();
    updateForecastResult();
    renderForecastAssumptions();
  }

  function scheduleSimulatorProjection() {
    if (!simulatorBaseline || simulatorRenderFrame != null) return;
    const schedule = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
    simulatorRenderFrame = schedule(() => {
      simulatorRenderFrame = null;
      selectedSimulatorScenario = S.applySimulatorOverrides(simulatorBaseline, simulatorControls);
      simulatorComparison = S.compareSimulatorScenario(simulatorBaseline, selectedSimulatorScenario);
      updateForecastResult();
    });
  }

  function setSimulatorControlValue(key, rawValue, options = {}) {
    if (!simulatorBaseline || !simulatorControls) return;
    const config = simulatorBaseline.controlsConfig[key];
    const numeric = rawValue == null || (typeof rawValue === 'string' && !rawValue.trim()) ? NaN : Number(rawValue);
    if (!config || !Number.isFinite(numeric)) return;
    const clamped = Math.min(config.max, Math.max(config.min, numeric));
    const value = options.snap ? S.snapToStep(config, clamped) : clamped;
    simulatorControls = { ...simulatorControls, [key]: value };
    syncSimulatorControlUi(key);
    scheduleSimulatorProjection();
  }

  function resetSimulatorToBaseline() {
    if (!simulatorBaseline) return;
    simulatorControls = S.resetSimulatorControls(simulatorBaseline);
    Object.keys(simulatorControls).forEach((key) => syncSimulatorControlUi(key));
    closeSimulatorInfo();
    scheduleSimulatorProjection();
  }

  function setProcessing(active, update = {}) {
    $('reportProcessing').classList.toggle('hidden', !active);
    $('pensionReportFile').disabled = active;
    if (!active) {
      processingProgress = 0;
      $('processingTrack').setAttribute('aria-valuenow', '0');
      return;
    }
    if (update.resetProgress) processingProgress = 0;
    if (update.title && $('processingTitle').textContent !== update.title) $('processingTitle').textContent = update.title;
    if (update.detail && $('processingDetail').textContent !== update.detail) $('processingDetail').textContent = update.detail;
    const requested = Number(update.progress);
    if (Number.isFinite(requested)) processingProgress = Math.max(processingProgress, Math.max(0.05, Math.min(1, requested)));
    else if (!processingProgress) processingProgress = 0.08;
    const percent = Math.round(processingProgress * 1000) / 10;
    $('processingBar').style.width = `${percent}%`;
    $('processingTrack').setAttribute('aria-valuenow', String(Math.round(percent)));
  }

  function progressUpdate(progress) {
    const phase = String(progress?.phase || '');
    const overallProgress = progress?.overallProgress == null ? Number.NaN : Number(progress.overallProgress);
    const pageDetail = progress?.pageNumber && progress?.pageCount
      ? `עמוד ${progress.pageNumber} מתוך ${progress.pageCount}`
      : '';
    if (phase === 'pdf-text') {
      setProcessing(true, {
        title: 'קוראים את הדוח…',
        detail: pageDetail || 'מחלצים שכבת טקסט מקומית',
        progress: 0.08 + (progress.pageNumber || 1) / Math.max(1, progress.pageCount || 1) * 0.2,
      });
    } else if (phase === 'scanned-pdf') {
      setProcessing(true, { title: 'הדוח נראה סרוק', detail: 'מפעילים זיהוי טקסט מקומי', progress: 0.3 });
    } else if (phase === 'rendering') {
      setProcessing(true, {
        title: 'מכינים את עמודי הדוח…',
        detail: pageDetail || 'מכינים תמונה לזיהוי מקומי',
        progress: Number.isFinite(overallProgress) ? overallProgress : 0.42,
      });
    } else if (phase === 'recognizing') {
      const stageDetail = [pageDetail, progress?.stageLabel].filter(Boolean).join(' · ');
      setProcessing(true, {
        title: 'מזהים טקסט בדוח…',
        detail: stageDetail || 'העיבוד נשאר במכשיר שלך',
        progress: Number.isFinite(overallProgress) ? overallProgress : 0.45 + (Number(progress.progress) || 0) * 0.5,
      });
    } else if (phase === 'loading-language' || phase === 'loading-ocr') {
      setProcessing(true, {
        title: 'מכינים זיהוי עברית…',
        detail: 'טעינה מקומית חד־פעמית',
        progress: 0.3 + (Number(progress.progress) || 0) * 0.1,
      });
    } else if (phase === 'ocr-page-complete' || phase === 'finalizing') {
      setProcessing(true, {
        title: phase === 'finalizing' ? 'מסכמים את הנתונים…' : 'מזהים טקסט בדוח…',
        detail: phase === 'finalizing' ? 'בודקים התאמות וסכומים' : pageDetail,
        progress: Number.isFinite(overallProgress) ? overallProgress : 0.98,
      });
    }
  }

  function extractionStatusText(extraction) {
    const status = extraction?.status;
    if (status === 'password-protected') return 'הדוח מוגן בסיסמה. שמרו עותק PDF פתוח ונסו שוב.';
    if (status === 'corrupted-pdf' || status === 'unreadable-pdf') return 'לא הצלחנו לקרוא את קובץ ה־PDF. נסו להוריד אותו מחדש.';
    if (status === 'wrong-document') return 'הקובץ לא נראה כמו דוח פנסיה שנתי או רבעוני.';
    if (status === 'too-many-pages') return 'הדוח ארוך ממגבלת העיבוד המקומי (10 עמודים).';
    if (status === 'file-too-large') return 'הקובץ גדול מ־12MB.';
    if (status === 'unsupported-type') return 'כרגע ניתן להעלות דוח פנסיה בפורמט PDF.';
    if (status === 'cancelled') return 'העיבוד בוטל.';
    if (extraction?.pensionReportState?.fundType === 'old_pension') return 'הדוח זוהה כדוח של קרן פנסיה ותיקה. התחזית הנוכחית אינה מתאימה לו.';
    if (extraction?.pensionReportState?.fundType === 'unknown') return 'קראנו את הדוח, אבל צריך לאשר אם הקרן חדשה או ותיקה לפני תחזית.';
    const months = Number(extraction?.pensionReportState?.derived?.monthsUsed) || 0;
    return months ? `הדוח נקרא. מצאנו ${months} ${months === 1 ? 'חודש הפקדה' : 'חודשי הפקדה'}.` : 'קראנו את הדוח. יש כמה ערכים שצריך לאשר ידנית.';
  }

  function applyExtraction(extraction) {
    selectedDocument = extraction;
    pensionReportState = stateFromExtraction(extraction);
    projection = null;
    userCorrections = {};
    resetSimulatorState();
    renderReview();
    showStep(2, { focusTarget: 'reviewTitle' });
  }

  function waitForCompletionPaint() {
    return new Promise((resolve) => {
      const holdVisible = () => window.setTimeout(resolve, 250);
      if (typeof window.requestAnimationFrame !== 'function') {
        holdVisible();
        return;
      }
      window.requestAnimationFrame(() => window.requestAnimationFrame(holdVisible));
    });
  }

  async function handleReportSelection() {
    const file = $('pensionReportFile').files?.[0];
    if (!file) return;
    if (processingController) processingController.abort();
    const controller = new AbortController();
    processingController = controller;
    $('pensionReportStatus').textContent = 'מתחילים לקרוא את הדוח…';
    setProcessing(true, { title: 'פותחים את הדוח…', detail: 'המסמך אינו נשלח לשרת', progress: 0.08, resetProgress: true });
    try {
      const extraction = await D.extract(file, D.SOURCES.PENSION_REPORT, {
        signal: controller.signal,
        onProgress(progress) {
          if (processingController === controller) progressUpdate(progress);
        },
      });
      const reviewable = ![
        'cancelled', 'unsupported-type', 'file-too-large', 'password-protected', 'corrupted-pdf',
        'unreadable-pdf', 'wrong-document', 'too-many-pages',
      ].includes(extraction.status);
      if (reviewable) {
        setProcessing(true, { title: 'הדוח נקרא', detail: 'פותחים את שלב הבדיקה', progress: 1 });
        await waitForCompletionPaint();
      }
      if (processingController !== controller) return;
      if (controller.signal.aborted || extraction.status === 'cancelled') {
        $('pensionReportStatus').textContent = 'העיבוד בוטל.';
        return;
      }
      $('pensionReportStatus').textContent = extractionStatusText(extraction);
      if (reviewable) applyExtraction(extraction);
    } catch (_) {
      if (processingController === controller) {
        $('pensionReportStatus').textContent = controller.signal.aborted
          ? 'העיבוד בוטל.'
          : 'לא הצלחנו לקרוא את הדוח. נסו שוב או השתמשו בעותק PDF אחר.';
      }
    } finally {
      if (processingController === controller) {
        processingController = null;
        setProcessing(false);
      }
    }
  }

  function markCorrection(inputId, correctionKey) {
    $(inputId).addEventListener('input', () => {
      const value = finiteInput(inputId);
      if (value == null) delete userCorrections[correctionKey];
      else userCorrections[correctionKey] = true;
      const errorId = {
        currentBalance: 'currentBalanceError',
        baselineMonthlyContribution: 'baselineContributionError',
        depositFee: 'depositFeeError',
        balanceFee: 'balanceFeeError',
      }[correctionKey];
      if (errorId) clearFieldError(inputId, errorId);
      if (pensionReportState) commitReviewInputs();
      if (correctionKey === 'currentBalance') setSourceChip('currentBalanceSource', finiteInput(inputId), correctionKey);
      if (correctionKey === 'baselineMonthlyContribution') setSourceChip('contributionSource', finiteInput(inputId), correctionKey);
      if (correctionKey === 'averageReportedPensionSalary') setSalarySourceChip(finiteInput(inputId));
      if (correctionKey === 'depositFee' || correctionKey === 'balanceFee') {
        updateFeesSourceChip();
      }
    });
  }

  function resetFlow() {
    if (demoMode) {
      window.location.assign(DEMO.demoExitUrl(window.location.href));
      return;
    }
    if (processingController) processingController.abort();
    selectedDocument = null;
    pensionReportState = null;
    projection = null;
    yearsUntilRetirement = null;
    userCorrections = {};
    resetSimulatorState();
    $('pensionReportFile').value = '';
    $('pensionReportStatus').textContent = 'לא נבחר קובץ';
    $('yearsUntilRetirement').value = '';
    storageRemove(SESSION_KEY);
    $('sessionRestoreNotice').classList.add('hidden');
    showStep(1, { skipPersist: true, focusTarget: 'uploadTitle' });
  }

  function initializeDemoMode() {
    document.body.classList.add('demo-mode');
    pensionReportState = DEMO.createDemoPensionReportState();
    yearsUntilRetirement = DEMO.getDemoYears();
    moneyMode = 'real';
    userCorrections = {};
    selectedDocument = null;
    resetSimulatorState();
    initializeSimulator();
    projection = simulatorBaseline.projection;
    $('yearsUntilRetirement').value = String(yearsUntilRetirement);
    $('demoBanner').classList.remove('hidden');
    $('exitDemo').href = DEMO.demoExitUrl(window.location.href);
    $('forecastEyebrow').textContent = 'תחזית הדגמה';
    $('forecastTitle').textContent = 'נקודת פתיחה סינתטית';
    renderForecast();
    showStep(4, { skipPersist: true, skipScroll: true, instant: true });
  }

  $('pensionReportFile').addEventListener('change', handleReportSelection);
  $('cancelProcessing').addEventListener('click', () => processingController?.abort());
  $('backToUpload').addEventListener('click', () => {
    $('pensionReportFile').value = '';
    $('pensionReportStatus').textContent = 'לא נבחר קובץ';
    showStep(1, { focusTarget: 'uploadTitle' });
  });
  $('continueToYears').addEventListener('click', () => {
    if (validateReview()) {
      renderReview();
      showStep(3, { focusTarget: 'yearsUntilRetirement' });
    }
  });
  $('fundTypeConfirmation').addEventListener('change', () => {
    if (!pensionReportState) return;
    const confirmed = $('fundTypeConfirmation').value;
    if (!['new_pension', 'old_pension'].includes(confirmed)) return;
    pensionReportState.fundType = confirmed;
    pensionReportState.supportedForCurrentForecast = confirmed === 'new_pension';
    pensionReportState.routingReason = confirmed === 'new_pension' ? 'USER_CONFIRMED_NEW_PENSION' : 'OLD_PENSION_REQUIRES_RIGHTS_BASED_MODEL';
    pensionReportState.confidence = { ...(pensionReportState.confidence || {}), fundTypeConfidence: 'USER_CONFIRMED' };
    pensionReportState.decision = {
      ...(pensionReportState.decision || {}),
      automaticAccepted: false,
      requiresReview: confirmed === 'new_pension',
      reasons: confirmed === 'new_pension' ? ['USER_CONFIRMED_FUND_TYPE'] : ['OLD_PENSION_REQUIRES_RIGHTS_BASED_MODEL'],
    };
    pensionReportState.review = confirmed === 'new_pension'
      ? { ...(pensionReportState.review || {}), requiresReview: true }
      : { requiresReview: false, issues: [] };
    persistSession();
    renderReview();
    window.requestAnimationFrame(() => $(confirmed === 'new_pension' ? 'continueToYears' : 'routingNotice')?.focus({ preventScroll: true }));
  });
  $('backToReview').addEventListener('click', () => showStep(2, { focusTarget: 'reviewTitle' }));
  $('calculateForecast').addEventListener('click', () => {
    clearErrors();
    const years = finiteInput('yearsUntilRetirement');
    if (years == null || !Number.isInteger(years) || years < 1 || years > 80) {
      errorFor('yearsUntilRetirement', 'yearsError', 'הזינו מספר שלם בין שנה אחת ל־80 שנים.');
      $('yearsUntilRetirement').focus();
      return;
    }
    if (!validateReview()) { showStep(2); return; }
    try {
      yearsUntilRetirement = years;
      resetSimulatorState();
      initializeSimulator();
      projection = simulatorBaseline.projection;
      renderForecast();
      showStep(4, { focusTarget: 'forecastTitle' });
    } catch (error) {
      errorFor('yearsUntilRetirement', 'yearsError', 'לא ניתן לחשב עם הערכים שהוזנו. חזרו לבדיקת הדוח וודאו שהיתרה וההפקדה בטווח סביר.');
      $('yearsUntilRetirement').focus();
    }
  });
  $('editYears').addEventListener('click', () => showStep(3, { focusTarget: 'yearsUntilRetirement' }));
  $('startOver').addEventListener('click', resetFlow);
  $('resetSimulator').addEventListener('click', resetSimulatorToBaseline);
  document.querySelectorAll('[data-money-mode]').forEach((button) => button.addEventListener('click', () => {
    moneyMode = button.dataset.moneyMode === 'nominal' ? 'nominal' : 'real';
    renderForecast();
    persistSession();
  }));
  ['currentBalance', 'baselineMonthlyContribution', 'averageReportedPensionSalary'].forEach((id) => markCorrection(id, id));
  markCorrection('depositFee', 'depositFee');
  markCorrection('balanceFee', 'balanceFee');
  $('yearsUntilRetirement').addEventListener('input', () => clearFieldError('yearsUntilRetirement', 'yearsError'));
  $('yearsUntilRetirement').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('calculateForecast').click();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const panel = document.querySelector('.simulator-info:not(.hidden)');
      const key = panel?.closest('[data-simulator-control]')?.dataset.simulatorControl;
      closeSimulatorInfo();
      if (key) focusSimulatorInfoTrigger(key);
    }
  });

  if (demoMode) {
    initializeDemoMode();
  } else {
    const restored = loadSession();
    if (restored) {
      renderReview();
      if (yearsUntilRetirement) $('yearsUntilRetirement').value = String(yearsUntilRetirement);
      if (projection) renderForecast();
      showStep(flowStep, { skipPersist: true, skipScroll: true, instant: true });
      $('sessionRestoreNotice').classList.remove('hidden');
    } else {
      showStep(1, { skipPersist: true, skipScroll: true, instant: true });
    }
  }

  window.PensionLabTest = Object.freeze({
    getSelectedDocument(kind) { return kind === 'pensionReport' ? deepClone(selectedDocument) : null; },
    getPensionReportState() { return deepClone(pensionReportState); },
    getProjection() { return deepClone(projection); },
    getSimulatorBaseline() { return deepClone(simulatorBaseline); },
    getSimulatorControls() { return deepClone(simulatorControls); },
    getSimulatorComparison() { return deepClone(simulatorComparison); },
    getFlowStep() { return flowStep; },
    isDemoMode() { return demoMode; },
    isReportProcessing() { return Boolean(processingController); },
    applyParsedText(text, method = 'pdf-text') {
      const parsed = R.parsePensionReport(String(text || ''), { method });
      const extraction = {
        status: Object.keys(parsed.fields || {}).length ? 'partial' : 'manual-required',
        kind: D.SOURCES.PENSION_REPORT,
        fields: parsed.fields,
        contributionHistory: parsed.contributionHistory,
        normalizedContributionMonths: parsed.normalizedContributionMonths,
        pensionReportState: parsed.pensionReportState,
        classification: parsed.classification,
        method,
      };
      applyExtraction(extraction);
      return deepClone(pensionReportState);
    },
    setPensionReportState(nextState) {
      resetSimulatorState();
      pensionReportState = deepClone(nextState);
      selectedDocument = { status: 'partial', kind: D.SOURCES.PENSION_REPORT, pensionReportState: deepClone(nextState), fields: {} };
      projection = null;
      yearsUntilRetirement = null;
      renderReview();
      showStep(2);
    },
    setYearsUntilRetirement(years) { $('yearsUntilRetirement').value = String(years); },
    calculateForecast() { $('calculateForecast').click(); return deepClone(projection); },
    setSimulatorControl(key, value) { setSimulatorControlValue(key, value, { snap: false }); return deepClone(simulatorControls); },
    resetSimulator: resetSimulatorToBaseline,
    reset: resetFlow,
  });
})();
