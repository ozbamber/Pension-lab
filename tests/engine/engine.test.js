const assert = require('assert');
const path = require('path');
const E = require(path.resolve(__dirname, '..', '..', 'app', 'engine.js'));

function base() {
  return {
    profile: { currentAge: 30, currentBalance: 100000, monthlySalary: 10000, pensionableSalary: 10000 },
    inflation: { annualRate: 0 },
    salaryPhases: [{ startAge: 30, endAge: 40, annualGrowth: 0, growthType: 'nominal' }],
    contribution: {
      mode: 'fixed', fixedAmount: 0, fixedGrowsWithSalary: false,
      employeeRate: 0, employerRate: 0, severanceRate: 0, pensionableSalaryLimit: 0,
    },
    returnPhases: [{ startAge: 30, endAge: 40, annualReturn: 0, returnType: 'nominal' }],
    investment: { blendProtected: false, protectedWeight: 0.3, protectedRealReturn: 0.0515 },
    careerBreaks: [],
    fees: { annualBalanceFee: 0, depositFee: 0 },
    retirement: { retirementAge: 40, coefficient: 200 },
  };
}

function approximately(actual, expected, tolerance = 1e-6) {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert(Math.abs(actual - expected) <= tolerance * scale, `Expected ${actual} to be approximately ${expected}`);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('starting balance remains unchanged at 0% return', () => {
  const result = E.project(base());
  approximately(result.retirementBalanceNominal, 100000);
});

test('fixed monthly contributions are accumulated', () => {
  const scenario = base();
  scenario.contribution.fixedAmount = 1000;
  const result = E.project(scenario);
  approximately(result.retirementBalanceNominal, 100000 + 1000 * 120);
});

test('annual return is converted to an equivalent monthly rate', () => {
  const scenario = base();
  scenario.returnPhases[0].annualReturn = 0.05;
  const result = E.project(scenario);
  approximately(result.retirementBalanceNominal, 100000 * Math.pow(1.05, 10), 1e-10);
});

test('0% inflation makes real and nominal balances identical', () => {
  const scenario = base();
  scenario.returnPhases[0].annualReturn = 0.05;
  const result = E.project(scenario);
  approximately(result.retirementBalanceReal, result.retirementBalanceNominal);
});

test('assets keep compounding during a career break', () => {
  const scenario = base();
  scenario.returnPhases[0].annualReturn = 0.05;
  scenario.contribution.fixedAmount = 1000;
  scenario.careerBreaks = [{ id: 'b', startAge: 32, durationMonths: 24, contributionDuringBreak: 0, salaryResumeMode: 'projected' }];
  const result = E.project(scenario);
  const uninterrupted = base();
  uninterrupted.returnPhases[0].annualReturn = 0.05;
  uninterrupted.contribution.fixedAmount = 1000;
  const uninterruptedResult = E.project(uninterrupted);
  assert(result.retirementBalanceNominal < uninterruptedResult.retirementBalanceNominal);
  assert(result.retirementBalanceNominal > 100000);
});

test('salary phase changes affect percentage contributions', () => {
  const scenario = base();
  scenario.contribution.mode = 'percent';
  scenario.contribution.employeeRate = 0.1;
  scenario.salaryPhases = [
    { startAge: 30, endAge: 35, annualGrowth: 0, growthType: 'nominal' },
    { startAge: 35, endAge: 40, annualGrowth: 0.1, growthType: 'nominal' },
  ];
  const result = E.project(scenario);
  assert(result.totalContributionsNominal > 10000 * 0.1 * 120);
});

test('pension conversion coefficient is applied directly', () => {
  const fake = { retirementBalanceReal: 4000000, retirementBalanceNominal: 4000000 };
  assert.strictEqual(E.pensionAtCoefficient(fake, 200, true), 20000);
});

test('real/nominal conversion round trip is stable', () => {
  const real = 0.05;
  const inflation = 0.025;
  const nominal = E.realToNominal(real, inflation);
  approximately(E.nominalToReal(nominal, inflation), real, 1e-12);
});

test('protected-return weights of 0 and 1 match their components', () => {
  const market = base();
  market.inflation.annualRate = 0.02;
  market.returnPhases[0] = { startAge: 30, endAge: 40, annualReturn: 0.08, returnType: 'real' };

  const weightZero = E.cloneScenario(market);
  weightZero.investment.blendProtected = true;
  weightZero.investment.protectedWeight = 0;
  weightZero.investment.protectedRealReturn = 0.0515;
  approximately(E.project(weightZero).retirementBalanceNominal, E.project(market).retirementBalanceNominal, 1e-10);

  const weightOne = E.cloneScenario(market);
  weightOne.investment.blendProtected = true;
  weightOne.investment.protectedWeight = 1;
  weightOne.investment.protectedRealReturn = 0.0515;
  const protectedOnly = E.cloneScenario(market);
  protectedOnly.returnPhases[0].annualReturn = 0.0515;
  approximately(E.project(weightOne).retirementBalanceNominal, E.project(protectedOnly).retirementBalanceNominal, 1e-10);
});

test('later retirement adds time and contributions', () => {
  const scenario = base();
  scenario.contribution.fixedAmount = 1000;
  const result40 = E.project(scenario);
  scenario.retirement.retirementAge = 45;
  scenario.salaryPhases[0].endAge = 45;
  scenario.returnPhases[0].endAge = 45;
  const result45 = E.project(scenario);
  assert(result45.retirementBalanceNominal > result40.retirementBalanceNominal);
});

test('a two-year zero-contribution break removes exactly 24 fixed contributions', () => {
  const scenario = base();
  scenario.contribution.fixedAmount = 1000;
  scenario.careerBreaks = [{ id: 'b', startAge: 32, durationMonths: 24, contributionDuringBreak: 0, salaryResumeMode: 'projected' }];
  const result = E.project(scenario);
  approximately(result.retirementBalanceNominal, 100000 + 1000 * 96);
});

test('partial contributions during a break are included', () => {
  const scenario = base();
  scenario.contribution.fixedAmount = 1000;
  scenario.careerBreaks = [{ id: 'b', startAge: 32, durationMonths: 24, contributionDuringBreak: 250, salaryResumeMode: 'projected' }];
  const result = E.project(scenario);
  approximately(result.retirementBalanceNominal, 100000 + 1000 * 96 + 250 * 24);
  approximately(result.totalContributionsNominal, 1000 * 96 + 250 * 24);
});

test('deposit fees reduce the balance while contributions stay gross', () => {
  const scenario = base();
  scenario.profile.currentBalance = 0;
  scenario.retirement.retirementAge = 31;
  scenario.salaryPhases[0].endAge = 31;
  scenario.returnPhases[0].endAge = 31;
  scenario.contribution.fixedAmount = 1000;
  scenario.fees.depositFee = 0.1;
  const result = E.project(scenario);
  approximately(result.totalContributionsNominal, 12000);
  approximately(result.totalNetContributionsNominal, 10800);
  approximately(result.totalDepositFeesNominal, 1200);
  approximately(result.retirementBalanceNominal, 10800);
  approximately(result.investmentGrowthNominal, 0);
});

test('annual balance fee uses an equivalent monthly reduction', () => {
  const scenario = base();
  scenario.retirement.retirementAge = 31;
  scenario.salaryPhases[0].endAge = 31;
  scenario.returnPhases[0].endAge = 31;
  scenario.fees.annualBalanceFee = 0.01;
  const result = E.project(scenario);
  approximately(result.retirementBalanceNominal, 99000, 1e-10);
});

test('fixed contributions can grow with salary', () => {
  const scenario = base();
  scenario.profile.currentBalance = 0;
  scenario.retirement.retirementAge = 31;
  scenario.salaryPhases[0] = { startAge: 30, endAge: 31, annualGrowth: 0.12, growthType: 'nominal' };
  scenario.returnPhases[0].endAge = 31;
  scenario.contribution.fixedAmount = 1000;
  scenario.contribution.fixedGrowsWithSalary = true;
  const monthlyGrowth = E.annualToMonthly(0.12);
  const expected = Array.from({ length: 12 }, (_, month) => 1000 * Math.pow(1 + monthlyGrowth, month)).reduce((a, b) => a + b, 0);
  approximately(E.project(scenario).totalContributionsNominal, expected, 1e-10);
});

test('pensionable salary ratio is respected for percentage contributions', () => {
  const scenario = base();
  scenario.profile.currentBalance = 0;
  scenario.profile.pensionableSalary = 8000;
  scenario.retirement.retirementAge = 31;
  scenario.salaryPhases[0].endAge = 31;
  scenario.returnPhases[0].endAge = 31;
  scenario.contribution.mode = 'percent';
  scenario.contribution.employeeRate = 0.1;
  const result = E.project(scenario);
  approximately(result.totalContributionsNominal, 8000 * 0.1 * 12);
});

test('nominal return equal to inflation preserves real starting balance', () => {
  const scenario = base();
  scenario.inflation.annualRate = 0.02;
  scenario.returnPhases[0].annualReturn = 0.02;
  scenario.returnPhases[0].returnType = 'nominal';
  const result = E.project(scenario);
  approximately(result.retirementBalanceReal, 100000, 1e-10);
});

test('the nearest prior phase continues through a gap or beyond the final boundary', () => {
  const phases = [
    { id: 'first', startAge: 30, endAge: 35 },
    { id: 'last', startAge: 35, endAge: 39 },
  ];
  assert.strictEqual(E.findPhase(phases, 39.5).id, 'last');

  const scenario = base();
  scenario.returnPhases = [
    { startAge: 30, endAge: 35, annualReturn: 0, returnType: 'nominal' },
    { startAge: 35, endAge: 39, annualReturn: 0.1, returnType: 'nominal' },
  ];
  const result = E.project(scenario);
  approximately(result.retirementBalanceNominal, 100000 * Math.pow(1.1, 5), 1e-10);
});

test('retirement explorer extends the final phase for later ages', () => {
  const scenario = base();
  scenario.returnPhases = [
    { startAge: 30, endAge: 35, annualReturn: 0, returnType: 'nominal' },
    { startAge: 35, endAge: 40, annualReturn: 0.1, returnType: 'nominal' },
  ];
  const row = E.retirementAgeSeries(scenario, 41, 41)[0];
  approximately(row.nominalBalance, 100000 * Math.pow(1.1, 6), 1e-10);
});

test('custom salary restart is applied after a career break', () => {
  const scenario = base();
  scenario.retirement.retirementAge = 33;
  scenario.salaryPhases[0].endAge = 33;
  scenario.returnPhases[0].endAge = 33;
  scenario.careerBreaks = [{
    id: 'custom', startAge: 31, durationMonths: 12, contributionDuringBreak: 0,
    salaryResumeMode: 'custom', customRestartSalary: 5000,
  }];
  approximately(E.project(scenario).finalSalaryNominal, 5000);
});

test('previous salary restart removes growth accumulated during the break', () => {
  const previous = base();
  previous.retirement.retirementAge = 33;
  previous.salaryPhases[0] = { startAge: 30, endAge: 33, annualGrowth: 0.1, growthType: 'nominal' };
  previous.returnPhases[0].endAge = 33;
  previous.careerBreaks = [{ id: 'previous', startAge: 31, durationMonths: 12, contributionDuringBreak: 0, salaryResumeMode: 'previous' }];
  approximately(E.project(previous).finalSalaryNominal, 12100, 1e-10);

  const projected = E.cloneScenario(previous);
  projected.careerBreaks[0].salaryResumeMode = 'projected';
  approximately(E.project(projected).finalSalaryNominal, 13310, 1e-10);
});

test('scenario comparison returns positive deltas for a stronger scenario', () => {
  const low = base();
  const high = base();
  high.returnPhases[0].annualReturn = 0.05;
  const delta = E.compareScenarios(low, high);
  assert(delta.balanceNominalDelta > 0);
  assert(delta.pensionNominalDelta > 0);
});

test('annual rates at or below -100% are rejected', () => {
  assert.throws(() => E.annualToMonthly(-1), /greater than -100%/);
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
console.log(`All ${passed} projection-engine tests passed.`);
