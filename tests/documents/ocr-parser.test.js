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
