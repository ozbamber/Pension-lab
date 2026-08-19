(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PensionEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function annualToMonthly(rate) {
    const r = Number(rate) || 0;
    if (r <= -1) throw new Error('Annual rate must be greater than -100%');
    return Math.pow(1 + r, 1 / 12) - 1;
  }

  const realToNominal = (real, inflation) => (1 + Number(real || 0)) * (1 + Number(inflation || 0)) - 1;
  const nominalToReal = (nominal, inflation) => (1 + Number(nominal || 0)) / (1 + Number(inflation || 0)) - 1;

  function sortedPhases(phases) {
    return (Array.isArray(phases) ? phases : [])
      .filter((p) => p && Number.isFinite(Number(p.startAge)) && Number.isFinite(Number(p.endAge)))
      .slice()
      .sort((a, b) => Number(a.startAge) - Number(b.startAge) || Number(a.endAge) - Number(b.endAge));
  }

  function findPhase(phases, age) {
    const sorted = sortedPhases(phases);
    if (!sorted.length) return null;

    // In an overlap, the most recently started phase takes precedence.
    const exact = sorted.filter((p) => age >= Number(p.startAge) && age < Number(p.endAge));
    if (exact.length) return exact[exact.length - 1];

    // In a gap or beyond the final boundary, continue with the nearest prior phase.
    const prior = sorted.filter((p) => age >= Number(p.startAge));
    return prior.length ? prior[prior.length - 1] : sorted[0];
  }

  function normalizedAnnualRate(rate, type, inflation) {
    const r = Number(rate) || 0;
    return type === 'real' ? realToNominal(r, inflation) : r;
  }

  function inBreak(careerBreaks, age) {
    const active = (careerBreaks || []).filter((b) => {
      const start = Number(b.startAge);
      const duration = Number(b.durationMonths || 0) / 12;
      return Number.isFinite(start) && duration > 0 && age >= start && age < start + duration;
    });
    if (!active.length) return null;
    return active.sort((a, b) => Number(a.startAge) - Number(b.startAge))[active.length - 1];
  }

  function project(input) {
    const s = JSON.parse(JSON.stringify(input || {}));
    if (!s.profile || !s.retirement || !s.inflation || !s.contribution || !s.fees) {
      throw new Error('Scenario is missing required fields');
    }

    const currentAge = Number(s.profile.currentAge);
    const retirementAge = Number(s.retirement.retirementAge);
    if (!Number.isFinite(currentAge) || !Number.isFinite(retirementAge) || !(retirementAge > currentAge)) {
      throw new Error('Retirement age must be greater than current age');
    }

    const months = Math.max(1, Math.round((retirementAge - currentAge) * 12));
    const inflationAnnual = Number(s.inflation.annualRate) || 0;
    const monthlyInflation = annualToMonthly(inflationAnnual);
    const baseSalary = Math.max(0, Number(s.profile.monthlySalary) || 0);
    const basePensionable = Math.max(0, Number(s.profile.pensionableSalary ?? baseSalary) || 0);
    const pensionableRatio = baseSalary > 0 ? basePensionable / baseSalary : 1;
    const fixedContributionBase = Math.max(0, Number(s.contribution.fixedAmount) || 0);
    const assetFeeAnnual = clamp(Number(s.fees.annualBalanceFee) || 0, 0, 0.25);
    const monthlyAssetFee = 1 - Math.pow(1 - assetFeeAnnual, 1 / 12);
    const depositFee = clamp(Number(s.fees.depositFee) || 0, 0, 0.25);

    let salary = baseSalary;
    let balance = Math.max(0, Number(s.profile.currentBalance) || 0);
    let inflationIndex = 1;
    let totalContributionsNominal = 0;
    let totalContributionsReal = 0;
    let totalNetContributionsNominal = 0;
    let totalNetContributionsReal = 0;
    let totalFeesNominal = 0;
    let totalFeesReal = 0;
    let totalDepositFeesNominal = 0;
    let totalDepositFeesReal = 0;
    let totalBalanceFeesNominal = 0;
    let totalBalanceFeesReal = 0;
    let totalInvestmentGainNominal = 0;
    let lastBreakId = null;
    let salaryAtBreakStart = null;
    const snapshots = [];

    function snapshot(monthIndex) {
      const age = currentAge + monthIndex / 12;
      snapshots.push({
        month: monthIndex,
        age,
        nominalBalance: balance,
        realBalance: balance / inflationIndex,
        nominalSalary: salary,
        realSalary: salary / inflationIndex,
        totalContributionsNominal,
        totalContributionsReal,
        totalNetContributionsNominal,
        totalNetContributionsReal,
        totalFeesNominal,
        totalFeesReal,
        totalInvestmentGainNominal,
      });
    }

    snapshot(0);

    for (let m = 0; m < months; m++) {
      const age = currentAge + m / 12;
      const activeBreak = inBreak(s.careerBreaks, age);
      const activeBreakId = activeBreak
        ? (activeBreak.id || `${activeBreak.startAge}|${activeBreak.durationMonths}`)
        : null;

      if (activeBreak && lastBreakId !== activeBreakId) {
        salaryAtBreakStart = salary;
        lastBreakId = activeBreakId;
      }

      // Inflation grows continuously, including during employment breaks.
      inflationIndex *= 1 + monthlyInflation;

      const salaryPhase = findPhase(s.salaryPhases, age);
      const salaryAnnual = normalizedAnnualRate(
        salaryPhase?.annualGrowth || 0,
        salaryPhase?.growthType || 'nominal',
        inflationAnnual
      );
      const salaryMonthlyGrowth = annualToMonthly(salaryAnnual);

      // This month's contribution is based on salary before the end-of-month raise.
      let grossContribution = 0;
      if (activeBreak) {
        grossContribution = Math.max(0, Number(activeBreak.contributionDuringBreak) || 0);
      } else if (s.contribution.mode === 'percent') {
        const pensionableSalary = Math.min(
          salary * pensionableRatio,
          Number(s.contribution.pensionableSalaryLimit) > 0
            ? Number(s.contribution.pensionableSalaryLimit)
            : Infinity
        );
        const rate = (Number(s.contribution.employeeRate) || 0) +
          (Number(s.contribution.employerRate) || 0) +
          (Number(s.contribution.severanceRate) || 0);
        grossContribution = Math.max(0, pensionableSalary * rate);
      } else {
        const grows = !!s.contribution.fixedGrowsWithSalary;
        grossContribution = fixedContributionBase * (grows && baseSalary > 0 ? salary / baseSalary : 1);
      }

      const depositFeeAmount = grossContribution * depositFee;
      const netContribution = grossContribution - depositFeeAmount;
      balance += netContribution;

      totalContributionsNominal += grossContribution;
      totalContributionsReal += grossContribution / inflationIndex;
      totalNetContributionsNominal += netContribution;
      totalNetContributionsReal += netContribution / inflationIndex;
      totalFeesNominal += depositFeeAmount;
      totalFeesReal += depositFeeAmount / inflationIndex;
      totalDepositFeesNominal += depositFeeAmount;
      totalDepositFeesReal += depositFeeAmount / inflationIndex;

      const returnPhase = findPhase(s.returnPhases, age);
      const marketAnnualNominal = normalizedAnnualRate(
        returnPhase?.annualReturn || 0,
        returnPhase?.returnType || 'real',
        inflationAnnual
      );
      let monthlyPortfolioReturn = annualToMonthly(marketAnnualNominal);

      if (s.investment?.blendProtected) {
        const wProtected = clamp(Number(s.investment.protectedWeight) || 0, 0, 1);
        const protectedReal = Number(s.investment.protectedRealReturn) || 0;
        const protectedNominal = realToNominal(protectedReal, inflationAnnual);
        const protectedMonthly = annualToMonthly(protectedNominal);
        const marketMonthly = annualToMonthly(marketAnnualNominal);
        monthlyPortfolioReturn = wProtected * protectedMonthly + (1 - wProtected) * marketMonthly;
      }

      const gain = balance * monthlyPortfolioReturn;
      balance += gain;
      totalInvestmentGainNominal += gain;

      const assetFeeAmount = balance * monthlyAssetFee;
      balance -= assetFeeAmount;
      totalFeesNominal += assetFeeAmount;
      totalFeesReal += assetFeeAmount / inflationIndex;
      totalBalanceFeesNominal += assetFeeAmount;
      totalBalanceFeesReal += assetFeeAmount / inflationIndex;

      // Apply salary growth at month end.
      salary *= 1 + salaryMonthlyGrowth;

      // If a break has just ended, apply its configured restart rule.
      const nextAge = currentAge + (m + 1) / 12;
      const nextBreak = inBreak(s.careerBreaks, nextAge);
      if (activeBreak && !nextBreak) {
        if (activeBreak.salaryResumeMode === 'previous' && salaryAtBreakStart != null) {
          salary = salaryAtBreakStart;
        } else if (activeBreak.salaryResumeMode === 'custom') {
          salary = Math.max(0, Number(activeBreak.customRestartSalary) || 0);
        }
        lastBreakId = null;
        salaryAtBreakStart = null;
      }

      if ((m + 1) % 12 === 0 || m === months - 1) snapshot(m + 1);
    }

    const coefficient = Math.max(1, Number(s.retirement.coefficient) || 200);
    const retirementBalanceNominal = balance;
    const retirementBalanceReal = balance / inflationIndex;
    const monthlyPensionNominal = retirementBalanceNominal / coefficient;
    const monthlyPensionReal = retirementBalanceReal / coefficient;
    const startBalance = Math.max(0, Number(s.profile.currentBalance) || 0);
    const investmentGrowthNominal = retirementBalanceNominal - startBalance - totalContributionsNominal + totalFeesNominal;
    const investmentGrowthReal = retirementBalanceReal - startBalance - totalContributionsReal + totalFeesReal;

    return {
      months,
      snapshots,
      inflationIndex,
      retirementBalanceNominal,
      retirementBalanceReal,
      monthlyPensionNominal,
      monthlyPensionReal,
      totalContributionsNominal,
      totalContributionsReal,
      totalNetContributionsNominal,
      totalNetContributionsReal,
      totalFeesNominal,
      totalFeesReal,
      totalDepositFeesNominal,
      totalDepositFeesReal,
      totalBalanceFeesNominal,
      totalBalanceFeesReal,
      totalInvestmentGainNominal,
      investmentGrowthNominal,
      investmentGrowthReal,
      finalSalaryNominal: salary,
      finalSalaryReal: salary / inflationIndex,
    };
  }

  function pensionAtCoefficient(result, coefficient, real = true) {
    const balance = real ? result.retirementBalanceReal : result.retirementBalanceNominal;
    return balance / Math.max(1, Number(coefficient) || 1);
  }

  function cloneScenario(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function extendLastPhase(phases, age) {
    if (!Array.isArray(phases) || !phases.length) return;
    let latest = phases[0];
    for (const phase of phases) {
      if (Number(phase.startAge) >= Number(latest.startAge)) latest = phase;
    }
    latest.endAge = Math.max(age, Number(latest.endAge) || age);
  }

  function retirementAgeSeries(scenario, minAge, maxAge) {
    const rows = [];
    for (let age = Math.ceil(minAge); age <= Math.floor(maxAge); age++) {
      if (age <= Number(scenario.profile.currentAge)) continue;
      const copy = cloneScenario(scenario);
      copy.retirement.retirementAge = age;
      extendLastPhase(copy.salaryPhases, age);
      extendLastPhase(copy.returnPhases, age);
      try {
        const r = project(copy);
        rows.push({
          age,
          realBalance: r.retirementBalanceReal,
          realPension: r.monthlyPensionReal,
          nominalBalance: r.retirementBalanceNominal,
          nominalPension: r.monthlyPensionNominal,
        });
      } catch (_) {}
    }
    return rows;
  }

  function compareScenarios(a, b) {
    const ra = project(a);
    const rb = project(b);
    return {
      balanceRealDelta: rb.retirementBalanceReal - ra.retirementBalanceReal,
      pensionRealDelta: rb.monthlyPensionReal - ra.monthlyPensionReal,
      balanceNominalDelta: rb.retirementBalanceNominal - ra.retirementBalanceNominal,
      pensionNominalDelta: rb.monthlyPensionNominal - ra.monthlyPensionNominal,
    };
  }

  return {
    clamp,
    annualToMonthly,
    realToNominal,
    nominalToReal,
    findPhase,
    project,
    pensionAtCoefficient,
    retirementAgeSeries,
    compareScenarios,
    cloneScenario,
  };
});
