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
  if (metrics.headlineSummary) {
    const headline = metrics.headlineSummary;
    console.log(`  HEADLINE supported new-pension independent parents: ${headline.automaticDocuments}/${headline.documents} automatic (${pct(headline.automaticCoverage)}) @ ${pct(headline.automaticCriticalAccuracy)} critical; unsafe=${headline.unsafeWrongAcceptances}`);
    const stats = headline.statisticalAccuracy;
    console.log(`  Exact-binomial accuracy: successes=${stats.successes}; failures=${stats.failures}; observed=${pct(stats.observedAccuracy)}; one-sided 95% lower bound=${pct(stats.oneSided95LowerBound)}; independent automatic n=${stats.independentSampleSize}; additional zero-failure successes required=${stats.additionalZeroFailureSuccessesRequired}`);
  }
  console.log(`  Supported new-pension documents (parents + augmentations): ${summary.documents}`);
  console.log(`  Automatic documents: ${summary.automaticDocuments}; review documents: ${summary.reviewDocuments}`);
  console.log(`  Automatic coverage: ${pct(summary.automaticCoverage)}`);
  console.log(`  Automatic critical accuracy: ${pct(summary.automaticCriticalAccuracy)}`);
  console.log(`  Review rate: ${pct(summary.reviewRate)}`);
  console.log(`  Unsafe wrong acceptances: ${summary.unsafeWrongAcceptances} (${pct(summary.unsafeWrongAcceptanceRate)})`);
  console.log(`  Safe outcome rate: ${pct(summary.safeOutcomeRate)}`);
  console.log(`  Independent parents: ${summary.independentParentCount}; augmentations: ${summary.augmentationCount}`);
  console.log(`  Old-pension safe unsupported routing: ${metrics.oldPensionRouting.correctlyRouted}/${metrics.oldPensionRouting.documents}; exact fund classification=${metrics.oldPensionRouting.correctlyClassifiedFundType}/${metrics.oldPensionRouting.documents} (${pct(metrics.oldPensionRouting.fundTypeClassificationAccuracy)}); incorrectly forecasted=${metrics.oldPensionRouting.incorrectlyForecasted}; routing accuracy=${pct(metrics.oldPensionRouting.routingAccuracy)}`);
  console.log(`  Unknown routing: ${metrics.unknownRouting.correctlyRouted}/${metrics.unknownRouting.documents}; accuracy=${pct(metrics.unknownRouting.routingAccuracy)}`);
  console.log(`  All-document routing: ${metrics.allDocumentRouting.correctlyRouted}/${metrics.allDocumentRouting.documents}; incorrectly forecasted=${metrics.allDocumentRouting.incorrectlyForecasted}; accuracy=${pct(metrics.allDocumentRouting.routingAccuracy)}`);
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
  console.log('  Independent parents vs augmentations:');
  for (const [name, group] of Object.entries(metrics.groups.lineage)) printGroup(name, group);
  console.log('  Remaining supported-new failure reasons:');
  const failures = Object.entries(metrics.supportedNewFailureReasonCounts || metrics.failureReasonCounts);
  if (!failures.length) console.log('    none');
  else failures.sort(([left], [right]) => left.localeCompare(right)).forEach(([reason, count]) => console.log(`    ${reason}: ${count}`));
}

module.exports = { pct, printPensionExtractionMetrics };
