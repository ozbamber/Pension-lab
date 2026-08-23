(function () {
  'use strict';

  const E = window.PensionEngine;
  const D = window.PensionDocuments;
  const R = window.PensionReportParser;
  if (!E || !D || !R) throw new Error('Pension Lab dependencies are missing.');

  const SESSION_KEY = 'pension-lab-report-first-session-v1';
  const DEFAULT_ASSUMPTIONS = Object.freeze({ realReturnRate: 0.04, inflationRate: 0.02, coefficient: 200 });
  const volatileStorage = new Map();
  const $ = (id) => document.getElementById(id);

  let selectedDocument = null;
  let pensionReportState = null;
  let projection = null;
  let yearsUntilRetirement = null;
  let flowStep = 1;
  let moneyMode = 'real';
  let processingController = null;
  let userCorrections = {};

  function storageGet(key) {
    try { return window.sessionStorage.getItem(key); }
    catch (_) { return volatileStorage.get(key) ?? null; }
  }

  function storageSet(key, value) {
    try { window.sessionStorage.setItem(key, value); }
    catch (_) { volatileStorage.set(key, value); }
  }

  function storageRemove(key) {
    try { window.sessionStorage.removeItem(key); }
    catch (_) { volatileStorage.delete(key); }
  }

  function deepClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function sessionSafeReportState(state) {
    const copy = deepClone(state);
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
    $(id).value = value == null || !Number.isFinite(Number(value)) ? '' : String(Math.round(Number(value) * scale * 10000) / 10000);
  }

  function formatMoney(value, options = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    const digits = options.decimals == null ? 0 : options.decimals;
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(numeric);
  }

  function formatPercentRatio(value, digits = 2) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits).replace(/\.00$/, '')}%` : '—';
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
    if (!pensionReportState) return;
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
    const raw = storageGet(SESSION_KEY);
    if (!raw) return false;
    try {
      const payload = JSON.parse(raw);
      if (payload.version !== 1 || !payload.pensionReportState) return false;
      pensionReportState = payload.pensionReportState;
      yearsUntilRetirement = Number.isFinite(Number(payload.yearsUntilRetirement)) ? Number(payload.yearsUntilRetirement) : null;
      moneyMode = payload.moneyMode === 'nominal' ? 'nominal' : 'real';
      userCorrections = payload.userCorrections && typeof payload.userCorrections === 'object' ? payload.userCorrections : {};
      flowStep = Math.max(2, Math.min(4, Number(payload.flowStep) || 2));
      if (flowStep === 4 && yearsUntilRetirement) {
        try { projection = E.projectBaseline(pensionReportState, yearsUntilRetirement, DEFAULT_ASSUMPTIONS); }
        catch (_) { flowStep = 2; projection = null; }
      }
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
  }

  function setSourceChip(id, value, correctionKey) {
    const chip = $(id);
    const corrected = Boolean(userCorrections[correctionKey]);
    const missing = value == null || !Number.isFinite(Number(value));
    chip.textContent = corrected ? 'תוקן ידנית' : missing ? 'נדרש אישור' : 'מהדוח';
    chip.classList.toggle('needs-review', missing);
    chip.classList.toggle('user-source', corrected);
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
      return `<article class="history-row ${statusClass}">
        <div class="history-month"><strong>${escapeHtml(row.salaryMonth || 'חודש לא מזוהה')}</strong><span>${escapeHtml(row.employerName || 'מעסיק לא צוין בדוח')}</span><b>${status}</b></div>
        <dl>
          <div><dt>שכר מדווח</dt><dd>${formatMoney(row.reportedSalary)}</dd></div>
          <div><dt>עובד</dt><dd>${formatMoney(row.employeeContribution)}</dd></div>
          <div><dt>מעסיק</dt><dd>${formatMoney(row.employerContribution)}</dd></div>
          <div><dt>פיצויים</dt><dd>${formatMoney(row.severanceContribution)}</dd></div>
          <div class="history-total"><dt>סה״כ הפקדה</dt><dd>${formatMoney(row.totalContribution)}</dd></div>
        </dl>
        <small>עמוד ${escapeHtml(row.sourcePage || '—')} · ביטחון ${Math.round((Number(row.confidence) || 0) * 100)}%</small>
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
    setSourceChip('salarySource', pensionReportState.derived?.averageReportedPensionSalary, 'averageReportedPensionSalary');
    const feesMissing = pensionReportState.fees?.depositRate == null || pensionReportState.fees?.balanceRate == null;
    $('feesSource').textContent = userCorrections.depositFee || userCorrections.balanceFee ? 'תוקן ידנית' : feesMissing ? 'נדרש אישור' : 'מהדוח';
    $('feesSource').classList.toggle('needs-review', feesMissing);
    $('feesSource').classList.toggle('user-source', Boolean(userCorrections.depositFee || userCorrections.balanceFee));

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
    ['currentBalanceError', 'baselineContributionError', 'depositFeeError', 'balanceFeeError', 'yearsError'].forEach((id) => { $(id).textContent = ''; });
    document.querySelectorAll('.invalid').forEach((element) => element.classList.remove('invalid'));
  }

  function errorFor(inputId, errorId, message) {
    $(inputId).classList.add('invalid');
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
    return valid;
  }

  function renderForecast() {
    if (!projection) return;
    const real = moneyMode === 'real';
    const pension = real ? projection.monthlyPensionReal : projection.monthlyPensionNominal;
    const balance = real ? projection.retirementBalanceReal : projection.retirementBalanceNominal;
    $('headlinePension').textContent = formatMoney(pension);
    $('headlineBalance').textContent = formatMoney(balance);
    $('horizonSummary').textContent = `בעוד ${yearsUntilRetirement} שנים · ${projection.monthsUntilRetirement} חודשים בדיוק`;
    $('forecastModeDescription').textContent = real
      ? 'הסכומים מוצגים בשקלים של היום, לאחר קיזוז השפעת האינפלציה.'
      : 'הסכומים מוצגים בשקלים עתידיים וכוללים את הנחת האינפלציה.';
    document.querySelectorAll('[data-money-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.moneyMode === moneyMode)));
    const assumptions = [
      ['יתרה נוכחית', formatMoney(pensionReportState.currentBalance)],
      ['הפקדה חודשית ממוצעת', `${formatMoney(pensionReportState.derived.baselineMonthlyContribution)} במונחים ריאליים`],
      ['תשואה שנתית', `${formatPercentRatio(DEFAULT_ASSUMPTIONS.realReturnRate, 0)} ריאלית`],
      ['אינפלציה', `${formatPercentRatio(DEFAULT_ASSUMPTIONS.inflationRate, 0)} לשנה`],
      ['דמי ניהול', `${formatPercentRatio(pensionReportState.fees.depositRate)} מהפקדה · ${formatPercentRatio(pensionReportState.fees.balanceRate)} מצבירה`],
      ['אופק החישוב', `${yearsUntilRetirement} שנים (${projection.monthsUntilRetirement} חודשים)`],
    ];
    $('forecastAssumptions').innerHTML = assumptions.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  }

  function setProcessing(active, update = {}) {
    $('reportProcessing').classList.toggle('hidden', !active);
    $('pensionReportFile').disabled = active;
    if (update.title) $('processingTitle').textContent = update.title;
    if (update.detail) $('processingDetail').textContent = update.detail;
    if (update.progress != null) $('processingBar').style.width = `${Math.max(5, Math.min(100, Number(update.progress) * 100))}%`;
    else if (active) $('processingBar').style.width = '18%';
  }

  function progressUpdate(progress) {
    const phase = String(progress?.phase || '');
    if (phase === 'pdf-text') {
      setProcessing(true, { title: 'קוראים את הדוח…', detail: `עמוד ${progress.pageNumber || 1} מתוך ${progress.pageCount || 1}`, progress: (progress.pageNumber || 1) / Math.max(1, progress.pageCount || 1) * 0.55 });
    } else if (phase === 'scanned-pdf' || phase === 'rendering') {
      setProcessing(true, { title: 'הדוח נראה סרוק', detail: 'מפעילים זיהוי טקסט מקומי', progress: 0.62 });
    } else if (phase === 'recognizing') {
      setProcessing(true, { title: 'מזהים טקסט בדוח…', detail: 'העיבוד נשאר במכשיר שלך', progress: 0.65 + (Number(progress.progress) || 0) * 0.3 });
    } else if (phase === 'loading-language' || phase === 'loading-ocr') {
      setProcessing(true, { title: 'מכינים זיהוי עברית…', detail: 'טעינה מקומית חד־פעמית', progress: 0.6 });
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
    renderReview();
    showStep(2);
  }

  async function handleReportSelection() {
    const file = $('pensionReportFile').files?.[0];
    if (!file) return;
    if (processingController) processingController.abort();
    processingController = new AbortController();
    $('pensionReportStatus').textContent = 'מתחילים לקרוא את הדוח…';
    setProcessing(true, { title: 'פותחים את הדוח…', detail: 'המסמך אינו נשלח לשרת', progress: 0.08 });
    try {
      const extraction = await D.extract(file, D.SOURCES.PENSION_REPORT, { signal: processingController.signal, onProgress: progressUpdate });
      $('pensionReportStatus').textContent = extractionStatusText(extraction);
      if (extraction.status !== 'cancelled' && !['unsupported-type', 'file-too-large', 'password-protected', 'corrupted-pdf', 'unreadable-pdf', 'wrong-document', 'too-many-pages'].includes(extraction.status)) {
        applyExtraction(extraction);
      }
    } catch (_) {
      $('pensionReportStatus').textContent = 'לא הצלחנו לקרוא את הדוח. נסו שוב או השתמשו בעותק PDF אחר.';
    } finally {
      processingController = null;
      setProcessing(false);
    }
  }

  function markCorrection(inputId, correctionKey) {
    $(inputId).addEventListener('input', () => {
      userCorrections[correctionKey] = true;
      clearErrors();
      if (pensionReportState) commitReviewInputs();
      if (correctionKey === 'currentBalance') setSourceChip('currentBalanceSource', finiteInput(inputId), correctionKey);
      if (correctionKey === 'baselineMonthlyContribution') setSourceChip('contributionSource', finiteInput(inputId), correctionKey);
      if (correctionKey === 'averageReportedPensionSalary') setSourceChip('salarySource', finiteInput(inputId), correctionKey);
      if (correctionKey === 'depositFee' || correctionKey === 'balanceFee') {
        $('feesSource').textContent = 'תוקן ידנית';
        $('feesSource').classList.remove('needs-review');
        $('feesSource').classList.add('user-source');
      }
    });
  }

  function resetFlow() {
    if (processingController) processingController.abort();
    selectedDocument = null;
    pensionReportState = null;
    projection = null;
    yearsUntilRetirement = null;
    userCorrections = {};
    $('pensionReportFile').value = '';
    $('pensionReportStatus').textContent = 'לא נבחר קובץ';
    $('yearsUntilRetirement').value = '';
    storageRemove(SESSION_KEY);
    $('sessionRestoreNotice').classList.add('hidden');
    showStep(1, { skipPersist: true });
  }

  $('pensionReportFile').addEventListener('change', handleReportSelection);
  $('cancelProcessing').addEventListener('click', () => processingController?.abort());
  $('backToUpload').addEventListener('click', () => showStep(1));
  $('continueToYears').addEventListener('click', () => { if (validateReview()) { renderReview(); showStep(3); $('yearsUntilRetirement').focus(); } });
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
  });
  $('backToReview').addEventListener('click', () => showStep(2));
  $('calculateForecast').addEventListener('click', () => {
    clearErrors();
    const years = finiteInput('yearsUntilRetirement');
    if (years == null || !Number.isInteger(years) || years < 1 || years > 80) {
      errorFor('yearsUntilRetirement', 'yearsError', 'הזינו מספר שלם בין שנה אחת ל־80 שנים.');
      return;
    }
    if (!validateReview()) { showStep(2); return; }
    try {
      yearsUntilRetirement = years;
      projection = E.projectBaseline(pensionReportState, yearsUntilRetirement, DEFAULT_ASSUMPTIONS);
      renderForecast();
      showStep(4);
    } catch (error) {
      $('yearsError').textContent = error.message;
    }
  });
  $('editYears').addEventListener('click', () => showStep(3));
  $('startOver').addEventListener('click', resetFlow);
  document.querySelectorAll('[data-money-mode]').forEach((button) => button.addEventListener('click', () => {
    moneyMode = button.dataset.moneyMode === 'nominal' ? 'nominal' : 'real';
    renderForecast();
    persistSession();
  }));
  ['currentBalance', 'baselineMonthlyContribution', 'averageReportedPensionSalary'].forEach((id) => markCorrection(id, id));
  markCorrection('depositFee', 'depositFee');
  markCorrection('balanceFee', 'balanceFee');
  $('yearsUntilRetirement').addEventListener('input', () => { $('yearsError').textContent = ''; $('yearsUntilRetirement').classList.remove('invalid'); });

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

  window.PensionLabTest = Object.freeze({
    getSelectedDocument(kind) { return kind === 'pensionReport' ? deepClone(selectedDocument) : null; },
    getPensionReportState() { return deepClone(pensionReportState); },
    getProjection() { return deepClone(projection); },
    getFlowStep() { return flowStep; },
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
      pensionReportState = deepClone(nextState);
      selectedDocument = { status: 'partial', kind: D.SOURCES.PENSION_REPORT, pensionReportState: deepClone(nextState), fields: {} };
      renderReview();
      showStep(2);
    },
    setYearsUntilRetirement(years) { $('yearsUntilRetirement').value = String(years); },
    calculateForecast() { $('calculateForecast').click(); return deepClone(projection); },
    reset: resetFlow,
  });
})();
