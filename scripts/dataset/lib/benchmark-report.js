'use strict';

function pct(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function printGroup(name, group) {
  console.log(`  ${name}: ${group.automaticDocuments}/${group.documents} automatic (${pct(group.automaticCoverage)}) @ ${pct(group.automaticCriticalAccuracy)} critical; unsafe=${group.unsafeWrongAcceptances}; row F1=${pct(group.rowDetection.f1)}`);
}

function printPensionExtractionMetrics(metrics, title = 'Pension-report extraction metrics') {
  const summary = metrics.summary;
  console.log(`${title}:`);
  if (metrics.headlineSummary && metrics.headlineSummary.documents !== summary.documents) {
    const headline = metrics.headlineSummary;
    console.log(`  Headline synthetic parents: ${headline.automaticDocuments}/${headline.documents} automatic (${pct(headline.automaticCoverage)}) @ ${pct(headline.automaticCriticalAccuracy)} critical; unsafe=${headline.unsafeWrongAcceptances}`);
  }
  console.log(`  Documents: ${summary.documents}`);
  console.log(`  Automatic documents: ${summary.automaticDocuments}; review documents: ${summary.reviewDocuments}`);
  console.log(`  Automatic coverage: ${pct(summary.automaticCoverage)}`);
  console.log(`  Automatic critical accuracy: ${pct(summary.automaticCriticalAccuracy)}`);
  console.log(`  Review rate: ${pct(summary.reviewRate)}`);
  console.log(`  Unsafe wrong acceptances: ${summary.unsafeWrongAcceptances} (${pct(summary.unsafeWrongAcceptanceRate)})`);
  console.log(`  Safe outcome rate: ${pct(summary.safeOutcomeRate)}`);
  console.log(`  Tables: expected=${summary.tableDetection.expected}; detected=${summary.tableDetection.detected}; recall=${pct(summary.tableDetection.recall)}`);
  console.log(`  Rows: expected=${summary.rowDetection.expected}; detected=${summary.rowDetection.detected}; false extras=${summary.rowDetection.falseExtra}; precision=${pct(summary.rowDetection.precision)}; recall=${pct(summary.rowDetection.recall)}; F1=${pct(summary.rowDetection.f1)}`);
  console.log('  Row field accuracy:');
  for (const [field, accuracy] of Object.entries(summary.rowFieldAccuracy)) console.log(`    ${field}: ${pct(accuracy)}`);
  console.log(`  Normalized month accuracy: ${pct(summary.normalization.normalizedMonthAccuracy)}`);
  console.log(`  Duplicate handling accuracy: ${pct(summary.normalization.duplicateHandlingAccuracy)}`);
  console.log(`  Ambiguous/correction handling accuracy: ${pct(summary.normalization.ambiguousHandlingAccuracy)}`);
  console.log(`  Baseline monthly contribution accuracy: ${pct(summary.derived.baselineMonthlyContributionAccuracy)}`);
  console.log(`  Average reported pension salary accuracy: ${pct(summary.derived.averageReportedPensionSalaryAccuracy)}`);
  console.log(`  Derived rates: employee=${pct(summary.derived.employeeContributionRateAccuracy)}; employer=${pct(summary.derived.employerContributionRateAccuracy)}; severance=${pct(summary.derived.severanceRateAccuracy)}`);
  console.log(`  Critical fields: balance=${pct(summary.criticalFields.currentBalanceAccuracy)}; deposit fee=${pct(summary.criticalFields.depositManagementFeeAccuracy)}; balance fee=${pct(summary.criticalFields.balanceManagementFeeAccuracy)}`);
  console.log('  Annual vs quarterly:');
  for (const [name, group] of Object.entries(metrics.groups.reportType)) printGroup(name, group);
  console.log('  Text-layer vs image-only:');
  for (const [name, group] of Object.entries(metrics.groups.textLayer)) printGroup(name, group);
  console.log('  Synthetic parents vs augmented children:');
  for (const [name, group] of Object.entries(metrics.groups.lineage)) printGroup(name, group);
  console.log('  Failure reasons:');
  const failures = Object.entries(metrics.failureReasonCounts);
  if (!failures.length) console.log('    none');
  else failures.sort(([left], [right]) => left.localeCompare(right)).forEach(([reason, count]) => console.log(`    ${reason}: ${count}`));
}

module.exports = { pct, printPensionExtractionMetrics };
