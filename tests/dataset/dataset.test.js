'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadDataset,
  validateDataset,
  validateManifestRecord,
  validateGroundTruth,
  getPath,
  evaluatePredictions,
  arithmeticChecks,
  CORE_FIELDS,
} = require('../../scripts/dataset/lib/dataset-core');

const projectRoot = path.resolve(__dirname, '..', '..');
let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

test('dataset validates hashes, lineage, annotations and family-isolated unseen split', () => {
  const result = validateDataset(projectRoot);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.counts.documents, 66);
  assert.strictEqual(result.counts.groundTruth, 66);
  assert.strictEqual(result.counts.textLayer, 54);
  assert.strictEqual(result.counts.imageOnly, 12);
});

test('all 66 documents occur in exactly one split and golden-real is reserved', () => {
  const dataset = loadDataset(projectRoot);
  const assignments = new Map();
  for (const [name, split] of dataset.splits) {
    for (const id of split.document_ids) {
      assert.ok(!assignments.has(id), `${id} occurs in two splits`);
      assignments.set(id, name);
    }
  }
  assert.strictEqual(assignments.size, 66);
  assert.strictEqual(dataset.splits.get('golden-real-test').document_ids.length, 0);
});

test('augmented documents stay in the same split as their parent', () => {
  const dataset = loadDataset(projectRoot);
  const augmented = dataset.records.filter((record) => record.source_type === 'augmented');
  assert.strictEqual(augmented.length, 12);
  for (const record of augmented) {
    assert.ok(record.parent_document);
    assert.strictEqual(record.split, dataset.byId.get(record.parent_document).split);
  }
});

test('core profile only scores fields supported by the current parser contract', () => {
  assert.ok(CORE_FIELDS.payslip.includes('salary.pensionable_salary'));
  assert.ok(!CORE_FIELDS.payslip.includes('salary.net'));
  assert.ok(CORE_FIELDS.pension_report.includes('balances.closing'));
  assert.ok(!CORE_FIELDS.pension_report.includes('fees.fund_average.deposit_rate'));
});

test('perfect canonical predictions score 100 percent on core fields', () => {
  const dataset = loadDataset(projectRoot);
  const predictions = dataset.records.map((record) => {
    const gt = dataset.groundTruth.get(record.id);
    const prediction = { document_type: record.document_type };
    for (const field of CORE_FIELDS[record.document_type]) {
      const value = getPath(gt, field);
      if (value !== undefined) {
        const keys = field.split('.');
        let cursor = prediction;
        for (let index = 0; index < keys.length - 1; index += 1) cursor = cursor[keys[index]] ||= {};
        cursor[keys[keys.length - 1]] = value;
      }
    }
    return { id: record.id, document_type: record.document_type, prediction };
  });
  const result = evaluatePredictions(projectRoot, predictions, { profile: 'core' });
  assert.strictEqual(result.summary.field_accuracy, 1);
  assert.strictEqual(result.summary.critical_document_accuracy, 1);
  assert.strictEqual(result.summary.validation_accuracy, 1);
});

test('missing predictions reduce field and critical-document accuracy instead of being ignored', () => {
  const dataset = loadDataset(projectRoot);
  const record = dataset.records.find((item) => item.document_type === 'payslip' && item.split === 'development');
  const result = evaluatePredictions(projectRoot, [{ id: record.id, fields: {} }], { split: 'development', profile: 'core' });
  assert.ok(result.summary.field_accuracy < 1);
  assert.ok(result.summary.critical_document_accuracy < 1);
  assert.strictEqual(result.summary.validation_checks_run, 0);
  assert.strictEqual(result.summary.validation_checks_possible, result.summary.documents * 3);
  assert.strictEqual(result.summary.validation_coverage, 0);
});

test('validation distinguishes missing, null, partial, correct and inconsistent tuples', () => {
  const missing = arithmeticChecks({}, 'payslip');
  const explicitNull = arithmeticChecks({ salary: { pensionable_salary: null }, pension: { employee: { rate: null, amount: null } } }, 'payslip');
  const partial = arithmeticChecks({ salary: { pensionable_salary: 20000 }, pension: { employee: { rate: 0.06 } } }, 'payslip');
  const correct = arithmeticChecks({ salary: { pensionable_salary: 20000 }, pension: { employee: { rate: 0.06, amount: 1200 } } }, 'payslip');
  const inconsistent = arithmeticChecks({ salary: { pensionable_salary: 20000 }, pension: { employee: { rate: 0.06, amount: 1300 } } }, 'payslip');
  assert.strictEqual(missing.length, 0);
  assert.strictEqual(explicitNull.length, 0);
  assert.strictEqual(partial.length, 0);
  assert.strictEqual(correct.length, 1);
  assert.strictEqual(correct[0].pass, true);
  assert.strictEqual(inconsistent.length, 1);
  assert.strictEqual(inconsistent[0].pass, false);
});

test('manifest and ground-truth schema contracts fail closed', () => {
  const dataset = loadDataset(projectRoot);
  const record = dataset.records[0];
  assert.ok(validateManifestRecord({ ...record, source_type: 'synthethic' }).some((error) => /source_type/.test(error)));
  assert.ok(validateManifestRecord({ ...record, source_type: 'consented_real', distribution_authorized: false }).some((error) => /distribution_authorized/.test(error)));
  const groundTruth = dataset.groundTruth.get(record.id);
  assert.ok(validateGroundTruth({ ...groundTruth, schema_version: 1 }).some((error) => /schema_version/.test(error)));
  assert.ok(validateGroundTruth({ ...groundTruth, annotation: { ...groundTruth.annotation, annotated_fields: ['period', 'period'] } }).some((error) => /duplicate/.test(error)));
  assert.ok(validateGroundTruth({ ...groundTruth, annotation: { ...groundTruth.annotation, expected_absent_fields: ['x', 'x'] } }).some((error) => /duplicate/.test(error)));
});

console.log(`All ${passed} dataset tests passed.`);
