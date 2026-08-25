# QA status

Reviewed: **2026-08-25**.

This review covers the PR2 Interactive Pension What-If Simulator on `codex/pr2-interactive-simulator`, based directly on reviewed PR1 safety SHA `f7978fe1a15c8e2f738ec0de629e77ff736ceabb`. The product accepts one annual or quarterly pension report, requires trusted `new_pension` routing and one years-until-retirement answer, and then exposes a session-only what-if simulator using the unchanged projection engine. PR1 extraction architecture and Dataset v2 ground truth remain frozen.

## Completed suites

- `npm run test:engine`: **23/23** projection-engine tests passed.
- `npm run test:simulator`: **26/26** immutable what-if scenario, nominal/real conversion, reset, contribution, fee, range-status, and safe-routing tests passed.
- `npm run test:documents`: **10/10** document-model tests passed.
- `npm run test:ocr`: **30/30** financial/spatial parser tests passed.
- `npm run test:pension`: **24/24** legacy pension-report/reconciliation regressions, **14/14** pension-report-state acceptance tests, **24/24** Engine V2 table regressions, and **32/32** fund-routing/source-safety regressions passed.
- `npm run test:dataset`: **13/13** Dataset v2 contract, exact-binomial, diagnostics, and safety-aware metric tests passed.
- `npm run dataset:validate`: **70/70** documents and ground-truth records passed; 55 have a text layer and 15 are image-only.
- `npm run dataset:benchmark:text`: all 55 eligible text observations completed; supported-new independent parents were **21/21** automatic with **100.0%** critical accuracy and **0** unsafe acceptances.
- `npm run dataset:benchmark:browser`: all **34/34** pension PDFs completed through the real local browser pipeline; detailed supported-new and routing results appear below.
- `npm run dataset:benchmark:compare -- --before-ref 2a6f05b8a0d38830da5ecc606dd124b99ba6ebf6`: extraction field/critical/validation metrics remained **88.2% / 96.0% / 100.0%** while the new routing contract made all **21/21** supported-new parents eligible for safe automatic acceptance.
- `npm run test:browser:smoke`: old-pension blocking and unknown-fund confirmation passed; the complete report-only flow also passed at **1440×1000** and **390×844**, including exact 144-month projection for 12 years, real/nominal switching, no payslip or age fields, and no horizontal overflow.
- `npm run test:browser:simulator`: supported-new gating, all five controls, combined changes, fixed baseline markers, global reset, positive/negative deltas, real/nominal consistency, keyboard interaction, desktop information UI, mobile tap information UI, session-only state, no interaction network request, and 390px overflow checks passed.
- `npm run test:browser:ocr`: **5/5** native-report, local OCR, privacy/session, mobile-overflow, and cancellation groups passed.
- `npm run test:browser:standalone`: **4/4** generated-artifact groups passed, including 10 local vendor URLs, native report parsing, scanned report OCR, and zero 404/console/runtime/network-loading errors.
- `npm run build`: generated **221 files** from canonical `app/`, including `dist/pension-lab-he-standalone.html`; two consecutive builds produced identical SHA256 `7DEEE94D513A689CAEF63ED93F30129375D5674BCEB54BA997D856D7CA5441F8`.
- `npm run check:standalone`: **8/8** authored inline script blocks passed syntax validation.
- `node --check` over `app/`, `scripts/`, and `tests/`: **39/39** JavaScript files passed syntax validation.

## PR2 visual and interaction review

- Chromium visual inspection at **1440×1000** confirmed one integrated central result above one compact RTL simulator, five physical LTR range tracks, a fixed dark baseline marker, a distinct selection thumb, and no scattered projection cards.
- Chromium visual inspection at **390×844** confirmed one-column layout, no horizontal overflow, 44px information targets, enlarged slider thumbs, central result above the controls, and an accessible fixed information bottom sheet.
- Desktop hover/focus/click information behavior, mobile tap behavior, Escape/close behavior, keyboard adjustment, exact global reset, real/nominal switching, combined-control updates, and zero interaction network requests are covered by the browser suite.

## Product-flow verification

1. The opening screen has one prominent PDF input labeled “העלאת דוח פנסיה” for either an annual or quarterly pension report.
2. There is no payslip input, payslip progress UI, payslip prompt, birth-year input, current-age input, or retirement-age input in the running application.
3. Review shows editable current balance, mean monthly pension deposit, mean reported pension salary, deposit fee, balance fee, representative component rates, and expandable raw contribution rows.
4. A missing provider does not block progression. A missing balance, monthly deposit, or either fee blocks automatic calculation until the user confirms it; missing fields are not converted to zero.
5. The only normal post-extraction question is “כמה שנים נשארו לך עד הפרישה?”. Twelve years produces exactly 144 projection months.
6. The forecast uses the extracted balance, the arithmetic mean of all reliable normalized monthly deposits, confirmed personal fees, 4% real return, 2% inflation, and coefficient 200.
7. The baseline contribution remains constant in real terms. Nominal cash flows increase only through the existing inflation conversion; no salary-growth assumption is required.
8. After a supported new-pension baseline exists, the result exposes one compact five-track PR2 simulator: nominal return, inflation, total contribution rate or a safe amount-only fallback, deposit fee, and balance fee. Old-pension and unknown states do not expose it.
9. The immutable baseline remains the PR1 calculation: 4% real return, 2% inflation, coefficient 200, actual report contribution, and actual report fees. The displayed 6.08% nominal default converts back through the ratio formula, and the selected scenario is compared in the same real or nominal money basis.
10. The simulator's global reset returns each control and result to exact baseline. What-if controls are not persisted; confirmed normalized report values can survive a same-tab refresh, but the document, filename, raw OCR/contribution-row text, and what-if choices are not persisted.

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

All **34** pension-report records have direct contribution-table ground truth: **170** monthly rows plus separately annotated annual/YTD exclusions. Fund type and report type are annotated independently. The corpus contains **21 supported-new independent parents**, **3 old-pension parents**, **9 supported-new augmentations**, and **1 old-pension augmentation**. Augmented children are never counted as independent statistical evidence.

Digital/text-layer engineering performance and image-only robustness are reported separately below. Image-only automatic coverage is below 95%, so these results do not support a 95% overall real-world automatic-coverage claim.

### Fast text-layer benchmark

- Supported-new text-layer records: **21/22** automatic (**95.5%**), **100.0%** automatic critical accuracy, and **0** unsafe automatic acceptances.
- Row detection: **100.0% precision**, **95.5% recall**, and **97.7% F1**. Baseline accuracy is **95.5%**; balance and both personal-fee fields are **100.0%** accurate.
- Supported-new independent-parent headline: **21/21** automatic (**100.0%**), **100.0%** automatic critical accuracy, **0** unsafe acceptances, and **100.0%** row precision/recall/F1, normalization, baseline, balance, and fee accuracy.
- Old-pension text routing is **3/3** safely unsupported with **3/3** exact fund classification and **0** forecasts. The mixed text/OCR supported-new augmentation remains review-only with `COLUMN_ASSIGNMENT_FAILED`.

### Full local-browser benchmark

- Supported-new records: **23/30** automatic (**76.7%**) and **7/30** review-only, with **100.0%** automatic critical accuracy, **0** unsafe automatic acceptances, and a **100.0%** safe-outcome rate.
- The independent-parent headline is **21/21** automatic with **100.0%** critical accuracy and **0** unsafe acceptances. Row precision/recall/F1, baseline, balance, and both fee accuracies are all **100.0%** on this headline set.
- Table detection recall across supported-new records is **96.7%**. Row detection is **80.8% precision**, **92.7% recall**, and **86.3% F1**, with **33** false-extra rows across 150 expected rows.
- Normalized-month accuracy is **80.7%**; baseline and average reported salary are **83.3%** each.
- Critical fields across supported-new parents and augmentations: balance **90.0%**, deposit fee **93.3%**, and balance fee **93.3%**.
- Annual supported-new subgroup: **19/25** automatic (**76.0%**) with **87.1%** row F1. Quarterly: **4/5** automatic (**80.0%**) with **82.8%** row F1. Both have **100.0%** automatic critical accuracy and **0** unsafe acceptances.
- Digital/text-layer supported-new subgroup: **22/22** automatic (**100.0%**) with **100.0%** row F1. Image-only supported-new subgroup: **1/8** automatic (**12.5%**) with **56.9%** row F1. Both have **100.0%** critical accuracy among automatically accepted documents and **0** unsafe acceptances.
- Supported-new augmentations: **2/9** automatic (**22.2%**) with **100.0%** automatic critical accuracy and **60.7%** row F1. Supported-new independent parents are **21/21** automatic with **100.0%** row F1.
- Old-pension routing is **4/4** safely unsupported, **0** incorrectly forecast, and **100.0%** safe-routing accuracy. Exact fund classification is **3/4** because one degraded image has no positive recoverable old-pension semantics and therefore correctly remains `unknown`/blocked.
- Remaining supported-new failure types are exactly `FUND_TYPE_UNKNOWN=5` and `TOTAL_RECONCILIATION_FAILED=2`.

### Statistical interpretation

- Independent automatic supported-new successes/failures: **21/0**; observed automatic critical accuracy: **100.0%**.
- Exact one-sided 95% Clopper-Pearson lower bound: **86.7%**.
- A zero-failure sample needs **59** independent successes for a 95% lower bound, so **38** additional zero-failure independent reports are still required.
- `HIGH`, `MEDIUM`, and `LOW` remain rule/evidence confidence bands. They are not documented as calibrated probabilities.
- `golden-real-test` remains empty. No production or real-world 95/95 claim is made; a meaningful consented, irreversibly de-identified real-report set is still required.

### Exact before/after comparison

Against the requested starting SHA `2a6f05b8a0d38830da5ecc606dd124b99ba6ebf6`, the fast text parser retains **88.2%** field accuracy, **96.0%** critical-document accuracy, **100.0%** arithmetic-validation accuracy, 120 raw/reliable rows, and **100.0%** independent-parent row/baseline/balance/fee accuracy. The starting revision had no independent `fundType`/routing contract, so the new safety metric correctly reports no eligible automatic new-pension routes there; the worktree reports **21/21** after the routing contract is introduced. This automatic-coverage comparison is a contract change, not evidence that the underlying extraction accuracy changed.

## Privacy and network verification

- PDF.js and Tesseract assets load from the same local origin; the report is provided through the browser file input and is never uploaded.
- OCR processing used GET requests with no request bodies and no external OCR endpoint.
- Native text PDFs did not load Tesseract assets.
- Session persistence contains normalized values and compact evidence identifiers only. Filename, source document, raw PDF/OCR text, and contribution-row `rawText` are excluded.
- The application has no backend, account, database, paid service, or document-processing analytics transmission.

## Remaining failure modes and intentionally deferred scope

- Seven of eight supported-new image-only records remain review-only. Low-quality scans can erase fund/balance labels, merge contribution columns, or leave totals that cannot be reconciled; the product does not promote these outputs automatically.
- Provider extraction remains conservative and often abstains. Provider is useful metadata and never blocks the forecast.
- Old-pension extraction values are not treated as forecast inputs. Positive old-pension evidence routes directly to the unsupported rights-based-model state; insufficient evidence remains unknown and blocked.
- Flat text without usable geometry is treated as a fallback. Structured table geometry and independent evidence paths are required before automatic acceptance.
- Cross-browser testing outside Chromium and assistive-technology testing with a screen reader were not performed.
- Deferred features remain named/saved scenarios, comparison of three or more saved scenarios, salary growth, career breaks, investment allocation, retirement-age Explorer, coefficient controls, provider recommendations, and personalized optimization. PR2 deliberately does not add them.
- Taxes, benefit eligibility, provider-specific product rules, multiple pension products, stochastic simulation, and personal pension advice remain outside scope.
