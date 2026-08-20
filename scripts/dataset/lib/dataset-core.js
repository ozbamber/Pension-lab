'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SPLIT_NAMES = ['development', 'validation', 'unseen-template-test', 'golden-real-test'];
const SOURCE_TYPES = ['official', 'public_example', 'consented_real', 'synthetic', 'augmented'];
const DOCUMENT_TYPES = ['payslip', 'pension_report'];
const QUALITY_VALUES = ['high', 'degraded'];
const DIGITAL_OR_SCAN_VALUES = ['digital', 'scan'];

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validateManifestRecord(record) {
  const errors = [];
  const id = record?.id || '<missing-id>';
  const requireString = (key, options = {}) => {
    if (typeof record?.[key] !== 'string' || (!options.allowEmpty && !record[key].length)) errors.push(`${id}: ${key} must be a non-empty string`);
  };
  if (!isPlainObject(record)) return ['<record>: manifest record must be an object'];
  if (typeof record.id !== 'string' || !/^pld2-[a-f0-9]{16}$/.test(record.id)) errors.push(`${id}: invalid id format`);
  if (!DOCUMENT_TYPES.includes(record.document_type)) errors.push(`${id}: invalid document_type`);
  requireString('path');
  if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) errors.push(`${id}: invalid sha256`);
  if (!SOURCE_TYPES.includes(record.source_type)) errors.push(`${id}: invalid source_type`);
  requireString('family');
  if (!SPLIT_NAMES.includes(record.split)) errors.push(`${id}: invalid split`);
  if (!QUALITY_VALUES.includes(record.quality)) errors.push(`${id}: invalid quality`);
  if (!DIGITAL_OR_SCAN_VALUES.includes(record.digital_or_scan)) errors.push(`${id}: invalid digital_or_scan`);
  if (typeof record.has_text_layer !== 'boolean') errors.push(`${id}: has_text_layer must be boolean`);
  requireString('license_or_consent');
  if (record.pages !== undefined && record.pages !== null && (!Number.isInteger(record.pages) || record.pages < 1)) errors.push(`${id}: pages must be a positive integer or null`);
  if (record.source_url !== undefined && record.source_url !== null && typeof record.source_url !== 'string') errors.push(`${id}: source_url must be a string or null`);
  if (record.parent_document !== undefined && record.parent_document !== null && typeof record.parent_document !== 'string') errors.push(`${id}: parent_document must be a string or null`);
  if (record.distribution_authorized !== undefined && typeof record.distribution_authorized !== 'boolean') errors.push(`${id}: distribution_authorized must be boolean`);
  if (record.source_type === 'consented_real' && record.distribution_authorized !== true) errors.push(`${id}: consented_real requires distribution_authorized=true`);
  return errors;
}

function validateGroundTruth(groundTruth) {
  const errors = [];
  const id = groundTruth?.id || '<missing-id>';
  if (!isPlainObject(groundTruth)) return ['<ground-truth>: record must be an object'];
  if (groundTruth.schema_version !== 2) errors.push(`${id}: schema_version must be 2`);
  if (typeof groundTruth.id !== 'string' || !groundTruth.id.length) errors.push(`${id}: id must be a non-empty string`);
  if (!DOCUMENT_TYPES.includes(groundTruth.document_type)) errors.push(`${id}: invalid document_type`);
  const annotation = groundTruth.annotation;
  if (!isPlainObject(annotation)) return errors.concat(`${id}: annotation must be an object`);
  for (const key of ['annotated_fields', 'expected_absent_fields']) {
    if (!Array.isArray(annotation[key]) || annotation[key].some((item) => typeof item !== 'string')) {
      errors.push(`${id}: annotation.${key} must be an array of strings`);
    } else if (new Set(annotation[key]).size !== annotation[key].length) {
      errors.push(`${id}: annotation.${key} contains duplicate fields`);
    }
  }
  if (annotation.evidence !== undefined && !isPlainObject(annotation.evidence)) errors.push(`${id}: annotation.evidence must be an object`);
  if (annotation.notes !== undefined && typeof annotation.notes !== 'string') errors.push(`${id}: annotation.notes must be a string`);
  return errors;
}

const CORE_FIELDS = Object.freeze({
  payslip: [
    'period',
    'salary.gross',
    'salary.pensionable_salary',
    'pension.employee.rate',
    'pension.employee.amount',
    'pension.employer.rate',
    'pension.employer.amount',
    'pension.severance.rate',
    'pension.severance.amount',
  ],
  pension_report: [
    'provider.name',
    'fees.personal.deposit_rate',
    'fees.personal.balance_rate',
    'balances.closing',
    'latest_contribution.salary',
    'latest_contribution.employee.rate',
    'latest_contribution.employee.amount',
    'latest_contribution.employer.rate',
    'latest_contribution.employer.amount',
    'latest_contribution.severance.rate',
    'latest_contribution.severance.amount',
  ],
});

const CRITICAL_FIELDS = Object.freeze({
  payslip: [
    'salary.pensionable_salary',
    'pension.employee.rate',
    'pension.employee.amount',
    'pension.employer.rate',
    'pension.employer.amount',
    'pension.severance.rate',
    'pension.severance.amount',
  ],
  pension_report: [
    'balances.closing',
    'fees.personal.deposit_rate',
    'fees.personal.balance_rate',
    'latest_contribution.salary',
    'latest_contribution.employee.amount',
    'latest_contribution.employer.amount',
    'latest_contribution.severance.amount',
  ],
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${filePath}:${index + 1}: ${error.message}`); }
  });
}

function getPath(object, dottedPath) {
  return String(dottedPath).split('.').reduce((value, key) => value == null ? undefined : value[key], object);
}

function setPath(object, dottedPath, value) {
  const keys = String(dottedPath).split('.');
  let cursor = object;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return object;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function datasetPaths(projectRoot) {
  const datasetRoot = path.join(projectRoot, 'dataset');
  return {
    datasetRoot,
    manifest: path.join(datasetRoot, 'metadata', 'manifest.jsonl'),
    groundTruth: path.join(datasetRoot, 'ground-truth'),
    splits: path.join(datasetRoot, 'splits'),
  };
}

function loadDataset(projectRoot) {
  const paths = datasetPaths(projectRoot);
  const records = readJsonl(paths.manifest);
  const byId = new Map(records.map((record) => [record.id, record]));
  const groundTruth = new Map();
  for (const record of records) {
    const gtPath = path.join(paths.groundTruth, `${record.id}.json`);
    if (fs.existsSync(gtPath)) groundTruth.set(record.id, readJson(gtPath));
  }
  const splits = new Map();
  for (const name of SPLIT_NAMES) {
    const splitPath = path.join(paths.splits, `${name}.json`);
    if (fs.existsSync(splitPath)) splits.set(name, readJson(splitPath));
  }
  return { projectRoot, paths, records, byId, groundTruth, splits };
}

function validateDataset(projectRoot, options = {}) {
  const dataset = loadDataset(projectRoot);
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const pathsSeen = new Set();
  const shaSeen = new Map();

  for (const record of dataset.records) {
    errors.push(...validateManifestRecord(record));
    if (!record.id) errors.push('Manifest record is missing id.');
    if (ids.has(record.id)) errors.push(`Duplicate id: ${record.id}`);
    ids.add(record.id);
    if (pathsSeen.has(record.path)) errors.push(`${record.id}: duplicate path ${record.path}`);
    pathsSeen.add(record.path);

    const absolute = path.join(projectRoot, record.path || '');
    if (!fs.existsSync(absolute)) {
      errors.push(`${record.id}: document is missing: ${record.path}`);
    } else if (!options.skipHashes) {
      const actual = sha256File(absolute);
      if (actual !== record.sha256) errors.push(`${record.id}: sha256 mismatch`);
      if (shaSeen.has(actual)) errors.push(`${record.id}: binary duplicate of ${shaSeen.get(actual)}`);
      else shaSeen.set(actual, record.id);
    }

    const gt = dataset.groundTruth.get(record.id);
    if (!gt) {
      errors.push(`${record.id}: ground truth is missing`);
    } else {
      errors.push(...validateGroundTruth(gt));
      if (gt.id !== record.id) errors.push(`${record.id}: ground-truth id mismatch`);
      if (gt.document_type !== record.document_type) errors.push(`${record.id}: ground-truth document_type mismatch`);
      const annotated = gt.annotation?.annotated_fields;
      if (!Array.isArray(annotated) || !annotated.length) errors.push(`${record.id}: annotated_fields must be a non-empty array`);
      else for (const field of annotated) {
        if (getPath(gt, field) === undefined) errors.push(`${record.id}: annotated field does not exist: ${field}`);
      }
    }

    if (record.source_type === 'augmented') {
      if (!record.parent_document) errors.push(`${record.id}: augmented document is missing parent_document`);
      else if (!dataset.byId.has(record.parent_document)) errors.push(`${record.id}: parent_document does not exist: ${record.parent_document}`);
    }
    if (record.source_type === 'consented_real' && record.distribution_authorized !== true) errors.push(`${record.id}: real/consented document cannot live in distributable dataset without distribution_authorized=true`);
    if (!record.family) warnings.push(`${record.id}: family is missing`);
    if (!record.license_or_consent) warnings.push(`${record.id}: license_or_consent is missing`);
  }

  const splitOf = new Map();
  for (const [name, split] of dataset.splits) {
    if (!Array.isArray(split.document_ids)) {
      errors.push(`${name}: document_ids must be an array`);
      continue;
    }
    for (const id of split.document_ids) {
      if (!dataset.byId.has(id)) errors.push(`${name}: unknown document id ${id}`);
      if (splitOf.has(id)) errors.push(`${id}: appears in multiple splits (${splitOf.get(id)}, ${name})`);
      splitOf.set(id, name);
    }
  }
  for (const record of dataset.records) {
    if (!splitOf.has(record.id)) errors.push(`${record.id}: not assigned to a split`);
    if (record.split && splitOf.get(record.id) !== record.split) errors.push(`${record.id}: manifest split ${record.split} differs from split file ${splitOf.get(record.id)}`);
    if (record.parent_document && splitOf.get(record.parent_document) !== splitOf.get(record.id)) {
      errors.push(`${record.id}: lineage leak - child split ${splitOf.get(record.id)} differs from parent split ${splitOf.get(record.parent_document)}`);
    }
  }

  const unseenFamilies = new Set(dataset.records.filter((record) => splitOf.get(record.id) === 'unseen-template-test').map((record) => record.family));
  for (const record of dataset.records) {
    if (splitOf.get(record.id) !== 'unseen-template-test' && unseenFamilies.has(record.family)) {
      errors.push(`${record.id}: unseen-template family ${record.family} leaks into ${splitOf.get(record.id)}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      documents: dataset.records.length,
      groundTruth: dataset.groundTruth.size,
      bySplit: Object.fromEntries([...dataset.splits].map(([name, split]) => [name, split.document_ids?.length || 0])),
      textLayer: dataset.records.filter((record) => record.has_text_layer).length,
      imageOnly: dataset.records.filter((record) => !record.has_text_layer).length,
    },
  };
}

function normalizeText(value) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function valueOf(item) {
  if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value')) return item.value;
  return item;
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function adaptPensionLabPrediction(line, record) {
  if (!line) return null;
  if (line.document_type && line.prediction) return line.prediction;
  const fields = line.fields || line.prediction?.fields || line;
  if (record.document_type === 'payslip') {
    return {
      document_type: 'payslip',
      period: valueOf(fields.payslipMonth),
      salary: {
        gross: valueOf(fields.grossSalary),
        pensionable_salary: valueOf(fields.insuredSalary),
      },
      pension: {
        employee: { rate: valueOf(fields.employeeContributionRate), amount: valueOf(fields.employeeContributionAmount) },
        employer: { rate: valueOf(fields.employerContributionRate), amount: valueOf(fields.employerContributionAmount) },
        severance: { rate: valueOf(fields.severanceRate), amount: valueOf(fields.severanceContributionAmount) },
      },
    };
  }
  return {
    document_type: 'pension_report',
    provider: { name: valueOf(fields.pensionProvider) },
    fees: {
      personal: {
        deposit_rate: valueOf(fields.depositManagementFeeRate),
        balance_rate: valueOf(fields.balanceManagementFeeRate),
      },
    },
    balances: { closing: valueOf(fields.currentBalance) },
    latest_contribution: {
      salary: valueOf(fields.latestReportedPensionableSalary),
      employee: { rate: valueOf(fields.latestEmployeeContributionRate), amount: valueOf(fields.latestEmployeeContributionAmount) },
      employer: { rate: valueOf(fields.latestEmployerContributionRate), amount: valueOf(fields.latestEmployerContributionAmount) },
      severance: { rate: valueOf(fields.latestSeveranceRate), amount: valueOf(fields.latestSeveranceContributionAmount) },
    },
  };
}

function toleranceFor(field, expected) {
  if (/\.rate$|_rate$/.test(field)) return { absolute: 0.0008, relative: 0.025 };
  if (typeof expected === 'number') return { absolute: 2, relative: 0.005 };
  return null;
}

function valuesMatch(field, expected, actual) {
  if (expected == null) return actual == null;
  if (typeof expected === 'number') {
    const numeric = finiteNumber(actual);
    if (numeric === null) return false;
    const tolerance = toleranceFor(field, expected);
    const difference = Math.abs(expected - numeric);
    return difference <= tolerance.absolute || difference <= Math.max(Math.abs(expected), Math.abs(numeric)) * tolerance.relative;
  }
  return normalizeText(expected) === normalizeText(actual);
}

function arithmeticChecks(prediction, documentType) {
  const base = documentType === 'payslip' ? 'pension' : 'latest_contribution';
  const salaryPath = documentType === 'payslip' ? 'salary.pensionable_salary' : 'latest_contribution.salary';
  const salary = finiteNumber(getPath(prediction, salaryPath));
  const checks = [];
  for (const role of ['employee', 'employer', 'severance']) {
    const rate = finiteNumber(getPath(prediction, `${base}.${role}.rate`));
    const amount = finiteNumber(getPath(prediction, `${base}.${role}.amount`));
    if ([salary, rate, amount].some((value) => value === null)) continue;
    const expectedAmount = salary * rate;
    const difference = Math.abs(expectedAmount - amount);
    const pass = difference <= 2 || difference <= Math.max(Math.abs(expectedAmount), Math.abs(amount)) * 0.01;
    checks.push({ role, pass, salary, rate, amount, expectedAmount });
  }
  return checks;
}

const ARITHMETIC_ROLE_PATHS = Object.freeze({
  payslip: Object.freeze({
    salary: 'salary.pensionable_salary',
    employee: Object.freeze({ rate: 'pension.employee.rate', amount: 'pension.employee.amount' }),
    employer: Object.freeze({ rate: 'pension.employer.rate', amount: 'pension.employer.amount' }),
    severance: Object.freeze({ rate: 'pension.severance.rate', amount: 'pension.severance.amount' }),
  }),
  pension_report: Object.freeze({
    salary: 'latest_contribution.salary',
    employee: Object.freeze({ rate: 'latest_contribution.employee.rate', amount: 'latest_contribution.employee.amount' }),
    employer: Object.freeze({ rate: 'latest_contribution.employer.rate', amount: 'latest_contribution.employer.amount' }),
    severance: Object.freeze({ rate: 'latest_contribution.severance.rate', amount: 'latest_contribution.severance.amount' }),
  }),
});

function validationChecksPossible(groundTruth, documentType) {
  const paths = ARITHMETIC_ROLE_PATHS[documentType];
  if (!paths) return 0;
  const annotated = new Set(groundTruth?.annotation?.annotated_fields || []);
  const absent = new Set(groundTruth?.annotation?.expected_absent_fields || []);
  const expected = (fieldPath) => annotated.has(fieldPath) && !absent.has(fieldPath) && finiteNumber(getPath(groundTruth, fieldPath)) !== null;
  if (!expected(paths.salary)) return 0;
  return ['employee', 'employer', 'severance'].filter((role) => expected(paths[role].rate) && expected(paths[role].amount)).length;
}

function groupKey(record, dimension) {
  if (dimension === 'document_type') return record.document_type;
  if (dimension === 'family') return record.family || 'unknown';
  if (dimension === 'source_type') return record.source_type || 'unknown';
  if (dimension === 'split') return record.split || 'unknown';
  if (dimension === 'quality') return record.quality || 'unknown';
  if (dimension === 'text_layer') return record.has_text_layer ? 'text-layer' : 'image-only';
  return 'all';
}

function evaluatePredictions(projectRoot, predictionLines, options = {}) {
  const dataset = loadDataset(projectRoot);
  const split = options.split || 'all';
  const profile = options.profile || 'core';
  const predictions = new Map(predictionLines.map((line) => [line.id, line]));
  const selected = dataset.records.filter((record) => (split === 'all' || record.split === split) && (!options.textLayerOnly || record.has_text_layer));
  const perDocument = [];
  let fieldCorrect = 0;
  let fieldTotal = 0;
  let criticalCorrect = 0;
  let criticalTotal = 0;
  let validationCorrect = 0;
  let validationRun = 0;
  let validationPossible = 0;
  let abstentionCorrect = 0;
  let abstentionTotal = 0;

  for (const record of selected) {
    const gt = dataset.groundTruth.get(record.id);
    const documentValidationPossible = validationChecksPossible(gt, record.document_type);
    validationPossible += documentValidationPossible;
    const line = predictions.get(record.id);
    const prediction = adaptPensionLabPrediction(line, record) || {};
    const annotated = gt.annotation?.annotated_fields || [];
    const fields = profile === 'extended' ? annotated : CORE_FIELDS[record.document_type].filter((field) => annotated.includes(field));
    const results = [];
    for (const field of fields) {
      const expected = getPath(gt, field);
      const actual = getPath(prediction, field);
      const pass = valuesMatch(field, expected, actual);
      results.push({ field, expected, actual: actual === undefined ? null : actual, pass });
      fieldTotal += 1;
      if (pass) fieldCorrect += 1;
    }
    const criticalFields = CRITICAL_FIELDS[record.document_type].filter((field) => fields.includes(field));
    const criticalPass = criticalFields.length > 0 && criticalFields.every((field) => results.find((result) => result.field === field)?.pass);
    criticalTotal += 1;
    if (criticalPass) criticalCorrect += 1;

    const arithmetic = arithmeticChecks(prediction, record.document_type);
    for (const check of arithmetic) {
      validationRun += 1;
      if (check.pass) validationCorrect += 1;
    }

    const expectedAbsent = gt.annotation?.expected_absent_fields || [];
    for (const field of expectedAbsent) {
      abstentionTotal += 1;
      const actual = getPath(prediction, field);
      if (actual == null) abstentionCorrect += 1;
    }

    perDocument.push({
      id: record.id,
      document_type: record.document_type,
      family: record.family,
      split: record.split,
      source_type: record.source_type,
      quality: record.quality,
      has_text_layer: record.has_text_layer,
      has_prediction: Boolean(line),
      fields: results,
      field_accuracy: results.length ? results.filter((result) => result.pass).length / results.length : null,
      critical_document_pass: criticalPass,
      arithmetic_checks: arithmetic,
      validation_checks_possible: documentValidationPossible,
    });
  }

  function aggregate(records) {
    const fieldRows = records.flatMap((record) => record.fields);
    const arithmetic = records.flatMap((record) => record.arithmetic_checks);
    const possible = records.reduce((sum, record) => sum + record.validation_checks_possible, 0);
    const run = arithmetic.length;
    return {
      documents: records.length,
      predictions: records.filter((record) => record.has_prediction).length,
      field_accuracy: fieldRows.length ? fieldRows.filter((row) => row.pass).length / fieldRows.length : null,
      critical_document_accuracy: records.length ? records.filter((record) => record.critical_document_pass).length / records.length : null,
      validation_accuracy: run ? arithmetic.filter((row) => row.pass).length / run : null,
      validation_checks_passed: arithmetic.filter((row) => row.pass).length,
      validation_checks_run: run,
      validation_checks_possible: possible,
      validation_coverage: possible ? run / possible : null,
    };
  }

  const dimensions = ['document_type', 'family', 'source_type', 'split', 'quality', 'text_layer'];
  const groups = {};
  for (const dimension of dimensions) {
    const buckets = new Map();
    for (const item of perDocument) {
      const record = dataset.byId.get(item.id);
      const key = groupKey(record, dimension);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    groups[dimension] = Object.fromEntries([...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => [key, aggregate(items)]));
  }

  return {
    schema_version: 1,
    evaluated_at: new Date().toISOString(),
    split,
    profile,
    summary: {
      documents: selected.length,
      predictions: selected.filter((record) => predictions.has(record.id)).length,
      field_accuracy: fieldTotal ? fieldCorrect / fieldTotal : null,
      critical_document_accuracy: criticalTotal ? criticalCorrect / criticalTotal : null,
      validation_accuracy: validationRun ? validationCorrect / validationRun : null,
      validation_checks_passed: validationCorrect,
      validation_checks_run: validationRun,
      validation_checks_possible: validationPossible,
      validation_coverage: validationPossible ? validationRun / validationPossible : null,
      abstention_accuracy: abstentionTotal ? abstentionCorrect / abstentionTotal : null,
      abstention_examples: abstentionTotal,
    },
    groups,
    documents: perDocument,
  };
}

module.exports = {
  SPLIT_NAMES,
  CORE_FIELDS,
  CRITICAL_FIELDS,
  readJson,
  readJsonl,
  getPath,
  setPath,
  loadDataset,
  validateManifestRecord,
  validateGroundTruth,
  validateDataset,
  adaptPensionLabPrediction,
  valuesMatch,
  arithmeticChecks,
  validationChecksPossible,
  finiteNumber,
  evaluatePredictions,
};
