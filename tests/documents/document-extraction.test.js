const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder } = require('util');

class TestFile {
  constructor(name, type, content = '', size = null) {
    this.name = name;
    this.type = type;
    this.content = content;
    this.size = size == null ? Buffer.byteLength(content) : size;
  }
  async arrayBuffer() {
    const buffer = Buffer.from(this.content, 'latin1');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
}

const sandbox = { window: {}, File: TestFile, TextDecoder, Uint8Array };
vm.createContext(sandbox);
const appRoot = path.resolve(__dirname, '..', '..', 'app');
for (const fileName of ['financial-normalizer.js', 'payslip-parser.js', 'document-extraction.js']) {
  vm.runInContext(fs.readFileSync(path.join(appRoot, fileName), 'utf8'), sandbox);
}
const D = sandbox.window.PensionDocuments;

async function run() {
  const meta = D.field(35, D.SOURCES.SYSTEM, 0.8, false, { unit: 'years', sourceDocument: 'test.pdf' });
  assert.strictEqual(meta.value, 35);
  assert.strictEqual(meta.unit, 'years');
  assert.strictEqual(meta.sourceDocument, 'test.pdf');
  assert.strictEqual(meta.requiresConfirmation, true);
  console.log('✓ provenance retains source, unit, document and confirmation state');

  const payslipPdf = '%PDF (insured salary 23500) Tj (employee contribution 1645) Tj (employer contribution 1527.5) Tj (severance 1957.55) Tj';
  const payslip = await D.extract(new TestFile('salary.pdf', 'application/pdf', payslipPdf), D.SOURCES.PAYSLIP);
  assert.strictEqual(payslip.status, 'partial');
  assert.strictEqual(payslip.fields.insuredSalary.value, 23500);
  assert.ok(Math.abs(payslip.fields.employeeContributionRate.value - 0.07) < 1e-8);
  assert.strictEqual(payslip.fields.employeeContributionRate.source, D.SOURCES.PAYSLIP_DERIVED);
  console.log('✓ local text-layer payslip extraction derives contribution rates');

  const pensionPdf = '%PDF (current balance 487000) Tj (deposit fee 1.2%) Tj (balance fee 0.25%) Tj';
  const pension = await D.extract(new TestFile('report.pdf', 'application/pdf', pensionPdf), D.SOURCES.PENSION_REPORT);
  assert.strictEqual(pension.status, 'partial');
  assert.strictEqual(pension.fields.currentBalance.value, 487000);
  assert.strictEqual(pension.fields.depositFee.value, 0.012);
  console.log('✓ local text-layer pension report extraction normalizes balance and fees');

  const image = await D.extract(new TestFile('scan.png', 'image/png', 'pixels'), D.SOURCES.PENSION_REPORT);
  assert.strictEqual(image.status, 'manual-required');
  assert.ok(Object.values(image.fields).every((item) => item.value === null));
  console.log('✓ images fall back to manual review without cloud OCR');

  const scannedPdf = await D.extract(new TestFile('scan.pdf', 'application/pdf', '%PDF binary data'), D.SOURCES.PAYSLIP);
  assert.strictEqual(scannedPdf.status, 'no-useful-text');
  console.log('✓ scanned PDFs are detected without invented values');

  const protectedPdf = await D.extract(new TestFile('protected.pdf', 'application/pdf', '%PDF /Encrypt (insured salary 20000) Tj'), D.SOURCES.PAYSLIP);
  assert.strictEqual(protectedPdf.status, 'password-protected');
  console.log('✓ password-protected PDFs receive a specific local error');

  const corruptPdf = await D.extract(new TestFile('corrupt.pdf', 'application/pdf', 'not a pdf document'), D.SOURCES.PAYSLIP);
  assert.strictEqual(corruptPdf.status, 'corrupted-pdf');
  console.log('✓ corrupted PDFs receive a specific local error');

  const wrongDocument = await D.extract(new TestFile('wrong.pdf', 'application/pdf', '%PDF (current balance 400000 and balance fee 0.3%) Tj'), D.SOURCES.PAYSLIP);
  assert.strictEqual(wrongDocument.status, 'wrong-document');
  console.log('✓ likely wrong document types are flagged without importing values');

  const oversized = await D.extract(new TestFile('large.pdf', 'application/pdf', '', D.MAX_FILE_BYTES + 1), D.SOURCES.PAYSLIP);
  assert.strictEqual(oversized.status, 'file-too-large');
  console.log('✓ configurable browser processing limit is enforced');

  const unsupported = await D.extract(new TestFile('notes.txt', 'text/plain', 'text'), D.SOURCES.PAYSLIP);
  assert.strictEqual(unsupported.status, 'unsupported-type');
  console.log('✓ unsupported document types receive an explicit fallback');

  console.log('All 10 document-model tests passed.');
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
