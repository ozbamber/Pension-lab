#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadDataset, evaluatePredictions } = require('./lib/dataset-core');

function loadParsers(projectRoot) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const name of ['financial-normalizer.js', 'payslip-parser.js', 'pension-report-parser.js']) {
    const filePath = path.join(projectRoot, 'app', name);
    if (!fs.existsSync(filePath)) throw new Error(`Missing parser dependency: ${filePath}`);
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath });
  }
  return {
    payslip: sandbox.window.PensionPayslipParser,
    pension: sandbox.window.PensionReportParser,
  };
}

function parserFields(parsed) {
  return parsed && parsed.fields ? parsed.fields : {};
}

const projectRoot = path.resolve(__dirname, '..', '..');
const dataset = loadDataset(projectRoot);
const parsers = loadParsers(projectRoot);
const predictions = [];
let eligible = 0;
for (const record of dataset.records) {
  if (!record.has_text_layer) continue;
  eligible += 1;
  const textPath = path.join(projectRoot, 'dataset', 'observations', 'pdf-text', `${record.id}.txt`);
  if (!fs.existsSync(textPath)) throw new Error(`Missing text observation for ${record.id}`);
  const text = fs.readFileSync(textPath, 'utf8');
  const parsed = record.document_type === 'payslip'
    ? parsers.payslip.parsePayslip(text, { method: 'pdf-text' })
    : parsers.pension.parsePensionReport(text, { method: 'pdf-text' });
  predictions.push({ id: record.id, fields: parserFields(parsed) });
}

const result = evaluatePredictions(projectRoot, predictions, { profile: 'core', textLayerOnly: true });
function pct(value) { return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`; }
console.log(`Fast text-layer parser benchmark: ${eligible} eligible documents`);
console.log(`Field accuracy: ${pct(result.summary.field_accuracy)}`);
console.log(`Critical-document accuracy: ${pct(result.summary.critical_document_accuracy)}`);
console.log(`Validation accuracy: ${pct(result.summary.validation_accuracy)}`);
console.log('By family:');
for (const [family, metrics] of Object.entries(result.groups.family)) {
  console.log(`  ${family}: fields=${pct(metrics.field_accuracy)}, critical=${pct(metrics.critical_document_accuracy)}, n=${metrics.documents}`);
}

const outIndex = process.argv.indexOf('--json-out');
if (outIndex >= 0 && process.argv[outIndex + 1]) {
  const output = path.resolve(process.cwd(), process.argv[outIndex + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${output}`);
}
