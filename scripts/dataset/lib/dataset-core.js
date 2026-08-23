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
  if (groundTruth.document_type === 'pension_report') errors.push(...validatePensionContributionGroundTruth(groundTruth));
  return errors;
}

const CONTRIBUTION_FIELDS = Object.freeze([
  'salaryMonth',
  'reportedSalary',
  'employeeContribution',
  'employerContribution',
  'severanceContribution',
  'totalContribution',
]);
const CONTRIBUTION_AMOUNT_FIELDS = Object.freeze(CONTRIBUTION_FIELDS.filter((field) => field !== 'salaryMonth'));
const CONTRIBUTION_ROW_CLASSIFICATIONS = new Set(['true_monthly', 'duplicate', 'correction_conflict', 'late_deposit', 'incomplete_valid']);
const CONTRIBUTION_DISPOSITIONS = new Set(['included', 'duplicate_count_once', 'ambiguous', 'excluded']);
const CONTRIBUTION_ANNOTATION_FIELDS = Object.freeze([
  'contribution_history',
  'contributionTableGroundTruth',
  'normalizedContributionMonths',
  'expectedBaselineMonthlyContribution',
  'expectedAverageReportedPensionSalary',
  'expectedEmployeeContributionRate',
  'expectedEmployerContributionRate',
  'expectedSeveranceRate',
]);

function arithmeticTotalPass(row) {
  const components = ['employeeContribution', 'employerContribution', 'severanceContribution'].map((field) => finiteNumber(row?.[field]));
  const total = finiteNumber(row?.totalContribution);
  if (total === null || components.some((value) => value === null)) return true;
  const componentSum = components.reduce((sum, value) => sum + value, 0);
  const difference = Math.abs(componentSum - total);
  return difference <= 0.06 || difference <= Math.max(Math.abs(componentSum), Math.abs(total)) * 0.0001;
}

function validateContributionAmounts(row, id, prefix, errors) {
  for (const field of CONTRIBUTION_AMOUNT_FIELDS) {
    const value = row?.[field];
    if (value !== null && (!Number.isFinite(value) || value < 0)) errors.push(`${id}: ${prefix}.${field} must be a non-negative number or null`);
  }
  if (!arithmeticTotalPass(row)) errors.push(`${id}: ${prefix} totalContribution disagrees with its three components`);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function expectedMean(months, field) {
  const values = months.map((month) => finiteNumber(month?.[field])).filter((value) => value !== null);
  return mean(values);
}

function expectedRateMean(months, field) {
  const rates = months.map((month) => {
    const salary = finiteNumber(month?.reportedSalary);
    const amount = finiteNumber(month?.[field]);
    return salary > 0 && amount !== null ? amount / salary : null;
  }).filter((value) => value !== null);
  return mean(rates);
}

function nearlyEqual(left, right, tolerance = 0.000001) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function validatePensionContributionGroundTruth(groundTruth) {
  const errors = [];
  const id = groundTruth?.id || '<missing-id>';
  const annotated = new Set(groundTruth?.annotation?.annotated_fields || []);
  for (const field of CONTRIBUTION_ANNOTATION_FIELDS) {
    if (!annotated.has(field)) errors.push(`${id}: annotation.annotated_fields must include ${field}`);
  }
  if (!Array.isArray(groundTruth.contribution_history) || !groundTruth.contribution_history.length) {
    errors.push(`${id}: contribution_history must contain directly annotated monthly rows`);
  } else {
    groundTruth.contribution_history.forEach((row, index) => {
      const prefix = `contribution_history.${index}`;
      if (!isPlainObject(row)) { errors.push(`${id}: ${prefix} must be an object`); return; }
      if (typeof row.salaryMonth !== 'string' || !/^(0[1-9]|1[0-2])\/20\d{2}$/.test(row.salaryMonth)) errors.push(`${id}: ${prefix}.salaryMonth must be MM/YYYY`);
      if (row.depositDate !== null && (typeof row.depositDate !== 'string' || !/^[0-3]\d\/(0[1-9]|1[0-2])\/20\d{2}$/.test(row.depositDate))) errors.push(`${id}: ${prefix}.depositDate must be DD/MM/YYYY or null`);
      if (row.employerName !== null && typeof row.employerName !== 'string') errors.push(`${id}: ${prefix}.employerName must be a string or null`);
      if (!CONTRIBUTION_ROW_CLASSIFICATIONS.has(row.rowClassification)) errors.push(`${id}: ${prefix}.rowClassification is invalid`);
      if (!CONTRIBUTION_DISPOSITIONS.has(row.normalizationDisposition)) errors.push(`${id}: ${prefix}.normalizationDisposition is invalid`);
      if (!Number.isInteger(row.sourcePage) || row.sourcePage < 1) errors.push(`${id}: ${prefix}.sourcePage must be a positive integer`);
      if (!Array.isArray(row.intentionallyAbsentFields)) errors.push(`${id}: ${prefix}.intentionallyAbsentFields must be an array`);
      else for (const absentField of row.intentionallyAbsentFields) {
        if (!['depositDate', 'employerName', ...CONTRIBUTION_AMOUNT_FIELDS].includes(absentField)) errors.push(`${id}: ${prefix}.intentionallyAbsentFields contains ${absentField}`);
        else if (row[absentField] !== null) errors.push(`${id}: ${prefix}.${absentField} is marked intentionally absent but is not null`);
      }
      validateContributionAmounts(row, id, prefix, errors);
    });
  }
  const tableTruth = groundTruth.contributionTableGroundTruth;
  if (!isPlainObject(tableTruth)) errors.push(`${id}: contributionTableGroundTruth must be an object`);
  else {
    if (!Number.isInteger(tableTruth.expectedTables) || tableTruth.expectedTables < 1) errors.push(`${id}: contributionTableGroundTruth.expectedTables must be positive`);
    if (!Array.isArray(tableTruth.excludedRows)) errors.push(`${id}: contributionTableGroundTruth.excludedRows must be an array`);
    if (tableTruth.printedTableTotals !== null && !isPlainObject(tableTruth.printedTableTotals)) errors.push(`${id}: contributionTableGroundTruth.printedTableTotals must be an object or null`);
  }
  const months = groundTruth.normalizedContributionMonths;
  if (!Array.isArray(months) || !months.length) errors.push(`${id}: normalizedContributionMonths must be a non-empty array`);
  else {
    const seen = new Set();
    months.forEach((month, index) => {
      const prefix = `normalizedContributionMonths.${index}`;
      if (!isPlainObject(month)) { errors.push(`${id}: ${prefix} must be an object`); return; }
      if (typeof month.salaryMonth !== 'string' || !/^(0[1-9]|1[0-2])\/20\d{2}$/.test(month.salaryMonth)) errors.push(`${id}: ${prefix}.salaryMonth must be MM/YYYY`);
      if (seen.has(month.salaryMonth)) errors.push(`${id}: normalizedContributionMonths contains duplicate ${month.salaryMonth}`);
      seen.add(month.salaryMonth);
      validateContributionAmounts(month, id, prefix, errors);
    });
    const expectations = [
      ['expectedBaselineMonthlyContribution', expectedMean(months, 'totalContribution'), 0.01],
      ['expectedAverageReportedPensionSalary', expectedMean(months, 'reportedSalary'), 0.01],
      ['expectedEmployeeContributionRate', expectedRateMean(months, 'employeeContribution'), 0.000001],
      ['expectedEmployerContributionRate', expectedRateMean(months, 'employerContribution'), 0.000001],
      ['expectedSeveranceRate', expectedRateMean(months, 'severanceContribution'), 0.000001],
    ];
    for (const [field, expected, tolerance] of expectations) {
      if (!nearlyEqual(Number(groundTruth[field]), expected, tolerance)) errors.push(`${id}: ${field} is inconsistent with normalizedContributionMonths`);
    }
  }
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
      else if (record.document_type === 'pension_report') {
        const parentTruth = dataset.groundTruth.get(record.parent_document);
        const childTruth = dataset.groundTruth.get(record.id);
        for (const field of CONTRIBUTION_ANNOTATION_FIELDS) {
          if (JSON.stringify(parentTruth?.[field]) !== JSON.stringify(childTruth?.[field])) {
            errors.push(`${record.id}: augmented contribution truth ${field} differs from parent ${record.parent_document}`);
          }
        }
      }
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
  const selected = dataset.records.filter((record) =>
    (split === 'all' || record.split === split) &&
    (!options.textLayerOnly || record.has_text_layer) &&
    (!options.documentType || record.document_type === options.documentType));
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

function predictionState(line) {
  return line?.pensionReportState || line?.prediction?.pensionReportState || null;
}

function predictionFields(line) {
  return line?.fields || line?.prediction?.fields || line?.prediction || {};
}

function extractedFieldValue(line, fieldName) {
  const fields = predictionFields(line);
  return valueOf(fields?.[fieldName]);
}

function pensionActuals(line) {
  const state = predictionState(line) || {};
  return {
    currentBalance: finiteNumber(state.currentBalance) ?? finiteNumber(extractedFieldValue(line, 'currentBalance')),
    depositManagementFeeRate: finiteNumber(state.fees?.depositRate) ?? finiteNumber(extractedFieldValue(line, 'depositManagementFeeRate')),
    balanceManagementFeeRate: finiteNumber(state.fees?.balanceRate) ?? finiteNumber(extractedFieldValue(line, 'balanceManagementFeeRate')),
    contributionHistory: Array.isArray(state.contributionHistory) ? state.contributionHistory : [],
    normalizedContributionMonths: Array.isArray(state.normalizedContributionMonths) ? state.normalizedContributionMonths : [],
    baselineMonthlyContribution: finiteNumber(state.derived?.baselineMonthlyContribution),
    averageReportedPensionSalary: finiteNumber(state.derived?.averageReportedPensionSalary),
    employeeContributionRate: finiteNumber(state.derived?.employeeContributionRate),
    employerContributionRate: finiteNumber(state.derived?.employerContributionRate),
    severanceRate: finiteNumber(state.derived?.severanceRate),
  };
}

function contributionValueMatch(field, expected, actual) {
  if (expected === null) return actual === null || actual === undefined;
  if (field === 'salaryMonth') return normalizeText(expected) === normalizeText(actual);
  return valuesMatch(`contribution.${field}`, expected, actual);
}

function contributionPairScore(expected, actual) {
  const month = contributionValueMatch('salaryMonth', expected?.salaryMonth, actual?.salaryMonth);
  const amountMatches = CONTRIBUTION_AMOUNT_FIELDS.filter((field) => contributionValueMatch(field, expected?.[field], actual?.[field])).length;
  const employer = expected?.employerName == null || actual?.employerName == null ? 0 : (normalizeText(expected.employerName) === normalizeText(actual.employerName) ? 0.5 : 0);
  const depositDate = expected?.depositDate == null || actual?.depositDate == null ? 0 : (normalizeText(expected.depositDate) === normalizeText(actual.depositDate) ? 0.5 : 0);
  return { eligible: month || amountMatches >= 3, score: (month ? 6 : 0) + amountMatches + employer + depositDate, month, amountMatches };
}

function matchContributionRows(expectedRows, actualRows) {
  const expected = Array.isArray(expectedRows) ? expectedRows : [];
  const actual = Array.isArray(actualRows) ? actualRows : [];
  const candidates = [];
  expected.forEach((expectedRow, expectedIndex) => actual.forEach((actualRow, actualIndex) => {
    const score = contributionPairScore(expectedRow, actualRow);
    if (score.eligible) candidates.push({ expectedIndex, actualIndex, ...score });
  }));
  candidates.sort((left, right) => right.score - left.score || Number(right.month) - Number(left.month) || right.amountMatches - left.amountMatches);
  const usedExpected = new Set();
  const usedActual = new Set();
  const pairs = [];
  for (const candidate of candidates) {
    if (usedExpected.has(candidate.expectedIndex) || usedActual.has(candidate.actualIndex)) continue;
    usedExpected.add(candidate.expectedIndex);
    usedActual.add(candidate.actualIndex);
    pairs.push({
      expectedIndex: candidate.expectedIndex,
      actualIndex: candidate.actualIndex,
      expected: expected[candidate.expectedIndex],
      actual: actual[candidate.actualIndex],
    });
  }
  return {
    pairs,
    unmatchedExpected: expected.map((row, index) => ({ row, index })).filter((item) => !usedExpected.has(item.index)),
    unmatchedActual: actual.map((row, index) => ({ row, index })).filter((item) => !usedActual.has(item.index)),
  };
}

function rowFullyCorrect(expected, actual) {
  return CONTRIBUTION_FIELDS.every((field) => contributionValueMatch(field, expected?.[field], actual?.[field]));
}

function legacyAutomaticDecision(line, actual) {
  const state = predictionState(line);
  if (!state) return false;
  const required = [actual.currentBalance, actual.depositManagementFeeRate, actual.balanceManagementFeeRate, actual.baselineMonthlyContribution];
  if (required.some((value) => value === null) || !actual.normalizedContributionMonths.length) return false;
  if (state.review?.requiresReview === true) return false;
  const fields = predictionFields(line);
  for (const name of ['currentBalance', 'depositManagementFeeRate', 'balanceManagementFeeRate']) {
    if (fields?.[name]?.requiresConfirmation === true) return false;
  }
  return true;
}

function automaticDecision(line, actual) {
  const state = predictionState(line);
  const policyEligible = [actual.currentBalance, actual.depositManagementFeeRate, actual.balanceManagementFeeRate, actual.baselineMonthlyContribution]
    .every((value) => value !== null) && actual.normalizedContributionMonths.length > 0 &&
    state?.extraction?.tableTotalReconciliation?.pass !== false &&
    !actual.contributionHistory.some((row) => row.normalizationStatus === 'ambiguous');
  if (typeof state?.decision?.automaticAccepted === 'boolean') {
    const high = state.decision.confidenceBand === 'HIGH' || state.confidence?.overall === 'HIGH';
    return state.decision.automaticAccepted && high && policyEligible;
  }
  if (typeof line?.automaticAccepted === 'boolean') return line.automaticAccepted && policyEligible;
  return legacyAutomaticDecision(line, actual);
}

function extractionEvidence(line, actual) {
  const state = predictionState(line) || {};
  const extraction = state.extraction || {};
  const tables = Array.isArray(extraction.tables) ? extraction.tables : [];
  const rawRows = actual.contributionHistory;
  const inferredTable = rawRows.length ? 1 : 0;
  const tableDetected = tables.length > 0 || inferredTable > 0;
  const headerDetected = tables.some((table) => Array.isArray(table.headerRows) && table.headerRows.length > 0) || rawRows.some((row) => row?.evidence?.headerRowId);
  const geometryAvailable = typeof extraction.geometryAvailable === 'boolean'
    ? extraction.geometryAvailable
    : rawRows.some((row) => Number.isFinite(row?.sourcePage) && row?.evidence?.headerRowId);
  const reconciliation = extraction.tableTotalReconciliation || state.tableTotalReconciliation || null;
  const reconciliationPass = reconciliation == null || reconciliation.available === false || reconciliation.pass == null
    ? (rawRows.length > 0 && rawRows.every((row) => row.reliable !== false && arithmeticTotalPass(row)))
    : reconciliation.pass === true;
  return {
    expectedTablesDetected: tables.length || inferredTable,
    tableDetected,
    headerDetected,
    geometryAvailable,
    reconciliationPass,
    confidence: state.decision?.confidenceBand || state.confidence?.overall || null,
    extractionMethod: line?.method || extraction.method || null,
    tables,
  };
}

function decideFailureType(document) {
  if (!document.criticalAvailability.currentBalance) return 'BALANCE_EXTRACTION_FAILED';
  if (!document.criticalAvailability.depositManagementFeeRate || !document.criticalAvailability.balanceManagementFeeRate) return 'FEE_EXTRACTION_FAILED';
  if (!document.tableDetected) return 'TABLE_NOT_FOUND';
  if (!document.headerDetected) return 'HEADER_NOT_RECONSTRUCTED';
  if (!document.geometryAvailable && document.rowDetection.detected < document.rowDetection.expected) return 'COLUMN_ASSIGNMENT_FAILED';
  if (document.rowDetection.detected < document.rowDetection.expected) return document.extractionMethod === 'ocr' ? 'OCR_DIGIT_ERROR' : 'ROW_SPLIT_FAILED';
  if (!document.reconciliationPass) return 'TOTAL_RECONCILIATION_FAILED';
  if (!document.normalizationPass && document.normalizationIssue) return 'DUPLICATE_AMBIGUITY';
  if (!document.criticalFields.currentBalance) return 'BALANCE_EXTRACTION_FAILED';
  if (!document.criticalFields.depositManagementFeeRate || !document.criticalFields.balanceManagementFeeRate) return 'FEE_EXTRACTION_FAILED';
  if (!document.normalizationPass) return document.extractionMethod === 'ocr' ? 'OCR_DIGIT_ERROR' : 'COLUMN_ASSIGNMENT_FAILED';
  return 'OTHER';
}

function aggregatePensionExtractionDocuments(documents) {
  const automatic = documents.filter((document) => document.automaticAccepted);
  const expectedTables = documents.reduce((sum, document) => sum + document.tableDetection.expected, 0);
  const detectedTables = documents.reduce((sum, document) => sum + Math.min(document.tableDetection.expected, document.tableDetection.detected), 0);
  const expectedRows = documents.reduce((sum, document) => sum + document.rowDetection.expected, 0);
  const detectedRows = documents.reduce((sum, document) => sum + document.rowDetection.detected, 0);
  const falseExtraRows = documents.reduce((sum, document) => sum + document.rowDetection.falseExtra, 0);
  const fieldAccuracy = {};
  for (const field of CONTRIBUTION_FIELDS) {
    const total = documents.reduce((sum, document) => sum + document.rowFields[field].total, 0);
    const correct = documents.reduce((sum, document) => sum + document.rowFields[field].correct, 0);
    fieldAccuracy[field] = total ? correct / total : null;
  }
  const normalizedTotal = documents.reduce((sum, document) => sum + document.normalizedMonths.total, 0);
  const normalizedCorrect = documents.reduce((sum, document) => sum + document.normalizedMonths.correct, 0);
  const duplicateTotal = documents.reduce((sum, document) => sum + document.duplicateHandling.total, 0);
  const duplicateCorrect = documents.reduce((sum, document) => sum + document.duplicateHandling.correct, 0);
  const ambiguousTotal = documents.reduce((sum, document) => sum + document.ambiguousHandling.total, 0);
  const ambiguousCorrect = documents.reduce((sum, document) => sum + document.ambiguousHandling.correct, 0);
  const metricRate = (key) => documents.length ? documents.filter((document) => document[key]).length / documents.length : null;
  const unsafeWrongAcceptances = automatic.filter((document) => !document.criticalPass).length;
  const rowPrecision = detectedRows + falseExtraRows ? detectedRows / (detectedRows + falseExtraRows) : null;
  const rowRecall = expectedRows ? detectedRows / expectedRows : null;
  const rowF1 = rowPrecision != null && rowRecall != null && rowPrecision + rowRecall > 0 ? 2 * rowPrecision * rowRecall / (rowPrecision + rowRecall) : null;
  return {
    documents: documents.length,
    automaticDocuments: automatic.length,
    reviewDocuments: documents.length - automatic.length,
    automaticCoverage: documents.length ? automatic.length / documents.length : null,
    automaticCriticalAccuracy: automatic.length ? automatic.filter((document) => document.criticalPass).length / automatic.length : null,
    reviewRate: documents.length ? (documents.length - automatic.length) / documents.length : null,
    unsafeWrongAcceptances,
    unsafeWrongAcceptanceRate: documents.length ? unsafeWrongAcceptances / documents.length : null,
    safeOutcomeRate: documents.length ? 1 - unsafeWrongAcceptances / documents.length : null,
    tableDetection: { expected: expectedTables, detected: detectedTables, recall: expectedTables ? detectedTables / expectedTables : null },
    rowDetection: { expected: expectedRows, detected: detectedRows, falseExtra: falseExtraRows, precision: rowPrecision, recall: rowRecall, f1: rowF1 },
    rowFieldAccuracy: fieldAccuracy,
    normalization: {
      normalizedMonthAccuracy: normalizedTotal ? normalizedCorrect / normalizedTotal : null,
      duplicateHandlingAccuracy: duplicateTotal ? duplicateCorrect / duplicateTotal : null,
      ambiguousHandlingAccuracy: ambiguousTotal ? ambiguousCorrect / ambiguousTotal : null,
    },
    derived: {
      baselineMonthlyContributionAccuracy: metricRate('baselinePass'),
      averageReportedPensionSalaryAccuracy: metricRate('averageSalaryPass'),
      employeeContributionRateAccuracy: metricRate('employeeRatePass'),
      employerContributionRateAccuracy: metricRate('employerRatePass'),
      severanceRateAccuracy: metricRate('severanceRatePass'),
    },
    criticalFields: {
      currentBalanceAccuracy: documents.length ? documents.filter((document) => document.criticalFields.currentBalance).length / documents.length : null,
      depositManagementFeeAccuracy: documents.length ? documents.filter((document) => document.criticalFields.depositManagementFeeRate).length / documents.length : null,
      balanceManagementFeeAccuracy: documents.length ? documents.filter((document) => document.criticalFields.balanceManagementFeeRate).length / documents.length : null,
    },
  };
}

function evaluatePensionReportExtraction(projectRoot, predictionLines, options = {}) {
  const dataset = loadDataset(projectRoot);
  const predictions = new Map(predictionLines.map((line) => [line.id, line]));
  const selected = dataset.records.filter((record) => record.document_type === 'pension_report' &&
    (!options.split || options.split === 'all' || record.split === options.split) &&
    (!options.textLayerOnly || record.has_text_layer));
  const documents = [];

  for (const record of selected) {
    const truth = dataset.groundTruth.get(record.id);
    const line = predictions.get(record.id) || { id: record.id };
    const actual = pensionActuals(line);
    const rawMatch = matchContributionRows(truth.contribution_history, actual.contributionHistory);
    const normalizedMatch = matchContributionRows(truth.normalizedContributionMonths, actual.normalizedContributionMonths);
    const rowFields = Object.fromEntries(CONTRIBUTION_FIELDS.map((field) => [field, { correct: 0, total: truth.contribution_history.length }]));
    for (const pair of rawMatch.pairs) {
      for (const field of CONTRIBUTION_FIELDS) if (contributionValueMatch(field, pair.expected[field], pair.actual[field])) rowFields[field].correct += 1;
    }
    const normalizedCorrect = normalizedMatch.pairs.filter((pair) => rowFullyCorrect(pair.expected, pair.actual)).length;
    const normalizationPass = normalizedCorrect === truth.normalizedContributionMonths.length &&
      normalizedMatch.unmatchedExpected.length === 0 && normalizedMatch.unmatchedActual.length === 0;
    const expectedDuplicates = truth.contribution_history.filter((row) => row.rowClassification === 'duplicate');
    const expectedAmbiguous = truth.contribution_history.filter((row) => ['correction_conflict'].includes(row.rowClassification));
    const rawStatuses = actual.contributionHistory.map((row) => row.normalizationStatus);
    const duplicateCorrect = expectedDuplicates.length && rawStatuses.filter((status) => status === 'duplicate-preserved' || status === 'duplicate-canonical').length >= expectedDuplicates.length ? expectedDuplicates.length : 0;
    const ambiguousCorrect = expectedAmbiguous.length && rawStatuses.filter((status) => status === 'ambiguous').length >= expectedAmbiguous.length ? expectedAmbiguous.length : 0;
    const evidence = extractionEvidence(line, actual);
    const criticalFields = {
      currentBalance: valuesMatch('balances.closing', truth.balances.closing, actual.currentBalance),
      depositManagementFeeRate: valuesMatch('fees.personal.deposit_rate', truth.fees.personal.deposit_rate, actual.depositManagementFeeRate),
      balanceManagementFeeRate: valuesMatch('fees.personal.balance_rate', truth.fees.personal.balance_rate, actual.balanceManagementFeeRate),
    };
    const criticalAvailability = {
      currentBalance: actual.currentBalance !== null,
      depositManagementFeeRate: actual.depositManagementFeeRate !== null,
      balanceManagementFeeRate: actual.balanceManagementFeeRate !== null,
    };
    const baselinePass = valuesMatch('expectedBaselineMonthlyContribution', truth.expectedBaselineMonthlyContribution, actual.baselineMonthlyContribution);
    const averageSalaryPass = valuesMatch('expectedAverageReportedPensionSalary', truth.expectedAverageReportedPensionSalary, actual.averageReportedPensionSalary);
    const employeeRatePass = valuesMatch('expectedEmployeeContributionRate', truth.expectedEmployeeContributionRate, actual.employeeContributionRate);
    const employerRatePass = valuesMatch('expectedEmployerContributionRate', truth.expectedEmployerContributionRate, actual.employerContributionRate);
    const severanceRatePass = valuesMatch('expectedSeveranceRate', truth.expectedSeveranceRate, actual.severanceRate);
    const criticalPass = Object.values(criticalFields).every(Boolean) && normalizationPass && baselinePass;
    const automaticAccepted = automaticDecision(line, actual);
    const normalizationIssue = expectedDuplicates.length || expectedAmbiguous.length || actual.contributionHistory.some((row) => row.normalizationStatus === 'ambiguous');
    const document = {
      id: record.id,
      split: record.split,
      reportType: record.family === 'quarterly' ? 'quarterly' : 'annual',
      textLayer: record.has_text_layer ? 'text-layer' : 'image-only',
      lineage: record.source_type === 'augmented' ? 'augmented-child' : 'synthetic-parent',
      extractionMethod: evidence.extractionMethod,
      confidence: evidence.confidence,
      automaticAccepted,
      criticalPass,
      criticalFields,
      criticalAvailability,
      baselinePass,
      averageSalaryPass,
      employeeRatePass,
      employerRatePass,
      severanceRatePass,
      normalizationPass,
      normalizationIssue: Boolean(normalizationIssue),
      tableDetected: evidence.tableDetected,
      headerDetected: evidence.headerDetected,
      geometryAvailable: evidence.geometryAvailable,
      reconciliationPass: evidence.reconciliationPass,
      tableDetection: { expected: truth.contributionTableGroundTruth.expectedTables, detected: evidence.expectedTablesDetected },
      rowDetection: { expected: truth.contribution_history.length, detected: rawMatch.pairs.length, falseExtra: rawMatch.unmatchedActual.length },
      rowFields,
      normalizedMonths: { total: truth.normalizedContributionMonths.length, correct: normalizedCorrect },
      duplicateHandling: { total: expectedDuplicates.length, correct: duplicateCorrect },
      ambiguousHandling: { total: expectedAmbiguous.length, correct: ambiguousCorrect },
      expected: {
        currentBalance: truth.balances.closing,
        depositManagementFeeRate: truth.fees.personal.deposit_rate,
        balanceManagementFeeRate: truth.fees.personal.balance_rate,
        normalizedContributionMonths: truth.normalizedContributionMonths,
        baselineMonthlyContribution: truth.expectedBaselineMonthlyContribution,
      },
      actual: {
        currentBalance: actual.currentBalance,
        depositManagementFeeRate: actual.depositManagementFeeRate,
        balanceManagementFeeRate: actual.balanceManagementFeeRate,
        normalizedContributionMonths: actual.normalizedContributionMonths,
        baselineMonthlyContribution: actual.baselineMonthlyContribution,
      },
    };
    document.failureType = criticalPass && automaticAccepted ? null : decideFailureType(document);
    documents.push(document);
  }

  const groupBy = (selector) => Object.fromEntries([...new Set(documents.map(selector))].sort().map((key) => [key, aggregatePensionExtractionDocuments(documents.filter((document) => selector(document) === key))]));
  const diagnostics = documents.filter((document) => !document.criticalPass || !document.automaticAccepted).map((document) => ({
    documentId: document.id,
    stage: document.failureType === 'BALANCE_EXTRACTION_FAILED' || document.failureType === 'FEE_EXTRACTION_FAILED' ? 'document-fields'
      : document.failureType === 'DUPLICATE_AMBIGUITY' ? 'normalization'
        : document.failureType === 'TABLE_NOT_FOUND' || document.failureType === 'HEADER_NOT_RECONSTRUCTED' ? 'table-detection'
          : 'table-extraction',
    expected: document.expected,
    actual: document.actual,
    failureType: document.failureType,
    confidence: document.confidence,
    tableDetected: document.tableDetected,
    headerDetected: document.headerDetected,
    geometryAvailable: document.geometryAvailable,
    reconciliationPass: document.reconciliationPass,
    extractionMethod: document.extractionMethod,
    automaticAccepted: document.automaticAccepted,
    criticalPass: document.criticalPass,
  }));
  const failureReasonCounts = {};
  diagnostics.forEach((diagnostic) => { failureReasonCounts[diagnostic.failureType] = (failureReasonCounts[diagnostic.failureType] || 0) + 1; });
  return {
    schemaVersion: 2,
    evaluatedAt: new Date().toISOString(),
    split: options.split || 'all',
    summary: aggregatePensionExtractionDocuments(documents),
    headlineSummary: aggregatePensionExtractionDocuments(documents.filter((document) => document.lineage === 'synthetic-parent')),
    groups: {
      reportType: groupBy((document) => document.reportType),
      textLayer: groupBy((document) => document.textLayer),
      lineage: groupBy((document) => document.lineage),
      split: groupBy((document) => document.split),
    },
    failureReasonCounts,
    diagnostics,
    documents,
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
  validatePensionContributionGroundTruth,
  matchContributionRows,
  evaluatePensionReportExtraction,
};
