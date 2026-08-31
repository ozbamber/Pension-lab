# QA status

Reviewed: **2026-08-31**.

This review covers the complete PR2 product and production-release path on `codex/pr2-interactive-simulator`, including its query-only synthetic demo, based directly on reviewed PR1 safety SHA `f7978fe1a15c8e2f738ec0de629e77ff736ceabb`. The normal product accepts one annual or quarterly pension report, requires trusted `new_pension` routing and one years-until-retirement answer, and then exposes a session-only what-if simulator using the unchanged projection engine. `?demo=1` constructs a clearly labeled synthetic post-extraction state and enters those same simulator APIs for product review. PR1 parsing, financial safety rules, source identity, and Dataset v2 ground truth remain frozen; the later OCR scheduling/progress follow-up is documented separately below. Findings, resolutions, limitations, and the exact release process are recorded in `docs/PR2-AUDIT-2026-08-31.md`, `docs/OCR-PERFORMANCE-2026-08-31.md`, and `docs/RELEASE.md`.

## 2026-08-31 OCR performance and progress follow-up

- Root-cause profiling measured about **19.4s / 10 Tesseract calls** for one scanned page and **42.4s / 19 calls** for two pages; **94%–96%** of the processing time was inside sequential Tesseract recognition. A first cold visit also loaded about **18.9MB** of same-origin PDF/OCR assets.
- Progress is now page- and stage-aware, monotonic, visibly reaches 100%, exposes native `progressbar` ARIA values, and resets on completion, cancellation, and a new upload. Cancellation races runtime/worker initialization, parameter updates, and active recognition; it returns the UI immediately, reports the cancelled state, terminates the active worker, and cleans a late worker. The Chromium OCR suite increased from **5 to 6 groups** and observed every `aria-valuenow`/bar-width mutation.
- OCR progress now assigns fixed per-page ranges to every existing stage while retaining the original single-render order and every prior pension-report OCR pass. A prototype early-exit was removed before release because none of the 9 image-only fixtures safely exercised it and there was no end-to-end coverage for the shortened branch.
- The final real-browser benchmark completed **34/34** pension reports. Its prediction array was JSON-identical for all **34/34** IDs to the prior benchmark artifact. Supported-new independent parents remained **21/21 automatic**, **100% critical automatic accuracy**, and **0 unsafe acceptances**; image-only remained **1/8 automatic** with **0 unsafe acceptances**.
- A `heb`-only experiment reduced the nine-image runtime from **204.33s to 75.04s**, but field accuracy fell **48/98→10/98**, reliable months **11→0**, baselines **3/9→0**, and routing **4/9→2/9**. It was rejected.
- Official `tessdata_fast` reduced runtime to **109.80s** and language payload by **81.4%**, but field accuracy fell **48/98→42/98**, critical documents **3/9→1/9**, baselines **3/9→2/9**, routing **4/9→3/9**, and automatic documents **1→0**. It was rejected; the production `heb+eng` data is unchanged.
- Only the fingerprinted 13.1MB tessdata path now uses a one-year immutable browser cache; unversioned PDF.js/Tesseract runtime assets still revalidate. The live verifier also requires the legacy-path redirect to the exact fingerprint.
- Final local gates passed: engine **28/28**; simulator **30/30 + 10/10 demo**; document model **10/10**; OCR parser **30/30**; pension suites **24/24 + 14/14 + 24/24 + 32/32**; dataset **13/13**; validation **70/70**; text benchmark **55/55**; full browser benchmark **34/34**; browser smoke at 1440px/390px; simulator browser; demo **38/38**; OCR **6/6**; standalone **6/6**; and authored JavaScript syntax **37/37**.
- Two clean builds each generated **225 files**. The standalone SHA256 was **`6BB86000C36FE74BA9969C738B61F38EBF543573DF6078EBA9675545756985D0`** and `dist/index.html` was **`960E135E0C4369B0DE96F67BBDD9A3969F1DE6CACAADCFCB8E143FFE604D0378`** both times. Source/dist SHA256 equality was also confirmed for `app.js` (`E845404A…`), `local-document-pipeline.js` (`57532B9E…`), and `document-extraction.js` (`C3DCDA46…`).
- Detailed measurements, gate logic, rejected optimizations, and the remaining multi-page CPU limitation are recorded in `docs/OCR-PERFORMANCE-2026-08-31.md`.

## Completed suites

- `npm run test:engine`: **28/28** projection-engine tests passed, including strict baseline types, bounded horizons and fees, non-finite output rejection, retirement-age horizon propagation, and overlapping-break rejection.
- `npm run test:simulator`: **30/30** immutable what-if scenario tests plus **10/10** synthetic-demo fixture, normalization, exact-value, production-equivalence, immutability, query, horizon, and exit-URL tests passed.
- `npm run test:documents`: **10/10** document-model tests passed.
- `npm run test:ocr`: **30/30** financial/spatial parser tests passed.
- `npm run test:pension`: **24/24** legacy pension-report/reconciliation regressions, **14/14** pension-report-state acceptance tests, **24/24** Engine V2 table regressions, and **32/32** fund-routing/source-safety regressions passed.
- `npm run test:dataset`: **13/13** Dataset v2 contract, exact-binomial, diagnostics, and safety-aware metric tests passed.
- `npm run dataset:validate`: **70/70** documents and ground-truth records passed; 55 have a text layer and 15 are image-only.
- `npm run dataset:benchmark:text`: all 55 eligible text observations completed; supported-new independent parents were **21/21** automatic with **100.0%** critical accuracy and **0** unsafe acceptances.
- `npm run dataset:benchmark:browser`: all **34/34** pension PDFs completed through the real local browser pipeline; detailed supported-new and routing results appear below.
- `npm run dataset:benchmark:compare -- --before-ref 2a6f05b8a0d38830da5ecc606dd124b99ba6ebf6`: extraction field/critical/validation metrics remained **88.2% / 96.0% / 100.0%** while the new routing contract made all **21/21** supported-new parents eligible for safe automatic acceptance.
- `npm run test:browser:smoke`: old-pension blocking and unknown-fund confirmation passed; the complete report-only flow also passed at **1440×1000** and **390×844**, including exact 144-month projection for 12 years, real/nominal switching, no payslip or age fields, and no horizontal overflow.
- `npm run test:browser:simulator`: supported-new gating, strict restored-state normalization, legacy sensitive-session migration, missing-value rendering, per-field validation, all five controls, real-valued native range semantics, Chromium accessibility-tree percentage units, monotonic native stepping, symmetric custom keyboard stepping, combined changes, fixed baseline markers, global reset, positive/negative deltas, real/nominal consistency, focus transitions, desktop information UI, mobile tap information UI, session-only state, no interaction network request, finite-overflow failure, and 390px overflow checks passed.
- `npm run test:browser:demo`: **38/38** normal/demo routing, canonical fixture, all controls, combined scenarios, positive/negative/stress deltas, reset, accessible information UI, session isolation, exit/restore, no local/IndexedDB storage, no interaction network request, LTR numeric direction, and 1440×1000/390×844 checks passed.
- `npm run test:browser:ocr`: **6/6** native-report, local OCR, painted monotonic progress, privacy/session, mobile overflow, active-recognition cancellation, and cold-start cancellation with late-worker cleanup passed.
- `npm run test:browser:standalone`: **6/6** generated-artifact groups passed, including 10 local vendor URLs, source-equivalent demo and normal routes, native report parsing, scanned report OCR, and zero 404/console/runtime/network-loading errors.
- `npm run build`: generated **225 files** from canonical `app/`, including `dist/pension-lab-he-standalone.html`, `dist/_headers`, `dist/_redirects`, and `dist/404.html`; two consecutive builds produced identical standalone SHA256 `6BB86000C36FE74BA9969C738B61F38EBF543573DF6078EBA9675545756985D0` and `dist/index.html` SHA256 `960E135E0C4369B0DE96F67BBDD9A3969F1DE6CACAADCFCB8E143FFE604D0378`.
- `npm run check:standalone`: **9/9** authored inline script blocks passed syntax validation.
- `node --check` over authored, non-vendored JavaScript in `app/`, `scripts/`, and `tests/`: **37/37** files passed syntax validation.

## 2026-08-31 whole-product audit and local release gate

- Three independent read-only reviews covered math/state/privacy, UI/accessibility, and repository/release readiness. Every P1/P2 code finding listed in `docs/PR2-AUDIT-2026-08-31.md` was resolved and regression-tested before release.
- Recursive session sanitization removes raw PDF/OCR text and sensitive nested keys; legacy v1 sessions containing such keys are scrubbed on load. Clean sessions remain byte-for-byte unchanged when entering and leaving the synthetic demo.
- Primitive-number validation now rejects booleans, arrays, numeric strings, blanks, `NaN`, infinity, malformed rows, impossible horizons, fees outside 0%–20%, overlapping career breaks, and non-finite projections instead of coercing or silently clamping them into a forecast.
- Chromium verified visible validation/focus behavior, screen-reader percentage names and values for every range, non-color range status, bidi-safe signed deltas, keyboard symmetry, same-file upload retry, and no horizontal overflow at 390px.
- At the time of the whole-product audit, `app/document-extraction.js` and `app/pension-report-parser.js` had an empty diff from reviewed PR1 safety SHA `f7978fe1a15c8e2f738ec0de629e77ff736ceabb`. The later follow-up changes only OCR scheduling/progress in `document-extraction.js`; the parser, financial rules, thresholds, and all 34 benchmark outputs remain unchanged.
- `git diff --check` passed. Two builds produced the same 225-file artifact and standalone SHA256 shown above; `_headers`, `_redirects`, and the custom Hebrew 404 page are present in `dist/`.
- The preceding whole-product release's Preview/Production evidence is retained below as historical rollback context. The OCR follow-up receives a separate exact-SHA evidence block after its own deployment; an upload alone is never counted as acceptance.

## 2026-08-31 prior whole-product live release evidence

- Application source commit `3f5b469dea8f9c5cf6fb78817b8f147869a2eee2` was pushed to `origin/codex/pr2-interactive-simulator`. The tracked worktree and `app/` untracked-file check were clean; the unrelated root-level untracked dataset overlay remained outside staging and `dist/`.
- Immutable Preview deployment `e63bc172-95fa-498e-a212-cd1e829ed637` at `https://e63bc172.pension-lab-5yh.pages.dev/` was verified at **2026-08-31T12:19:19.915Z**. Its branch alias is `https://codex-pr2-interactive-simula.pension-lab-5yh.pages.dev/`.
- Production deployment `baeea5ab-faf0-4cd0-ae6e-725d5a894feb` at `https://baeea5ab.pension-lab-5yh.pages.dev/` was verified at **2026-08-31T12:27:19.238Z**. The canonical production URL `https://pension-lab-5yh.pages.dev/` was independently verified at **2026-08-31T12:27:20.180Z**.
- Preview and Production used the same prebuilt `dist/` without an intervening rebuild. The deployed `index.html` SHA256 is `5D9E375605184452824FC4521178F9DE2C1EF844DA6797DD84E53AEC2AE7628C`; `app.js` is `1D7102DC47B8D3ADD55FF7E9D72EAA42BDA5121AE5E8D9EE57A7D2AA6D25EE23`; the standalone artifact remains `48FE2FC4300A6C91F6EE025D7258CDB9AB1A035215D2DE5D3ED765A89B0FBA48`.
- Live verification confirmed exact local/deployed hashes for `index.html`, `app.js`, `engine.js`, `simulator.js`, `demo-fixture.js`, `styles.css`, and the custom 404 page; expected HTML/JavaScript/CSS MIME types; HTTP 404 for an unknown JavaScript asset; and no redirect hiding a wrong target.
- Production sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`.
- Headless Chromium loaded both the normal and `?demo=1` flows from the immutable Preview and canonical Production URLs at **1440×1000** and **390×844**. The normal flow remained at upload, Demo exposed five finite controls, the result remained above controls on mobile, and there was no positive horizontal overflow, runtime/console/network-loading error, external request, or request caused by simulator interaction.
- Cloudflare records Production source `3f5b469` under its `main` production label. This release did not merge or push the Git repository's `main` branch. The immediately preceding known Production rollback target is deployment `27647325-1d7d-4a6d-8406-480ec9bc1076` (`0387079`).

## PR2 visual and interaction review

- Chromium visual inspection at **1440×1000** confirmed one integrated central result above one compact RTL simulator, five physical LTR range tracks, a fixed dark baseline marker, a distinct selection thumb, and no scattered projection cards.
- Chromium visual inspection at **390×844** confirmed one-column layout, no horizontal overflow, 44px information targets, enlarged slider thumbs, central result above the controls, and an accessible fixed information bottom sheet.
- Desktop hover/focus/click information behavior, mobile tap behavior, Escape/close behavior, keyboard adjustment, exact global reset, real/nominal switching, combined-control updates, and zero interaction network requests are covered by the browser suite.
- Demo screenshots at **1440×1000** and **390×844** confirmed a modest synthetic-data banner, central-result dominance, exact fee/contribution ticks, subtle neutral extreme ranges, fixed baseline markers, separate selected thumbs, 44px mobile information targets, and no horizontal overflow.

## Synthetic demo verification

- Activation is URL-only: `?demo=1`. Without that query, the application opens the unchanged upload flow with no visible demo banner, fake provider, synthetic value, or automatic navigation.
- The fixture is a supported `new_pension` annual state with balance **₪250,000**, salary **₪24,500**, deposit fee **0.8%**, balance fee **0.15%**, and 12 reliable monthly rows for 01/2025–12/2025.
- Each row contains employee **₪1,470** (6%), employer **₪1,592.50** (6.5%), severance **₪2,040.85** (8.33%), and total **₪5,103.35** (20.83%). The production contribution normalizer derives 12 used months, the same salary, and the same monthly baseline.
- Default horizon is **25 years / 300 months**; return is **6.08% nominal = 4% real at 2% inflation**; coefficient remains **200**. The untouched demo controls equal `projectBaseline()` exactly.
- Optimistic scenario (8%, 2%, 21.83%, 0.5%, 0.10%): real monthly pension **₪22,621**, real retirement balance **₪4,524,195**, deltas **+₪6,747 / +₪1,349,322**.
- Conservative scenario (4%, 3%, 18.5%, 2%, 0.30%): real monthly pension **₪8,746**, real retirement balance **₪1,749,114**, deltas **−₪7,129 / −₪1,425,758**.
- Extreme stress (2%, 10%, 15%, 6%, 2%): implied real return **−7.2727%**, real monthly pension **₪2,090**, real retirement balance **₪417,945**, deltas **−₪13,785 / −₪2,756,928**; all outputs stayed finite.
- Mixed high-return/low-contribution/high-fee scenario produced real monthly pension **₪11,696** and real retirement balance **₪2,339,194**, distinct from the return-only result and confirming one combined projection.
- A seeded normal session remained byte-for-byte unchanged throughout demo startup, slider/money-mode interaction, mobile reload, and exit. After “יציאה מהדגמה”, the prior 12-year normal forecast restored successfully.
- Instrumented Chromium observed zero demo session writes/removals, zero local-storage writes/removals, zero IndexedDB opens, and zero network requests caused by demo interaction.

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
