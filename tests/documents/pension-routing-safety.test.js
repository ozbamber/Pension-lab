'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
const appRoot = path.resolve(__dirname, '..', '..', 'app');
for (const name of ['financial-normalizer.js', 'pension-report-parser.js', 'document-extraction.js', 'engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(appRoot, name), 'utf8'), sandbox, { filename: name });
}
const R = sandbox.window.PensionReportParser;
const D = sandbox.window.PensionDocuments;
const E = sandbox.PensionEngine || sandbox.window.PensionEngine;

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`✓ ${name}`); }

const HEADER = 'חודש משכורת שכר לפנסיה תגמולי עובד תגמולי מעסיק פיצויים סה״כ הפקדות';
function report(title, rows = [], fields = {}) {
  const balance = Object.prototype.hasOwnProperty.call(fields, 'balance') ? fields.balance : 'יתרה בסוף תקופת הדיווח 300,000';
  const depositFee = Object.prototype.hasOwnProperty.call(fields, 'depositFee') ? fields.depositFee : 'דמי ניהול אישיים מהפקדה 0.8%';
  const balanceFee = Object.prototype.hasOwnProperty.call(fields, 'balanceFee') ? fields.balanceFee : 'דמי ניהול אישיים מצבירה 0.16%';
  return [title, balance, depositFee, balanceFee, HEADER, ...rows].filter(Boolean).join('\n');
}

function sourceRow(month, values, options = {}) {
  const total = Object.prototype.hasOwnProperty.call(values, 'total') ? values.total : null;
  return {
    employerName: options.employer || null,
    depositDate: options.depositDate || null,
    salaryMonth: month,
    chronologyKey: Number(month.slice(3)) * 12 + Number(month.slice(0, 2)),
    reportedSalary: values.salary,
    pensionableSalary: values.salary,
    employeeContribution: values.employee,
    employerContribution: values.employer,
    severanceContribution: values.severance ?? null,
    totalContribution: total,
    totalSource: total == null ? null : 'explicit',
    sourcePage: options.page || 1,
    page: options.page || 1,
    confidence: options.confidence || 0.96,
    confidenceBand: options.reliable === false ? 'LOW' : 'HIGH',
    reliable: options.reliable !== false,
    requiresReview: options.reliable === false,
    issues: options.reliable === false ? ['INCOMPLETE_CONTRIBUTION_ROW'] : [],
    evidence: {
      rowId: options.rowId || `${month}-${options.employer || 'row'}`,
      sourcePage: options.page || 1,
      sourceRow: { id: options.rowId || `${month}-${options.employer || 'row'}`, page: options.page || 1, y: options.y ?? 140 },
      method: 'ocr',
    },
  };
}

function parsedPass(rows, options = {}) {
  const baseline = R.deriveContributionBaseline(rows);
  const automatic = baseline.derived.monthsUsed > 0 && baseline.issues.length === 0 && rows.every((row) => row.reliable);
  const state = {
    fundType: options.fundType || 'new_pension',
    supportedForCurrentForecast: options.fundType === 'old_pension' ? false : true,
    routingReason: options.fundType === 'old_pension' ? 'OLD_PENSION_REQUIRES_RIGHTS_BASED_MODEL' : 'SUPPORTED_NEW_PENSION',
    currentBalance: 300000,
    provider: options.provider ?? null,
    report: { type: options.reportType || 'annual', reportDate: null, period: null },
    fees: { depositRate: 0.008, balanceRate: 0.0016 },
    contributionHistory: rows,
    normalizedContributionMonths: baseline.normalizedMonths,
    derived: baseline.derived,
    extraction: {
      method: 'ocr', geometryAvailable: true, tables: [{ headerRows: ['header'] }],
      tableTotalReconciliation: { available: false, pass: null },
      counts: { monthsDetected: rows.length, monthsAccepted: baseline.derived.monthsUsed, monthsExcluded: 0, monthsAmbiguous: 0 },
    },
    confidence: {
      overall: automatic ? 'HIGH' : 'MEDIUM', fundTypeConfidence: 'HIGH', currentBalanceConfidence: 'HIGH',
      depositFeeConfidence: 'HIGH', balanceFeeConfidence: 'HIGH', tableHeaderConfidence: 'HIGH', columnGeometryConfidence: 'HIGH',
      rowGeometryConfidence: 'HIGH', arithmeticConfidence: automatic ? 'HIGH' : 'LOW', baselineConfidence: automatic ? 'HIGH' : 'LOW',
      crossMonthConsistencyConfidence: 'HIGH', ocrConfidence: 'HIGH',
    },
    decision: { confidenceBand: automatic ? 'HIGH' : 'MEDIUM', automaticAccepted: automatic, requiresReview: !automatic, reasons: [] },
    evidence: { fundType: { signalIds: ['explicit-new-pension-he'], confidenceBand: 'HIGH' } },
    review: { requiresReview: !automatic, issues: [] },
  };
  return {
    fields: {
      currentBalance: { value: 300000, confidence: 0.97, confidenceBand: 'HIGH' },
      depositManagementFeeRate: { value: 0.008, confidence: 0.95, confidenceBand: 'HIGH' },
      balanceManagementFeeRate: { value: 0.0016, confidence: 0.95, confidenceBand: 'HIGH' },
    },
    contributionHistory: rows,
    normalizedContributionMonths: baseline.normalizedMonths,
    pensionReportState: state,
    method: 'ocr',
  };
}

function resolve(passRows) {
  return D._test.resolvePensionOcrPasses(passRows.map((rows, index) => ({ name: index ? `ocr-targeted-${index}` : 'native-geometry', parsed: parsedPass(rows) })));
}

function token(text, x, y, page = 1, width = Math.max(24, String(text).length * 7)) {
  return { text, x, y, width, height: 14, confidence: 0.97, page };
}

function structuredTable(printedTotal) {
  const xs = { total: 70, severance: 215, employer: 320, employee: 440, salary: 575, month: 700 };
  const headers = [
    token('סה״כ הפקדות', xs.total, 100), token('פיצויים', xs.severance, 100), token('תגמולי מעסיק', xs.employer, 100),
    token('תגמולי עובד', xs.employee, 100), token('שכר לפנסיה', xs.salary, 100), token('חודש משכורת', xs.month, 100),
  ];
  const row = [token('4,000', xs.total, 140), token('1,200', xs.severance, 140), token('1,400', xs.employer, 140), token('1,400', xs.employee, 140), token('20,000', xs.salary, 140), token('12/2025', xs.month, 140)];
  const total = [token(String(printedTotal), xs.total, 180), token('1,200', xs.severance, 180), token('1,400', xs.employer, 180), token('1,400', xs.employee, 180), token('20,000', xs.salary, 180), token('סה״כ', xs.month, 180)];
  return {
    pages: [{ pageNumber: 1, tokens: [...headers, ...row, ...total] }],
    text: 'קרן פנסיה חדשה\nדוח שנתי\nיתרה בסוף תקופת הדיווח 300,000\nדמי ניהול אישיים מהפקדה 0.8%\nדמי ניהול אישיים מצבירה 0.16%',
  };
}

test('1. new-pension annual report is supported', () => {
  const state = R.parsePensionReport(report('קרן פנסיה חדשה\nדוח שנתי', ['12/2025 20,000 1,400 1,400 1,200 4,000'])).pensionReportState;
  assert.strictEqual(state.fundType, 'new_pension'); assert.strictEqual(state.report.type, 'annual'); assert.strictEqual(state.supportedForCurrentForecast, true);
});

test('2. new-pension quarterly report is supported', () => {
  const state = R.parsePensionReport(report('קרן פנסיה חדשה\nדוח רבעוני', ['01/2026 20,000 1,400 1,400 1,200 4,000'])).pensionReportState;
  assert.strictEqual(state.fundType, 'new_pension'); assert.strictEqual(state.report.type, 'quarterly'); assert.strictEqual(state.supportedForCurrentForecast, true);
});

test('3. old-pension annual report is routed unsupported', () => {
  const state = R.parsePensionReport('קרן פנסיה ותיקה\nדוח שנתי').pensionReportState;
  assert.strictEqual(state.fundType, 'old_pension'); assert.strictEqual(state.supportedForCurrentForecast, false); assert.strictEqual(state.routingReason, 'OLD_PENSION_REQUIRES_RIGHTS_BASED_MODEL');
  assert.throws(() => E.projectBaseline(state, 10), /rights-based model/i);
});

test('4. old-pension variant is routed unsupported', () => {
  const state = R.parsePensionReport('חוד יתנש טרופמ םיתימעל ןרקב היסנפ הקיתו').pensionReportState;
  assert.strictEqual(state.fundType, 'old_pension'); assert.strictEqual(state.decision.requiresReview, false);
});

test('5. a missing fee alone never classifies an old pension', () => {
  const state = R.parsePensionReport(report('דוח שנתי', ['12/2025 20,000 1,400 1,400 1,200 4,000'], { balanceFee: '' })).pensionReportState;
  assert.notStrictEqual(state.fundType, 'old_pension');
});

test('6. a missing balance alone never classifies an old pension', () => {
  const state = R.parsePensionReport(report('דוח שנתי', ['12/2025 20,000 1,400 1,400 1,200 4,000'], { balance: '' })).pensionReportState;
  assert.notStrictEqual(state.fundType, 'old_pension');
});

test('7. unknown fund type routes to review and cannot forecast', () => {
  const state = R.parsePensionReport('דוח שנתי\nדמי ניהול אישיים מהפקדה 0.8%').pensionReportState;
  assert.strictEqual(state.fundType, 'unknown'); assert.strictEqual(state.review.requiresReview, true); assert.throws(() => E.projectBaseline(state, 10), /new-pension fund type/i);
});

test('8. explicit zero percent deposit fee is valid', () => {
  assert.strictEqual(R.parsePensionReport('דמי ניהול אישיים מהפקדה 0%').pensionReportState.fees.depositRate, 0);
});

test('9. explicit zero percent balance fee is valid', () => {
  assert.strictEqual(R.parsePensionReport('דמי ניהול אישיים מצבירה 0.00%').pensionReportState.fees.balanceRate, 0);
});

test('10. equal salaries with different severance never copy values across months', () => {
  const january = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { rowId: 'jan' });
  const february = sourceRow('02/2026', { salary: 20000, employee: 1400, employer: 1400, severance: null, total: null }, { rowId: 'feb', reliable: false, y: 170 });
  const state = resolve([[january, february]]).pensionReportState;
  assert.strictEqual(state.contributionHistory.find((row) => row.salaryMonth === '02/2026').severanceContribution, null);
});

test('11. matching salary and two components never infer severance from another month', () => {
  const rows = [
    sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { rowId: 'jan' }),
    sourceRow('02/2026', { salary: 20000, employee: 1400, employer: 1400, severance: null, total: null }, { rowId: 'feb', reliable: false, y: 170 }),
  ];
  const february = resolve([rows]).pensionReportState.contributionHistory.find((row) => row.salaryMonth === '02/2026');
  assert.strictEqual(february.severanceContribution, null); assert.strictEqual(february.totalContribution, null);
});

test('12. three observed components safely derive a missing total', () => {
  const row = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: null }, { rowId: 'row', reliable: false });
  const resolved = resolve([[row]]).pensionReportState.contributionHistory[0];
  assert.strictEqual(resolved.totalContribution, 4000); assert.strictEqual(resolved.totalSource, 'derived-from-observed-components');
});

test('13. missing component with explicit total remains null', () => {
  const row = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: null, total: 2800 }, { rowId: 'row' });
  const resolved = resolve([[row]]).pensionReportState.contributionHistory[0];
  assert.strictEqual(resolved.severanceContribution, null); assert.strictEqual(resolved.totalContribution, 2800);
});

test('14. missing component and total remains review-only', () => {
  const row = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: null, total: null }, { rowId: 'row', reliable: false });
  const state = resolve([[row]]).pensionReportState;
  assert.strictEqual(state.contributionHistory[0].reliable, false); assert.strictEqual(state.derived.monthsUsed, 0); assert.strictEqual(state.decision.automaticAccepted, false);
});

test('15. two employers survive real multipass resolution and aggregate', () => {
  const a = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { employer: 'Employer A', rowId: 'row-a', y: 140 });
  const b = sourceRow('01/2026', { salary: 10000, employee: 700, employer: 700, severance: 600, total: 2000 }, { employer: 'Employer B', rowId: 'row-b', y: 170 });
  const state = resolve([[a, b], [{ ...a, evidence: { ...a.evidence } }, { ...b, evidence: { ...b.evidence } }]]).pensionReportState;
  assert.strictEqual(state.contributionHistory.length, 2); assert.strictEqual(state.normalizedContributionMonths.length, 1); assert.strictEqual(state.normalizedContributionMonths[0].totalContribution, 6000);
});

test('16. the same employer row is deduplicated across OCR passes', () => {
  const row = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { employer: 'Employer A', rowId: 'row-a' });
  const shifted = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { employer: 'Employer A', rowId: 'ocr-row-7', y: 310 });
  assert.strictEqual(resolve([[row], [shifted]]).pensionReportState.contributionHistory.length, 1);
});

test('17. similar numeric tuples from different employers are not deduplicated', () => {
  const a = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { employer: 'Employer A', rowId: 'row-a', y: 140 });
  const b = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { employer: 'Employer B', rowId: 'row-b', y: 170 });
  assert.strictEqual(resolve([[a, b], [{ ...a }, { ...b }]]).pensionReportState.contributionHistory.length, 2);
});

test('18. deposit date does not replace salary month for grouping', () => {
  const row = sourceRow('12/2025', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { depositDate: '10/01/2026', rowId: 'late' });
  assert.strictEqual(resolve([[row]]).pensionReportState.normalizedContributionMonths[0].salaryMonth, '12/2025');
});

test('19. YTD summary is excluded', () => {
  const parsed = R.parsePensionReport(report('קרן פנסיה חדשה\nדוח רבעוני', ['01/2026 20,000 1,400 1,400 1,200 4,000', '03/2026 סיכום מצטבר מתחילת השנה 60,000 4,200 4,200 3,600 12,000']));
  assert.strictEqual(parsed.contributionHistory.length, 1);
});

test('20. annual summary is excluded', () => {
  const parsed = R.parsePensionReport(report('קרן פנסיה חדשה\nדוח שנתי', ['12/2025 20,000 1,400 1,400 1,200 4,000', 'סה״כ שנתי 240,000 16,800 16,800 14,400 48,000']));
  assert.strictEqual(parsed.contributionHistory.length, 1);
});

test('21. printed table total is not mistaken for a salary month', () => {
  const parsed = R.parsePensionReport(structuredTable('4,000'));
  assert.strictEqual(parsed.contributionHistory.length, 1); assert.strictEqual(parsed.contributionHistory[0].salaryMonth, '12/2025');
});

test('22. successful table reconciliation is recorded', () => {
  assert.strictEqual(R.parsePensionReport(structuredTable('4,000')).pensionReportState.extraction.tableTotalReconciliation.pass, true);
});

test('23. contradictory table total blocks automatic acceptance', () => {
  const state = R.parsePensionReport(structuredTable('9,000')).pensionReportState;
  assert.strictEqual(state.extraction.tableTotalReconciliation.pass, false); assert.strictEqual(state.decision.automaticAccepted, false);
});

test('24. agreement on the same source row raises multipass agreement confidence', () => {
  const row = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { rowId: 'row' });
  const state = resolve([[row], [{ ...row, evidence: { ...row.evidence } }]]).pensionReportState;
  assert.strictEqual(state.confidence.ocrMultiPassAgreementConfidence, 'HIGH');
});

test('25. equal values from unrelated months do not count as source-local agreement', () => {
  const january = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { rowId: 'row' });
  const february = sourceRow('02/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { rowId: 'row' });
  const state = resolve([[january], [february]]).pensionReportState;
  assert.strictEqual(state.contributionHistory.length, 2); assert.notStrictEqual(state.confidence.ocrMultiPassAgreementConfidence, 'HIGH');
});

test('26. bad native row plus correct targeted OCR succeeds without value invention', () => {
  const bad = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: null, total: null }, { rowId: 'row', reliable: false });
  const good = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { rowId: 'row' });
  const state = resolve([[bad], [good]]).pensionReportState;
  assert.strictEqual(state.derived.baselineMonthlyContribution, 4000); assert.strictEqual(state.contributionHistory[0].severanceContribution, 1200);
});

test('27. conflicting passes route to review', () => {
  const left = sourceRow('01/2026', { salary: 20000, employee: 1400, employer: 1400, severance: 1200, total: 4000 }, { rowId: 'row' });
  const right = sourceRow('01/2026', { salary: 21000, employee: 1470, employer: 1470, severance: 1260, total: 4200 }, { rowId: 'row' });
  const state = resolve([[left], [right]]).pensionReportState;
  assert.strictEqual(state.decision.automaticAccepted, false); assert.ok(state.decision.reasons.includes('OCR_PASS_CONFLICT'));
});

test('28. a missing provider does not block a supported new-pension forecast', () => {
  const state = R.parsePensionReport(report('קרן פנסיה חדשה\nדוח שנתי', ['12/2025 20,000 1,400 1,400 1,200 4,000'])).pensionReportState;
  assert.strictEqual(state.provider, null); assert.strictEqual(state.supportedForCurrentForecast, true); assert.ok(E.projectBaseline(state, 10).retirementBalanceReal > 300000);
});

assert.strictEqual(passed, 28);
console.log(`All ${passed} fund-routing and source-safety regression tests passed.`);
