const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
const appRoot = path.resolve(__dirname, '..', '..', 'app');
for (const name of ['financial-normalizer.js', 'pension-report-parser.js', 'engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(appRoot, name), 'utf8'), sandbox, { filename: name });
}
const R = sandbox.window.PensionReportParser;
const E = sandbox.PensionEngine || sandbox.window.PensionEngine;
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`✓ ${name}`); }
function near(actual, expected, tolerance = 0.01) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`); }

const header = 'חודש משכורת שכר לפנסיה תגמולי עובד תגמולי מעסיק פיצויים סה״כ הפקדות';
function reportWithRows(title, rows, extra = []) {
  return [
    title,
    'יתרה בסוף תקופת הדיווח 300,000',
    'דמי ניהול אישיים מהפקדה 0.8%',
    'דמי ניהול אישיים מצבירה 0.16%',
    header,
    ...rows,
    ...extra,
  ].join('\n');
}

test('annual report preserves twelve monthly rows and derives their mean', () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    const total = 4000 + index * 10;
    return `${month}/2025 20,000 ${1100 + index * 10} 1,400 1,500 ${total}`;
  });
  const parsed = R.parsePensionReport(reportWithRows('דוח שנתי לשנת 2025', rows));
  assert.strictEqual(parsed.pensionReportState.report.type, 'annual');
  assert.strictEqual(parsed.contributionHistory.length, 12);
  assert.strictEqual(parsed.pensionReportState.derived.monthsUsed, 12);
  near(parsed.pensionReportState.derived.baselineMonthlyContribution, 4055);
});

test('quarterly report uses the same model and preserves three months', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני רבעון ראשון 2026', [
    '01/2026 20,000 1,100 1,400 1,500 4,000',
    '02/2026 20,000 1,100 1,400 1,500 4,000',
    '03/2026 20,000 1,100 1,400 1,500 4,000',
  ]));
  assert.strictEqual(parsed.classification, 'QUARTERLY_PENSION_REPORT');
  assert.strictEqual(parsed.pensionReportState.derived.monthsUsed, 3);
});

test('quarterly YTD summary rows are not normalized as salary months', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני', [
    '01/2026 20,000 1,100 1,400 1,500 4,000',
    '02/2026 20,000 1,100 1,400 1,500 4,000',
    '03/2026 20,000 1,100 1,400 1,500 4,000',
    '03/2026 סיכום מצטבר מתחילת השנה 60,000 3,300 4,200 4,500 12,000',
  ]));
  assert.strictEqual(parsed.contributionHistory.length, 3);
  assert.strictEqual(parsed.pensionReportState.derived.monthsUsed, 3);
});

test('one reliable contribution month becomes the baseline', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני', ['01/2026 20,000 1,100 1,400 1,500 4,000']));
  assert.strictEqual(parsed.pensionReportState.derived.monthsUsed, 1);
  near(parsed.pensionReportState.derived.baselineMonthlyContribution, 4000);
});

test('multiple reliable months use the arithmetic mean rather than the latest month', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני', [
    '01/2026 20,000 1,100 1,400 1,500 4,000',
    '02/2026 20,000 1,200 1,400 1,500 4,100',
    '03/2026 20,000 1,300 1,400 1,500 4,200',
  ]));
  near(parsed.pensionReportState.derived.baselineMonthlyContribution, 4100);
  assert.notStrictEqual(parsed.pensionReportState.derived.baselineMonthlyContribution, 4200);
});

test('different monthly reported salaries use the arithmetic mean', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני', [
    '01/2026 18,000 1,000 1,200 1,300 3,500',
    '02/2026 20,000 1,100 1,400 1,500 4,000',
    '03/2026 22,000 1,200 1,600 1,700 4,500',
  ]));
  near(parsed.pensionReportState.derived.averageReportedPensionSalary, 20000);
});

test('non-standard component rates are derived as supporting information', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני', ['01/2026 20,000 1,100 1,400 1,500 4,000']));
  near(parsed.pensionReportState.derived.employeeContributionRate, 0.055, 0.00001);
  near(parsed.pensionReportState.derived.employerContributionRate, 0.07, 0.00001);
  near(parsed.pensionReportState.derived.severanceRate, 0.075, 0.00001);
});

test('explicit consistent total supports a row with one missing component without inventing it', () => {
  const input = { pages: [{ pageNumber: 1, tokens: [
    { text: 'חודש משכורת', x: 600, y: 20 },
    { text: 'שכר לפנסיה', x: 500, y: 20 },
    { text: 'תגמולי עובד', x: 400, y: 20 },
    { text: 'תגמולי מעסיק', x: 300, y: 20 },
    { text: 'פיצויים', x: 200, y: 20 },
    { text: 'סה״כ הפקדות', x: 100, y: 20 },
    { text: '01/2026', x: 600, y: 50 },
    { text: '20,000', x: 500, y: 50 },
    { text: '1,100', x: 400, y: 50 },
    { text: '1,400', x: 300, y: 50 },
    { text: '4,000', x: 100, y: 50 },
  ] }] };
  const parsed = R.parsePensionReport(input);
  assert.strictEqual(parsed.contributionHistory[0].severanceContribution, null);
  assert.strictEqual(parsed.contributionHistory[0].totalContribution, 4000);
  assert.strictEqual(parsed.contributionHistory[0].reliable, true);
  assert.strictEqual(parsed.pensionReportState.derived.baselineMonthlyContribution, 4000);
});

test('explicit total inconsistent with complete components requires review and is not averaged', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני', ['01/2026 20,000 1,100 1,400 1,500 4,900']));
  assert.strictEqual(parsed.contributionHistory[0].requiresReview, true);
  assert.ok(parsed.contributionHistory[0].issues.includes('TOTAL_COMPONENT_MISMATCH'));
  assert.strictEqual(parsed.pensionReportState.derived.monthsUsed, 0);
});

test('conflicting rows for the same salary month remain raw and make the month ambiguous', () => {
  const parsed = R.parsePensionReport(reportWithRows('דוח רבעוני', [
    '01/2026 20,000 1,100 1,400 1,500 4,000',
    '01/2026 20,000 1,200 1,400 1,500 4,100',
    '02/2026 20,000 1,100 1,400 1,500 4,000',
  ]));
  assert.strictEqual(parsed.contributionHistory.length, 3);
  assert.strictEqual(parsed.pensionReportState.derived.monthsUsed, 1);
  assert.ok(parsed.pensionReportState.review.issues.some((issue) => issue.code === 'AMBIGUOUS_SALARY_MONTH'));
});

function validState(overrides = {}) {
  return {
    currentBalance: 300000,
    provider: null,
    fees: { depositRate: 0.008, balanceRate: 0.0016 },
    derived: { baselineMonthlyContribution: 4000 },
    ...overrides,
  };
}

test('missing provider does not block the baseline forecast', () => {
  const result = E.projectBaseline(validState(), 12);
  assert.strictEqual(result.monthsUntilRetirement, 144);
  assert.ok(result.retirementBalanceReal > 300000);
});

test('missing fees require review and are never invented by the engine', () => {
  assert.throws(() => E.projectBaseline(validState({ fees: { depositRate: null, balanceRate: 0.0016 } }), 12), /deposit management fee/i);
});

test('missing balance blocks automatic forecast until a balance is confirmed', () => {
  assert.throws(() => E.projectBaseline(validState({ currentBalance: null }), 12), /current balance/i);
});

test('years until retirement drives the horizon exactly without age fields', () => {
  const state = validState();
  assert.strictEqual(Object.prototype.hasOwnProperty.call(state, 'currentAge'), false);
  const result = E.projectBaseline(state, 37);
  assert.strictEqual(result.months, 444);
  assert.strictEqual(result.monthsUntilRetirement, 444);
  assert.strictEqual(result.scenario.contribution.fixedValueType, 'real');
});

console.log(`All ${passed} pension-report state tests passed.`);
