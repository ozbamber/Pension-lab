#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { loadDataset, evaluatePredictions } = require('./lib/dataset-core');

const projectRoot = path.resolve(__dirname, '..', '..');
const dataset = loadDataset(projectRoot);
const refIndex = process.argv.indexOf('--before-ref');
const beforeRef = refIndex >= 0 && process.argv[refIndex + 1] ? process.argv[refIndex + 1] : 'HEAD^';

function sourceAt(ref, name) {
  if (ref === 'WORKTREE') return fs.readFileSync(path.join(projectRoot, 'app', name), 'utf8');
  return execFileSync('git', ['show', `${ref}:app/${name}`], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

function parserAt(ref) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const name of ['financial-normalizer.js', 'payslip-parser.js', 'pension-report-parser.js']) {
    vm.runInContext(sourceAt(ref, name), sandbox, { filename: `${ref}:${name}` });
  }
  return sandbox.window.PensionReportParser;
}

function evaluate(ref) {
  const parser = parserAt(ref);
  const predictions = [];
  let rawRows = 0;
  let normalizedMonths = 0;
  for (const record of dataset.records) {
    if (record.document_type !== 'pension_report' || !record.has_text_layer) continue;
    const text = fs.readFileSync(path.join(projectRoot, 'dataset', 'observations', 'pdf-text', `${record.id}.txt`), 'utf8');
    const parsed = parser.parsePensionReport(text, { method: 'pdf-text' });
    rawRows += parsed.contributionHistory?.length || 0;
    normalizedMonths += parsed.pensionReportState?.derived?.monthsUsed || 0;
    predictions.push({ id: record.id, fields: parsed.fields || {} });
  }
  const metrics = evaluatePredictions(projectRoot, predictions, { profile: 'core', textLayerOnly: true, documentType: 'pension_report' });
  return { metrics, rawRows, normalizedMonths };
}

function pct(value) { return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`; }
function points(after, before) { return `${((after - before) * 100).toFixed(1)} pp`; }
function aggregate(documents) {
  const fields = documents.flatMap((document) => document.fields);
  return {
    fields: fields.length ? fields.filter((field) => field.pass).length / fields.length : null,
    critical: documents.length ? documents.filter((document) => document.critical_document_pass).length / documents.length : null,
    documents: documents.length,
  };
}

const before = evaluate(beforeRef);
const after = evaluate('WORKTREE');
const beforeAnnual = aggregate(before.metrics.documents.filter((document) => document.family !== 'quarterly'));
const afterAnnual = aggregate(after.metrics.documents.filter((document) => document.family !== 'quarterly'));
const beforeQuarterly = aggregate(before.metrics.documents.filter((document) => document.family === 'quarterly'));
const afterQuarterly = aggregate(after.metrics.documents.filter((document) => document.family === 'quarterly'));

console.log(`Pension parser comparison: ${beforeRef} -> worktree`);
console.log(`  Field accuracy: ${pct(before.metrics.summary.field_accuracy)} -> ${pct(after.metrics.summary.field_accuracy)} (${points(after.metrics.summary.field_accuracy, before.metrics.summary.field_accuracy)})`);
console.log(`  Critical-document accuracy: ${pct(before.metrics.summary.critical_document_accuracy)} -> ${pct(after.metrics.summary.critical_document_accuracy)} (${points(after.metrics.summary.critical_document_accuracy, before.metrics.summary.critical_document_accuracy)})`);
console.log(`  Validation accuracy: ${pct(before.metrics.summary.validation_accuracy)} -> ${pct(after.metrics.summary.validation_accuracy)}`);
console.log(`  Annual: fields ${pct(beforeAnnual.fields)} -> ${pct(afterAnnual.fields)}; critical ${pct(beforeAnnual.critical)} -> ${pct(afterAnnual.critical)}; n=${afterAnnual.documents}`);
console.log(`  Quarterly: fields ${pct(beforeQuarterly.fields)} -> ${pct(afterQuarterly.fields)}; critical ${pct(beforeQuarterly.critical)} -> ${pct(afterQuarterly.critical)}; n=${afterQuarterly.documents}`);
console.log(`  Raw contribution rows: ${before.rawRows} -> ${after.rawRows}; reliable normalized months: ${before.normalizedMonths || 'n/a'} -> ${after.normalizedMonths}.`);
