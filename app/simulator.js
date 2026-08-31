(function (root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./engine.js') : root.PensionEngine;
  const config = typeof module === 'object' && module.exports ? require('./simulator-config.js') : root.PensionSimulatorConfig;
  const api = factory(engine, config);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PensionSimulator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E, C) {
  'use strict';

  if (!E || !C) throw new Error('Pension simulator dependencies are missing.');

  const EPSILON = 1e-12;

  function finite(value) {
    if (value == null || (typeof value === 'string' && !value.trim())) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key], seen));
    return Object.freeze(value);
  }

  function sameNumber(a, b) {
    const left = finite(a);
    const right = finite(b);
    return left != null && right != null && Math.abs(left - right) <= EPSILON;
  }

  function supportedNewPension(report) {
    return report?.fundType === 'new_pension' && report?.supportedForCurrentForecast === true;
  }

  function expandConfigToIncludeBaseline(template, baselineValue) {
    const baseline = finite(baselineValue);
    if (baseline == null) throw new Error(`Missing baseline for ${template.id}.`);
    const span = template.max - template.min;
    const extension = Math.max(template.step * 2, Math.abs(baseline) * 0.08, span * 0.08);
    const expandedMin = baseline < template.min ? Math.min(template.min, baseline - extension) : template.min;
    return {
      ...template,
      min: template.min >= 0 ? Math.max(0, expandedMin) : expandedMin,
      max: baseline > template.max ? Math.max(template.max, baseline + extension) : template.max,
      baselineValue: baseline,
    };
  }

  function deriveContributionControl(report, options = {}) {
    const baselineMonthlyContribution = finite(report?.derived?.baselineMonthlyContribution);
    const averageReportedPensionSalary = finite(report?.derived?.averageReportedPensionSalary);
    if (baselineMonthlyContribution == null || baselineMonthlyContribution < 0) {
      throw new Error('A confirmed monthly pension contribution is required for the simulator.');
    }
    const monthsUsed = finite(report?.derived?.monthsUsed) || 0;
    const salaryConfirmed = options.salaryConfirmed === true;
    const hasReliableSalary = averageReportedPensionSalary != null && averageReportedPensionSalary > 0 && (monthsUsed >= 1 || salaryConfirmed);
    if (!hasReliableSalary) {
      return deepFreeze({
        type: 'amount',
        baselineMonthlyContribution,
        averageReportedPensionSalary: null,
        baselineValue: C.SLIDERS.monthlyContribution.baselineValue,
        config: expandConfigToIncludeBaseline(C.SLIDERS.monthlyContribution, C.SLIDERS.monthlyContribution.baselineValue),
      });
    }
    const baselineRate = baselineMonthlyContribution / averageReportedPensionSalary;
    if (!Number.isFinite(baselineRate) || baselineRate < 0 || baselineRate > 1) {
      return deepFreeze({
        type: 'amount',
        baselineMonthlyContribution,
        averageReportedPensionSalary: null,
        baselineValue: C.SLIDERS.monthlyContribution.baselineValue,
        config: expandConfigToIncludeBaseline(C.SLIDERS.monthlyContribution, C.SLIDERS.monthlyContribution.baselineValue),
      });
    }
    return deepFreeze({
      type: 'rate',
      baselineMonthlyContribution,
      averageReportedPensionSalary,
      baselineValue: baselineRate,
      config: expandConfigToIncludeBaseline(C.SLIDERS.contributionRate, baselineRate),
    });
  }

  function buildSimulatorBaseline(report, yearsUntilRetirement, options = {}) {
    if (!supportedNewPension(report)) throw new Error('A confirmed new-pension fund type is required for the simulator.');
    const projection = E.projectBaseline(report, yearsUntilRetirement, {
      realReturnRate: C.BASELINE.realReturnRate,
      inflationRate: C.BASELINE.inflationRate,
      coefficient: C.BASELINE.coefficient,
    });
    const contribution = deriveContributionControl(report, options);
    const depositFee = finite(report?.fees?.depositRate);
    const balanceFee = finite(report?.fees?.balanceRate);
    if (depositFee == null || depositFee < 0 || balanceFee == null || balanceFee < 0) {
      throw new Error('Confirmed management fees are required for the simulator.');
    }
    const controls = {
      nominalReturn: C.BASELINE.nominalReturnRate,
      inflation: C.BASELINE.inflationRate,
      contribution: contribution.baselineValue,
      depositFee,
      balanceFee,
    };
    const controlsConfig = {
      nominalReturn: expandConfigToIncludeBaseline(C.SLIDERS.nominalReturn, controls.nominalReturn),
      inflation: expandConfigToIncludeBaseline(C.SLIDERS.inflation, controls.inflation),
      contribution: contribution.config,
      depositFee: expandConfigToIncludeBaseline(C.SLIDERS.depositFee, controls.depositFee),
      balanceFee: expandConfigToIncludeBaseline(C.SLIDERS.balanceFee, controls.balanceFee),
    };
    return deepFreeze({
      yearsUntilRetirement: projection.yearsUntilRetirement,
      monthsUntilRetirement: projection.monthsUntilRetirement,
      engineScenario: projection.scenario,
      projection,
      contribution,
      baselineControls: controls,
      controlsConfig,
      assumptions: {
        realReturnRate: C.BASELINE.realReturnRate,
        inflationRate: C.BASELINE.inflationRate,
        nominalReturnRate: C.BASELINE.nominalReturnRate,
        coefficient: C.BASELINE.coefficient,
      },
    });
  }

  function normalizeControlValue(config, value, fallback) {
    const numeric = finite(value);
    if (numeric == null) return fallback;
    return clamp(numeric, config.min, config.max);
  }

  function selectedMonthlyContribution(baseline, contributionValue) {
    const selected = baseline.contribution.type === 'rate'
      ? baseline.contribution.averageReportedPensionSalary * contributionValue
      : baseline.contribution.baselineMonthlyContribution * contributionValue;
    return Math.max(0, selected);
  }

  function applySimulatorOverrides(baselineScenario, controls = {}) {
    if (!baselineScenario || !baselineScenario.engineScenario) throw new Error('A simulator baseline is required.');
    const baselineControls = baselineScenario.baselineControls;
    const configs = baselineScenario.controlsConfig;
    const selectedControls = {
      nominalReturn: normalizeControlValue(configs.nominalReturn, controls.nominalReturn, baselineControls.nominalReturn),
      inflation: normalizeControlValue(configs.inflation, controls.inflation, baselineControls.inflation),
      contribution: normalizeControlValue(configs.contribution, controls.contribution, baselineControls.contribution),
      depositFee: normalizeControlValue(configs.depositFee, controls.depositFee, baselineControls.depositFee),
      balanceFee: normalizeControlValue(configs.balanceFee, controls.balanceFee, baselineControls.balanceFee),
    };
    const scenario = deepClone(baselineScenario.engineScenario);
    const changedInflation = !sameNumber(selectedControls.inflation, baselineControls.inflation);
    const changedReturn = !sameNumber(selectedControls.nominalReturn, baselineControls.nominalReturn);
    const changedContribution = !sameNumber(selectedControls.contribution, baselineControls.contribution);
    const changedDepositFee = !sameNumber(selectedControls.depositFee, baselineControls.depositFee);
    const changedBalanceFee = !sameNumber(selectedControls.balanceFee, baselineControls.balanceFee);

    if (changedInflation) scenario.inflation.annualRate = selectedControls.inflation;
    if (changedInflation || changedReturn) {
      scenario.returnPhases[0].annualReturn = E.nominalToReal(selectedControls.nominalReturn, selectedControls.inflation);
      scenario.returnPhases[0].returnType = 'real';
    }
    const monthlyContribution = selectedMonthlyContribution(baselineScenario, selectedControls.contribution);
    if (changedContribution) scenario.contribution.fixedAmount = monthlyContribution;
    if (changedDepositFee) scenario.fees.depositFee = selectedControls.depositFee;
    if (changedBalanceFee) scenario.fees.annualBalanceFee = selectedControls.balanceFee;

    return deepFreeze({
      engineScenario: scenario,
      controls: selectedControls,
      impliedRealReturn: E.nominalToReal(selectedControls.nominalReturn, selectedControls.inflation),
      selectedMonthlyContribution: monthlyContribution,
      selectedDepositFee: selectedControls.depositFee,
      selectedBalanceFee: selectedControls.balanceFee,
      coefficient: C.BASELINE.coefficient,
      yearsUntilRetirement: baselineScenario.yearsUntilRetirement,
      monthsUntilRetirement: baselineScenario.monthsUntilRetirement,
    });
  }

  function projectSimulatorScenario(selectedScenario) {
    if (!selectedScenario?.engineScenario) throw new Error('A selected simulator scenario is required.');
    return E.project(selectedScenario.engineScenario);
  }

  function deltaPercent(delta, baseline) {
    const base = Number(baseline);
    return Math.abs(base) <= EPSILON ? null : delta / Math.abs(base);
  }

  function compareSimulatorScenario(baselineScenario, selectedScenario) {
    const baseline = baselineScenario?.projection;
    if (!baseline) throw new Error('A simulator baseline projection is required.');
    const scenario = projectSimulatorScenario(selectedScenario);
    const retirementBalanceRealDelta = scenario.retirementBalanceReal - baseline.retirementBalanceReal;
    const retirementBalanceNominalDelta = scenario.retirementBalanceNominal - baseline.retirementBalanceNominal;
    const monthlyPensionRealDelta = scenario.monthlyPensionReal - baseline.monthlyPensionReal;
    const monthlyPensionNominalDelta = scenario.monthlyPensionNominal - baseline.monthlyPensionNominal;
    return {
      baseline,
      scenario,
      retirementBalanceRealDelta,
      retirementBalanceRealDeltaPercent: deltaPercent(retirementBalanceRealDelta, baseline.retirementBalanceReal),
      retirementBalanceNominalDelta,
      retirementBalanceNominalDeltaPercent: deltaPercent(retirementBalanceNominalDelta, baseline.retirementBalanceNominal),
      monthlyPensionRealDelta,
      monthlyPensionRealDeltaPercent: deltaPercent(monthlyPensionRealDelta, baseline.monthlyPensionReal),
      monthlyPensionNominalDelta,
      monthlyPensionNominalDeltaPercent: deltaPercent(monthlyPensionNominalDelta, baseline.monthlyPensionNominal),
      selectedNominalReturn: selectedScenario.controls.nominalReturn,
      selectedInflation: selectedScenario.controls.inflation,
      impliedRealReturn: selectedScenario.impliedRealReturn,
      selectedMonthlyContribution: selectedScenario.selectedMonthlyContribution,
      selectedDepositFee: selectedScenario.selectedDepositFee,
      selectedBalanceFee: selectedScenario.selectedBalanceFee,
    };
  }

  function resetSimulatorControls(baselineScenario) {
    return deepClone(baselineScenario?.baselineControls || {});
  }

  function controlsAtBaseline(baselineScenario, controls) {
    if (!baselineScenario) return false;
    return Object.keys(baselineScenario.baselineControls).every((key) => sameNumber(
      controls?.[key],
      baselineScenario.baselineControls[key]
    ));
  }

  function scenarioRangeStatus(config, value) {
    const numeric = finite(value);
    if (numeric == null) return 'extreme';
    if (numeric >= config.centralMin && numeric <= config.centralMax) return 'central';
    if (numeric >= config.moderateMin && numeric <= config.moderateMax) return 'moderate';
    return 'extreme';
  }

  function valueToPosition(config, value) {
    const numeric = clamp(finite(value) ?? config.min, config.min, config.max);
    return Math.round(((numeric - config.min) / (config.max - config.min)) * C.SLIDER_POSITION_MAX);
  }

  function positionToValue(config, position) {
    const numeric = clamp(finite(position) ?? 0, 0, C.SLIDER_POSITION_MAX);
    return config.min + (numeric / C.SLIDER_POSITION_MAX) * (config.max - config.min);
  }

  function snapToStep(config, value) {
    const clamped = clamp(value, config.min, config.max);
    const steps = Math.round((clamped - config.min) / config.step);
    const decimalPlaces = Math.max(0, String(config.step).split('.')[1]?.length || 0) + 4;
    const snapped = Number((config.min + steps * config.step).toFixed(decimalPlaces));
    return clamp(snapped, config.min, config.max);
  }

  return Object.freeze({
    config: C,
    supportedNewPension,
    deriveContributionControl,
    buildSimulatorBaseline,
    applySimulatorOverrides,
    projectSimulatorScenario,
    compareSimulatorScenario,
    resetSimulatorControls,
    controlsAtBaseline,
    scenarioRangeStatus,
    valueToPosition,
    positionToValue,
    snapToStep,
  });
});
