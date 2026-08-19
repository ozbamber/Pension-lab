const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const name of ['financial-normalizer.js', 'payslip-parser.js', 'pension-report-parser.js', 'pension-input-reconciler.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), sandbox);
}
const F = sandbox.window.PensionFinancial;
const P = sandbox.window.PensionPayslipParser;
const R = sandbox.window.PensionReportParser;
const X = sandbox.window.PensionInputReconciler;
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`✓ ${name}`); }
function near(actual, expected, tolerance = 0.0001) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`); }

test('financial punctuation preserves decimals and removes grouping', () => {
  for (const [raw, expected] of [['9.25', 9.25], ['8.33', 8.33], ['6.50', 6.5], ['0.80', 0.8], ['0.16', 0.16], ['23,500', 23500], ['23,500.00', 23500], ['1,645', 1645]]) {
    assert.strictEqual(F.normalizeFinancialValue(raw, { kind: 'amount' }).value, expected);
  }
});

test('salary candidates are validated against contribution arithmetic', () => {
  const parsed = P.parsePayslip({ pages: [{ pageNumber: 1, tokens: [
    { text: 'נק. רגילות 9.25', x: 100, y: 100, width: 100, height: 14, confidence: 0.99 },
    { text: 'שכר מבוטח', x: 500, y: 100, width: 90, height: 14, confidence: 0.99 },
    { text: '23,500', x: 350, y: 100, width: 60, height: 14, confidence: 0.99 },
    { text: 'תגמולי עובד', x: 500, y: 140, width: 90, height: 14, confidence: 0.99 },
    { text: '1,645', x: 350, y: 140, width: 50, height: 14, confidence: 0.99 },
  ] }] }, { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 23500);
  assert.notStrictEqual(parsed.fields.insuredSalary.value, 925);
});

const report = [
  'יתרה בתחילת תקופת הדיווח 202,375',
  'יתרת הכספים בקרן בסוף תקופת הדיווח 237,963',
  'דמי ניהול אישיים דמי ניהול מהפקדה 0.80%',
  'דמי ניהול אישיים דמי ניהול מחיסכון 0.16%',
  'ממוצע דמי ניהול בקרן מהפקדה 1.46%',
  'ממוצע דמי ניהול בקרן מחיסכון 0.13%',
  'דמי ניהול שנגבו בתקופה -414 ₪',
  '05/2025 21,000 1,470 1,365 1,749 4,584',
  '03/2026 23,500 1,645 1,528 1,958 5,131',
  '04/2026 23,500 1,645 1,528 1,958 5,131',
  '05/2026 23,500 1,645 1,528 1,958 5,131',
].join('\n');

test('report selects closing balance and personal percentage fees', () => {
  const parsed = R.parsePensionReport(report);
  assert.strictEqual(parsed.fields.currentBalance.value, 237963);
  near(parsed.fields.depositManagementFeeRate.value, 0.008);
  near(parsed.fields.balanceManagementFeeRate.value, 0.0016);
  assert.notStrictEqual(parsed.fields.depositManagementFeeRate.value, 414);
});

test('report chronology and recurring rows select latest contribution structure', () => {
  const parsed = R.parsePensionReport(report);
  assert.strictEqual(parsed.fields.latestReportedPensionableSalary.value, 23500);
  assert.strictEqual(parsed.fields.latestEmployeeContributionAmount.value, 1645);
  assert.strictEqual(parsed.fields.latestEmployerContributionAmount.value, 1528);
  assert.strictEqual(parsed.fields.latestSeveranceContributionAmount.value, 1958);
  near(parsed.fields.latestEmployeeContributionRate.value, 0.07);
  near(parsed.fields.latestEmployerContributionRate.value, 1528 / 23500);
  near(parsed.fields.latestSeveranceRate.value, 1958 / 23500);
  assert.strictEqual(parsed.fields.latestReportedPensionableSalary.evidence.recurringPattern.recurring, true);
});

test('RTL reversed contribution rows retain chronology', () => {
  const parsed = R.parsePensionReport('5,131 1,958 1,528 1,645 23,500 05/2026\n4,584 1,749 1,365 1,470 21,000 05/2025');
  assert.strictEqual(parsed.fields.latestReportedPensionableSalary.value, 23500);
});

test('cross-document agreement increases confidence', () => {
  const payslip = P.parsePayslip('שכר מבוטח 23,500\nתגמולי עובד 1,645').fields;
  const pension = R.parsePensionReport(report).fields;
  const result = X.reconcile(payslip, pension);
  assert.strictEqual(result.fields.insuredSalary.value, 23500);
  assert.strictEqual(result.fields.insuredSalary.source, 'crossValidated');
  assert.strictEqual(result.fields.insuredSalary.requiresConfirmation, false);
});

test('genuine cross-document disagreement requires confirmation', () => {
  const result = X.reconcile({ insuredSalary: { value: 25000, confidence: 0.95 } }, { latestReportedPensionableSalary: { value: 23500, confidence: 0.95 } });
  assert.strictEqual(result.requiresConfirmation, true);
  assert.ok(result.fields.insuredSalary.conflict);
});

test('non-standard rates are derived from evidence', () => {
  const parsed = R.parsePensionReport('06/2026 20,000 1,100 1,400 1,500 4,000');
  near(parsed.fields.latestEmployeeContributionRate.value, 0.055);
  near(parsed.fields.latestEmployerContributionRate.value, 0.07);
  near(parsed.fields.latestSeveranceRate.value, 0.075);
});

console.log(`All ${passed} pension-report/reconciliation tests passed.`);
