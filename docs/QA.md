# QA status

Reviewed: **2026-08-23**.

This review covers the pension-report-first PR1 flow on `codex/dataset-v2-evaluation`. The product accepts one annual or quarterly pension report, reviews the extracted pension state, asks only for years until retirement, and produces one baseline forecast. PR2 what-if controls are intentionally outside this change.

## Completed suites

- `npm run test:engine`: **23/23** projection-engine tests passed.
- `npm run test:documents`: **10/10** document-model tests passed.
- `npm run test:ocr`: **30/30** financial/spatial parser tests passed.
- `npm run test:pension`: **24/24** legacy pension-report/reconciliation regressions plus **14/14** new pension-report-state acceptance tests passed.
- `npm run test:dataset`: **9/9** Dataset v2 contract tests passed.
- `npm run dataset:validate`: **66/66** documents and ground-truth records passed; 54 have a text layer and 12 are image-only.
- `npm run test:browser:smoke`: the complete report-only flow passed at **1440×1000** and **390×844**, including exact 144-month projection for 12 years, real/nominal switching, no payslip or age fields, no PR2 controls, and no horizontal overflow.
- `npm run test:browser:ocr`: **5/5** native-report, local OCR, privacy/session, mobile-overflow, and cancellation groups passed.
- `npm run test:browser:standalone`: **4/4** generated-artifact groups passed, including 10 local vendor URLs, native report parsing, scanned report OCR, and zero 404/console/runtime/network-loading errors.
- `npm run build`: generated **219 files** from canonical `app/`, including `dist/pension-lab-he-standalone.html`.
- `npm run check:standalone`: **6/6** authored inline script blocks passed syntax validation.

## Product-flow verification

1. The opening screen has one prominent PDF input labeled “העלאת דוח פנסיה” for either an annual or quarterly pension report.
2. There is no payslip input, payslip progress UI, payslip prompt, birth-year input, current-age input, or retirement-age input in the running application.
3. Review shows editable current balance, mean monthly pension deposit, mean reported pension salary, deposit fee, balance fee, representative component rates, and expandable raw contribution rows.
4. A missing provider does not block progression. A missing balance, monthly deposit, or either fee blocks automatic calculation until the user confirms it; missing fields are not converted to zero.
5. The only normal post-extraction question is “כמה שנים נשארו לך עד הפרישה?”. Twelve years produces exactly 144 projection months.
6. The forecast uses the extracted balance, the arithmetic mean of all reliable normalized monthly deposits, confirmed personal fees, 4% real return, 2% inflation, and coefficient 200.
7. The baseline contribution remains constant in real terms. Nominal cash flows increase only through the existing inflation conversion; no salary-growth assumption is required.
8. The initial result exposes no return, fee, contribution, retirement-age, comparison, Explorer, saved-scenario, or advanced what-if controls. Those belong to PR2.
9. Real and nominal displays update from the same projection and remained consistent in desktop and mobile browser tests.
10. Reset returns to the single-report upload and clears the session. Confirmed normalized numbers can survive a same-tab refresh, but the document, filename, and raw OCR/contribution-row text are not persisted.

## Contribution-history rules verified

- Annual report with 12 rows and quarterly report with 3 rows use the same parser and normalized state.
- Every detected raw row retains salary month, employer when available, deposit date when available, salary, employee/employer/severance components, explicit or computed total, source page, confidence, issues, and evidence identifiers.
- One reliable month becomes the baseline. Two or more reliable months use the arithmetic mean of every reliable normalized monthly total, not the latest month.
- Reported pension salary uses the same reliable-month arithmetic mean and is never labeled gross salary.
- Component rates are derived per reliable month and displayed as supporting information; direct deposited amounts drive the forecast.
- An explicit total is preferred only when arithmetically consistent. A row with one missing component can use a plausible explicit total without inventing the missing component.
- A complete row whose explicit total conflicts with its components requires review and is excluded from the mean.
- Annual/YTD/summary rows are excluded from monthly normalization.
- Exact duplicate rows remain in raw history but are canonicalized once. Conflicting same-employer/unknown-employer rows for one salary month mark that month ambiguous and exclude it.
- Multiple reliable rows with distinct identified employers can be aggregated for the same salary month.

## Dataset v2 pension-report metrics

### Fast text-layer benchmark

- Pension reports: **24/24** produced predictions.
- Field accuracy: **83.3%**.
- Critical-document accuracy: **45.8%**.
- Arithmetic validation: **72/72**, **100.0% coverage**.
- Annual: **84.8% field**, **52.4% critical**, `n=21`.
- Quarterly: **72.7% field**, **0.0% critical**, `n=3`.
- Contribution history: **120 raw rows**, **120 reliable normalized months**.

Compared with remote head `1ca66e379dbaeb26f9512000c75e7609837251cc`:

- Pension-report field accuracy: **82.2% → 83.3%** (`+1.1 pp`).
- Critical-document accuracy: **45.8% → 45.8%**.
- Annual field accuracy: **83.5% → 84.8%**.
- Quarterly field accuracy: **72.7% → 72.7%**.
- Raw contribution rows: **120 → 120**; reliable normalized-month output: **not available → 120**.

### Full pension-report browser benchmark

- Reports exercised: **30/30**; 24 text-layer and 6 image-only.
- Field accuracy: **73.3%**.
- Critical-document accuracy: **60.0%**.
- Arithmetic validation: **84/84 passed**, with **84/90 possible checks run (93.3% coverage)**.
- Annual: **73.4% field**, **57.7% critical**, `n=26`.
- Quarterly: **72.7% field**, **75.0% critical**, `n=4`.
- Text-layer: **88.6% field**, **75.0% critical**, `n=24`.
- Image-only: **12.1% field**, **0.0% critical**, `n=6`.
- Contribution history: **136 raw rows**, **132 reliable normalized months**.
- Two image-only reports reached manual review without reliable extracted fields; no values were fabricated.

Dataset v2 has **0/30** pension reports with annotated `contribution_history` rows. Therefore correct-row count, salary-month accuracy, component-amount accuracy, total accuracy, and `baselineMonthlyContribution` accuracy are explicitly **n/a** for the dataset benchmark. The 14 deterministic acceptance tests cover these semantics, but they are not presented as Dataset v2 accuracy. Full history annotation is required for a genuine benchmark.

## Privacy and network verification

- PDF.js and Tesseract assets load from the same local origin; the report is provided through the browser file input and is never uploaded.
- OCR processing used GET requests with no request bodies and no external OCR endpoint.
- Native text PDFs did not load Tesseract assets.
- Session persistence contains normalized values and compact evidence identifiers only. Filename, source document, raw PDF/OCR text, and contribution-row `rawText` are excluded.
- The application has no backend, account, database, paid service, or document-processing analytics transmission.

## Remaining failure modes and intentionally deferred scope

- Image-only OCR remains weak: **12.1% field accuracy** and **0.0% critical-document accuracy** across six degraded reports. Low-quality scans frequently miss balance/fee labels and can merge contribution columns; the product routes incomplete results to review.
- Provider extraction remains conservative and often abstains. Provider is useful metadata and never blocks the forecast.
- Flat text without usable geometry can still reverse deposit and balance fees on some quarterly/annual layouts; structured browser geometry performs materially better.
- Dataset v2 lacks annotated full contribution histories, so history accuracy cannot yet be claimed.
- Cross-browser testing outside Chromium and assistive-technology testing with a screen reader were not performed.
- PR2 controls—fee, deposit, return and retirement what-if changes, comparisons, Explorer, scenario saving, salary phases and career breaks—are not exposed in this PR1 interface.
- Taxes, benefit eligibility, provider-specific product rules, multiple pension products, stochastic simulation, and personal pension advice remain outside scope.
