#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadDataset, evaluatePredictions, evaluatePensionReportExtraction } = require('./lib/dataset-core');
const { printPensionExtractionMetrics } = require('./lib/benchmark-report');

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
const pensionStates = new Map();
const splitIndex = process.argv.indexOf('--split');
const split = splitIndex >= 0 && process.argv[splitIndex + 1] ? process.argv[splitIndex + 1] : 'all';
let eligible = 0;
for (const record of dataset.records) {
  if (!record.has_text_layer || (split !== 'all' && record.split !== split)) continue;
  eligible += 1;
  const textPath = path.join(projectRoot, 'dataset', 'observations', 'pdf-text', `${record.id}.txt`);
  if (!fs.existsSync(textPath)) throw new Error(`Missing text observation for ${record.id}`);
  const text = fs.readFileSync(textPath, 'utf8');
  const parsed = record.document_type === 'payslip'
    ? parsers.payslip.parsePayslip(text, { method: 'pdf-text' })
    : parsers.pension.parsePensionReport(text, { method: 'pdf-text' });
  if (record.document_type === 'pension_report') pensionStates.set(record.id, parsed.pensionReportState || null);
  predictions.push({ id: record.id, fields: parserFields(parsed), pensionReportState: parsed.pensionReportState || null, method: 'pdf-text' });
}

const result = evaluatePredictions(projectRoot, predictions, { profile: 'core', textLayerOnly: true, split });
const extractionMetrics = evaluatePensionReportExtraction(projectRoot, predictions, { textLayerOnly: true, split });
function pct(value) { return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`; }
console.log(`Fast text-layer parser benchmark: ${eligible} eligible documents`);
console.log(`Field accuracy: ${pct(result.summary.field_accuracy)}`);
console.log(`Critical-document accuracy: ${pct(result.summary.critical_document_accuracy)}`);
console.log(`Validation accuracy: ${pct(result.summary.validation_accuracy)}`);
console.log(`Validation checks: ${result.summary.validation_checks_passed}/${result.summary.validation_checks_run} passed; ${result.summary.validation_checks_run}/${result.summary.validation_checks_possible} run; coverage=${pct(result.summary.validation_coverage)}`);
console.log('By family:');
for (const [family, metrics] of Object.entries(result.groups.family)) {
  console.log(`  ${family}: fields=${pct(metrics.field_accuracy)}, critical=${pct(metrics.critical_document_accuracy)}, n=${metrics.documents}`);
}

function aggregateDocuments(documents) {
  const fields = documents.flatMap((document) => document.fields);
  return {
    documents: documents.length,
    fieldAccuracy: fields.length ? fields.filter((field) => field.pass).length / fields.length : null,
    criticalAccuracy: documents.length ? documents.filter((document) => document.critical_document_pass).length / documents.length : null,
    extractionCoverage: documents.length ? documents.filter((document) => document.has_prediction).length / documents.length : null,
  };
}

const pensionMetrics = result.groups.document_type.pension_report;
const pensionDocuments = result.documents.filter((document) => document.document_type === 'pension_report');
const annualMetrics = aggregateDocuments(pensionDocuments.filter((document) => document.family !== 'quarterly'));
const quarterlyMetrics = aggregateDocuments(pensionDocuments.filter((document) => document.family === 'quarterly'));
const pensionRecords = dataset.records.filter((record) => record.document_type === 'pension_report');
const annotatedHistoryRecords = pensionRecords.filter((record) => {
  const groundTruth = dataset.groundTruth.get(record.id);
  return Array.isArray(groundTruth?.contribution_history) && groundTruth.contribution_history.length > 0 &&
    (groundTruth.annotation?.annotated_fields || []).some((field) => field.startsWith('contribution_history'));
});
const extractedRows = [...pensionStates.values()].reduce((sum, state) => sum + (state?.contributionHistory?.length || 0), 0);
const reliableMonths = [...pensionStates.values()].reduce((sum, state) => sum + (state?.derived?.monthsUsed || 0), 0);

console.log('Pension reports only:');
console.log(`  Documents: ${pensionMetrics.documents}`);
console.log(`  Field accuracy: ${pct(pensionMetrics.field_accuracy)}`);
console.log(`  Critical-document accuracy: ${pct(pensionMetrics.critical_document_accuracy)}`);
console.log(`  Extraction coverage: ${pensionMetrics.predictions}/${pensionMetrics.documents} (${pct(pensionMetrics.predictions / pensionMetrics.documents)})`);
console.log(`  Validation: ${pensionMetrics.validation_checks_passed}/${pensionMetrics.validation_checks_run}; coverage=${pct(pensionMetrics.validation_coverage)}`);
console.log(`  Annual: fields=${pct(annualMetrics.fieldAccuracy)}, critical=${pct(annualMetrics.criticalAccuracy)}, coverage=${pct(annualMetrics.extractionCoverage)}, n=${annualMetrics.documents}`);
console.log(`  Quarterly: fields=${pct(quarterlyMetrics.fieldAccuracy)}, critical=${pct(quarterlyMetrics.criticalAccuracy)}, coverage=${pct(quarterlyMetrics.extractionCoverage)}, n=${quarterlyMetrics.documents}`);
console.log(`  Text-layer: fields=${pct(pensionMetrics.field_accuracy)}, critical=${pct(pensionMetrics.critical_document_accuracy)}, n=${pensionMetrics.documents}`);
console.log('  Image-only: n/a in the text-layer benchmark (run dataset:benchmark:browser).');
console.log('Contribution-history annotation:');
console.log(`  Extracted raw rows: ${extractedRows}; reliable normalized months: ${reliableMonths}.`);
console.log(`  Dataset v2 annotated history coverage: ${annotatedHistoryRecords.length}/${pensionRecords.length} pension reports.`);
printPensionExtractionMetrics(extractionMetrics, 'Safety-aware text-layer pension benchmark');

const outIndex = process.argv.indexOf('--json-out');
if (outIndex >= 0 && process.argv[outIndex + 1]) {
  const output = path.resolve(process.cwd(), process.argv[outIndex + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ coreMetrics: result, extractionMetrics, predictions }, null, 2)}\n`);
  console.log(`Wrote ${output}`);
}
