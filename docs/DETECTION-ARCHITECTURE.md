# Detection Architecture

## Scope and privacy boundary

Pension Lab's primary PR1 path processes one annual or quarterly pension report locally in the browser. PDF text extraction, optional OCR, normalization, arithmetic validation, and forecast calculation run without uploading the document. The session can retain confirmed normalized values, but it excludes the file, filename, and raw PDF/OCR/contribution-row text.

Historical payslip and cross-document reconciliation modules remain isolated for regression coverage. The running application does not load them and the normal pension-report flow does not depend on them.

## Report pipeline

1. PDF.js extracts text tokens with page geometry from up to ten pages.
2. A multi-signal assessment decides whether the native text layer is useful. Image-only reports use locally bundled Tesseract `heb+eng` OCR; incomplete OCR remains reviewable.
3. Financial normalization handles shekel markers, grouping/decimal punctuation, percentages, signs, and conservative OCR digit repair.
4. Hebrew and English semantic aliases identify closing balance, personal deposit/balance fees, provider metadata, report date/type, and contribution-table headers.
5. Tokens are grouped into page rows. Structured geometry associates values with the nearest semantic columns and supports reversed RTL order. Flat text uses header order and arithmetic identities as a conservative fallback.
6. Annual and quarterly classification is metadata only. Both use the same field and contribution-history model.
7. The result is an explicit `pensionReportState` containing report metadata, fees, every raw contribution row, reliable normalized salary months, derived means/rates, evidence identifiers, and review issues.

## Contribution rows

A raw contribution row can preserve:

- employer name;
- deposit date;
- salary month;
- reported pension salary;
- employee, employer, and severance amounts;
- explicit or component-derived total contribution;
- source page, confidence, issues, and compact evidence.

Salary month is required for monthly normalization. Annual, YTD, cumulative, and summary rows are excluded. Dates, balances, management-fee amounts, and report metadata are not reused as monthly contribution values.

## Arithmetic and normalization

- When all three components are present, their sum is the expected monthly total.
- A printed total is preferred only when it agrees with the components within a small amount/relative tolerance.
- A plausible printed total can support a row with one missing component, but the missing component remains `null`; it is not invented.
- A conflicting printed total marks the row for review and excludes it from the baseline.
- Exact duplicate rows remain in raw history and are canonicalized once for the month.
- Distinct identified employers can be aggregated for one salary month.
- Conflicting rows for the same employer—or unidentified conflicting duplicates—mark the month ambiguous; no row is selected silently.

For every reliable normalized month:

`monthlyPensionDeposit = employee + employer + severance`

or the arithmetically consistent explicit total. One reliable month becomes the baseline. With two or more reliable months, `baselineMonthlyContribution` is the arithmetic mean of all reliable monthly totals. `averageReportedPensionSalary` and representative component rates use the same reliable-month set, but they are supporting information rather than the forecast's cash-flow source.

## Forecast gate

The automatic baseline forecast requires confirmed current balance, monthly contribution, deposit fee, balance fee, and years until retirement. A missing provider never blocks calculation. Missing numeric values remain missing and the engine refuses to replace them silently with zero.

`yearsUntilRetirement × 12` determines the horizon exactly. The baseline monthly contribution remains constant in real terms and is converted through the existing inflation machinery for nominal internal cash flows. The existing real-return methodology remains authoritative.

## Provenance and review

- `direct` values are selected document observations.
- `derived` values are arithmetic results from direct observations.
- Evidence stores alias, row, page, method, header association, and explicit-total status.
- Low-confidence OCR, conflicting totals, ambiguous salary months, and missing critical values remain visible for user review.
- Provider abstention is allowed; financial evidence is not discarded because provider identification failed.

## Regression and benchmark coverage

Deterministic tests cover annual 12-row and quarterly 3-row reports, quarterly YTD distractors, one/multiple months, mean salary and deposit, non-standard rates, partial components with explicit total, total mismatch, summary exclusion, duplicate/correction ambiguity, missing provider/fees/balance, report-only completion, absence of age fields, and exact forecast horizon.

Dataset v2 reports field, critical-document, annual/quarterly, and text-layer/image-only metrics separately. Its current ground truth does not annotate full contribution histories, so history field accuracy is reported as unavailable; raw-row and normalized-month counts are reported without pretending they are accuracy.
