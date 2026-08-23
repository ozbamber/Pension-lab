# QA status

Reviewed: **2026-08-23**.

This review covers Pension Report Extraction Engine V2 on `codex/dataset-v2-evaluation`. The product accepts one annual or quarterly pension report, reviews the extracted pension state, asks only for years until retirement, and produces one baseline forecast. PR2 what-if controls are intentionally outside this change.

## Completed suites

- `npm run test:engine`: **23/23** projection-engine tests passed.
- `npm run test:documents`: **10/10** document-model tests passed.
- `npm run test:ocr`: **30/30** financial/spatial parser tests passed.
- `npm run test:pension`: **24/24** legacy pension-report/reconciliation regressions, **14/14** pension-report-state acceptance tests, and **24/24** Engine V2 table regressions passed.
- `npm run test:dataset`: **12/12** Dataset v2 contract and safety-aware metric tests passed.
- `npm run dataset:validate`: **70/70** documents and ground-truth records passed; 55 have a text layer and 15 are image-only.
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

All **34** pension-report records have direct contribution-table ground truth: **170** monthly rows plus separately annotated annual/YTD exclusions. The headline set contains the **24 independent synthetic parents**; the 10 augmented children are reported separately and are not counted as independent evidence.

### Fast text-layer benchmark

- All text-layer records: **25** documents; **84.0%** automatic coverage, **100.0%** automatic critical accuracy, and **0** unsafe automatic acceptances.
- Row detection: **100.0% precision**, **96.0% recall**, **98.0% F1**; every scored row field and normalized-month output was **96.0%** accurate.
- Independent-parent headline: **21/24** automatic (**87.5%**), **100.0%** automatic critical accuracy, **0** unsafe acceptances, and **100.0%** row precision/recall/F1, normalization, baseline, average salary, rates, balance, and fee accuracy.
- The additional mixed text/OCR augmentation is deliberately incomplete on the text path and correctly remains in review.

### Full local-browser benchmark

- All records: **34** documents; **25** automatic and **9** review-only (**73.5%** automatic coverage), **100.0%** automatic critical accuracy, **0** unsafe automatic acceptances, and a **100.0%** safe-outcome rate.
- Table detection recall: **94.1%**. Row detection: **99.4% precision**, **90.6% recall**, **94.8% F1**, with **1** false extra row across 170 expected rows.
- Normalized-month accuracy: **85.3%**; baseline and average reported salary: **82.4%** each.
- Critical fields: balance **79.4%**, deposit fee **91.2%**, and balance fee **94.1%** across all original and augmented records.
- Text-layer subgroup: **22/25** automatic, **100.0%** automatic critical accuracy, and **100.0%** row precision/recall/F1.
- Image-only subgroup: **3/9** automatic, **100.0%** automatic critical accuracy, **96.7%** row precision, and **64.4%** row recall. The other six image-only records remain review-only.
- Augmented-child subgroup: **4/10** automatic, **100.0%** automatic critical accuracy, **97.1%** row precision, and **68.0%** row recall.
- Machine-readable remaining reasons: `BALANCE_EXTRACTION_FAILED=7` and `TOTAL_RECONCILIATION_FAILED=2`.

### Exact before/after comparison

The saved full-browser baseline at `22a4e8cbd383711987ce3714f20719f3bbd8dd92` covered the then-current 30 records: **11/30** automatic (**36.7%**), **100.0%** automatic critical accuracy, **0** unsafe acceptances, and row precision/recall/F1 of **99.3% / 90.0% / 94.4%**. Engine V2 evaluates 34 records because it adds four controlled robustness augmentations; it reaches **25/34** automatic (**73.5%**) with **100.0%** automatic critical accuracy and **0** unsafe acceptances.

For a like-for-like comparison on the 24 independent parents, coverage improved from **11/24 (45.8%)** to **21/24 (87.5%)** while automatic critical accuracy remained **100.0%**, unsafe acceptances remained **0**, and row precision/recall/F1 remained **100.0% / 100.0% / 100.0%**. Deposit-fee accuracy improved from **70.8%** to **100.0%** and balance-fee accuracy from **58.3%** to **100.0%**.

The requested 95% automatic-coverage target is not safely attainable on the fixed parent set: three old-pension source reports do not print a personal balance-management fee, so a correct engine must send at least **3/24** to review, making **87.5%** the source-constrained ceiling. The augmented robustness set also contains scans where balance labels or complete contribution tuples are no longer legible; automatic completion would require inventing evidence. More representative source examples or explicit user confirmation are required to raise coverage without weakening safety.

## Privacy and network verification

- PDF.js and Tesseract assets load from the same local origin; the report is provided through the browser file input and is never uploaded.
- OCR processing used GET requests with no request bodies and no external OCR endpoint.
- Native text PDFs did not load Tesseract assets.
- Session persistence contains normalized values and compact evidence identifiers only. Filename, source document, raw PDF/OCR text, and contribution-row `rawText` are excluded.
- The application has no backend, account, database, paid service, or document-processing analytics transmission.

## Remaining failure modes and intentionally deferred scope

- Six of nine image-only records remain review-only. Low-quality scans can erase balance labels, merge contribution columns, or leave a total that cannot be reconciled; the product does not promote these outputs automatically.
- Provider extraction remains conservative and often abstains. Provider is useful metadata and never blocks the forecast.
- Three independent old-pension reports genuinely omit the personal balance-management fee. This is an absent source value, not a parser defect, and requires review or user confirmation.
- Flat text without usable geometry is treated as a fallback. Structured table geometry and independent evidence paths are required before automatic acceptance.
- Cross-browser testing outside Chromium and assistive-technology testing with a screen reader were not performed.
- PR2 controls—fee, deposit, return and retirement what-if changes, comparisons, Explorer, scenario saving, salary phases and career breaks—are not exposed in this PR1 interface.
- Taxes, benefit eligibility, provider-specific product rules, multiple pension products, stochastic simulation, and personal pension advice remain outside scope.
