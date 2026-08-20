const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder } = require('util');

class TestFile {}

const sandbox = {
  window: {},
  File: TestFile,
  TextDecoder,
  Uint8Array,
  URL,
  DOMException,
  globalThis: {},
};
vm.createContext(sandbox);
const appRoot = path.resolve(__dirname, '..', '..', 'app');
for (const fileName of [
  'financial-normalizer.js',
  'payslip-parser.js',
  'local-document-pipeline.js',
  'document-extraction.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(appRoot, fileName), 'utf8'), sandbox);
}

const F = sandbox.window.PensionFinancial;
const P = sandbox.window.PensionPayslipParser;
const L = sandbox.window.PensionLocalDocuments;
const D = sandbox.window.PensionDocuments;
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

function approximately(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test('financial normalizer accepts Israeli and European amount punctuation', () => {
  assert.strictEqual(F.normalizeFinancialValue('23,500', { kind: 'amount' }).value, 23500);
  assert.strictEqual(F.normalizeFinancialValue('23.500', { kind: 'amount' }).value, 23500);
  assert.strictEqual(F.normalizeFinancialValue('23 500', { kind: 'amount' }).value, 23500);
  assert.strictEqual(F.normalizeFinancialValue('23.500,00', { kind: 'amount' }).value, 23500);
});

test('financial normalizer handles currency, percentages and conservative OCR digit repair', () => {
  assert.strictEqual(F.normalizeFinancialValue('₪23,500.00', { kind: 'amount' }).value, 23500);
  approximately(F.normalizeFinancialValue('8.33%', { kind: 'rate' }).value, 0.0833);
  assert.strictEqual(F.normalizeFinancialValue('1,64O', { kind: 'amount' }).value, 1640);
  assert.strictEqual(F.normalizeFinancialValue('23,5OO', { kind: 'amount' }).value, 23500);
  assert.notStrictEqual(F.normalizeFinancialValue('1,64S', { kind: 'amount' }).value, 1645);
  assert.strictEqual(F.normalizeFinancialValue('ONLY', { kind: 'amount' }).value, null);
});

test('centralized alias matcher recognizes insured salary variants', () => {
  assert.strictEqual(P.countPayslipAnchors('בסיס לפנסיה 20,000'), 1);
  assert.strictEqual(P.countPayslipAnchors('pensionable salary 20,000'), 1);
});

test('spatial rows match nearby contribution values without flattened-text dependence', () => {
  const input = { pages: [{ pageNumber: 1, tokens: [
    { text: 'שכר מבוטח', x: 700, y: 100, width: 100, height: 16, confidence: 99 },
    { text: '23,500', x: 120, y: 102, width: 70, height: 16, confidence: 98 },
    { text: 'תגמולי עובד', x: 700, y: 150, width: 100, height: 16, confidence: 98 },
    { text: '1,645', x: 230, y: 151, width: 55, height: 16, confidence: 97 },
    { text: '7%', x: 120, y: 151, width: 25, height: 16, confidence: 99 },
  ] }] };
  const parsed = P.parsePayslip(input, { method: 'ocr' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 23500);
  assert.strictEqual(parsed.fields.employeeContributionAmount.value, 1645);
  approximately(parsed.fields.employeeContributionRate.value, 0.07);
  assert.strictEqual(parsed.fields.insuredSalary.evidence.page, 1);
});

test('synthetic acceptance payslip covers insured salary and all three contributions', () => {
  const parsed = P.parsePayslip([
    'שכר מבוטח 23,500',
    'תגמולי עובד 1,645 7%',
    'תגמולי מעסיק 1,527.50 6.5%',
    'פיצויים 1,957.55 8.33%',
    '08/2026',
  ].join('\n'), { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 23500);
  assert.strictEqual(parsed.fields.employeeContributionAmount.value, 1645);
  approximately(parsed.fields.employeeContributionRate.value, 0.07);
  assert.strictEqual(parsed.fields.employerContributionAmount.value, 1527.5);
  approximately(parsed.fields.employerContributionRate.value, 0.065);
  assert.strictEqual(parsed.fields.severanceContributionAmount.value, 1957.55);
  approximately(parsed.fields.severanceRate.value, 0.0833);
  assert.strictEqual(parsed.fields.payslipMonth.value, '08/2026');
});

test('global tuple rejects a 925 neighbor and keeps the coherent salary candidate', () => {
  const parsed = P.parsePayslip([
    'שכר מבוטח 925 23,500',
    'תגמולי עובד 1,645 7%',
    'תגמולי מעסיק 1,527.50 6.5%',
    'פיצויים 1,957.55 8.33%',
  ].join('\n'), { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 23500);
  assert.notStrictEqual(parsed.fields.insuredSalary.value, 925);
  assert.strictEqual(parsed.fields.insuredSalary.evidence.selection, 'global-coherent-tuple');
});

test('global tuple considers a true salary on an adjacent spatial row despite a 925 on the anchor row', () => {
  const parsed = P.parsePayslip({ pages: [{ pageNumber: 1, tokens: [
    { text: 'insured salary', x: 600, y: 100, width: 110, height: 14, confidence: 0.99 },
    { text: '925', x: 450, y: 100, width: 35, height: 14, confidence: 0.99 },
    { text: '23,500', x: 450, y: 120, width: 65, height: 14, confidence: 0.96 },
    { text: 'employee contribution', x: 600, y: 180, width: 150, height: 14, confidence: 0.98 },
    { text: '1,645', x: 450, y: 180, width: 55, height: 14, confidence: 0.98 },
    { text: '7%', x: 380, y: 180, width: 25, height: 14, confidence: 0.98 },
    { text: 'employer contribution', x: 600, y: 240, width: 150, height: 14, confidence: 0.98 },
    { text: '1,528', x: 450, y: 240, width: 55, height: 14, confidence: 0.98 },
    { text: '6.5%', x: 370, y: 240, width: 45, height: 14, confidence: 0.98 },
    { text: 'severance', x: 600, y: 300, width: 90, height: 14, confidence: 0.98 },
    { text: '1,958', x: 450, y: 300, width: 55, height: 14, confidence: 0.98 },
    { text: '8.33%', x: 370, y: 300, width: 45, height: 14, confidence: 0.98 },
  ] }] }, { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 23500);
  assert.strictEqual(parsed.fields.employeeContributionAmount.value, 1645);
  assert.strictEqual(parsed.fields.employerContributionAmount.value, 1528);
  assert.strictEqual(parsed.fields.severanceContributionAmount.value, 1958);
});

test('contribution rate and adjacent-row amount form one coherent spatial observation', () => {
  const parsed = P.parsePayslip({ pages: [{ pageNumber: 1, tokens: [
    { text: 'pensionable salary', x: 600, y: 80, width: 130, height: 14, confidence: 0.98 },
    { text: '20,000', x: 420, y: 80, width: 65, height: 14, confidence: 0.98 },
    { text: 'employee contribution', x: 600, y: 150, width: 150, height: 14, confidence: 0.98 },
    { text: '5.5%', x: 420, y: 150, width: 35, height: 14, confidence: 0.98 },
    { text: 'current month 1,100', x: 420, y: 170, width: 130, height: 14, confidence: 0.96 },
    { text: 'employer contribution 1,400 7%', x: 420, y: 230, width: 260, height: 14, confidence: 0.98 },
    { text: 'severance 1,500 7.5%', x: 420, y: 290, width: 220, height: 14, confidence: 0.98 },
  ] }] }, { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.employeeContributionAmount.value, 1100);
  approximately(parsed.fields.employeeContributionRate.value, 0.055);
  assert.strictEqual(parsed.fields.employeeContributionAmount.evidence.validation, 'amount-rate-agree');
});

test('monthly contribution tuple outranks a nearby high-confidence YTD amount', () => {
  const parsed = P.parsePayslip({ pages: [{ pageNumber: 1, tokens: [
    { text: 'insured salary 20,000', x: 500, y: 80, width: 180, height: 14, confidence: 0.98 },
    { text: 'employee contribution monthly 5.5%', x: 500, y: 150, width: 260, height: 14, confidence: 0.94 },
    { text: 'current month 1,100', x: 500, y: 170, width: 140, height: 14, confidence: 0.88 },
    { text: 'employee contribution YTD accumulated 5,500', x: 500, y: 190, width: 310, height: 14, confidence: 0.999 },
    { text: 'employer contribution 1,400 7%', x: 500, y: 250, width: 250, height: 14, confidence: 0.98 },
    { text: 'severance 1,500 7.5%', x: 500, y: 310, width: 200, height: 14, confidence: 0.98 },
  ] }] }, { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.employeeContributionAmount.value, 1100);
  approximately(parsed.fields.employeeContributionRate.value, 0.055);
});

test('structured tokens do not gain duplicate fallback identities from input text', () => {
  const input = {
    pages: [{ pageNumber: 1, tokens: [
      { text: 'insured salary', x: 500, y: 100, width: 100, height: 14, confidence: 0.98 },
      { text: '20,000', x: 350, y: 100, width: 60, height: 14, confidence: 0.98 },
    ] }],
    text: 'insured salary 20,000',
  };
  assert.strictEqual(P.tokensFromInput(input).length, 2);
});

test('flattened text is a separate fallback stream when structured OCR has no critical tuple', () => {
  const parsed = P.parsePayslip({
    pages: [{ pageNumber: 1, tokens: [{ text: '08/2026', x: 0, y: 0, width: 60, height: 14, confidence: 0.9 }] }],
    text: 'insured salary 20,000\nemployee contribution 1,100 5.5%\n08/2026',
  }, { method: 'ocr' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 20000);
  assert.strictEqual(parsed.fields.employeeContributionAmount.value, 1100);
  assert.strictEqual(parsed.fields.insuredSalary.evidence.observationStream, 'flattened-text-fallback');
});

test('monthly salary wins over an annual cumulative salary through semantics and arithmetic', () => {
  const parsed = P.parsePayslip([
    'שכר מבוטח שנתי מצטבר 282,000',
    'שכר מבוטח חודשי 23,500',
    'תגמולי עובד 1,645 7%',
    'תגמולי מעסיק 1,527.50 6.5%',
    'פיצויים 1,957.55 8.33%',
  ].join('\n'), { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 23500);
});

test('salary-period context beats an earlier employment-start date', () => {
  const parsed = P.parsePayslip('תחילת עבודה 01/2020\nחודש שכר 08/2026\nשכר מבוטח 25,000', { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.payslipMonth.value, '08/2026');
  assert.ok(parsed.fields.payslipMonth.confidence >= 0.8);
  assert.strictEqual(parsed.fields.insuredSalary.sourceDate, '08/2026');
});

test('salary-period context beats an earlier seniority date', () => {
  const parsed = P.parsePayslip('וותק 03/2021\nתקופת שכר 07/2026', { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.payslipMonth.value, '07/2026');
  assert.ok(parsed.fields.payslipMonth.confidence >= 0.8);
});

test('unlabelled multiple dates remain below chronology confidence', () => {
  const parsed = P.parsePayslip('01/2020\n08/2026\nשכר מבוטח 25,000', { method: 'pdf-text' });
  assert.ok(!parsed.fields.payslipMonth || parsed.fields.payslipMonth.confidence < 0.8);
});

test('month/year fragments are not reused as financial amounts', () => {
  const parsed = P.parsePayslip([
    'pay period 04/2025',
    'gross salary 20,812.50',
    'insured salary 18,750',
    'employee contribution 1,125 6%',
  ].join('\\n'), { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.payslipMonth.value, '04/2025');
  assert.strictEqual(parsed.fields.grossSalary.value, 20812.5);
  assert.strictEqual(parsed.fields.insuredSalary.value, 18750);
});

test('global tuple pairs all contribution roles without reusing numeric observations', () => {
  const parsed = P.parsePayslip([
    'שכר לפנסיה 20,000',
    'ניכוי עובד לפנסיה 1,100 5.5%',
    'הפרשת מעסיק 1,400 7%',
    'פיצויי מעסיק 1,500 7.5%',
  ].join('\n'), { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.employeeContributionAmount.value, 1100);
  assert.strictEqual(parsed.fields.employerContributionAmount.value, 1400);
  assert.strictEqual(parsed.fields.severanceContributionAmount.value, 1500);
  assert.notStrictEqual(parsed.fields.employeeContributionAmount.evidence.candidateId, parsed.fields.employerContributionAmount.evidence.candidateId);
});

test('financially impossible contribution relationships are omitted rather than fabricated', () => {
  const parsed = P.parsePayslip('שכר מבוטח 925\nתגמולי עובד 1,645', { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 925);
  assert.strictEqual(parsed.fields.employeeContributionAmount, undefined);
  assert.strictEqual(parsed.fields.employeeContributionRate, undefined);
});

test('near-tied salary candidates are surfaced for confirmation', () => {
  const parsed = P.parsePayslip('שכר מבוטח 20,000\nשכר לפנסיה 21,000', { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.requiresConfirmation, true);
  assert.strictEqual(parsed.fields.insuredSalary.evidence.validation, 'ambiguous-salary-candidates');
});

test('employee rate is derived from insured salary and amount', () => {
  const parsed = P.parsePayslip('שכר לפנסיה 23,500\nהפרשת עובד 1,645', { method: 'pdf-text' });
  approximately(parsed.fields.employeeContributionRate.value, 0.07);
  assert.strictEqual(parsed.fields.employeeContributionRate.origin, 'derived');
});

test('employer amount is derived when only its rate is present', () => {
  const parsed = P.parsePayslip('שכר קובע 23,500\nהפרשת מעסיק 6.5%', { method: 'pdf-text' });
  approximately(parsed.fields.employerContributionAmount.value, 1527.5, 0.01);
  assert.strictEqual(parsed.fields.employerContributionAmount.origin, 'derived');
});

test('severance rate is derived from insured salary and amount', () => {
  const parsed = P.parsePayslip('בסיס גמל 23,500\nפיצויי מעסיק 1,957.55', { method: 'pdf-text' });
  approximately(parsed.fields.severanceRate.value, 1957.55 / 23500);
});

test('materially conflicting amount and rate require confirmation', () => {
  const parsed = P.parsePayslip('שכר מבוטח 23,500\nתגמולי עובד 1,645 5%', { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.employeeContributionAmount.requiresConfirmation, true);
  assert.strictEqual(parsed.fields.employeeContributionRate.requiresConfirmation, true);
  assert.strictEqual(parsed.fields.employeeContributionRate.evidence.validation, 'amount-rate-conflict');
});

test('missing fields remain absent instead of receiving document-derived defaults', () => {
  const parsed = P.parsePayslip('שכר מבוטח 23,500', { method: 'pdf-text' });
  assert.strictEqual(parsed.fields.insuredSalary.value, 23500);
  assert.strictEqual(parsed.fields.employeeContributionRate, undefined);
  assert.strictEqual(parsed.fields.employerContributionAmount, undefined);
});

test('all OCR-derived critical values require human review', () => {
  const parsed = P.parsePayslip('שכר מבוטח 23,500\nתגמולי עובד 1,645', { method: 'ocr' });
  assert.strictEqual(parsed.fields.insuredSalary.requiresConfirmation, true);
  assert.strictEqual(parsed.fields.employeeContributionAmount.requiresConfirmation, true);
  assert.strictEqual(parsed.fields.employeeContributionRate.requiresConfirmation, true);
});

test('user correction changes provenance to USER_OVERRIDE', () => {
  const corrected = D.field(0.075, D.SOURCES.USER_OVERRIDE, null, true, { unit: 'ratio' });
  assert.strictEqual(corrected.source, D.SOURCES.USER);
  assert.strictEqual(corrected.confirmedByUser, true);
});

test('native text heuristic keeps a healthy payslip on the PDF text path', () => {
  const assessment = L.assessNativeText({ text: 'שכר מבוטח 23,500 תגמולי עובד 1,645 תגמולי מעסיק 1,527.50' }, 'payslip');
  assert.strictEqual(assessment.useful, true);
  assert.strictEqual(assessment.reason, 'native-text-usable');
});

test('native text heuristic routes an image-only PDF to local OCR', () => {
  const assessment = L.assessNativeText({ text: '  \u0000  ' }, 'payslip');
  assert.strictEqual(assessment.useful, false);
  assert.strictEqual(assessment.reason, 'too-little-text');
});

test('development diagnostics never contain raw text or financial values', () => {
  const parsed = P.parsePayslip('שכר מבוטח 23,500\nתגמולי עובד 1,645', { method: 'ocr' });
  const serialized = JSON.stringify(parsed.diagnostics);
  assert.ok(!serialized.includes('23500'));
  assert.ok(!serialized.includes('1645'));
  assert.ok(!serialized.includes('שכר מבוטח'));
  assert.ok(parsed.diagnostics.every((item) => item.method === 'ocr'));
});

console.log(`All ${passed} OCR/parser tests passed.`);
