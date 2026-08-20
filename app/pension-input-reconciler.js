(function (root) {
  'use strict';

  const F = root.PensionFinancial;
  const RELIABLE_PERIOD_CONFIDENCE = 0.8;
  const STRONG_EVIDENCE_MARGIN = 0.18;

  function value(fields, name) {
    const item = fields && fields[name];
    return item && item.value != null ? item : null;
  }

  function monthKey(text) {
    const match = String(text || '').match(/(0?[1-9]|1[0-2])[\/.\-](20\d{2})/);
    return match ? Number(match[2]) * 12 + Number(match[1]) : 0;
  }

  function period(field, fallback) {
    const raw = field?.sourceDate || field?.evidence?.salaryMonth || fallback?.sourceDate || fallback?.value || null;
    const confidence = Number(field?.evidence?.sourceDateConfidence ?? fallback?.confidence ?? (field?.evidence?.salaryMonth ? 0.95 : 0));
    return {
      value: raw,
      key: monthKey(raw),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reliable: Boolean(monthKey(raw) && confidence >= RELIABLE_PERIOD_CONFIDENCE),
    };
  }

  function evidenceStrength(item) {
    if (!item) return 0;
    let strength = Number(item.confidence) || 0;
    if (item.origin === 'direct') strength += 0.025;
    if (item.origin === 'derived') strength -= 0.025;
    if (item.extractionMethod === 'ocr' || item.evidence?.method === 'ocr') strength -= 0.04;
    if (item.evidence?.recurringPattern?.recurring) strength += 0.035;
    return strength;
  }

  function decisionEvidence(type, primary, secondary, primaryPeriod, secondaryPeriod) {
    return {
      type,
      observations: [primary, secondary],
      periods: {
        primary: { value: primaryPeriod.value, confidence: primaryPeriod.confidence, reliable: primaryPeriod.reliable },
        secondary: { value: secondaryPeriod.value, confidence: secondaryPeriod.confidence, reliable: secondaryPeriod.reliable },
      },
    };
  }

  function combine(primary, secondary, options = {}) {
    if (!primary) return secondary ? { ...secondary } : null;
    if (!secondary) return { ...primary };

    const primaryPeriod = period(primary, options.primaryPeriod);
    const secondaryPeriod = period(secondary, options.secondaryPeriod);
    const evidence = (type) => decisionEvidence(type, primary, secondary, primaryPeriod, secondaryPeriod);
    const agrees = F.approximatelyEqual(primary.value, secondary.value, options.absoluteTolerance || 2, options.relativeTolerance || 0.025);
    if (agrees) {
      const newestDate = primaryPeriod.key >= secondaryPeriod.key ? primaryPeriod.value : secondaryPeriod.value;
      return {
        ...primary,
        sourceDate: newestDate || primary.sourceDate || secondary.sourceDate || null,
        confidence: Math.min(0.995, Math.max(primary.confidence || 0, secondary.confidence || 0) + 0.08),
        requiresConfirmation: false,
        source: 'crossValidated',
        evidence: evidence('CROSS_DOCUMENT_VALIDATION'),
      };
    }

    if (primaryPeriod.reliable && secondaryPeriod.reliable && primaryPeriod.key !== secondaryPeriod.key) {
      const winner = primaryPeriod.key > secondaryPeriod.key ? primary : secondary;
      const winnerPeriod = primaryPeriod.key > secondaryPeriod.key ? primaryPeriod : secondaryPeriod;
      return {
        ...winner,
        sourceDate: winnerPeriod.value,
        evidence: evidence('CHRONOLOGY_RESOLVED'),
      };
    }

    if ((primaryPeriod.value && !primaryPeriod.reliable) || (secondaryPeriod.value && !secondaryPeriod.reliable)) {
      return {
        ...primary,
        sourceDate: primaryPeriod.value || primary.sourceDate || null,
        confidence: Math.min(primary.confidence || 0.8, 0.78),
        requiresConfirmation: true,
        conflict: {
          primary: primary.value,
          secondary: secondary.value,
          primaryPeriod: primaryPeriod.value,
          secondaryPeriod: secondaryPeriod.value,
        },
        evidence: evidence('CROSS_DOCUMENT_CONFLICT'),
      };
    }

    const primaryStrength = evidenceStrength(primary);
    const secondaryStrength = evidenceStrength(secondary);
    if (Math.abs(primaryStrength - secondaryStrength) >= STRONG_EVIDENCE_MARGIN) {
      const winner = secondaryStrength > primaryStrength ? secondary : primary;
      const winnerPeriod = secondaryStrength > primaryStrength ? secondaryPeriod : primaryPeriod;
      return {
        ...winner,
        sourceDate: winnerPeriod.value || winner.sourceDate || null,
        evidence: evidence('STRONGER_INDEPENDENT_EVIDENCE'),
      };
    }

    return {
      ...primary,
      sourceDate: primaryPeriod.value || primary.sourceDate || null,
      confidence: Math.min(primary.confidence || 0.8, 0.78),
      requiresConfirmation: true,
      conflict: {
        primary: primary.value,
        secondary: secondary.value,
        primaryPeriod: primaryPeriod.value,
        secondaryPeriod: secondaryPeriod.value,
      },
      evidence: evidence('CROSS_DOCUMENT_CONFLICT'),
    };
  }

  function reconcile(payslipFields = {}, reportFields = {}) {
    const fields = {};
    const periods = {
      primaryPeriod: value(payslipFields, 'payslipMonth'),
      secondaryPeriod: value(reportFields, 'latestReportedPensionableSalary'),
    };
    fields.insuredSalary = combine(value(payslipFields, 'insuredSalary'), value(reportFields, 'latestReportedPensionableSalary'), periods);
    fields.employeeContributionAmount = combine(value(payslipFields, 'employeeContributionAmount'), value(reportFields, 'latestEmployeeContributionAmount'), periods);
    fields.employeeContributionRate = combine(value(payslipFields, 'employeeContributionRate'), value(reportFields, 'latestEmployeeContributionRate'), { ...periods, absoluteTolerance: 0.0008, relativeTolerance: 0.025 });
    fields.employerContributionAmount = combine(value(payslipFields, 'employerContributionAmount'), value(reportFields, 'latestEmployerContributionAmount'), periods);
    fields.employerContributionRate = combine(value(payslipFields, 'employerContributionRate'), value(reportFields, 'latestEmployerContributionRate'), { ...periods, absoluteTolerance: 0.0008, relativeTolerance: 0.025 });
    fields.severanceContributionAmount = combine(value(payslipFields, 'severanceContributionAmount'), value(reportFields, 'latestSeveranceContributionAmount'), periods);
    fields.severanceRate = combine(value(payslipFields, 'severanceRate'), value(reportFields, 'latestSeveranceRate'), { ...periods, absoluteTolerance: 0.001, relativeTolerance: 0.03 });
    fields.currentBalance = value(reportFields, 'currentBalance');
    fields.balanceDate = value(reportFields, 'balanceDate');
    fields.reportDate = value(reportFields, 'reportDate');
    fields.pensionProvider = value(reportFields, 'pensionProvider');
    fields.depositManagementFeeRate = value(reportFields, 'depositManagementFeeRate');
    fields.balanceManagementFeeRate = value(reportFields, 'balanceManagementFeeRate');
    return {
      fields: Object.fromEntries(Object.entries(fields).filter(([, item]) => item)),
      requiresConfirmation: Object.values(fields).some((item) => item?.requiresConfirmation),
    };
  }

  root.PensionInputReconciler = Object.freeze({ reconcile });
})(typeof window !== 'undefined' ? window : globalThis);
