#!/usr/bin/env node
'use strict';

const path = require('path');
const { validateDataset } = require('./lib/dataset-core');

const projectRoot = path.resolve(__dirname, '..', '..');
const skipHashes = process.argv.includes('--skip-hashes');
const result = validateDataset(projectRoot, { skipHashes });

console.log(`Dataset documents: ${result.counts.documents}`);
console.log(`Ground truth: ${result.counts.groundTruth}`);
console.log(`Splits: ${Object.entries(result.counts.bySplit).map(([name, count]) => `${name}=${count}`).join(', ')}`);
console.log(`Text layer: ${result.counts.textLayer}; image-only: ${result.counts.imageOnly}`);
for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
if (!result.ok) {
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log('Dataset validation passed.');
}
