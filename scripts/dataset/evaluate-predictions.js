#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonl, evaluatePredictions } = require('./lib/dataset-core');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const predictionsPath = arg('--predictions');
if (!predictionsPath) {
  console.error('Usage: node scripts/dataset/evaluate-predictions.js --predictions <predictions.jsonl> [--split all|development|validation|unseen-template-test|golden-real-test] [--profile core|extended] [--text-layer-only] [--json-out <file>]');
  process.exit(2);
}

const projectRoot = path.resolve(__dirname, '..', '..');
const absolutePredictions = path.resolve(process.cwd(), predictionsPath);
const split = arg('--split', 'all');
const profile = arg('--profile', 'core');
const jsonOut = arg('--json-out');
const textLayerOnly = process.argv.includes('--text-layer-only');
const predictions = readJsonl(absolutePredictions);
const result = evaluatePredictions(projectRoot, predictions, { split, profile, textLayerOnly });

function pct(value) { return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`; }
console.log(`Documents: ${result.summary.documents}; predictions: ${result.summary.predictions}`);
console.log(`Field accuracy: ${pct(result.summary.field_accuracy)}`);
console.log(`Critical-document accuracy: ${pct(result.summary.critical_document_accuracy)}`);
console.log(`Validation accuracy: ${pct(result.summary.validation_accuracy)}`);
console.log(`Abstention accuracy: ${pct(result.summary.abstention_accuracy)} (${result.summary.abstention_examples} labeled absence cases)`);
console.log('\nBy family:');
for (const [family, metrics] of Object.entries(result.groups.family)) {
  console.log(`  ${family}: fields=${pct(metrics.field_accuracy)}, critical=${pct(metrics.critical_document_accuracy)}, validation=${pct(metrics.validation_accuracy)}, n=${metrics.documents}`);
}
if (jsonOut) {
  const absoluteOut = path.resolve(process.cwd(), jsonOut);
  fs.mkdirSync(path.dirname(absoluteOut), { recursive: true });
  fs.writeFileSync(absoluteOut, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${absoluteOut}`);
}
