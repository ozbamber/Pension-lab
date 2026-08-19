(function (root) {
  'use strict';
  const F = root.PensionFinancial;
  function value(fields, name) { const item = fields && fields[name]; return item && item.value != null ? item : null; }
  function monthKey(text) { const match = String(text || '').match(/(0?[1-9]|1[0-2])[\/.\-](20\d{2})/); return match ? Number(match[2]) * 12 + Number(match[1]) : 0; }
  function combine(primary, secondary, options = {}) {
    if (!primary) return secondary ? { ...secondary } : null;
    if (!secondary) return { ...primary };
    const agrees = F.approximatelyEqual(primary.value, secondary.value, options.absoluteTolerance || 2, options.relativeTolerance || 0.025);
    if (agrees) return { ...primary, confidence: Math.min(0.995, Math.max(primary.confidence || 0, secondary.confidence || 0) + 0.08), requiresConfirmation: false, source: 'crossValidated', evidence: [primary, secondary, { type: 'CROSS_DOCUMENT_VALIDATION' }] };
    if ((secondary.confidence || 0) >= (primary.confidence || 0) + 0.07) {
      return { ...secondary, evidence: [primary, secondary, { type: 'STRONGER_INDEPENDENT_EVIDENCE' }] };
    }
    const primaryDate = monthKey(primary.evidence?.salaryMonth || primary.sourceDate);
    const secondaryDate = monthKey(secondary.evidence?.salaryMonth || secondary.sourceDate);
    if (primaryDate && secondaryDate && primaryDate > secondaryDate) return { ...primary, evidence: [primary, secondary, { type: 'CHRONOLOGY_RESOLVED' }] };
    return { ...primary, confidence: Math.min(primary.confidence || 0.8, 0.78), requiresConfirmation: true, conflict: { primary: primary.value, secondary: secondary.value }, evidence: [primary, secondary, { type: 'CROSS_DOCUMENT_CONFLICT' }] };
  }
  function reconcile(payslipFields = {}, reportFields = {}) {
    const fields = {};
    fields.insuredSalary = combine(value(payslipFields, 'insuredSalary'), value(reportFields, 'latestReportedPensionableSalary'));
    fields.employeeContributionAmount = combine(value(payslipFields, 'employeeContributionAmount'), value(reportFields, 'latestEmployeeContributionAmount'));
    fields.employeeContributionRate = combine(value(payslipFields, 'employeeContributionRate'), value(reportFields, 'latestEmployeeContributionRate'), { absoluteTolerance: 0.0008, relativeTolerance: 0.025 });
    fields.employerContributionAmount = combine(value(payslipFields, 'employerContributionAmount'), value(reportFields, 'latestEmployerContributionAmount'));
    fields.employerContributionRate = combine(value(payslipFields, 'employerContributionRate'), value(reportFields, 'latestEmployerContributionRate'), { absoluteTolerance: 0.0008, relativeTolerance: 0.025 });
    fields.severanceContributionAmount = combine(value(payslipFields, 'severanceContributionAmount'), value(reportFields, 'latestSeveranceContributionAmount'));
    fields.severanceRate = combine(value(payslipFields, 'severanceRate'), value(reportFields, 'latestSeveranceRate'), { absoluteTolerance: 0.001, relativeTolerance: 0.03 });
    fields.currentBalance = value(reportFields, 'currentBalance');
    fields.balanceDate = value(reportFields, 'balanceDate');
    fields.reportDate = value(reportFields, 'reportDate');
    fields.pensionProvider = value(reportFields, 'pensionProvider');
    fields.depositManagementFeeRate = value(reportFields, 'depositManagementFeeRate');
    fields.balanceManagementFeeRate = value(reportFields, 'balanceManagementFeeRate');
    return { fields: Object.fromEntries(Object.entries(fields).filter(([, item]) => item)), requiresConfirmation: Object.values(fields).some((item) => item?.requiresConfirmation) };
  }
  root.PensionInputReconciler = Object.freeze({ reconcile });
})(typeof window !== 'undefined' ? window : globalThis);
