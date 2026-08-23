const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
const appRoot = path.resolve(__dirname, '..', '..', 'app');
for (const name of ['financial-normalizer.js', 'pension-report-parser.js', 'document-extraction.js']) {
  vm.runInContext(fs.readFileSync(path.join(appRoot, name), 'utf8'), sandbox);
}
const R = sandbox.window.PensionReportParser;
const D = sandbox.window.PensionDocuments;
let passed = 0;

function test(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

function token(text, x, y, page = 1, width = Math.max(24, String(text).length * 7)) {
  return { text, x, y, width, height: 14, confidence: 0.97, page };
}

function standardHeader(y = 100, page = 1, split = false) {
  const firstY = split ? y - 12 : y;
  return [
    token('סה״כ הפקדות', 55, y, page, 95),
    token('פיצויים', 205, y, page, 65),
    token('תגמולי מעסיק', 300, y, page, 105),
    token('תגמולי עובד', 420, y, page, 95),
    token('שכר לפנסיה', 555, firstY, page, 90),
    token('חודש שכר', 690, firstY, page, 80),
  ];
}

function contributionRow(month, salary, employee, employer, severance, total, y = 140, page = 1, extras = []) {
  return [
    token(String(total), 70, y, page, 62),
    token(String(severance), 215, y, page, 62),
    token(String(employer), 320, y, page, 62),
    token(String(employee), 440, y, page, 62),
    token(String(salary), 575, y, page, 76),
    token(month, 700, y, page, 72),
    ...extras,
  ];
}

function tableInput(rows, options = {}) {
  const tokens = [
    token(options.section || 'פירוט הפקדות', 600, 65, 1, 120),
    ...standardHeader(100, 1, options.splitHeader),
    ...rows.flat(),
  ];
  return { pages: [{ pageNumber: 1, tokens }] };
}

function rawRow(month, salary, employee, employer, severance, total, employerName = null, reliable = true) {
  return {
    salaryMonth: month,
    chronologyKey: Number(month.slice(3)) * 12 + Number(month.slice(0, 2)),
    reportedSalary: salary,
    employeeContribution: employee,
    employerContribution: employer,
    severanceContribution: severance,
    totalContribution: total,
    employerName,
    reliable,
    confidence: 0.96,
    sourcePage: 1,
    evidence: { rowId: `${month}-${employerName || 'none'}` },
  };
}

test('RTL column geometry maps physical X bands, not token order', () => {
  const input = tableInput([contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000')]);
  input.pages[0].tokens.reverse();
  const table = R.parseContributionTables(R.buildRows(R.tokensFromInput(input)));
  assert.strictEqual(table.rows.length, 1);
  assert.strictEqual(table.rows[0].reportedSalary, 20000);
  assert.strictEqual(table.rows[0].totalContribution, 4000);
  assert.ok(table.tables[0].columns.totalContribution.centerX < table.tables[0].columns.salaryMonth.centerX);
});

test('reversed PDF token order preserves the contribution tuple', () => {
  const input = tableInput([contributionRow('11/2025', '19,000', '1,330', '1,330', '1,140', '3,800')]);
  input.pages[0].tokens = input.pages[0].tokens.sort((left, right) => right.x - left.x || right.y - left.y);
  const parsed = R.parsePensionReport(input);
  assert.strictEqual(parsed.contributionHistory[0].salaryMonth, '11/2025');
  assert.strictEqual(parsed.contributionHistory[0].totalContribution, 3800);
});

test('two-line table header reconstructs one schema', () => {
  const input = tableInput([contributionRow('10/2025', '18,000', '1,260', '1,260', '1,080', '3,600')], { splitHeader: true });
  const headers = R.reconstructContributionHeaders(R.buildRows(R.tokensFromInput(input)));
  assert.ok(headers.some((header) => header.strength >= 5 && header.headerRows.length >= 2));
});

test('split monetary token is joined inside its physical column', () => {
  const row = contributionRow('09/2025', '18,800', '1,316', '1,316', '1,128', '3,760');
  row.splice(4, 1, token('18,', 568, 140, 1, 30), token('800', 601, 140, 1, 32));
  const parsed = R.parsePensionReport(tableInput([row]));
  assert.strictEqual(parsed.contributionHistory[0].reportedSalary, 18800);
});

test('wrapped employer name remains associated with its physical row', () => {
  const input = tableInput([contributionRow('08/2025', '18,800', '1,316', '1,316', '1,128', '3,760', 140, 1, [token('מעסיק בדיקה', 805, 132, 1, 90)])]);
  input.pages[0].tokens.push(token('שם מעסיק', 805, 100, 1, 80));
  const parsed = R.parsePensionReport(input);
  assert.match(parsed.contributionHistory[0].employerName || '', /מעסיק/);
});

test('repeated header on page 2 creates a second table segment', () => {
  const input = { pages: [{ pageNumber: 1, tokens: [...standardHeader(100, 1), ...contributionRow('11/2025', '20,000', '1,400', '1,400', '1,200', '4,000', 140, 1)] },
    { pageNumber: 2, tokens: [...standardHeader(100, 2), ...contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000', 140, 2)] }] };
  const parsed = R.parsePensionReport(input);
  assert.deepStrictEqual(Array.from(parsed.normalizedContributionMonths, (row) => row.salaryMonth), ['11/2025', '12/2025']);
});

test('deposit date remains distinct from salary month', () => {
  const extras = [token('10/01/2026', 820, 140, 1, 88), token('תאריך הפקדה', 810, 100, 1, 92)];
  const parsed = R.parsePensionReport(tableInput([contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000', 140, 1, extras)]));
  assert.strictEqual(parsed.contributionHistory[0].salaryMonth, '12/2025');
  assert.strictEqual(parsed.contributionHistory[0].depositDate, '10/01/2026');
});

test('missing severance with explicit total keeps severance null', () => {
  const input = tableInput([[token('2,800', 70, 140), token('1,400', 320, 140), token('1,400', 440, 140), token('20,000', 575, 140), token('12/2025', 700, 140)]]);
  const row = R.parsePensionReport(input).contributionHistory[0];
  assert.strictEqual(row.severanceContribution, null);
  assert.strictEqual(row.totalContribution, 2800);
});

test('explicit total mismatch makes a row unreliable', () => {
  const parsed = R.parsePensionReport(tableInput([contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '9,999')]));
  assert.strictEqual(parsed.contributionHistory[0].reliable, false);
  assert.ok(parsed.decision === undefined || parsed.pensionReportState.decision.requiresReview);
});

test('duplicate identical row is preserved raw and counted once', () => {
  const history = [rawRow('12/2025', 20000, 1400, 1400, 1200, 4000), rawRow('12/2025', 20000, 1400, 1400, 1200, 4000)];
  const normalized = R.aggregateContributionHistory(history);
  assert.strictEqual(normalized.months.length, 1);
  assert.ok(history.some((row) => row.normalizationStatus === 'duplicate-preserved'));
});

test('same-month correction remains ambiguous', () => {
  const history = [rawRow('12/2025', 20000, 1400, 1400, 1200, 4000), rawRow('12/2025', 21000, 1470, 1470, 1260, 4200)];
  const normalized = R.aggregateContributionHistory(history);
  assert.strictEqual(normalized.months.length, 0);
  assert.ok(normalized.issues.some((issue) => issue.code === 'AMBIGUOUS_SALARY_MONTH'));
});

test('two employers in one salary month aggregate legitimately', () => {
  const history = [rawRow('12/2025', 10000, 700, 700, 600, 2000, 'א'), rawRow('12/2025', 5000, 350, 350, 300, 1000, 'ב')];
  const normalized = R.aggregateContributionHistory(history);
  assert.strictEqual(normalized.months[0].reportedSalary, 15000);
  assert.strictEqual(normalized.months[0].totalContribution, 3000);
});

test('YTD summary is excluded from monthly contribution rows', () => {
  const text = 'פירוט הפקדות\nחודש שכר שכר לפנסיה תגמולי עובד תגמולי מעסיק פיצויים סה״כ הפקדות\n12/2025 20,000 1,400 1,400 1,200 4,000\nמצטבר מתחילת השנה 240,000 16,800 16,800 14,400 48,000';
  assert.strictEqual(R.parsePensionReport(text).contributionHistory.length, 1);
});

test('annual total row is not treated as a salary month', () => {
  const text = 'פירוט הפקדות\n12/2025 20,000 1,400 1,400 1,200 4,000\nסה״כ שנתי 240,000 16,800 16,800 14,400 48,000';
  assert.deepStrictEqual(Array.from(R.parsePensionReport(text).contributionHistory, (row) => row.salaryMonth), ['12/2025']);
});

test('printed table totals reconcile with extracted monthly rows', () => {
  const input = tableInput([
    contributionRow('11/2025', '20,000', '1,400', '1,400', '1,200', '4,000', 140),
    contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000', 170),
  ]);
  input.pages[0].tokens.push(...[token('8,000', 70, 205), token('2,400', 215, 205), token('2,800', 320, 205), token('2,800', 440, 205), token('40,000', 575, 205), token('סה״כ', 700, 205)]);
  const state = R.parsePensionReport(input).pensionReportState;
  assert.strictEqual(state.extraction.tableTotalReconciliation.pass, true);
});

test('bad native text can fall back to successful OCR evidence', () => {
  const badNative = R.parsePensionReport('יתרה בסוף תקופת הדיווח 100,000\n12/2025 20,000 1,400 1,400 1,200 9,999');
  const successfulOcr = R.parsePensionReport(tableInput([contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000')]), { method: 'ocr' });
  assert.strictEqual(D._test.pensionTableNeedsSecondSource(badNative), true);
  assert.strictEqual(successfulOcr.pensionReportState.derived.baselineMonthlyContribution, 4000);
});

test('good native geometry outranks a bad OCR-like semantic row', () => {
  const parsed = R.parsePensionReport(tableInput([contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000')]));
  assert.strictEqual(parsed.pensionReportState.extraction.paths.selected, 'geometry');
  assert.strictEqual(parsed.pensionReportState.derived.baselineMonthlyContribution, 4000);
});

test('conflicting extraction paths require review', () => {
  const left = [rawRow('12/2025', 20000, 1400, 1400, 1200, 4000)];
  const right = [rawRow('12/2025', 21000, 1470, 1470, 1260, 4200)];
  const resolved = R.resolveContributionHistories(left, right);
  assert.strictEqual(resolved.conflict, true);
});

test('zero personal management fee is retained', () => {
  const parsed = R.parsePensionReport('דמי ניהול אישיים דמי ניהול מהפקדה 0.00%\nדמי ניהול אישיים דמי ניהול מצבירה 0.00%');
  assert.strictEqual(parsed.fields.depositManagementFeeRate.value, 0);
  assert.strictEqual(parsed.fields.balanceManagementFeeRate.value, 0);
});

test('fund-average fees do not replace personal fees', () => {
  const parsed = R.parsePensionReport('ממוצע דמי ניהול בקרן מהפקדה 1.50% מחיסכון 0.20%\nדמי ניהול אישיים מהפקדה 0.70% מחיסכון 0.15%');
  near(parsed.fields.depositManagementFeeRate.value, 0.007);
  near(parsed.fields.balanceManagementFeeRate.value, 0.0015);
});

test('closing balance outranks opening balance', () => {
  const parsed = R.parsePensionReport({
    pages: [{ pageNumber: 1, tokens: [token('פירוט הפקדות', 600, 65)] }],
    text: 'יתרה בתחילת תקופת הדיווח 100,000\nיתרה בסוף תקופת הדיווח 125,000',
  });
  assert.strictEqual(parsed.fields.currentBalance.value, 125000);
});

test('missing provider does not block a reliable baseline', () => {
  const parsed = R.parsePensionReport(tableInput([contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000')]));
  assert.strictEqual(parsed.fields.pensionProvider, undefined);
  assert.strictEqual(parsed.pensionReportState.derived.baselineMonthlyContribution, 4000);
});

test('missing critical field routes the document to review', () => {
  const parsed = R.parsePensionReport('דמי ניהול אישיים מהפקדה 0.70% מצבירה 0.15%\nפירוט הפקדות\n12/2025 20,000 1,400 1,400 1,200 4,000');
  assert.strictEqual(parsed.pensionReportState.decision.automaticAccepted, false);
  assert.ok(parsed.pensionReportState.decision.reasons.includes('MISSING_CURRENT_BALANCE'));
});

test('one valid salary month produces a one-month baseline', () => {
  const parsed = R.parsePensionReport(tableInput([contributionRow('12/2025', '20,000', '1,400', '1,400', '1,200', '4,000')]));
  assert.strictEqual(parsed.pensionReportState.derived.monthsUsed, 1);
  assert.strictEqual(parsed.pensionReportState.derived.baselineMonthlyContribution, 4000);
});

console.log(`All ${passed} Pension Report Extraction Engine V2 tests passed.`);
