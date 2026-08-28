(function (root, factory) {
  let parser = root.PensionReportParser;
  if (!parser && typeof module === 'object' && module.exports) {
    require('./financial-normalizer.js');
    require('./pension-report-parser.js');
    parser = root.PensionReportParser;
  }
  const api = factory(parser, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PensionDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R, environment) {
  'use strict';

  if (!R?.deriveContributionBaseline) throw new Error('PensionReportParser must be loaded before PensionDemo.');

  const DEFAULT_DEMO_YEARS = 25;
  const MIN_DEMO_YEARS = 1;
  const MAX_DEMO_YEARS = 80;
  const DEMO_SALARY = 24500;
  const CONTRIBUTION_RATES = Object.freeze({
    employee: 0.06,
    employer: 0.065,
    severance: 0.0833,
  });

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key], seen));
    return Object.freeze(value);
  }

  function queryParams(search) {
    const input = search == null ? environment.location?.search || '' : String(search);
    return new URLSearchParams(input.startsWith('?') ? input : `?${input}`);
  }

  function isDemoMode(search) {
    return queryParams(search).get('demo') === '1';
  }

  function getDemoYears(search) {
    const raw = queryParams(search).get('years');
    if (raw == null || raw === '') return DEFAULT_DEMO_YEARS;
    const years = Number(raw);
    return Number.isInteger(years) && years >= MIN_DEMO_YEARS && years <= MAX_DEMO_YEARS
      ? years
      : DEFAULT_DEMO_YEARS;
  }

  function demoExitUrl(href) {
    const current = href == null ? environment.location?.href : String(href);
    const url = new URL(current || '/', environment.location?.origin || 'http://127.0.0.1');
    url.searchParams.delete('demo');
    url.searchParams.delete('years');
    return url.href;
  }

  function moneyAtRate(rate) {
    return Number((DEMO_SALARY * rate).toFixed(2));
  }

  function createDemoContributionRows() {
    const employeeContribution = moneyAtRate(CONTRIBUTION_RATES.employee);
    const employerContribution = moneyAtRate(CONTRIBUTION_RATES.employer);
    const severanceContribution = moneyAtRate(CONTRIBUTION_RATES.severance);
    const totalContribution = Number((employeeContribution + employerContribution + severanceContribution).toFixed(2));

    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const salaryMonth = `${String(month).padStart(2, '0')}/2025`;
      return {
        employerName: 'מעסיק לדוגמה',
        depositDate: null,
        salaryMonth,
        chronologyKey: 2025 * 12 + month,
        reportedSalary: DEMO_SALARY,
        pensionableSalary: DEMO_SALARY,
        employeeContribution,
        employerContribution,
        severanceContribution,
        totalContribution,
        totalSource: 'derived-from-observed-components',
        periodType: 'monthly',
        isYtd: false,
        sourcePage: null,
        page: null,
        confidence: 0.99,
        confidenceBand: 'HIGH',
        reliable: true,
        requiresReview: false,
        issues: [],
        evidence: {
          aliasId: 'synthetic-demo-contribution',
          rowId: `synthetic-demo-2025-${String(month).padStart(2, '0')}`,
          sourcePage: null,
          method: 'synthetic-demo',
          headerRowId: 'synthetic-demo-header',
          explicitTotal: false,
          synthetic: true,
        },
      };
    });
  }

  function createDemoPensionReportState() {
    const contributionHistory = createDemoContributionRows();
    const baseline = R.deriveContributionBaseline(contributionHistory);
    if (baseline.issues.length || baseline.derived.monthsUsed !== 12) {
      throw new Error('Synthetic demo contribution rows did not normalize safely.');
    }

    const derived = {
      ...baseline.derived,
      baselineMonthlyContribution: Number(baseline.derived.baselineMonthlyContribution.toFixed(2)),
      averageReportedPensionSalary: Number(baseline.derived.averageReportedPensionSalary.toFixed(2)),
    };

    return deepFreeze({
      fundType: 'new_pension',
      supportedForCurrentForecast: true,
      routingReason: 'SUPPORTED_NEW_PENSION',
      currentBalance: 250000,
      provider: 'קרן לדוגמה',
      report: { type: 'annual', reportDate: null, period: '2025' },
      fees: { depositRate: 0.008, balanceRate: 0.0015 },
      contributionHistory,
      normalizedContributionMonths: baseline.normalizedMonths,
      derived,
      evidence: { syntheticDemo: true },
      confidence: { fundTypeConfidence: 'SYNTHETIC_DEMO' },
      decision: {
        automaticAccepted: true,
        requiresReview: false,
        reasons: ['SYNTHETIC_DEMO_FIXTURE'],
      },
      review: { requiresReview: false, issues: [] },
    });
  }

  return Object.freeze({
    DEFAULT_DEMO_YEARS,
    MIN_DEMO_YEARS,
    MAX_DEMO_YEARS,
    DEMO_SALARY,
    CONTRIBUTION_RATES,
    isDemoMode,
    getDemoYears,
    demoExitUrl,
    createDemoContributionRows,
    createDemoPensionReportState,
  });
});
