(function () {
  'use strict';

  const E = window.PensionEngine;
  const D = window.PensionDocuments;
  const $ = (id) => document.getElementById(id);
  const storageKey = 'pension-lab-he-session-state-v3';
  const flowStorageKey = 'pension-lab-he-session-flow-v1';
  const provenanceStorageKey = 'pension-lab-he-session-provenance-v1';
  const legacyStorageKey = 'pension-lab-he-state-v2';
  const scenariosKey = 'pension-lab-he-scenarios-v2';
  const legacyScenariosKey = 'pension-lab-he-scenarios-v1';
  const moneyModeKey = 'pension-lab-he-session-money-mode-v2';
  const volatileStorage = new Map();

  const exampleScenario = {
    profile: {
      currentAge: 35, birthYear: new Date().getFullYear() - 35, retirementTrack: null,
      currentBalance: 250000, monthlySalary: 20000, pensionableSalary: 20000,
      additionalSavingsChoice: 'no', additionalBalance: 0, contributionsConfirmed: false,
    },
    inflation: { annualRate: 0.02 },
    salaryPhases: [
      { id: cryptoId(), startAge: 35, endAge: 67, annualGrowth: 0, growthType: 'nominal' },
    ],
    contribution: {
      mode: 'percent', fixedAmount: 4500, fixedGrowsWithSalary: true,
      employeeRate: 0.06, employerRate: 0.065, severanceRate: 0.0833, pensionableSalaryLimit: 0,
    },
    returnPhases: [
      { id: cryptoId(), startAge: 35, endAge: 67, annualReturn: 0.04, returnType: 'real' },
    ],
    investment: { blendProtected: false, protectedWeight: 0.30, protectedRealReturn: 0.0515 },
    careerBreaks: [],
    fees: { annualBalanceFee: 0.005, depositFee: 0 },
    retirement: { retirementAge: 67, coefficient: 200 },
  };

  let persistentStorageAvailable = detectPersistentStorage();
  const restoredSession = storageGet(storageKey) != null;
  let state = hydrateScenario(loadJSON(storageKey, null));
  let savedScenarios = [];
  let flowStep = storageGet(flowStorageKey) || 'documents';
  let moneyMode = storageGet(moneyModeKey) || 'real';
  if (!['real', 'nominal'].includes(moneyMode)) moneyMode = 'real';
  let lastResult = null;
  let lastChanged = 'initial';
  const sourceLabels = Object.freeze({
    system: 'הנחת מערכת', payslip: 'מהתלוש', payslipDerived: 'חושב מהתלוש',
    pensionReport: 'מדוח הפנסיה', pensionReportDerived: 'חושב מדוח הפנסיה', user: 'שונה על ידך',
  });
  const sourceExplanations = Object.freeze({
    system: 'ערך ברירת מחדל של המחשבון. אפשר לשנות אותו בכל רגע.',
    user: 'הערך עודכן ידנית על ידך.',
    payslip: 'הערך זוהה ישירות בתלוש השכר ואושר.',
    payslipDerived: 'הערך חושב מנתונים שזוהו בתלוש ואושר.',
    pensionReport: 'הערך זוהה ישירות בדוח הפנסיה ואושר.',
    pensionReportDerived: 'הערך חושב מנתונים שזוהו בדוח הפנסיה ואושר.',
  });
  const fieldSources = {
    birthYear: D.field(null), retirementTrack: D.field(null), currentAge: D.field(35), retirementAge: D.field(67), currentBalance: D.field(null),
    monthlySalary: D.field(null), pensionableSalary: D.field(null), inflation: D.field(0.02),
    employeeContributionRate: D.field(null), employerContributionRate: D.field(null),
    severanceRate: D.field(null), depositFee: D.field(null), balanceFee: D.field(null),
    coefficient: D.field(null), salaryGrowth: D.field(0), investmentReturn: D.field(0.04),
  };
  const restoredProvenance = loadJSON(provenanceStorageKey, {});
  Object.keys(fieldSources).forEach((fieldName) => {
    if (restoredProvenance[fieldName] && typeof restoredProvenance[fieldName] === 'object') fieldSources[fieldName] = restoredProvenance[fieldName];
  });
  const selectedDocuments = { payslip: null, pensionReport: null };
  let activePayslipController = null;
  const analyticsQueue = [];

  function trackEvent(name) {
    const allowed = new Set([
      'app_opened', 'flow_started', 'document_selected', 'document_read_locally', 'manual_flow_selected',
      'review_completed', 'forecast_generated', 'improve_forecast_opened', 'comparison_opened',
      'advanced_assumptions_opened', 'retirement_age_changed',
    ]);
    if (!allowed.has(name)) return;
    analyticsQueue.push({ name, at: new Date().toISOString() });
  }

  function setFieldSource(fieldName, source, value = null, confirmedByUser = false) {
    fieldSources[fieldName] = D.field(value, source, null, confirmedByUser);
  }

  function markUserSourceForInput(id) {
    const map = {
      birthYear: 'birthYear', currentAge: 'currentAge', retirementAge: 'retirementAge', currentBalance: 'currentBalance',
      monthlySalary: 'monthlySalary', pensionableSalary: 'pensionableSalary', inflation: 'inflation',
      inflationRange: 'inflation', employeeRate: 'employeeContributionRate',
      employerRate: 'employerContributionRate', severanceRate: 'severanceRate',
      depositFee: 'depositFee', annualBalanceFee: 'balanceFee', coefficient: 'coefficient', coefficientRange: 'coefficient',
    };
    if (map[id]) setFieldSource(map[id], D.SOURCES.USER, null, true);
  }

  function renderProvenance() {
    document.querySelectorAll('[data-source-for]').forEach((badge) => {
      const provenance = fieldSources[badge.dataset.sourceFor] || D.field(null);
      const source = provenance.source || D.SOURCES.SYSTEM;
      badge.dataset.source = source;
      badge.textContent = `${sourceLabels[source] || sourceLabels.system}${provenance.requiresConfirmation && !provenance.confirmedByUser ? ' · צריך אישור' : ''}`;
      badge.classList.add('explainable');
      badge.tabIndex = 0;
      badge.dataset.tooltip = sourceExplanations[source];
    });
    const items = [
      ['שנת לידה', state.profile.birthYear, 'birthYear'],
      ['שכר שממנו מפקידים', formatMoney(state.profile.pensionableSalary, false), 'pensionableSalary'],
      ['סכום שכבר נחסך', formatMoney(state.profile.currentBalance, true), 'currentBalance'],
      ['אינפלציה', `${pct(state.inflation.annualRate)}%`, 'inflation'],
      ['תשואה ריאלית', `${pct(state.returnPhases[0]?.annualReturn || 0)}%`, 'investmentReturn'],
      ['מקדם קצבה', state.retirement.coefficient, 'coefficient'],
    ];
    $('provenanceSummary').innerHTML = items.map(([label, value, field]) => {
      const source = fieldSources[field]?.source || D.SOURCES.SYSTEM;
      return `<div class="provenance-item"><span>${label}</span><strong>${value}</strong><b class="source-badge explainable" tabindex="0" data-source="${source}" data-tooltip="${sourceExplanations[source]}">${sourceLabels[source]}</b></div>`;
    }).join('');
    const documentCount = items.filter(([, , field]) => ['payslip', 'payslipDerived', 'pensionReport', 'pensionReportDerived'].includes(fieldSources[field]?.source)).length;
    const systemCount = items.filter(([, , field]) => (fieldSources[field]?.source || D.SOURCES.SYSTEM) === D.SOURCES.SYSTEM).length;
    if ($('sourceSummaryText')) $('sourceSummaryText').textContent = `${documentCount} נתונים מהמסמכים · ${systemCount} הנחות מערכת · מאיפה הגיעו המספרים?`;
  }

  function confirmProvenance(fieldName) {
    const current = fieldSources[fieldName] || D.field(null);
    fieldSources[fieldName] = { ...current, requiresConfirmation: false, confirmedByUser: true, lastModified: new Date().toISOString() };
  }

  function resetFieldSources() {
    Object.keys(fieldSources).forEach((fieldName) => setFieldSource(fieldName, D.SOURCES.SYSTEM));
    setFieldSource('currentAge', D.SOURCES.SYSTEM, 35);
    setFieldSource('birthYear', D.SOURCES.SYSTEM, new Date().getFullYear() - 35);
    setFieldSource('retirementTrack', D.SOURCES.SYSTEM, null);
    setFieldSource('retirementAge', D.SOURCES.SYSTEM, 67);
    setFieldSource('inflation', D.SOURCES.SYSTEM, 0.02);
    setFieldSource('salaryGrowth', D.SOURCES.SYSTEM, 0);
    setFieldSource('investmentReturn', D.SOURCES.SYSTEM, 0.04);
  }

  function cryptoId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function detectPersistentStorage() {
    try {
      const probe = '__pension_lab_storage_probe__';
      window.sessionStorage.setItem(probe, '1');
      window.sessionStorage.removeItem(probe);
      return true;
    } catch (_) {
      return false;
    }
  }

  function storageGet(key) {
    if (volatileStorage.has(key)) return volatileStorage.get(key);
    if (!persistentStorageAvailable) return null;
    try {
      return window.sessionStorage.getItem(key);
    } catch (_) {
      persistentStorageAvailable = false;
      return null;
    }
  }

  function storageSet(key, value) {
    const text = String(value);
    volatileStorage.set(key, text);
    if (!persistentStorageAvailable) return false;
    try {
      window.sessionStorage.setItem(key, text);
      return true;
    } catch (_) {
      persistentStorageAvailable = false;
      return false;
    }
  }

  function storageRemove(key) {
    volatileStorage.delete(key);
    if (!persistentStorageAvailable) return false;
    try {
      window.sessionStorage.removeItem(key);
      return true;
    } catch (_) {
      persistentStorageAvailable = false;
      return false;
    }
  }

  function hasLegacyScenarios() {
    try {
      return Boolean(window.localStorage.getItem(scenariosKey) || window.localStorage.getItem(legacyScenariosKey));
    } catch (_) {
      return false;
    }
  }

  function loadJSON(key, fallback) {
    try {
      const raw = storageGet(key);
      if (raw == null) return deepClone(fallback);
      return JSON.parse(raw);
    } catch (_) {
      return deepClone(fallback);
    }
  }

  function safeId(value) {
    const id = String(value || '');
    return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : cryptoId();
  }

  function hydrateScenario(raw) {
    const base = deepClone(exampleScenario);
    const source = raw && typeof raw === 'object' ? raw : {};
    const hydrated = {
      ...base,
      ...source,
      profile: { ...base.profile, ...(source.profile || {}) },
      inflation: { ...base.inflation, ...(source.inflation || {}) },
      contribution: { ...base.contribution, ...(source.contribution || {}) },
      investment: { ...base.investment, ...(source.investment || {}) },
      fees: { ...base.fees, ...(source.fees || {}) },
      retirement: { ...base.retirement, ...(source.retirement || {}) },
      salaryPhases: Array.isArray(source.salaryPhases) && source.salaryPhases.length
        ? source.salaryPhases.map((phase) => ({ ...phase, id: safeId(phase.id) }))
        : base.salaryPhases,
      returnPhases: Array.isArray(source.returnPhases) && source.returnPhases.length
        ? source.returnPhases.map((phase) => ({ ...phase, id: safeId(phase.id) }))
        : base.returnPhases,
      careerBreaks: Array.isArray(source.careerBreaks)
        ? source.careerBreaks.map((careerBreak) => ({ ...careerBreak, id: safeId(careerBreak.id) }))
        : [],
    };
    normalizeStateObject(hydrated);
    return hydrated;
  }

  function hydrateSavedScenarios(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && typeof item === 'object' && item.state)
      .slice(0, 30)
      .map((item, index) => ({
        name: String(item.name || `תרחיש ${index + 1}`).slice(0, 80),
        state: hydrateScenario(item.state),
        savedAt: item.savedAt || null,
      }));
  }

  function pct(value, digits = 1) {
    return (Number(value || 0) * 100).toFixed(digits);
  }

  function inputNumber(id, fallback = 0) {
    const raw = String($(id).value ?? '').trim();
    if (raw === '') return Number(fallback) || 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : (Number(fallback) || 0);
  }

  function setValue(id, value) {
    $(id).value = value;
  }

  function formatMoney(value, compact = true) {
    const numeric = Number(value) || 0;
    const abs = Math.abs(numeric);
    const sign = numeric < 0 ? '-' : '';
    if (compact && abs >= 1000000) return `${sign}₪${(abs / 1000000).toFixed(abs >= 10000000 ? 1 : 2)} מיליון`;
    if (compact && abs >= 1000) return `${sign}₪${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)} אלף`;
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(numeric);
  }

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function normalizeStateObject(target) {
    target.profile = target.profile || {};
    target.retirement = target.retirement || {};
    target.inflation = target.inflation || {};
    target.contribution = target.contribution || {};
    target.investment = target.investment || {};
    target.fees = target.fees || {};

    const currentYear = new Date().getFullYear();
    target.profile.birthYear = E.clamp(Number(target.profile.birthYear) || currentYear - 35, currentYear - 70, currentYear - 18);
    target.profile.retirementTrack = ['male', 'female'].includes(target.profile.retirementTrack) ? target.profile.retirementTrack : null;
    target.profile.additionalSavingsChoice = ['no', 'yes', 'unsure'].includes(target.profile.additionalSavingsChoice)
      ? target.profile.additionalSavingsChoice : 'no';
    target.profile.additionalBalance = Math.max(0, Number(target.profile.additionalBalance) || 0);
    target.profile.contributionsConfirmed = Boolean(target.profile.contributionsConfirmed);
    const currentAge = E.clamp(Number(target.profile.currentAge) || currentYear - target.profile.birthYear, 18, 70);
    const retirementAge = E.clamp(Number(target.retirement.retirementAge) || currentAge + 1, currentAge + 1, 80);

    target.profile.currentAge = currentAge;
    target.profile.currentBalance = Math.max(0, Number(target.profile.currentBalance) || 0);
    target.profile.monthlySalary = Math.max(0, Number(target.profile.monthlySalary) || 0);
    target.profile.pensionableSalary = Math.max(0, Number(target.profile.pensionableSalary) || 0);
    target.retirement.retirementAge = retirementAge;
    target.retirement.coefficient = E.clamp(Number(target.retirement.coefficient) || 200, 100, 400);
    target.inflation.annualRate = E.clamp(Number(target.inflation.annualRate) || 0, 0, 0.10);

    target.contribution.mode = target.contribution.mode === 'fixed' ? 'fixed' : 'percent';
    target.contribution.fixedAmount = Math.max(0, Number(target.contribution.fixedAmount) || 0);
    target.contribution.fixedGrowsWithSalary = !!target.contribution.fixedGrowsWithSalary;
    target.contribution.employeeRate = E.clamp(Number(target.contribution.employeeRate) || 0, 0, 0.30);
    target.contribution.employerRate = E.clamp(Number(target.contribution.employerRate) || 0, 0, 0.30);
    target.contribution.severanceRate = E.clamp(Number(target.contribution.severanceRate) || 0, 0, 0.30);
    target.contribution.pensionableSalaryLimit = Math.max(0, Number(target.contribution.pensionableSalaryLimit) || 0);

    target.investment.blendProtected = !!target.investment.blendProtected;
    target.investment.protectedWeight = E.clamp(Number(target.investment.protectedWeight) || 0, 0, 1);
    target.investment.protectedRealReturn = E.clamp(Number(target.investment.protectedRealReturn) || 0, 0, 0.15);
    target.fees.annualBalanceFee = E.clamp(Number(target.fees.annualBalanceFee) || 0, 0, 0.05);
    target.fees.depositFee = E.clamp(Number(target.fees.depositFee) || 0, 0, 0.10);

    target.salaryPhases = normalizePhases(target.salaryPhases, currentAge, retirementAge, 'salary');
    target.returnPhases = normalizePhases(target.returnPhases, currentAge, retirementAge, 'return');
    target.careerBreaks = normalizeCareerBreaks(target.careerBreaks, currentAge, retirementAge);
  }

  function statutoryRetirementAge(birthYear, track) {
    if (track === 'male') return 67;
    if (track !== 'female') return 67;
    const year = Number(birthYear);
    if (year <= 1959) return 62;
    const byYear = {
      1960: 62 + 4 / 12, 1961: 62 + 8 / 12, 1962: 63,
      1963: 63.25, 1964: 63.5, 1965: 63.75, 1966: 64,
      1967: 64.25, 1968: 64.5, 1969: 64.75,
    };
    return byYear[year] || 65;
  }

  function syncAgeAndDefaultRetirement(forceRetirement = false) {
    const currentYear = new Date().getFullYear();
    const birthYear = E.clamp(inputNumber('birthYear', state.profile.birthYear), currentYear - 70, currentYear - 18);
    state.profile.birthYear = birthYear;
    state.profile.currentAge = currentYear - birthYear;
    setValue('currentAge', state.profile.currentAge);
    if (forceRetirement || fieldSources.retirementAge.source !== D.SOURCES.USER) {
      state.retirement.retirementAge = statutoryRetirementAge(birthYear, state.profile.retirementTrack);
      setFieldSource('retirementAge', D.SOURCES.SYSTEM, state.retirement.retirementAge, false);
    }
    normalizeState();
    setValue('retirementAge', state.retirement.retirementAge);
  }

  function normalizeState() {
    normalizeStateObject(state);
  }

  function normalizePhases(phases, currentAge, retirementAge, kind) {
    let items = Array.isArray(phases) ? deepClone(phases) : [];
    items = items
      .filter((phase) => phase && typeof phase === 'object')
      .map((phase) => ({
        ...phase,
        id: safeId(phase.id),
        startAge: Number(phase.startAge),
        endAge: Number(phase.endAge),
      }))
      .filter((phase) => Number.isFinite(phase.startAge) && Number.isFinite(phase.endAge))
      .sort((a, b) => a.startAge - b.startAge || a.endAge - b.endAge);

    if (!items.length) {
      return kind === 'salary'
        ? [{ id: cryptoId(), startAge: currentAge, endAge: retirementAge, annualGrowth: 0, growthType: 'nominal' }]
        : [{ id: cryptoId(), startAge: currentAge, endAge: retirementAge, annualReturn: 0.04, returnType: 'real' }];
    }

    const maxPhases = Math.max(1, Math.floor(retirementAge - currentAge));
    items = items.slice(0, maxPhases);
    let start = currentAge;

    items.forEach((phase, index) => {
      phase.startAge = start;
      if (kind === 'salary') {
        phase.annualGrowth = E.clamp(Number(phase.annualGrowth) || 0, -0.20, 0.20);
        phase.growthType = phase.growthType === 'real' ? 'real' : 'nominal';
      } else {
        phase.annualReturn = E.clamp(Number(phase.annualReturn) || 0, -0.20, 0.20);
        phase.returnType = phase.returnType === 'nominal' ? 'nominal' : 'real';
      }

      if (index === items.length - 1) {
        phase.endAge = retirementAge;
      } else {
        const remainingPhases = items.length - index - 1;
        const maxEnd = retirementAge - remainingPhases;
        const desiredEnd = Number.isFinite(Number(phase.endAge)) ? Number(phase.endAge) : start + 1;
        phase.endAge = E.clamp(desiredEnd, start + 1, maxEnd);
      }
      start = phase.endAge;
    });

    return items;
  }

  function normalizeCareerBreaks(careerBreaks, currentAge, retirementAge) {
    const source = Array.isArray(careerBreaks) ? careerBreaks : [];
    const sorted = source
      .filter((careerBreak) => careerBreak && typeof careerBreak === 'object')
      .map((careerBreak) => ({
        ...careerBreak,
        id: safeId(careerBreak.id),
        startAge: Number(careerBreak.startAge),
      }))
      .filter((careerBreak) => Number.isFinite(careerBreak.startAge))
      .sort((a, b) => a.startAge - b.startAge);

    const normalized = [];
    let nextAvailableAge = currentAge;
    for (const careerBreak of sorted) {
      const startAge = Math.max(currentAge, careerBreak.startAge, nextAvailableAge);
      const remainingMonths = Math.floor((retirementAge - startAge) * 12 + 1e-7);
      if (remainingMonths < 1) continue;
      const durationMonths = E.clamp(Math.round(Number(careerBreak.durationMonths) || 1), 1, Math.min(120, remainingMonths));
      const salaryResumeMode = ['projected', 'previous', 'custom'].includes(careerBreak.salaryResumeMode)
        ? careerBreak.salaryResumeMode
        : 'projected';
      normalized.push({
        ...careerBreak,
        startAge,
        durationMonths,
        contributionDuringBreak: Math.max(0, Number(careerBreak.contributionDuringBreak) || 0),
        salaryResumeMode,
        customRestartSalary: Math.max(0, Number(careerBreak.customRestartSalary) || 0),
      });
      nextAvailableAge = startAge + durationMonths / 12;
    }
    return normalized;
  }

  function saveState() {
    storageSet(storageKey, JSON.stringify(state));
    storageSet(provenanceStorageKey, JSON.stringify(fieldSources));
  }

  function renderForm() {
    normalizeState();
    setValue('birthYear', state.profile.birthYear);
    setValue('currentAge', state.profile.currentAge);
    setValue('currentAgeDisplay', state.profile.currentAge);
    setValue('retirementAge', state.retirement.retirementAge);
    setValue('retirementAgeMirror', state.retirement.retirementAge);
    setValue('currentBalance', Math.round(state.profile.currentBalance));
    setValue('monthlySalary', Math.round(state.profile.monthlySalary));
    setValue('pensionableSalary', Math.round(state.profile.pensionableSalary));
    setValue('quickRealReturn', pct(state.returnPhases[0]?.annualReturn || 0));
    setValue('employeeRate', pct(state.contribution.employeeRate, 2));
    setValue('employerRate', pct(state.contribution.employerRate, 2));
    setValue('severanceRate', pct(state.contribution.severanceRate, 2));
    setValue('fixedContribution', Math.round(state.contribution.fixedAmount));
    $('fixedGrowsWithSalary').checked = !!state.contribution.fixedGrowsWithSalary;
    setContributionModeUI();
    setValue('inflation', pct(state.inflation.annualRate));
    setValue('inflationRange', pct(state.inflation.annualRate));
    $('blendProtected').checked = !!state.investment.blendProtected;
    setValue('protectedWeight', pct(state.investment.protectedWeight, 0));
    setValue('protectedReturn', pct(state.investment.protectedRealReturn, 2));
    $('protectedFields').classList.toggle('hidden', !state.investment.blendProtected);
    setValue('annualBalanceFee', pct(state.fees.annualBalanceFee, 2));
    setValue('depositFee', pct(state.fees.depositFee, 2));
    setValue('coefficient', state.retirement.coefficient);
    setValue('coefficientRange', state.retirement.coefficient);
    setValue('additionalBalance', Math.round(state.profile.additionalBalance || 0));
    $('confirmContributionDefaults').checked = state.profile.contributionsConfirmed;
    document.querySelectorAll('[data-retirement-track]').forEach((button) => button.classList.toggle('active', button.dataset.retirementTrack === state.profile.retirementTrack));
    document.querySelectorAll('[data-additional-savings]').forEach((button) => button.classList.toggle('active', button.dataset.additionalSavings === state.profile.additionalSavingsChoice));
    $('additionalBalanceField').classList.toggle('hidden', state.profile.additionalSavingsChoice !== 'yes');
    $('additionalSavingsNote').classList.toggle('hidden', state.profile.additionalSavingsChoice !== 'unsure');
    $('salaryInflationOption').textContent = `${pct(state.inflation.annualRate)}% נומינלי`;
    $('salaryAboveInflationOption').textContent = `${pct(state.inflation.annualRate + 0.01)}% נומינלי`;
    const retirementLabel = state.profile.retirementTrack
      ? `חישבנו כרגע לפי פרישה בגיל ${formatAge(state.retirement.retirementAge)}.`
      : 'גיל הפרישה יחושב לאחר הבחירה.';
    $('calculatedRetirementAge').textContent = retirementLabel;
    syncYearsRemaining();
    renderSalaryPhases();
    renderReturnPhases();
    renderCareerBreaks();
    renderMoneyMode();
    renderPresetState();
    renderProvenance();
    renderActiveDocuments();
  }

  function formatAge(age) {
    const years = Math.floor(Number(age) || 0);
    const months = Math.round(((Number(age) || 0) - years) * 12);
    return months ? `${years} ו־${months} חודשים` : String(years);
  }

  function renderActiveDocuments() {
    const rows = [
      ['תלוש שכר', selectedDocuments.payslip],
      ['דוח פנסיה', selectedDocuments.pensionReport],
    ].filter(([, document]) => document);
    $('activeDocumentSummary').innerHTML = rows.length
      ? rows.map(([label, document]) => `<div class="document-session-item"><strong>${label}</strong><span>${escapeHtml(document.fileName || 'קובץ נבחר')} · נשמר בזיכרון הלשונית בלבד</span></div>`).join('')
      : '<p class="section-help">לא נבחרו מסמכים בלשונית הזו.</p>';
  }

  function setContributionModeUI() {
    const percent = state.contribution.mode === 'percent';
    $('contributionModePercent').classList.toggle('active', percent);
    $('contributionModeFixed').classList.toggle('active', !percent);
    $('contributionModePercent').setAttribute('aria-pressed', String(percent));
    $('contributionModeFixed').setAttribute('aria-pressed', String(!percent));
    $('contributionPercentFields').classList.toggle('hidden', !percent);
    $('contributionFixedFields').classList.toggle('hidden', percent);
  }

  function phaseCard(phase, index, kind, total) {
    const isSalary = kind === 'salary';
    const rate = isSalary ? phase.annualGrowth : phase.annualReturn;
    const type = isSalary ? phase.growthType : phase.returnType;
    const noun = isSalary ? 'שכר' : 'תשואה';
    const typeOptions = isSalary
      ? `<option value="nominal" ${type === 'nominal' ? 'selected' : ''}>נומינלי</option><option value="real" ${type === 'real' ? 'selected' : ''}>ריאלי</option>`
      : `<option value="real" ${type === 'real' ? 'selected' : ''}>ריאלי</option><option value="nominal" ${type === 'nominal' ? 'selected' : ''}>נומינלי</option>`;
    const endReadonly = index === total - 1 ? 'readonly aria-readonly="true"' : '';
    return `<div class="phase-card" data-phase-id="${phase.id}">
      <div class="phase-head"><strong>שלב ${noun} ${index + 1}</strong><button type="button" class="icon-btn" data-remove-${kind}="${phase.id}" aria-label="מחק שלב ${noun} ${index + 1}" title="מחק">✕</button></div>
      <div class="phase-grid">
        <label class="mini-field">מגיל<input class="readonly-input" type="number" value="${phase.startAge}" readonly aria-readonly="true"></label>
        <label class="mini-field">עד גיל<input data-${kind}-field="endAge" data-id="${phase.id}" type="number" value="${phase.endAge}" min="19" max="80" step="1" ${endReadonly}></label>
        <label class="mini-field">שינוי שנתי (%)<input data-${kind}-field="rate" data-id="${phase.id}" type="number" value="${(rate * 100).toFixed(2)}" min="-20" max="20" step="0.1"></label>
        <label class="mini-field">סוג<select data-${kind}-field="type" data-id="${phase.id}">${typeOptions}</select></label>
      </div>
    </div>`;
  }

  function renderSalaryPhases() {
    $('salaryPhases').innerHTML = state.salaryPhases.map((phase, index) => phaseCard(phase, index, 'salary', state.salaryPhases.length)).join('');
  }

  function renderReturnPhases() {
    $('returnPhases').innerHTML = state.returnPhases.map((phase, index) => phaseCard(phase, index, 'return', state.returnPhases.length)).join('');
  }

  function renderCareerBreaks() {
    const html = (state.careerBreaks || []).map((careerBreak, index) => `<div class="break-card">
      <div class="phase-head"><strong>הפסקה ${index + 1}</strong><button type="button" class="icon-btn" data-remove-break="${careerBreak.id}" aria-label="מחק הפסקה ${index + 1}">✕</button></div>
      <div class="break-grid">
        <label class="mini-field">מתחילה בגיל<input data-break-field="startAge" data-id="${careerBreak.id}" type="number" value="${Number(careerBreak.startAge.toFixed(4))}" min="${state.profile.currentAge}" max="${state.retirement.retirementAge - 1 / 12}" step="0.0833333333"></label>
        <label class="mini-field">משך (חודשים)<input data-break-field="durationMonths" data-id="${careerBreak.id}" type="number" value="${careerBreak.durationMonths}" min="1" max="120" step="1"></label>
        <label class="mini-field">הפקדה חודשית בזמן ההפסקה<input data-break-field="contributionDuringBreak" data-id="${careerBreak.id}" type="number" value="${careerBreak.contributionDuringBreak || 0}" min="0" step="100"></label>
        <label class="mini-field">שכר בחזרה<select data-break-field="salaryResumeMode" data-id="${careerBreak.id}">
          <option value="projected" ${careerBreak.salaryResumeMode === 'projected' ? 'selected' : ''}>מסלול שכר מקורי</option>
          <option value="previous" ${careerBreak.salaryResumeMode === 'previous' ? 'selected' : ''}>השכר האחרון</option>
          <option value="custom" ${careerBreak.salaryResumeMode === 'custom' ? 'selected' : ''}>שכר חדש</option>
        </select></label>
      </div>
      ${careerBreak.salaryResumeMode === 'custom' ? `<label class="mini-field custom-restart-field">שכר חזרה<input data-break-field="customRestartSalary" data-id="${careerBreak.id}" type="number" value="${careerBreak.customRestartSalary || 0}" min="0" step="500"></label>` : ''}
    </div>`).join('');
    $('careerBreaks').innerHTML = html || '<p class="section-help">אין כרגע הפסקות עבודה בתרחיש.</p>';
  }

  function syncYearsRemaining() {
    const years = state.retirement.retirementAge - state.profile.currentAge;
    $('yearsRemainingHint').textContent = `${years.toFixed(0)} שנים עד הפרישה`;
  }

  function readBasicInputs() {
    const oldAge = state.profile.currentAge;
    const oldRetirementAge = state.retirement.retirementAge;

    const currentYear = new Date().getFullYear();
    state.profile.birthYear = E.clamp(inputNumber('birthYear', state.profile.birthYear), currentYear - 70, currentYear - 18);
    state.profile.currentAge = currentYear - state.profile.birthYear;
    state.retirement.retirementAge = E.clamp(
      inputNumber('retirementAge', oldRetirementAge),
      state.profile.currentAge + 1,
      80
    );
    state.profile.currentBalance = Math.max(0, inputNumber('currentBalance', state.profile.currentBalance));
    state.profile.additionalBalance = Math.max(0, inputNumber('additionalBalance', state.profile.additionalBalance));
    state.profile.monthlySalary = Math.max(0, inputNumber('monthlySalary', state.profile.monthlySalary));
    state.profile.pensionableSalary = Math.max(0, inputNumber('pensionableSalary', state.profile.pensionableSalary));
    state.contribution.employeeRate = E.clamp(inputNumber('employeeRate', pct(state.contribution.employeeRate)) / 100, 0, 0.30);
    state.contribution.employerRate = E.clamp(inputNumber('employerRate', pct(state.contribution.employerRate)) / 100, 0, 0.30);
    state.contribution.severanceRate = E.clamp(inputNumber('severanceRate', pct(state.contribution.severanceRate)) / 100, 0, 0.30);
    state.contribution.fixedAmount = Math.max(0, inputNumber('fixedContribution', state.contribution.fixedAmount));
    state.contribution.fixedGrowsWithSalary = $('fixedGrowsWithSalary').checked;
    state.inflation.annualRate = E.clamp(inputNumber('inflation', pct(state.inflation.annualRate)) / 100, 0, 0.10);
    state.investment.blendProtected = $('blendProtected').checked;
    state.investment.protectedWeight = E.clamp(inputNumber('protectedWeight', pct(state.investment.protectedWeight)) / 100, 0, 1);
    state.investment.protectedRealReturn = E.clamp(inputNumber('protectedReturn', pct(state.investment.protectedRealReturn)) / 100, 0, 0.15);
    state.fees.annualBalanceFee = E.clamp(inputNumber('annualBalanceFee', pct(state.fees.annualBalanceFee)) / 100, 0, 0.05);
    state.fees.depositFee = E.clamp(inputNumber('depositFee', pct(state.fees.depositFee)) / 100, 0, 0.10);
    state.retirement.coefficient = E.clamp(inputNumber('coefficient', state.retirement.coefficient), 100, 400);

    setValue('currentAge', state.profile.currentAge);
    setValue('retirementAge', state.retirement.retirementAge);
    setValue('coefficient', state.retirement.coefficient);
    setValue('coefficientRange', state.retirement.coefficient);

    if (oldAge !== state.profile.currentAge || oldRetirementAge !== state.retirement.retirementAge) {
      normalizeState();
      renderSalaryPhases();
      renderReturnPhases();
      renderCareerBreaks();
    }
  }

  function currentContribution() {
    if (state.contribution.mode === 'fixed') return state.contribution.fixedAmount;
    const limit = state.contribution.pensionableSalaryLimit > 0
      ? state.contribution.pensionableSalaryLimit
      : Infinity;
    const pensionable = Math.min(state.profile.pensionableSalary, limit);
    return pensionable * (
      state.contribution.employeeRate +
      state.contribution.employerRate +
      state.contribution.severanceRate
    );
  }

  function stateForProjection(sourceState = state) {
    const projected = deepClone(sourceState);
    projected.profile.currentBalance = Math.max(0, Number(projected.profile.currentBalance) || 0) +
      Math.max(0, Number(projected.profile.additionalBalance) || 0);
    return projected;
  }

  function renderProjection() {
    syncYearsRemaining();
    $('currentContributionLabel').textContent = formatMoney(currentContribution(), false);
    renderPresetState();
    try {
      lastResult = E.project(stateForProjection());
      renderResults(lastResult);
      renderCoefficientSensitivity(lastResult);
      drawBalanceChart(lastResult);
      renderRetirementExplorer();
      renderExplain(lastResult);
      renderInsight(lastResult);
    } catch (error) {
      toast(error.message || 'יש בעיה בהנחות');
    }
  }

  function updateAll() {
    readBasicInputs();
    saveState();
    renderProjection();
  }

  function commitBasicInputs() {
    readBasicInputs();
    renderForm();
    saveState();
    renderProjection();
  }

  function renderResults(result) {
    const real = moneyMode === 'real';
    const balance = real ? result.retirementBalanceReal : result.retirementBalanceNominal;
    const pension = real ? result.monthlyPensionReal : result.monthlyPensionNominal;
    const contributions = real ? result.totalContributionsReal : result.totalContributionsNominal;
    const fees = real ? result.totalFeesReal : result.totalFeesNominal;
    const growth = real ? result.investmentGrowthReal : result.investmentGrowthNominal;

    $('headlinePension').textContent = `כ־${formatMoney(Math.round(pension / 50) * 50, false)} בחודש`;
    $('headlinePensionSub').textContent = `בגיל ${formatAge(state.retirement.retirementAge)}`;
    $('headlineBalance').textContent = `כ־${formatMoney(Math.round(balance / 10000) * 10000, true)}`;
    $('headlineBalanceSub').textContent = real ? 'בשקלים של היום' : 'בשקלים עתידיים';
    const years = state.retirement.retirementAge - state.profile.currentAge;
    $('yearsToRetirement').textContent = `כ־${Math.round(years)} שנים`;
    $('forecastRetirementAge').textContent = formatAge(state.retirement.retirementAge);
    $('retirementAgeText').textContent = `חישבנו כרגע לפי פרישה בגיל ${formatAge(state.retirement.retirementAge)}`;
    if ($('contribResult')) $('contribResult').textContent = formatMoney(contributions, true);
    if ($('growthResult')) $('growthResult').textContent = formatMoney(growth, true);
    if ($('feesResult')) $('feesResult').textContent = formatMoney(fees, true);
    $('chartModeLabel').textContent = real ? 'בשקלים של היום' : 'בשקלים עתידיים';
    $('chartFinalLabel').textContent = `בפרישה: ${formatMoney(balance, true)}`;
    const salaryPhase = state.salaryPhases[0] || { annualGrowth: 0, growthType: 'nominal' };
    $('forecastAssumptions').innerHTML = [
      [`פרישה בגיל ${formatAge(state.retirement.retirementAge)}`, 'אפשר לשנות בחלק שיפור התחזית'],
      [`תשואה: ${pct(state.returnPhases[0]?.annualReturn || 0)}% ${state.returnPhases[0]?.returnType === 'nominal' ? 'נומינלית' : 'ריאלית'}`, 'ריאלית = לאחר השפעת האינפלציה'],
      [`אינפלציה: ${pct(state.inflation.annualRate)}%`, 'הנחת מערכת לתכנון'],
      [`שכר: ${pct(salaryPhase.annualGrowth)}% עלייה ${salaryPhase.growthType === 'real' ? 'ריאלית' : 'נומינלית'}`, salaryPhase.annualGrowth === 0 && salaryPhase.growthType === 'nominal' ? 'מספר השקלים נשאר קבוע וכוח הקנייה נשחק' : 'לפי ההנחה שנבחרה'],
    ].map(([title, detail]) => `<div class="assumption-item"><strong>${title}</strong><span>${detail}</span></div>`).join('');
    $('additionalSavingsWarning').classList.toggle('hidden', state.profile.additionalSavingsChoice !== 'unsure');
    renderProvenance();
    renderReturnComparison();
  }

  function renderCoefficientSensitivity(result) {
    const real = moneyMode === 'real';
    const selected = Number(state.retirement.coefficient);
    const coefficients = Array.from(new Set([180, 200, 220, 240, selected])).sort((a, b) => a - b).slice(0, 5);
    $('coefficientSensitivity').innerHTML = coefficients
      .map((coefficient) => `<div><span>מקדם ${coefficient}</span><strong>${formatMoney(E.pensionAtCoefficient(result, coefficient, real), false)}</strong></div>`)
      .join('');
  }

  function renderExplain(result) {
    const real = moneyMode === 'real';
    const start = state.profile.currentBalance + (state.profile.additionalBalance || 0);
    const contributions = real ? result.totalContributionsReal : result.totalContributionsNominal;
    const fees = real ? result.totalFeesReal : result.totalFeesNominal;
    const growth = real ? result.investmentGrowthReal : result.investmentGrowthNominal;
    $('explainResult').innerHTML = [
      ['יתרה התחלתית', start],
      ['הפקדות לפני דמי ניהול', contributions],
      ['צמיחה מהשקעות', growth],
      ['דמי ניהול', -fees],
    ].map(([label, value]) => `<div class="explain-item"><span>${label}</span><strong>${formatMoney(value, true)}</strong></div>`).join('');
  }

  function renderInsight(result) {
    const years = state.retirement.retirementAge - state.profile.currentAge;
    const breakMonths = (state.careerBreaks || []).reduce((sum, careerBreak) => sum + Number(careerBreak.durationMonths || 0), 0);
    let title = `החישוב כולל כ־${Math.round(years)} שנות צבירה`;
    let text = 'התוצאה מחושבת לפי ההפקדות, התשואה, האינפלציה, דמי הניהול וגיל הפרישה שמופיעים במסך.';

    if (lastChanged === 'retirement') {
      const previousAge = Math.max(state.profile.currentAge + 1, state.retirement.retirementAge - 1);
      const previous = E.retirementAgeSeries(stateForProjection(), previousAge, previousAge)[0];
      const delta = previous ? result.monthlyPensionReal - previous.realPension : 0;
      title = `בחישוב פרישה בגיל ${formatAge(state.retirement.retirementAge)}`;
      text = `נכללו 12 חודשי הפקדה וצמיחה נוספים לעומת גיל ${formatAge(previousAge)}. הפרש הקצבה לפי ההנחות הוא ${formatMoney(delta, false)}.`;
    } else if (breakMonths > 0) {
      const noBreak = deepClone(state);
      noBreak.careerBreaks = [];
      const noBreakResult = E.project(stateForProjection(noBreak));
      const delta = noBreakResult.monthlyPensionReal - result.monthlyPensionReal;
      title = `החישוב כולל ${breakMonths} חודשי הפסקת עבודה`;
      text = `לעומת אותו חישוב ללא הפסקות, הקצבה החודשית משתנה ב־${formatMoney(-delta, false)} לפי ההנחות שהוגדרו.`;
    }

    $('insightTitle').textContent = title;
    $('insightText').textContent = text;
  }

  function renderRetirementExplorer() {
    const minAge = Math.max(state.profile.currentAge + 1, Math.max(55, state.retirement.retirementAge - 4));
    const maxAge = Math.min(80, Math.max(state.retirement.retirementAge + 4, minAge + 4));
    const rows = E.retirementAgeSeries(stateForProjection(), minAge, maxAge);
    drawRetirementChart(rows);
    const picked = rows
      .filter((row, index) => index === 0 || index === rows.length - 1 || row.age === state.retirement.retirementAge || index % 2 === 0)
      .slice(0, 8);
    $('retirementAgeTable').innerHTML = picked
      .map((row) => `<div><span>גיל ${row.age}</span><strong>${formatMoney(moneyMode === 'real' ? row.realPension : row.nominalPension, false)}</strong></div>`)
      .join('');
  }

  function setupCanvas(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Number(canvas.getAttribute('height')) || 280;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: context, w: width, h: height };
  }

  function drawBalanceChart(result) {
    const canvas = $('balanceChart');
    const { ctx, w, h } = setupCanvas(canvas);
    const narrow = w < 520;
    const pad = { t: 24, r: narrow ? 50 : 58, b: 34, l: 18 };
    const plotW = w - pad.r - pad.l;
    const plotH = h - pad.t - pad.b;
    const data = result.snapshots.map((snapshot) => ({
      x: snapshot.age,
      y: moneyMode === 'real' ? snapshot.realBalance : snapshot.nominalBalance,
    }));
    const maxY = Math.max(1, ...data.map((point) => point.y)) * 1.08;
    const minX = data[0].x;
    const maxX = data[data.length - 1].x;

    ctx.clearRect(0, 0, w, h);
    ctx.font = `${narrow ? 10 : 11}px Arial`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + plotH * i / 4;
      ctx.strokeStyle = '#e7eaee';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = '#7b828c';
      ctx.fillText(formatMoney(maxY * (1 - i / 4), true), w - 4, y);
    }

    const xFor = (x) => pad.l + (x - minX) / (maxX - minX || 1) * plotW;
    const yFor = (y) => pad.t + plotH - (y / maxY) * plotH;
    const gradient = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    gradient.addColorStop(0, 'rgba(31,95,80,.22)');
    gradient.addColorStop(1, 'rgba(31,95,80,0)');

    ctx.beginPath();
    data.forEach((point, index) => index ? ctx.lineTo(xFor(point.x), yFor(point.y)) : ctx.moveTo(xFor(point.x), yFor(point.y)));
    ctx.lineTo(xFor(data[data.length - 1].x), h - pad.b);
    ctx.lineTo(xFor(data[0].x), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    data.forEach((point, index) => index ? ctx.lineTo(xFor(point.x), yFor(point.y)) : ctx.moveTo(xFor(point.x), yFor(point.y)));
    ctx.strokeStyle = '#1f5f50';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#707781';
    ctx.textAlign = 'center';
    const ticks = narrow ? 2 : 4;
    for (let i = 0; i <= ticks; i++) {
      const age = minX + (maxX - minX) * i / ticks;
      ctx.fillText(`גיל ${Math.round(age)}`, xFor(age), h - 12);
    }

    const last = data[data.length - 1];
    ctx.fillStyle = '#1f5f50';
    ctx.beginPath();
    ctx.arc(xFor(last.x), yFor(last.y), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function comparisonResults() {
    return [0.02, 0.04, 0.06].map((rate) => {
      const scenario = stateForProjection();
      scenario.returnPhases = [{ id: cryptoId(), startAge: state.profile.currentAge, endAge: state.retirement.retirementAge, annualReturn: rate, returnType: 'real' }];
      return { rate, result: E.project(scenario) };
    });
  }

  function renderReturnComparison() {
    const rows = comparisonResults();
    const subtitles = { 2: 'הנחת חישוב נמוכה', 4: 'תרחיש בסיס', 6: 'הנחת חישוב גבוהה' };
    $('returnComparisonCards').innerHTML = rows.map(({ rate, result }) => `<article class="comparison-card"><h3>${Math.round(rate * 100)}% ריאלי</h3><span>${subtitles[Math.round(rate * 100)]}</span><div class="comparison-metrics"><div><span>קצבה חודשית לפני מס</span><strong>${formatMoney(result.monthlyPensionReal, false)}</strong></div><div><span>צבירה בפרישה</span><strong>${formatMoney(result.retirementBalanceReal, true)}</strong></div></div></article>`).join('');
    $('comparisonFallback').innerHTML = rows.map(({ rate, result }) => `<div><strong>${Math.round(rate * 100)}% ריאלי</strong><br>קצבה ${formatMoney(result.monthlyPensionReal, false)} · צבירה ${formatMoney(result.retirementBalanceReal, true)}</div>`).join('');
    if (!$('comparisonPanel').classList.contains('hidden')) drawComparisonChart(rows);
  }

  function drawComparisonChart(rows) {
    const canvas = $('comparisonChart');
    const { ctx, w, h } = setupCanvas(canvas);
    const pad = { t: 24, r: 18, b: 34, l: 18 };
    const allValues = rows.flatMap(({ result }) => result.snapshots.map((snapshot) => snapshot.realBalance));
    const maxY = Math.max(1, ...allValues) * 1.08;
    const firstSnapshots = rows[0].result.snapshots;
    const minAge = firstSnapshots[0].age;
    const maxAge = firstSnapshots[firstSnapshots.length - 1].age;
    const xFor = (age) => pad.l + (age - minAge) / (maxAge - minAge || 1) * (w - pad.l - pad.r);
    const yFor = (value) => pad.t + (h - pad.t - pad.b) - value / maxY * (h - pad.t - pad.b);
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (h - pad.t - pad.b) * i / 4;
      ctx.strokeStyle = '#e7eaee'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }
    const styles = [
      { color: '#6f7780', dash: [3, 5] },
      { color: '#315b7d', dash: [] },
      { color: '#1f5f50', dash: [9, 5] },
    ];
    rows.forEach(({ rate, result }, index) => {
      ctx.beginPath();
      result.snapshots.forEach((snapshot, pointIndex) => pointIndex ? ctx.lineTo(xFor(snapshot.age), yFor(snapshot.realBalance)) : ctx.moveTo(xFor(snapshot.age), yFor(snapshot.realBalance)));
      ctx.strokeStyle = styles[index].color; ctx.lineWidth = 3; ctx.setLineDash(styles[index].dash); ctx.stroke(); ctx.setLineDash([]);
      const last = result.snapshots[result.snapshots.length - 1];
      ctx.fillStyle = styles[index].color; ctx.font = '700 11px "Segoe UI"'; ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(rate * 100)}%`, w - 4, Math.max(12, yFor(last.realBalance) + (index - 1) * 12));
    });
    ctx.fillStyle = '#707781'; ctx.font = '11px "Segoe UI"'; ctx.textAlign = 'center';
    [minAge, maxAge].forEach((age) => ctx.fillText(`גיל ${Math.round(age)}`, xFor(age), h - 12));
  }

  function drawRetirementChart(rows) {
    const canvas = $('retirementChart');
    const { ctx, w, h } = setupCanvas(canvas);
    const narrow = w < 520;
    const pad = { t: 20, r: 18, b: 34, l: 18 };
    const plotW = w - pad.r - pad.l;
    const plotH = h - pad.t - pad.b;
    const values = rows.map((row) => moneyMode === 'real' ? row.realPension : row.nominalPension);
    const maxY = Math.max(1, ...values) * 1.1;
    const minAge = rows[0]?.age || 0;
    const maxAge = rows[rows.length - 1]?.age || 1;

    ctx.clearRect(0, 0, w, h);
    ctx.font = `${narrow ? 10 : 11}px Arial`;
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + plotH * i / 4;
      ctx.strokeStyle = '#e7eaee';
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = '#7b828c';
      ctx.textAlign = 'left';
      ctx.fillText(formatMoney(maxY * (1 - i / 4), true), pad.l, y - 8);
    }

    const xFor = (x) => pad.l + (x - minAge) / (maxAge - minAge || 1) * plotW;
    const yFor = (y) => pad.t + plotH - (y / maxY) * plotH;
    ctx.beginPath();
    rows.forEach((row, index) => {
      const x = xFor(row.age);
      const y = yFor(values[index]);
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#315b7d';
    ctx.lineWidth = 3;
    ctx.stroke();

    rows.forEach((row, index) => {
      ctx.fillStyle = row.age === state.retirement.retirementAge ? '#1f5f50' : '#315b7d';
      ctx.beginPath();
      ctx.arc(xFor(row.age), yFor(values[index]), row.age === state.retirement.retirementAge ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#707781';
    ctx.textAlign = 'center';
    rows.forEach((row, index) => {
      if (index === 0 || index === rows.length - 1 || row.age === state.retirement.retirementAge) {
        ctx.fillText(`גיל ${row.age}`, xFor(row.age), h - 12);
      }
    });
  }

  function renderMoneyMode() {
    document.querySelectorAll('[data-money-mode]').forEach((button) => {
      const active = button.dataset.moneyMode === moneyMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if ($('moneyModeHelp')) $('moneyModeHelp').textContent = moneyMode === 'real'
      ? 'שקלים של היום מציגים את כוח הקנייה המשוער של הסכום לאחר התחשבות באינפלציה.'
      : 'שקלים עתידיים כוללים את האינפלציה ולכן נראים גבוהים יותר. זה לא אומר בהכרח שכוח הקנייה גבוה יותר.';
  }

  function renderSavedScenarios() {
    const projected = savedScenarios.map((scenario, index) => {
      try {
        return { scenario, index, result: E.project(stateForProjection(scenario.state)) };
      } catch (_) {
        return null;
      }
    }).filter(Boolean);

    if (!projected.length) {
      $('savedScenarios').innerHTML = '<p class="section-help">עדיין אין תרחישים שמורים. לחצו “שמור תרחיש” כדי להתחיל להשוות.</p>';
      $('comparisonTableWrap').innerHTML = '';
      return;
    }

    $('savedScenarios').innerHTML = projected.map(({ scenario, index, result }) => `<article class="scenario-card"><h3>${escapeHtml(scenario.name)}</h3><div class="scenario-metrics">
        <div><span>גיל פרישה</span><strong>${scenario.state.retirement.retirementAge}</strong></div>
        <div><span>צבירה ריאלית</span><strong>${formatMoney(result.retirementBalanceReal, true)}</strong></div>
        <div><span>קצבה ריאלית</span><strong>${formatMoney(result.monthlyPensionReal, false)}</strong></div>
      </div><div class="scenario-actions"><button type="button" class="load" data-load-scenario="${index}">טען</button><button type="button" class="delete" data-delete-scenario="${index}">מחק</button></div></article>`).join('');

    const rows = projected.slice(0, 4);
    $('comparisonTableWrap').innerHTML = `<table><thead><tr><th>מדד</th>${rows.map(({ scenario }) => `<th>${escapeHtml(scenario.name)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>גיל נוכחי</td>${rows.map(({ scenario }) => `<td>${scenario.state.profile.currentAge}</td>`).join('')}</tr>
      <tr><td>גיל פרישה</td>${rows.map(({ scenario }) => `<td>${scenario.state.retirement.retirementAge}</td>`).join('')}</tr>
      <tr><td>צבירה בשקלים של היום</td>${rows.map(({ result }) => `<td>${formatMoney(result.retirementBalanceReal, true)}</td>`).join('')}</tr>
      <tr><td>קצבה חודשית ריאלית</td>${rows.map(({ result }) => `<td>${formatMoney(result.monthlyPensionReal, false)}</td>`).join('')}</tr>
      <tr><td>מקדם</td>${rows.map(({ scenario }) => `<td>${scenario.state.retirement.coefficient}</td>`).join('')}</tr>
    </tbody></table>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function approximately(a, b, epsilon = 1e-9) {
    return Math.abs(Number(a) - Number(b)) <= epsilon;
  }

  function detectPreset() {
    const phases = state.returnPhases;
    const coefficient = Number(state.retirement.coefficient);
    if (phases.length === 1 && phases[0].returnType === 'real' && approximately(phases[0].annualReturn, 0.04) && coefficient === 230) return 'conservative';
    if (phases.length === 1 && phases[0].returnType === 'real' && approximately(phases[0].annualReturn, 0.06) && coefficient === 190) return 'growth';
    const baseShape = phases.length >= 1 && phases[0].returnType === 'real' && approximately(phases[0].annualReturn, 0.055) && coefficient === 200;
    const baseTail = phases.length === 1 || (phases[1].returnType === 'real' && approximately(phases[1].annualReturn, 0.045));
    return baseShape && baseTail ? 'base' : null;
  }

  function renderPresetState() {
    const activePreset = detectPreset();
    document.querySelectorAll('[data-preset]').forEach((button) => {
      const active = button.dataset.preset === activePreset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function applyPreset(name) {
    const currentAge = state.profile.currentAge;
    const retirementAge = state.retirement.retirementAge;
    if (name === 'conservative') {
      state.returnPhases = [{ id: cryptoId(), startAge: currentAge, endAge: retirementAge, annualReturn: 0.04, returnType: 'real' }];
      state.retirement.coefficient = 230;
    } else if (name === 'growth') {
      state.returnPhases = [{ id: cryptoId(), startAge: currentAge, endAge: retirementAge, annualReturn: 0.06, returnType: 'real' }];
      state.retirement.coefficient = 190;
    } else {
      state.returnPhases = [{ id: cryptoId(), startAge: currentAge, endAge: Math.min(retirementAge, currentAge + 15), annualReturn: 0.055, returnType: 'real' }];
      if (currentAge + 15 < retirementAge) {
        state.returnPhases.push({ id: cryptoId(), startAge: currentAge + 15, endAge: retirementAge, annualReturn: 0.045, returnType: 'real' });
      }
      state.retirement.coefficient = 200;
    }
    renderForm();
    updateAll();
  }

  function refreshAfterDynamicEdit() {
    saveState();
    renderProjection();
  }

  ['currentAge', 'retirementAge', 'currentBalance', 'monthlySalary', 'pensionableSalary', 'employeeRate', 'employerRate', 'severanceRate', 'fixedContribution', 'annualBalanceFee', 'depositFee'].forEach((id) => {
    $(id).addEventListener('change', () => {
      markUserSourceForInput(id);
      if (id === 'pensionableSalary' && fieldSources.monthlySalary.source !== D.SOURCES.USER) {
        setValue('monthlySalary', $('pensionableSalary').value);
      }
      lastChanged = id === 'retirementAge' ? 'retirement' : 'input';
      if (id === 'retirementAge') trackEvent('retirement_age_changed');
      updateAll();
    });
  });

  $('fixedGrowsWithSalary').addEventListener('change', () => {
    lastChanged = 'contribution';
    updateAll();
  });
  $('inflation').addEventListener('change', () => {
    markUserSourceForInput('inflation');
    setValue('inflationRange', $('inflation').value);
    lastChanged = 'inflation';
    updateAll();
  });
  $('inflationRange').addEventListener('input', () => {
    markUserSourceForInput('inflationRange');
    setValue('inflation', $('inflationRange').value);
    lastChanged = 'inflation';
    updateAll();
  });
  $('coefficient').addEventListener('change', () => {
    markUserSourceForInput('coefficient');
    setValue('coefficientRange', $('coefficient').value);
    lastChanged = 'coefficient';
    updateAll();
  });
  $('coefficientRange').addEventListener('input', () => {
    markUserSourceForInput('coefficientRange');
    setValue('coefficient', $('coefficientRange').value);
    lastChanged = 'coefficient';
    updateAll();
  });
  $('blendProtected').addEventListener('change', () => {
    $('protectedFields').classList.toggle('hidden', !$('blendProtected').checked);
    lastChanged = 'investment';
    updateAll();
  });
  ['protectedWeight', 'protectedReturn'].forEach((id) => $(id).addEventListener('input', () => {
    lastChanged = 'investment';
    updateAll();
  }));
  $('contributionModePercent').addEventListener('click', () => {
    state.contribution.mode = 'percent';
    setContributionModeUI();
    lastChanged = 'contribution';
    updateAll();
  });
  $('contributionModeFixed').addEventListener('click', () => {
    state.contribution.mode = 'fixed';
    setContributionModeUI();
    lastChanged = 'contribution';
    updateAll();
  });

  function activateChoice(selector, activeButton) {
    document.querySelectorAll(selector).forEach((button) => button.classList.toggle('active', button === activeButton));
  }

  function showReview(manual = false) {
    $('quickStart').classList.add('hidden');
    $('reviewShell').classList.remove('hidden');
    flowStep = 'review';
    storageSet(flowStorageKey, flowStep);
    const selectedCount = Object.values(selectedDocuments).filter(Boolean).length;
    $('reviewSummary').textContent = selectedCount
      ? `נבחרו ${selectedCount === 2 ? 'שני מסמכים' : 'מסמך אחד'}. לא כל הנתונים זוהו באופן אמין, ולכן צריך לבדוק ולהשלים את הפרטים הבאים.`
      : 'לא נבחרו מסמכים. צריך להשלים רק את הנתונים הקריטיים ולאשר את הנחות ההפקדה.';
    if (manual) trackEvent('manual_flow_selected');
    renderForm();
    $('reviewShell').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setFieldError(id, message) {
    const element = $(id);
    element.textContent = message || '';
    element.classList.toggle('hidden', !message);
  }

  function validateReview() {
    readBasicInputs();
    let valid = true;
    const currentYear = new Date().getFullYear();
    if (!String($('birthYear').value).trim() || state.profile.birthYear < currentYear - 70 || state.profile.birthYear > currentYear - 18) {
      setFieldError('birthYearError', `יש להזין שנת לידה בין ${currentYear - 70} ל־${currentYear - 18}.`); valid = false;
    } else setFieldError('birthYearError', '');
    if (!state.profile.retirementTrack) { $('calculatedRetirementAge').textContent = 'צריך לבחור מסלול לחישוב גיל הפרישה.'; valid = false; }
    if (!String($('pensionableSalary').value).trim() || state.profile.pensionableSalary <= 0) {
      setFieldError('pensionableSalaryError', 'חסר השכר שממנו מפקידים לך לפנסיה.'); valid = false;
    } else setFieldError('pensionableSalaryError', '');
    if (!String($('currentBalance').value).trim() || state.profile.currentBalance < 0) {
      setFieldError('currentBalanceError', 'חסר נתון אחד לפני שאפשר לחשב: הסכום שכבר חסכת.'); valid = false;
    } else setFieldError('currentBalanceError', '');
    state.profile.contributionsConfirmed = $('confirmContributionDefaults').checked;
    if (!state.profile.contributionsConfirmed) {
      setFieldError('contributionError', 'צריך לאשר את אחוזי ההפקדה או לשנות אותם לפני החישוב.'); valid = false;
    } else setFieldError('contributionError', '');
    if (!valid) {
      $('reviewAttention').textContent = 'נשארו כמה פרטים קצרים לפני שאפשר לחשב.';
      $('reviewAttention').scrollIntoView({ behavior: 'smooth', block: 'center' });
      saveState();
      return false;
    }
    syncAgeAndDefaultRetirement(false);
    setFieldSource('birthYear', D.SOURCES.USER, state.profile.birthYear, true);
    setFieldSource('currentAge', D.SOURCES.USER, state.profile.currentAge, true);
    if (fieldSources.pensionableSalary.source === D.SOURCES.SYSTEM) setFieldSource('pensionableSalary', D.SOURCES.USER, state.profile.pensionableSalary, true);
    else confirmProvenance('pensionableSalary');
    if (fieldSources.currentBalance.source === D.SOURCES.SYSTEM) setFieldSource('currentBalance', D.SOURCES.USER, state.profile.currentBalance, true);
    else confirmProvenance('currentBalance');
    ['employeeContributionRate', 'employerContributionRate', 'severanceRate'].forEach(confirmProvenance);
    saveState();
    return true;
  }

  function revealForecast() {
    if (!validateReview()) return;
    $('forecastShell').classList.remove('hidden');
    document.querySelectorAll('.forecast-action').forEach((element) => element.classList.remove('hidden'));
    flowStep = 'forecast';
    storageSet(flowStorageKey, flowStep);
    $('forecastSummary').textContent = 'התחזית חושבה לפי הנתונים שאישרת והנחות המערכת שמוצגות כאן.';
    renderProjection();
    trackEvent('review_completed');
    trackEvent('forecast_generated');
    $('forecastShell').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyExtraction(extraction) {
    const fields = extraction.fields || {};
    const apply = (sourceField, stateSetter, provenanceName) => {
      const extracted = fields[sourceField];
      if (!extracted || extracted.value == null) return;
      stateSetter(extracted.value);
      fieldSources[provenanceName] = extracted;
    };
    if (extraction.kind === D.SOURCES.PAYSLIP) {
      apply('insuredSalary', (value) => { state.profile.pensionableSalary = value; }, 'pensionableSalary');
      apply('grossSalary', (value) => { state.profile.monthlySalary = value; }, 'monthlySalary');
      apply('employeeContributionRate', (value) => { state.contribution.employeeRate = value; }, 'employeeContributionRate');
      apply('employerContributionRate', (value) => { state.contribution.employerRate = value; }, 'employerContributionRate');
      apply('severanceRate', (value) => { state.contribution.severanceRate = value; }, 'severanceRate');
    } else {
      apply('currentBalance', (value) => { state.profile.currentBalance = value; }, 'currentBalance');
      apply('depositFee', (value) => { state.fees.depositFee = value; }, 'depositFee');
      apply('balanceFee', (value) => { state.fees.annualBalanceFee = value; }, 'balanceFee');
    }
    normalizeState();
    renderForm();
  }

  function setPayslipProcessing(active, update = {}) {
    const panel = $('salarySlipProcessing');
    panel.classList.toggle('hidden', !active);
    $('salarySlipFile').disabled = active;
    if (!active) {
      $('salarySlipProcessingBar').style.width = '18%';
      return;
    }
    const phase = update.phase || 'pdf-text';
    const scanned = ['scanned-pdf', 'loading-ocr', 'loading-language', 'rendering', 'recognizing'].includes(phase);
    $('salarySlipProcessingTitle').textContent = scanned
      ? 'התלוש סרוק, אז הקריאה יכולה לקחת קצת יותר זמן.'
      : 'קוראים את התלוש…';
    const detail = {
      'pdf-text': 'מנסים לקרוא את הנתונים ישירות מהקובץ',
      'scanned-pdf': 'מכינים קריאה מקומית במכשיר',
      'loading-ocr': 'מכינים קריאה מקומית במכשיר',
      'loading-language': 'מכינים עברית ואנגלית',
      rendering: 'מכינים את עמוד התלוש',
      recognizing: 'מזהים שכר והפקדות',
    }[phase] || 'מזהים שכר והפקדות';
    $('salarySlipProcessingDetail').textContent = detail;
    let width = { 'pdf-text': 12, 'scanned-pdf': 20, 'loading-ocr': 28, 'loading-language': 42, rendering: 55 }[phase] || 18;
    if (phase === 'recognizing' && Number.isFinite(update.progress)) width = 55 + Math.round(update.progress * 40);
    $('salarySlipProcessingBar').style.width = `${Math.max(8, Math.min(96, width))}%`;
  }

  async function handleDocumentSelection(input, kind, statusId) {
    const file = input.files && input.files[0];
    if (!file) {
      selectedDocuments[kind] = null;
      $(statusId).textContent = 'לא נבחר קובץ';
      return;
    }
    let controller = null;
    if (kind === D.SOURCES.PAYSLIP) {
      if (activePayslipController) activePayslipController.abort();
      controller = new AbortController();
      activePayslipController = controller;
      setPayslipProcessing(true, { phase: 'pdf-text' });
      $(statusId).textContent = 'קוראים את התלוש במכשיר…';
    }
    let extraction;
    try {
      extraction = await D.extract(file, kind, {
        signal: controller ? controller.signal : undefined,
        onProgress: kind === D.SOURCES.PAYSLIP ? (update) => setPayslipProcessing(true, update) : undefined,
      });
    } finally {
      if (controller && activePayslipController === controller) {
        activePayslipController = null;
        setPayslipProcessing(false);
      }
    }
    if (extraction.status === 'cancelled') {
      input.value = '';
      $(statusId).textContent = 'הקריאה בוטלה. אפשר לבחור תלוש אחר או להמשיך ידנית.';
      return;
    }
    if (extraction.status === 'unsupported-type') {
      input.value = '';
      selectedDocuments[kind] = null;
      $(statusId).textContent = kind === D.SOURCES.PAYSLIP
        ? 'כרגע אפשר להעלות תלוש בפורמט PDF בלבד.'
        : 'הקובץ אינו בפורמט נתמך. אפשר להעלות PDF, JPG או PNG.';
      return;
    }
    if (extraction.status === 'file-too-large') {
      input.value = '';
      selectedDocuments[kind] = null;
      $(statusId).textContent = 'הקובץ גדול מדי לעיבוד בדפדפן.';
      return;
    }
    selectedDocuments[kind] = extraction;
    applyExtraction(extraction);
    const identified = Object.values(extraction.fields || {}).filter((field) => field.value != null).length;
    const fallbackMessages = {
      'password-protected': 'הקובץ מוגן בסיסמה ולכן לא ניתן לקרוא אותו. אפשר לשמור עותק לא מוגן ולהעלות שוב.',
      'corrupted-pdf': 'לא הצלחנו לפתוח את הקובץ. אפשר לנסות להוריד אותו מחדש או לבחור קובץ אחר.',
      'unreadable-pdf': 'לא הצלחנו לפתוח את הקובץ. אפשר לבחור קובץ אחר או להמשיך ידנית.',
      'too-many-pages': 'הקובץ ארוך מדי לעיבוד כתלוש. אפשר לבחור תלוש קצר יותר או להמשיך ידנית.',
      'page-limit': 'לא מצאנו את הנתונים בעמודים הראשונים. אפשר להזין אותם ידנית.',
      'ocr-unavailable': 'לא הצלחנו להפעיל את הקריאה המקומית. אפשר להמשיך ידנית.',
      'wrong-document': kind === D.SOURCES.PAYSLIP ? 'זה לא נראה כמו תלוש שכר. אפשר לבחור קובץ אחר או להמשיך ידנית.' : 'זה לא נראה כמו דוח שנתי מקרן פנסיה. אפשר לבחור קובץ אחר או להמשיך ידנית.',
    };
    $(statusId).textContent = identified
      ? `${file.name} · זוהו ${identified} נתונים לבדיקה`
      : (fallbackMessages[extraction.status] || `${file.name} · לא הצלחנו לזהות את כל הנתונים. צריך רק להשלים כמה פרטים.`);
    if (kind === D.SOURCES.PAYSLIP && identified) {
      $('reviewTitle').textContent = 'קראנו את התלוש';
      $('reviewSummary').textContent = 'כדאי לעבור על הנתונים שזוהו ולשנות כל ערך שאינו נכון.';
      $('reviewAttention').textContent = Object.values(extraction.fields).some((item) => item.requiresConfirmation)
        ? 'צריך לבדוק לפחות נתון אחד לפני החישוב.'
        : 'הנתונים שזוהו מהתלוש מחכים לבדיקה שלך.';
    }
    trackEvent('document_selected');
    trackEvent('document_read_locally');
    renderActiveDocuments();
  }

  function openAdvanced() {
    $('advancedShell').classList.remove('hidden');
    $('advancedToggleBtn').setAttribute('aria-expanded', 'true');
    $('advancedToggleBtn').innerHTML = 'הסתר הנחות וחישוב מתקדם <span aria-hidden="true">⌃</span>';
    trackEvent('advanced_assumptions_opened');
    requestAnimationFrame(() => {
      if (lastResult) {
        drawBalanceChart(lastResult);
        renderRetirementExplorer();
      }
    });
  }

  $('salarySlipFile').addEventListener('change', () => handleDocumentSelection($('salarySlipFile'), D.SOURCES.PAYSLIP, 'salarySlipStatus'));
  $('cancelPayslipProcessing').addEventListener('click', () => {
    if (activePayslipController) activePayslipController.abort();
  });
  $('pensionReportFile').addEventListener('change', () => handleDocumentSelection($('pensionReportFile'), D.SOURCES.PENSION_REPORT, 'pensionReportStatus'));
  $('continueToReviewBtn').addEventListener('click', () => showReview(false));
  $('manualFlowBtn').addEventListener('click', () => showReview(true));
  $('backToDocumentsBtn').addEventListener('click', () => { $('reviewShell').classList.add('hidden'); $('quickStart').classList.remove('hidden'); flowStep = 'documents'; storageSet(flowStorageKey, flowStep); });
  $('generateForecastBtn').addEventListener('click', revealForecast);
  $('quickRealReturn').addEventListener('change', () => {
    const annualReturn = E.clamp(inputNumber('quickRealReturn', pct(state.returnPhases[0]?.annualReturn || 0)) / 100, -0.20, 0.20);
    state.returnPhases = [{ id: cryptoId(), startAge: state.profile.currentAge, endAge: state.retirement.retirementAge, annualReturn, returnType: 'real' }];
    setFieldSource('investmentReturn', D.SOURCES.USER, annualReturn, true);
    setValue('quickRealReturn', pct(annualReturn));
    renderReturnPhases();
    updateAll();
  });
  $('improveForecastBtn').addEventListener('click', () => {
    $('improvePanel').classList.remove('hidden');
    trackEvent('improve_forecast_opened');
    $('improvePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('compareScenariosBtn').addEventListener('click', () => {
    $('comparisonPanel').classList.remove('hidden');
    trackEvent('comparison_opened');
    renderReturnComparison();
    $('comparisonPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('advancedToggleBtn').addEventListener('click', () => {
    const open = !$('advancedShell').classList.contains('hidden');
    if (open) {
      $('advancedShell').classList.add('hidden');
      $('advancedToggleBtn').setAttribute('aria-expanded', 'false');
      $('advancedToggleBtn').innerHTML = 'הצג הנחות וחישוב מתקדם <span aria-hidden="true">⌄</span>';
    } else {
      openAdvanced();
      $('advancedShell').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  document.querySelectorAll('[data-money-mode]').forEach((button) => button.addEventListener('click', () => {
    moneyMode = button.dataset.moneyMode;
    storageSet(moneyModeKey, moneyMode);
    renderMoneyMode();
    renderProjection();
  }));

  $('birthYear').addEventListener('change', () => {
    setFieldSource('birthYear', D.SOURCES.USER, inputNumber('birthYear'), true);
    syncAgeAndDefaultRetirement(false);
    renderForm();
    saveState();
  });
  document.querySelectorAll('[data-retirement-track]').forEach((button) => button.addEventListener('click', () => {
    activateChoice('[data-retirement-track]', button);
    state.profile.retirementTrack = button.dataset.retirementTrack;
    setFieldSource('retirementTrack', D.SOURCES.USER, state.profile.retirementTrack, true);
    syncAgeAndDefaultRetirement(true);
    renderForm();
    saveState();
  }));
  $('confirmContributionDefaults').addEventListener('change', () => {
    state.profile.contributionsConfirmed = $('confirmContributionDefaults').checked;
    if (state.profile.contributionsConfirmed) setFieldError('contributionError', '');
    saveState();
  });
  $('additionalBalance').addEventListener('change', () => { state.profile.additionalBalance = Math.max(0, inputNumber('additionalBalance')); updateAll(); });

  document.querySelectorAll('[data-career-path]').forEach((button) => button.addEventListener('click', () => {
    activateChoice('[data-career-path]', button);
    const rates = { steady: 0, inflation: state.inflation.annualRate, aboveInflation: state.inflation.annualRate + 0.01 };
    if (button.dataset.careerPath === 'custom') {
      openAdvanced();
      $('salaryPhases').closest('details').open = true;
      $('advancedShell').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const annualGrowth = rates[button.dataset.careerPath];
    state.salaryPhases = [{ id: cryptoId(), startAge: state.profile.currentAge, endAge: state.retirement.retirementAge, annualGrowth, growthType: 'nominal' }];
    setFieldSource('salaryGrowth', D.SOURCES.USER, annualGrowth, true);
    renderForm();
    updateAll();
  }));

  document.querySelectorAll('[data-simple-investment]').forEach((button) => button.addEventListener('click', () => {
    activateChoice('[data-simple-investment]', button);
    const rates = { low: 0.02, base: 0.04, high: 0.06 };
    const annualReturn = rates[button.dataset.simpleInvestment];
    state.returnPhases = [{ id: cryptoId(), startAge: state.profile.currentAge, endAge: state.retirement.retirementAge, annualReturn, returnType: 'real' }];
    setFieldSource('investmentReturn', D.SOURCES.USER, annualReturn, true);
    renderForm();
    updateAll();
  }));

  document.querySelectorAll('[data-simple-break]').forEach((button) => button.addEventListener('click', () => {
    activateChoice('[data-simple-break]', button);
    if (button.dataset.simpleBreak === 'none') {
      state.careerBreaks = [];
      renderCareerBreaks();
      updateAll();
      return;
    }
    if (!state.careerBreaks.length) $('addCareerBreak').click();
    openAdvanced();
    $('careerBreaks').closest('details').open = true;
  }));

  document.querySelectorAll('[data-additional-savings]').forEach((button) => button.addEventListener('click', () => {
    activateChoice('[data-additional-savings]', button);
    state.profile.additionalSavingsChoice = button.dataset.additionalSavings;
    $('additionalBalanceField').classList.toggle('hidden', state.profile.additionalSavingsChoice !== 'yes');
    $('additionalSavingsNote').classList.toggle('hidden', state.profile.additionalSavingsChoice !== 'unsure');
    saveState();
  }));

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset.salaryField) {
      const phase = state.salaryPhases.find((item) => item.id === target.dataset.id);
      if (!phase) return;
      if (target.dataset.salaryField === 'endAge' && !target.readOnly) phase.endAge = Number(target.value);
      if (target.dataset.salaryField === 'rate') phase.annualGrowth = E.clamp(Number(target.value) / 100, -0.20, 0.20);
      lastChanged = 'salary';
      setFieldSource('salaryGrowth', D.SOURCES.USER, null, true);
      refreshAfterDynamicEdit();
    }
    if (target.dataset.returnField) {
      const phase = state.returnPhases.find((item) => item.id === target.dataset.id);
      if (!phase) return;
      if (target.dataset.returnField === 'endAge' && !target.readOnly) phase.endAge = Number(target.value);
      if (target.dataset.returnField === 'rate') phase.annualReturn = E.clamp(Number(target.value) / 100, -0.20, 0.20);
      lastChanged = 'return';
      setFieldSource('investmentReturn', D.SOURCES.USER, null, true);
      refreshAfterDynamicEdit();
    }
    if (target.dataset.breakField && target.dataset.breakField !== 'salaryResumeMode') {
      const careerBreak = state.careerBreaks.find((item) => item.id === target.dataset.id);
      if (!careerBreak) return;
      careerBreak[target.dataset.breakField] = Number(target.value);
      lastChanged = 'break';
      refreshAfterDynamicEdit();
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.salaryField === 'type') {
      const phase = state.salaryPhases.find((item) => item.id === target.dataset.id);
      if (phase) phase.growthType = target.value;
      lastChanged = 'salary';
      setFieldSource('salaryGrowth', D.SOURCES.USER, null, true);
      refreshAfterDynamicEdit();
    }
    if (target.dataset.returnField === 'type') {
      const phase = state.returnPhases.find((item) => item.id === target.dataset.id);
      if (phase) phase.returnType = target.value;
      lastChanged = 'return';
      setFieldSource('investmentReturn', D.SOURCES.USER, null, true);
      refreshAfterDynamicEdit();
    }
    if (target.dataset.salaryField === 'rate') {
      normalizeState();
      renderSalaryPhases();
      refreshAfterDynamicEdit();
    }
    if (target.dataset.returnField === 'rate') {
      normalizeState();
      renderReturnPhases();
      refreshAfterDynamicEdit();
    }
    if (target.dataset.salaryField === 'endAge' || target.dataset.returnField === 'endAge') {
      normalizeState();
      renderSalaryPhases();
      renderReturnPhases();
      refreshAfterDynamicEdit();
    }
    if (target.dataset.breakField) {
      const careerBreak = state.careerBreaks.find((item) => item.id === target.dataset.id);
      if (careerBreak && target.dataset.breakField === 'salaryResumeMode') {
        careerBreak.salaryResumeMode = target.value;
      }
      normalizeState();
      renderCareerBreaks();
      refreshAfterDynamicEdit();
    }
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.removeSalary) {
      state.salaryPhases = state.salaryPhases.filter((phase) => phase.id !== button.dataset.removeSalary);
      normalizeState();
      renderSalaryPhases();
      updateAll();
    }
    if (button.dataset.removeReturn) {
      state.returnPhases = state.returnPhases.filter((phase) => phase.id !== button.dataset.removeReturn);
      normalizeState();
      renderReturnPhases();
      updateAll();
    }
    if (button.dataset.removeBreak) {
      state.careerBreaks = state.careerBreaks.filter((careerBreak) => careerBreak.id !== button.dataset.removeBreak);
      renderCareerBreaks();
      updateAll();
    }
    if (button.dataset.moneyMode) {
      moneyMode = button.dataset.moneyMode;
      storageSet(moneyModeKey, moneyMode);
      renderMoneyMode();
      renderProjection();
    }
    if (button.dataset.preset) applyPreset(button.dataset.preset);
    if (button.dataset.loadScenario != null) {
      const selected = savedScenarios[Number(button.dataset.loadScenario)];
      if (!selected) return;
      state = hydrateScenario(selected.state);
      renderForm();
      updateAll();
      toast('התרחיש נטען');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (button.dataset.deleteScenario != null) {
      savedScenarios.splice(Number(button.dataset.deleteScenario), 1);
      storageSet(scenariosKey, JSON.stringify(savedScenarios));
      renderSavedScenarios();
    }
  });

  const committedInputIds = new Set([
    'currentAge', 'retirementAge', 'currentBalance', 'monthlySalary', 'pensionableSalary',
    'employeeRate', 'employerRate', 'severanceRate', 'fixedContribution',
    'inflation', 'inflationRange', 'protectedWeight', 'protectedReturn',
    'annualBalanceFee', 'depositFee', 'coefficient', 'coefficientRange',
  ]);
  document.addEventListener('change', (event) => {
    if (committedInputIds.has(event.target.id)) commitBasicInputs();
  });

  $('addSalaryPhase').addEventListener('click', () => {
    const last = state.salaryPhases[state.salaryPhases.length - 1];
    if (last.endAge - last.startAge < 2) return toast('אין מספיק מרווח להוספת שלב');
    const midpoint = Math.max(state.profile.currentAge + 1, Math.round((last.startAge + last.endAge) / 2));
    const oldEnd = last.endAge;
    last.endAge = midpoint;
    state.salaryPhases.push({
      id: cryptoId(), startAge: midpoint, endAge: oldEnd,
      annualGrowth: last.annualGrowth, growthType: last.growthType,
    });
    normalizeState();
    renderSalaryPhases();
    updateAll();
  });

  $('addReturnPhase').addEventListener('click', () => {
    const last = state.returnPhases[state.returnPhases.length - 1];
    if (last.endAge - last.startAge < 2) return toast('אין מספיק מרווח להוספת שלב');
    const midpoint = Math.max(state.profile.currentAge + 1, Math.round((last.startAge + last.endAge) / 2));
    const oldEnd = last.endAge;
    last.endAge = midpoint;
    state.returnPhases.push({
      id: cryptoId(), startAge: midpoint, endAge: oldEnd,
      annualReturn: last.annualReturn, returnType: last.returnType,
    });
    normalizeState();
    renderReturnPhases();
    updateAll();
  });

  $('addCareerBreak').addEventListener('click', () => {
    const startAge = Math.min(state.retirement.retirementAge - 1, state.profile.currentAge + 5);
    state.careerBreaks.push({
      id: cryptoId(), startAge, durationMonths: 24, contributionDuringBreak: 0,
      salaryResumeMode: 'projected', customRestartSalary: state.profile.monthlySalary,
    });
    normalizeState();
    renderCareerBreaks();
    updateAll();
  });

  $('saveScenarioBtn').addEventListener('click', () => {
    const defaultName = `תרחיש ${savedScenarios.length + 1} · פרישה ${state.retirement.retirementAge}`;
    const entered = window.prompt('שם לתרחיש', defaultName);
    const name = String(entered || '').trim().slice(0, 80);
    if (!name) return;
    if (savedScenarios.length >= 30) savedScenarios = savedScenarios.slice(-29);
    savedScenarios.push({ name, state: deepClone(state), savedAt: new Date().toISOString() });
    storageSet(scenariosKey, JSON.stringify(savedScenarios));
    renderSavedScenarios();
    trackEvent('scenario_saved');
    toast(persistentStorageAvailable ? 'התרחיש נשמר בדפדפן' : 'התרחיש נשמר זמנית בלשונית זו');
  });

  $('clearScenariosBtn').addEventListener('click', () => {
    if (window.confirm('למחוק את כל התרחישים השמורים?')) {
      savedScenarios = [];
      storageSet(scenariosKey, '[]');
      renderSavedScenarios();
    }
  });

  $('resetBtn').addEventListener('click', () => {
    if (window.confirm('להתחיל מחדש? המספרים שאושרו בלשונית הזו יימחקו.')) {
      if (activePayslipController) activePayslipController.abort();
      state = deepClone(exampleScenario);
      resetFieldSources();
      storageRemove(storageKey);
      storageRemove(provenanceStorageKey);
      storageRemove(flowStorageKey);
      selectedDocuments.payslip = null;
      selectedDocuments.pensionReport = null;
      $('salarySlipFile').value = '';
      $('pensionReportFile').value = '';
      $('salarySlipStatus').textContent = 'כרגע אפשר להעלות תלוש בפורמט PDF.';
      $('pensionReportStatus').textContent = 'PDF, JPG או PNG';
      setPayslipProcessing(false);
      $('reviewTitle').textContent = 'בדקנו את המסמכים';
      $('reviewSummary').textContent = 'צריך להשלים כמה פרטים לפני החישוב.';
      $('confirmContributionDefaults').checked = false;
      flowStep = 'documents';
      ['reviewShell', 'forecastShell', 'comparisonPanel', 'improvePanel', 'advancedShell'].forEach((id) => $(id).classList.add('hidden'));
      $('quickStart').classList.remove('hidden');
      document.querySelectorAll('.forecast-action').forEach((element) => element.classList.add('hidden'));
      renderForm();
      updateAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastResult) {
        drawBalanceChart(lastResult);
        renderRetirementExplorer();
        if (!$('comparisonPanel').classList.contains('hidden')) renderReturnComparison();
      }
    }, 120);
  });

  document.querySelector('[data-career-path="steady"]')?.classList.add('active');
  document.querySelector('[data-simple-investment="base"]')?.classList.add('active');
  document.querySelector('[data-simple-break="none"]')?.classList.add('active');
  document.querySelectorAll('input[type="number"]').forEach((input) => {
    input.inputMode = input.step && String(input.step).includes('.') ? 'decimal' : 'numeric';
  });
  trackEvent('app_opened');
  trackEvent('flow_started');
  window.PensionLabTest = Object.freeze({
    getFieldSource: (fieldName) => fieldSources[fieldName]?.source || null,
    getAnalyticsEvents: () => deepClone(analyticsQueue),
    getState: () => deepClone(state),
    getMoneyMode: () => moneyMode,
    getStorageScope: () => 'session',
    getSelectedDocument: (kind) => selectedDocuments[kind] ? deepClone(selectedDocuments[kind]) : null,
    isPayslipProcessing: () => Boolean(activePayslipController),
    cancelPayslipProcessing: () => { if (activePayslipController) activePayslipController.abort(); },
    openAdvanced,
  });
  renderForm();
  updateAll();
  renderSavedScenarios();
  if (restoredSession) $('sessionRestoreNotice').classList.remove('hidden');
  if (hasLegacyScenarios()) $('legacyScenarioNotice').classList.remove('hidden');
  $('dismissLegacyNotice').addEventListener('click', () => $('legacyScenarioNotice').classList.add('hidden'));
  $('deleteLegacyScenarios').addEventListener('click', () => {
    if (!window.confirm('למחוק את התרחישים שנשמרו בגרסה הקודמת? לא ניתן לשחזר אותם.')) return;
    try {
      window.localStorage.removeItem(scenariosKey);
      window.localStorage.removeItem(legacyScenariosKey);
      $('legacyScenarioNotice').classList.add('hidden');
    } catch (_) {
      toast('לא הצלחנו למחוק את התרחישים הישנים בדפדפן הזה.');
    }
  });
  if (flowStep === 'review' || flowStep === 'forecast') {
    $('quickStart').classList.add('hidden');
    $('reviewShell').classList.remove('hidden');
  }
  if (flowStep === 'forecast' && state.profile.contributionsConfirmed && state.profile.retirementTrack) {
    $('forecastShell').classList.remove('hidden');
    document.querySelectorAll('.forecast-action').forEach((element) => element.classList.remove('hidden'));
    renderProjection();
  }
})();
