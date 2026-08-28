'use strict';

const assert = require('assert');
const path = require('path');

const appRoot = path.resolve(__dirname, '..', '..', 'app');
const E = require(path.join(appRoot, 'engine.js'));
const C = require(path.join(appRoot, 'simulator-config.js'));
const S = require(path.join(appRoot, 'simulator.js'));
const DEMO = require(path.join(appRoot, 'demo-fixture.js'));
const R = globalThis.PensionReportParser;

function near(actual, expected, tolerance = 1e-10) {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale, `${actual} != ${expected}`);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('demo activation requires the explicit demo=1 query parameter', () => {
  assert.strictEqual(DEMO.isDemoMode(''), false);
  assert.strictEqual(DEMO.isDemoMode('?demo=0'), false);
  assert.strictEqual(DEMO.isDemoMode('?demo=1'), true);
  assert.strictEqual(DEMO.isDemoMode('?x=1&demo=1'), true);
});

test('demo horizon defaults to 25 years and validates optional review years', () => {
  assert.strictEqual(DEMO.getDemoYears('?demo=1'), 25);
  assert.strictEqual(DEMO.getDemoYears('?demo=1&years=20'), 20);
  assert.strictEqual(DEMO.getDemoYears('?demo=1&years=30'), 30);
  assert.strictEqual(DEMO.getDemoYears('?demo=1&years=0'), 25);
  assert.strictEqual(DEMO.getDemoYears('?demo=1&years=20.5'), 25);
  assert.strictEqual(DEMO.getDemoYears('?demo=1&years=999'), 25);
});

test('demo fixture is a supported canonical new-pension state', () => {
  const state = DEMO.createDemoPensionReportState();
  assert.strictEqual(state.fundType, 'new_pension');
  assert.strictEqual(state.supportedForCurrentForecast, true);
  assert.strictEqual(state.routingReason, 'SUPPORTED_NEW_PENSION');
  assert.strictEqual(state.report.type, 'annual');
  assert.strictEqual(S.supportedNewPension(state), true);
});

test('demo balance, salary and management-fee ratios are exact', () => {
  const state = DEMO.createDemoPensionReportState();
  assert.strictEqual(state.currentBalance, 250000);
  assert.strictEqual(state.derived.averageReportedPensionSalary, 24500);
  assert.strictEqual(state.fees.depositRate, 0.008);
  assert.strictEqual(state.fees.balanceRate, 0.0015);
});

test('twelve synthetic rows are monthly, reliable and review-free', () => {
  const state = DEMO.createDemoPensionReportState();
  assert.strictEqual(state.contributionHistory.length, 12);
  assert.strictEqual(state.normalizedContributionMonths.length, 12);
  assert.deepStrictEqual(state.contributionHistory.map((row) => row.salaryMonth), Array.from({ length: 12 }, (_, index) => `${String(index + 1).padStart(2, '0')}/2025`));
  assert.ok(state.contributionHistory.every((row) => row.periodType === 'monthly' && row.isYtd === false && row.reliable === true && row.requiresReview === false));
  assert.ok(state.contributionHistory.every((row) => row.normalizationStatus === 'used'));
});

test('demo contribution components reconcile to ₪5,103.35 and 20.83%', () => {
  const state = DEMO.createDemoPensionReportState();
  const row = state.contributionHistory[0];
  assert.strictEqual(row.employeeContribution, 1470);
  assert.strictEqual(row.employerContribution, 1592.5);
  assert.strictEqual(row.severanceContribution, 2040.85);
  assert.strictEqual(row.totalContribution, 5103.35);
  assert.strictEqual(state.derived.baselineMonthlyContribution, 5103.35);
  near(state.derived.baselineMonthlyContribution / state.derived.averageReportedPensionSalary, 0.2083, 1e-12);
});

test('canonical parser normalization derives the demo baseline', () => {
  const state = DEMO.createDemoPensionReportState();
  const independentlyDerived = R.deriveContributionBaseline(JSON.parse(JSON.stringify(state.contributionHistory)));
  assert.strictEqual(independentlyDerived.derived.monthsUsed, 12);
  near(independentlyDerived.derived.baselineMonthlyContribution, state.derived.baselineMonthlyContribution, 1e-12);
  near(independentlyDerived.derived.averageReportedPensionSalary, state.derived.averageReportedPensionSalary, 1e-12);
});

test('demo baseline is the unchanged production projection for 25 years', () => {
  const state = DEMO.createDemoPensionReportState();
  const baseline = S.buildSimulatorBaseline(state, DEMO.DEFAULT_DEMO_YEARS);
  const production = E.projectBaseline(state, 25, {
    realReturnRate: C.BASELINE.realReturnRate,
    inflationRate: C.BASELINE.inflationRate,
    coefficient: C.BASELINE.coefficient,
  });
  const selected = S.applySimulatorOverrides(baseline, S.resetSimulatorControls(baseline));
  const projected = S.projectSimulatorScenario(selected);
  ['retirementBalanceReal', 'retirementBalanceNominal', 'monthlyPensionReal', 'monthlyPensionNominal'].forEach((key) => {
    near(baseline.projection[key], production[key], 1e-12);
    near(projected[key], production[key], 1e-12);
  });
  assert.strictEqual(baseline.yearsUntilRetirement, 25);
  assert.strictEqual(baseline.monthsUntilRetirement, 300);
  assert.strictEqual(baseline.assumptions.coefficient, 200);
  near(baseline.baselineControls.contribution, 0.2083, 1e-12);
});

test('each demo fixture is fresh and deeply immutable', () => {
  const first = DEMO.createDemoPensionReportState();
  const second = DEMO.createDemoPensionReportState();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.contributionHistory, second.contributionHistory);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.contributionHistory));
  assert.ok(Object.isFrozen(first.contributionHistory[0]));
  assert.throws(() => { first.currentBalance = 1; }, TypeError);
});

test('demo exit removes only demo review parameters', () => {
  const exit = new URL(DEMO.demoExitUrl('http://127.0.0.1:8080/path/?demo=1&years=30&keep=yes#result'));
  assert.strictEqual(exit.pathname, '/path/');
  assert.strictEqual(exit.searchParams.has('demo'), false);
  assert.strictEqual(exit.searchParams.has('years'), false);
  assert.strictEqual(exit.searchParams.get('keep'), 'yes');
  assert.strictEqual(exit.hash, '#result');
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}
console.log(`All ${passed} synthetic-demo fixture tests passed.`);
