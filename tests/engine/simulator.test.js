'use strict';

const assert = require('assert');
const path = require('path');
const E = require(path.resolve(__dirname, '..', '..', 'app', 'engine.js'));
const C = require(path.resolve(__dirname, '..', '..', 'app', 'simulator-config.js'));
const S = require(path.resolve(__dirname, '..', '..', 'app', 'simulator.js'));

function reportState(overrides = {}) {
  const derived = {
    baselineMonthlyContribution: 4000,
    averageReportedPensionSalary: 20000,
    monthsUsed: 3,
    ...(overrides.derived || {}),
  };
  return {
    fundType: 'new_pension',
    supportedForCurrentForecast: true,
    currentBalance: 300000,
    fees: { depositRate: 0.008, balanceRate: 0.0015, ...(overrides.fees || {}) },
    derived,
    ...overrides,
    fees: { depositRate: 0.008, balanceRate: 0.0015, ...(overrides.fees || {}) },
    derived,
  };
}

function near(actual, expected, tolerance = 1e-10) {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale, `${actual} != ${expected}`);
}

function comparisonFor(report = reportState(), years = 20, controls = null) {
  const baseline = S.buildSimulatorBaseline(report, years);
  const selected = S.applySimulatorOverrides(baseline, controls || S.resetSimulatorControls(baseline));
  return { baseline, selected, comparison: S.compareSimulatorScenario(baseline, selected) };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('canonical nominal baseline is 6.08% and maps to the 4% real baseline', () => {
  assert.strictEqual(C.BASELINE.nominalReturnRate, 0.0608);
  near(E.nominalToReal(C.BASELINE.nominalReturnRate, C.BASELINE.inflationRate), C.BASELINE.realReturnRate, 1e-12);
});

test('nominal-to-real conversion uses the ratio formula rather than subtraction', () => {
  const nominal = 0.1;
  const inflation = 0.04;
  near(E.nominalToReal(nominal, inflation), (1 + nominal) / (1 + inflation) - 1, 1e-12);
  assert.notStrictEqual(E.nominalToReal(nominal, inflation), nominal - inflation);
});

test('a low nominal return with high inflation remains a valid negative real return', () => {
  assert.ok(E.nominalToReal(0.02, 0.1) < 0);
});

test('the untouched simulator scenario exactly matches projectBaseline', () => {
  const report = reportState();
  const baseline = S.buildSimulatorBaseline(report, 25);
  const selected = S.applySimulatorOverrides(baseline, S.resetSimulatorControls(baseline));
  const expected = E.projectBaseline(report, 25, {
    realReturnRate: C.BASELINE.realReturnRate,
    inflationRate: C.BASELINE.inflationRate,
    coefficient: C.BASELINE.coefficient,
  });
  const actual = S.projectSimulatorScenario(selected);
  ['retirementBalanceReal', 'retirementBalanceNominal', 'monthlyPensionReal', 'monthlyPensionNominal', 'totalFeesReal', 'totalFeesNominal'].forEach((key) => near(actual[key], expected[key], 1e-12));
});

test('the baseline scenario is deeply immutable', () => {
  const baseline = S.buildSimulatorBaseline(reportState(), 20);
  assert.ok(Object.isFrozen(baseline));
  assert.ok(Object.isFrozen(baseline.engineScenario));
  assert.ok(Object.isFrozen(baseline.engineScenario.fees));
  assert.throws(() => { baseline.engineScenario.fees.depositFee = 0.2; }, TypeError);
  near(baseline.engineScenario.fees.depositFee, 0.008);
});

test('changing nominal return changes the projected result', () => {
  const { baseline, comparison } = comparisonFor(reportState(), 20, { nominalReturn: 0.08 });
  assert.ok(comparison.monthlyPensionRealDelta > 0);
  assert.ok(comparison.scenario.monthlyPensionReal > baseline.projection.monthlyPensionReal);
});

test('changing inflation changes the real result', () => {
  const { comparison } = comparisonFor(reportState(), 20, { inflation: 0.03 });
  assert.ok(comparison.monthlyPensionRealDelta < 0);
});

test('changing the total contribution rate changes the result', () => {
  const { comparison } = comparisonFor(reportState(), 20, { contribution: 0.22 });
  assert.ok(comparison.monthlyPensionRealDelta > 0);
});

test('changing the deposit fee changes the result', () => {
  const { comparison } = comparisonFor(reportState(), 20, { depositFee: 0.03 });
  assert.ok(comparison.monthlyPensionRealDelta < 0);
});

test('changing the balance fee changes the result', () => {
  const { comparison } = comparisonFor(reportState(), 20, { balanceFee: 0.01 });
  assert.ok(comparison.monthlyPensionRealDelta < 0);
});

test('simultaneous controls create one deterministic combined scenario', () => {
  const report = reportState();
  const first = comparisonFor(report, 20, { nominalReturn: 0.075, inflation: 0.025, contribution: 0.21, depositFee: 0.006, balanceFee: 0.0012 });
  const second = comparisonFor(report, 20, { balanceFee: 0.0012, depositFee: 0.006, contribution: 0.21, inflation: 0.025, nominalReturn: 0.075 });
  near(first.comparison.scenario.retirementBalanceReal, second.comparison.scenario.retirementBalanceReal, 1e-12);
  near(first.comparison.scenario.monthlyPensionNominal, second.comparison.scenario.monthlyPensionNominal, 1e-12);
});

test('reset controls restore the exact baseline projection', () => {
  const baseline = S.buildSimulatorBaseline(reportState(), 20);
  const changed = S.applySimulatorOverrides(baseline, { nominalReturn: 0.08, inflation: 0.025, contribution: 0.22, depositFee: 0.02, balanceFee: 0.004 });
  assert.ok(S.compareSimulatorScenario(baseline, changed).monthlyPensionRealDelta !== 0);
  const reset = S.applySimulatorOverrides(baseline, S.resetSimulatorControls(baseline));
  const resetComparison = S.compareSimulatorScenario(baseline, reset);
  assert.strictEqual(resetComparison.monthlyPensionRealDelta, 0);
  assert.strictEqual(resetComparison.retirementBalanceNominalDelta, 0);
});

test('control update order does not change the final projection', () => {
  const baseline = S.buildSimulatorBaseline(reportState(), 20);
  let controls = S.resetSimulatorControls(baseline);
  controls = { ...controls, nominalReturn: 0.07 };
  controls = { ...controls, balanceFee: 0.004 };
  controls = { ...controls, inflation: 0.026 };
  controls = { ...controls, contribution: 0.205 };
  controls = { ...controls, depositFee: 0.012 };
  const sequential = S.compareSimulatorScenario(baseline, S.applySimulatorOverrides(baseline, controls));
  const direct = S.compareSimulatorScenario(baseline, S.applySimulatorOverrides(baseline, { nominalReturn: 0.07, inflation: 0.026, contribution: 0.205, depositFee: 0.012, balanceFee: 0.004 }));
  near(sequential.scenario.retirementBalanceReal, direct.scenario.retirementBalanceReal, 1e-12);
});

test('negative deltas are calculated against the frozen baseline', () => {
  const { comparison } = comparisonFor(reportState(), 20, { nominalReturn: 0.04 });
  assert.ok(comparison.monthlyPensionRealDelta < 0);
  assert.ok(comparison.retirementBalanceNominalDelta < 0);
});

test('positive deltas are calculated against the frozen baseline', () => {
  const { comparison } = comparisonFor(reportState(), 20, { nominalReturn: 0.09 });
  assert.ok(comparison.monthlyPensionRealDelta > 0);
  assert.ok(comparison.retirementBalanceNominalDelta > 0);
});

test('real and nominal deltas compare matching monetary bases', () => {
  const { comparison } = comparisonFor(reportState(), 20, { nominalReturn: 0.075, inflation: 0.025 });
  near(comparison.monthlyPensionRealDelta, comparison.scenario.monthlyPensionReal - comparison.baseline.monthlyPensionReal, 1e-12);
  near(comparison.monthlyPensionNominalDelta, comparison.scenario.monthlyPensionNominal - comparison.baseline.monthlyPensionNominal, 1e-12);
});

test('the annuity coefficient remains fixed at 200', () => {
  const { selected } = comparisonFor(reportState(), 12, { nominalReturn: 0.07 });
  assert.strictEqual(selected.coefficient, C.BASELINE.coefficient);
  assert.strictEqual(selected.engineScenario.retirement.coefficient, C.BASELINE.coefficient);
});

test('the user-entered horizon remains unchanged by simulator controls', () => {
  const { selected } = comparisonFor(reportState(), 12, { nominalReturn: 0.07, contribution: 0.21 });
  assert.strictEqual(selected.yearsUntilRetirement, 12);
  assert.strictEqual(selected.monthsUntilRetirement, 144);
  assert.strictEqual(selected.engineScenario.horizonMonths, 144);
});

test('contribution rates calculate actual monthly money from the reported pension salary', () => {
  const baseline = S.buildSimulatorBaseline(reportState(), 20);
  [
    [0.185, 3700],
    [0.2083, 4166],
    [0.2183, 4366],
  ].forEach(([rate, amount]) => {
    const selected = S.applySimulatorOverrides(baseline, { contribution: rate });
    near(selected.selectedMonthlyContribution, amount, 1e-12);
  });
});

test('a report-derived contribution baseline stays exact rather than snapping to a reference tick', () => {
  const baseline = S.buildSimulatorBaseline(reportState({ derived: { baselineMonthlyContribution: 3880, averageReportedPensionSalary: 20000, monthsUsed: 3 } }), 20);
  near(baseline.baselineControls.contribution, 0.194, 1e-12);
  assert.notStrictEqual(baseline.baselineControls.contribution, C.SLIDERS.contributionRate.centralMin);
});

test('the amount fallback does not invent a pension salary', () => {
  const fallbackReport = reportState({ derived: { baselineMonthlyContribution: 4000, averageReportedPensionSalary: null, monthsUsed: 0 } });
  const baseline = S.buildSimulatorBaseline(fallbackReport, 20);
  assert.strictEqual(baseline.contribution.type, 'amount');
  assert.strictEqual(baseline.contribution.averageReportedPensionSalary, null);
  const selected = S.applySimulatorOverrides(baseline, { contribution: 1.5 });
  near(selected.selectedMonthlyContribution, 6000, 1e-12);
});

test('explicit zero fees remain valid simulation values', () => {
  const baseline = S.buildSimulatorBaseline(reportState({ fees: { depositRate: 0, balanceRate: 0 } }), 20);
  assert.strictEqual(baseline.baselineControls.depositFee, 0);
  assert.strictEqual(baseline.baselineControls.balanceFee, 0);
  const selected = S.applySimulatorOverrides(baseline, S.resetSimulatorControls(baseline));
  assert.strictEqual(selected.selectedDepositFee, 0);
  assert.strictEqual(selected.selectedBalanceFee, 0);
});

test('report fee ratios retain their exact decimal-ratio values', () => {
  const baseline = S.buildSimulatorBaseline(reportState({ fees: { depositRate: 0.008, balanceRate: 0.0015 } }), 20);
  near(baseline.baselineControls.depositFee, 0.008, 1e-12);
  near(baseline.baselineControls.balanceFee, 0.0015, 1e-12);
});

test('range status is derived from canonical numeric configuration', () => {
  const config = C.SLIDERS.nominalReturn;
  assert.strictEqual(S.scenarioRangeStatus(config, 0.06), 'central');
  assert.strictEqual(S.scenarioRangeStatus(config, 0.035), 'moderate');
  assert.strictEqual(S.scenarioRangeStatus(config, 0.115), 'extreme');
});

test('a contribution baseline outside the standard track expands the visual range without moving the green reference band', () => {
  const baseline = S.buildSimulatorBaseline(reportState({ derived: { baselineMonthlyContribution: 6000, averageReportedPensionSalary: 20000, monthsUsed: 3 } }), 20);
  assert.ok(baseline.controlsConfig.contribution.max > C.SLIDERS.contributionRate.max);
  assert.strictEqual(baseline.controlsConfig.contribution.centralMin, C.SLIDERS.contributionRate.centralMin);
  assert.strictEqual(baseline.controlsConfig.contribution.centralMax, C.SLIDERS.contributionRate.centralMax);
});

test('old-pension and unknown fund states cannot build a simulator baseline', () => {
  assert.throws(() => S.buildSimulatorBaseline(reportState({ fundType: 'old_pension', supportedForCurrentForecast: false }), 20), /new-pension/);
  assert.throws(() => S.buildSimulatorBaseline(reportState({ fundType: 'unknown', supportedForCurrentForecast: false }), 20), /new-pension/);
});

test('null, blank and non-finite controls fall back without changing the baseline', () => {
  const baseline = S.buildSimulatorBaseline(reportState(), 20);
  const selected = S.applySimulatorOverrides(baseline, {
    nominalReturn: null,
    inflation: '',
    contribution: NaN,
    depositFee: Infinity,
    balanceFee: undefined,
  });
  assert.deepStrictEqual(selected.controls, baseline.baselineControls);
  assert.strictEqual(S.controlsAtBaseline(baseline, selected.controls), true);
  assert.strictEqual(S.controlsAtBaseline(baseline, { ...baseline.baselineControls, depositFee: null }), false);
});

test('a zero contribution baseline never expands into negative money or rates', () => {
  const baseline = S.buildSimulatorBaseline(reportState({ derived: {
    baselineMonthlyContribution: 0, averageReportedPensionSalary: 20000, monthsUsed: 1,
  } }), 20);
  assert.strictEqual(baseline.contribution.type, 'rate');
  assert.strictEqual(baseline.controlsConfig.contribution.min, 0);
  const selected = S.applySimulatorOverrides(baseline, { contribution: baseline.controlsConfig.contribution.min });
  assert.strictEqual(selected.selectedMonthlyContribution, 0);
  assert.strictEqual(S.projectSimulatorScenario(selected).totalContributionsReal, 0);
});

test('an implausible contribution-to-salary ratio uses the amount-only fallback', () => {
  const baseline = S.buildSimulatorBaseline(reportState({ derived: {
    baselineMonthlyContribution: 4000, averageReportedPensionSalary: 1, monthsUsed: 1,
  } }), 20);
  assert.strictEqual(baseline.contribution.type, 'amount');
  assert.strictEqual(baseline.contribution.averageReportedPensionSalary, null);
  assert.strictEqual(baseline.baselineControls.contribution, 1);
});

test('snapping an expanded endpoint never exceeds the control maximum', () => {
  const baseline = S.buildSimulatorBaseline(reportState({ derived: {
    baselineMonthlyContribution: 6140, averageReportedPensionSalary: 20000, monthsUsed: 1,
  } }), 20);
  const config = baseline.controlsConfig.contribution;
  assert(Math.abs(config.max - 0.33156) < 1e-12);
  assert.strictEqual(S.snapToStep(config, config.max), config.max);
  assert(S.snapToStep(config, config.max + 1) <= config.max);
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
console.log(`All ${passed} interactive-simulator tests passed.`);
