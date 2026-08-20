const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sandbox = { window: {} };
vm.createContext(sandbox);
const appRoot = path.resolve(__dirname, '..', '..', 'app');
for (const name of ['financial-normalizer.js', 'payslip-parser.js', 'pension-report-parser.js', 'pension-input-reconciler.js']) {
  vm.runInContext(fs.readFileSync(path.join(appRoot, name), 'utf8'), sandbox);
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

test('token-stream fee extraction keeps deposit and balance rates distinct', () => {
  const fees = R.parseManagementFeesFromTokens({ pages: [{ pageNumber: 1, tokens: [
    { text: 'deposit fee 0.80%', x: 0, y: 20, page: 1 },
    { text: 'balance fee 0.16%', x: 0, y: 10, page: 1 },
  ] }] });
  near(fees.depositManagementFeeRate.value, 0.008);
  near(fees.balanceManagementFeeRate.value, 0.0016);
});

test('fee selection ignores nearby fund averages and charged currency amounts', () => {
  const confusing = [
    'ממוצע דמי ניהול בקרן מהפקדה 1.46%',
    'ממוצע דמי ניהול בקרן מחיסכון 0.13%',
    'דמי ניהול שנגבו בתקופה 414 ₪',
    'דמי ניהול אישיים',
    'דמי ניהול מהפקדה 0.80%',
    'דמי ניהול מחיסכון 0.16%',
  ].join('\n');
  const parsed = R.parsePensionReport(confusing);
  near(parsed.fields.depositManagementFeeRate.value, 0.008);
  near(parsed.fields.balanceManagementFeeRate.value, 0.0016);
});

test('provider extraction accepts a Hebrew label and provider on the following row', () => {
  const parsed = R.parsePensionReport([
    'שם הגוף המוסדי',
    'מנורה מבטחים פנסיה וגמל בע"מ',
    'שם העמית עמית בדיקה',
  ].join('\n'));
  assert.strictEqual(parsed.fields.pensionProvider.value, 'מנורה מבטחים פנסיה וגמל בע"מ');
});

test('provider extraction accepts a same-row label and stops before unrelated text', () => {
  const parsed = R.parsePensionReport('שם הגוף המוסדי: מנורה מבטחים פנסיה וגמל בע"מ | שם העמית: עמית בדיקה');
  assert.strictEqual(parsed.fields.pensionProvider.value, 'מנורה מבטחים פנסיה וגמל בע"מ');
});

test('provider extraction rejects an unrelated investment heading after a missing value', () => {
  const parsed = R.parsePensionReport(['שם הגוף המוסדי', 'מסלול השקעה כללי'].join('\n'));
  assert.strictEqual(parsed.fields.pensionProvider, undefined);
});

test('provider extraction rejects a following financial balance row after a missing value', () => {
  const parsed = R.parsePensionReport(['שם הגוף המוסדי', 'יתרת הכספים בקרן בסוף השנה 237,963'].join('\n'));
  assert.strictEqual(parsed.fields.pensionProvider, undefined);
});

test('provider extraction accepts English same-row and following-row labels', () => {
  const sameRow = R.parsePensionReport('institution name: Menora Mivtachim Pension and Gemel Ltd. | member name: Test Member');
  const followingRow = R.parsePensionReport(['institution name', 'Menora Mivtachim Pension and Gemel Ltd.', 'member name Test Member'].join('\n'));
  assert.strictEqual(sameRow.fields.pensionProvider.value, 'Menora Mivtachim Pension and Gemel Ltd.');
  assert.strictEqual(followingRow.fields.pensionProvider.value, 'Menora Mivtachim Pension and Gemel Ltd.');
});

test('provider extraction uses structured token geometry without absorbing neighboring labels', () => {
  const parsed = R.parsePensionReport({ pages: [{ pageNumber: 1, tokens: [
    { text: 'שם הגוף המוסדי', x: 600, y: 20, width: 120, height: 14 },
    { text: 'מנורה מבטחים פנסיה וגמל בע"מ', x: 300, y: 20, width: 260, height: 14 },
    { text: 'שם העמית', x: 600, y: 50, width: 90, height: 14 },
    { text: 'עמית בדיקה', x: 450, y: 50, width: 100, height: 14 },
  ] }] });
  assert.strictEqual(parsed.fields.pensionProvider.value, 'מנורה מבטחים פנסיה וגמל בע"מ');
});

test('structured nearby financial rows cannot become a provider', () => {
  const parsed = R.parsePensionReport({ pages: [{ pageNumber: 1, tokens: [
    { text: 'שם הגוף המוסדי', x: 600, y: 20, width: 120, height: 14 },
    { text: 'יתרת הכספים בקרן בסוף השנה', x: 600, y: 42, width: 180, height: 14 },
    { text: '237,963', x: 400, y: 42, width: 60, height: 14 },
  ] }] });
  assert.strictEqual(parsed.fields.pensionProvider, undefined);
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

test('newer payslip salary wins over an older higher-confidence report observation', () => {
  const result = X.reconcile({
    payslipMonth: { value: '08/2026', confidence: 0.92 },
    insuredSalary: { value: 25000, confidence: 0.91, origin: 'direct', sourceDate: '08/2026', requiresConfirmation: false, evidence: { sourceDateConfidence: 0.92 } },
  }, {
    latestReportedPensionableSalary: { value: 23500, confidence: 0.97, origin: 'direct', sourceDate: '05/2026', evidence: { salaryMonth: '05/2026', recurringPattern: { recurring: true } } },
  });
  assert.strictEqual(result.fields.insuredSalary.value, 25000);
  assert.strictEqual(result.fields.insuredSalary.sourceDate, '08/2026');
  assert.strictEqual(result.fields.insuredSalary.evidence.type, 'CHRONOLOGY_RESOLVED');
  assert.strictEqual(result.fields.insuredSalary.requiresConfirmation, false);
});

test('newer report salary wins symmetrically over an older payslip observation', () => {
  const result = X.reconcile({
    payslipMonth: { value: '05/2026', confidence: 0.92 },
    insuredSalary: { value: 23500, confidence: 0.96, origin: 'direct', sourceDate: '05/2026', evidence: { sourceDateConfidence: 0.92 } },
  }, {
    latestReportedPensionableSalary: { value: 25000, confidence: 0.9, origin: 'direct', sourceDate: '08/2026', evidence: { salaryMonth: '08/2026' } },
  });
  assert.strictEqual(result.fields.insuredSalary.value, 25000);
  assert.strictEqual(result.fields.insuredSalary.sourceDate, '08/2026');
  assert.strictEqual(result.fields.insuredSalary.evidence.type, 'CHRONOLOGY_RESOLVED');
});

test('same-month salary conflict remains reviewable when evidence is not decisive', () => {
  const result = X.reconcile({
    payslipMonth: { value: '08/2026', confidence: 0.92 },
    insuredSalary: { value: 23500, confidence: 0.93, origin: 'direct', sourceDate: '08/2026', evidence: { sourceDateConfidence: 0.92 } },
  }, {
    latestReportedPensionableSalary: { value: 25000, confidence: 0.97, origin: 'direct', sourceDate: '08/2026', evidence: { salaryMonth: '08/2026' } },
  });
  assert.strictEqual(result.requiresConfirmation, true);
  assert.strictEqual(result.fields.insuredSalary.value, 23500);
  assert.strictEqual(result.fields.insuredSalary.conflict.primary, 23500);
  assert.strictEqual(result.fields.insuredSalary.conflict.secondary, 25000);
  assert.strictEqual(result.fields.insuredSalary.conflict.primaryPeriod, '08/2026');
  assert.strictEqual(result.fields.insuredSalary.conflict.secondaryPeriod, '08/2026');
  assert.strictEqual(result.fields.insuredSalary.evidence.type, 'CROSS_DOCUMENT_CONFLICT');
});

test('ambiguous payslip dates cannot silently chronology-resolve a conflicting report', () => {
  const payslip = P.parsePayslip('01/2020\n08/2026\nשכר מבוטח 25,000', { method: 'pdf-text' }).fields;
  const result = X.reconcile(payslip, {
    latestReportedPensionableSalary: {
      value: 23500, confidence: 0.97, origin: 'direct', sourceDate: '05/2026',
      evidence: { salaryMonth: '05/2026', recurringPattern: { recurring: true } },
    },
  });
  assert.strictEqual(result.requiresConfirmation, true);
  assert.notStrictEqual(result.fields.insuredSalary.evidence.type, 'CHRONOLOGY_RESOLVED');
  assert.ok(result.fields.insuredSalary.conflict);
});

test('non-standard rates are derived from evidence', () => {
  const parsed = R.parsePensionReport('06/2026 20,000 1,100 1,400 1,500 4,000');
  near(parsed.fields.latestEmployeeContributionRate.value, 0.055);
  near(parsed.fields.latestEmployerContributionRate.value, 0.07);
  near(parsed.fields.latestSeveranceRate.value, 0.075);
});

test('annual and YTD rows do not replace the latest monthly contribution tuple', () => {
  const parsed = R.parsePensionReport([
    'דוח שנתי לשנת 2026',
    '05/2026 שכר שנתי מצטבר 282,000 19,740 18,330 23,490 61,560',
    '04/2026 23,000 1,610 1,495 1,916 5,021',
    '05/2026 23,500 1,645 1,528 1,958 5,131',
  ].join('\n'));
  assert.strictEqual(parsed.fields.latestReportedPensionableSalary.value, 23500);
  assert.strictEqual(parsed.fields.latestEmployeeContributionAmount.value, 1645);
  assert.strictEqual(parsed.classification, 'ANNUAL_PENSION_REPORT');
});

test('report parser rejects an impossible contribution row', () => {
  const parsed = R.parsePensionReport('05/2026 925 1,645 1,528 1,958 5,131');
  assert.strictEqual(parsed.fields.latestReportedPensionableSalary, undefined);
  assert.strictEqual(parsed.fields.latestEmployeeContributionAmount, undefined);
});

test('reconciliation supplies a missing payslip amount from report evidence without inventing it', () => {
  const payslip = P.parsePayslip('שכר מבוטח 23,500\nתגמולי עובד 7%').fields;
  delete payslip.employeeContributionAmount;
  const pension = R.parsePensionReport(report).fields;
  const result = X.reconcile(payslip, pension);
  assert.strictEqual(result.fields.employeeContributionAmount.value, 1645);
  assert.strictEqual(result.fields.employeeContributionAmount.origin, 'direct');
  assert.strictEqual(result.fields.employeeContributionAmount.evidence.aliasId, 'contribution-table');
});

console.log(`All ${passed} pension-report/reconciliation tests passed.`);
