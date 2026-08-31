# יומן שינויים

## OCR performance and monotonic progress — 2026-08-31

- Replaced per-pass 65%→95% resets with page-aware, stage-aware cumulative progress, a painted 100% completion state, correct retry/cancel reset, and accessible `progressbar` semantics. Cancellation now races cold initialization, parameter changes, and active recognition; it reports the cancelled state, terminates the active worker, and cleans a worker that resolves late.
- Assigned every existing image-OCR pass a stable per-page progress range while retaining the original single-render order, every pension-report OCR pass, and all fail-closed parsing rules.
- Fingerprinted the two 13.1MB OCR language files, added a one-year immutable cache only for those exact paths, versioned Tesseract's public-model cache, and kept unversioned runtime assets revalidating.
- Benchmarked and rejected both Hebrew-only OCR and official `tessdata_fast` models because their speed and payload gains caused material field, history, baseline, and routing regressions.
- Expanded Chromium OCR coverage from 5 to 6 groups, including a painted 100% completion state and every progress mutation. The complete 34-document browser benchmark preserved all prior outputs exactly, 21/21 supported-new parent automatic acceptance, 100% critical automatic accuracy, and zero unsafe acceptances.
- Recorded timings, payloads, rejected alternatives, safety results, and the remaining multi-page limitation in `docs/OCR-PERFORMANCE-2026-08-31.md`.
- Released exact application commit `3e7618eb41251f6548b7b9f260af6836435fd351` through verified immutable Preview `a6382ee1-df8d-4032-be93-2d74e1e663b0` and Production `d259ab72-1999-4c59-a7ed-9a16ff216743`. The canonical site is `https://pension-lab-5yh.pages.dev/`; exact hashes, model-cache/redirect checks, rollback evidence, and live desktop/mobile/scanned-PDF Chromium results are recorded in `docs/QA.md`.

## Whole-product audit and production hardening — 2026-08-31

- Removed nested raw PDF/OCR evidence from browser-session persistence, corrected missing financial values that appeared as zero, and added browser regressions proving that raw sentinels and sensitive keys do not reach `sessionStorage`.
- Hardened baseline and simulator inputs against blank, `null`, non-finite, excessive-horizon, overlapping-break, negative-contribution, and implausible contribution-rate states. Corrected retirement Explorer horizon propagation while preserving the reviewed PR1 baseline math.
- Reworked range controls to expose their real percentage values to assistive technology, added visible non-color range status, field-scoped validation and focus, reliable information-panel focus return, Enter-to-calculate, bidi-safe signed currency, missing-confidence display, and clearer amount-fallback provenance.
- Improved focus/tick/progress contrast, cleared the upload input for same-file retries, and kept the central forecast announcement concise through a dedicated live region.
- Added a Hebrew 404 page, static security headers, Node 22 runtime metadata, a redirect-intolerant deployed-byte verifier, an exact-SHA Cloudflare preview/production/rollback runbook that rejects untracked application files, and a complete audit register in `docs/PR2-AUDIT-2026-08-31.md`.
- Corrected the third-party notice to describe the pension-report OCR path. The PR1 extraction and pension-report parser remain unchanged from the reviewed safety baseline.
- Released exact application commit `3f5b469dea8f9c5cf6fb78817b8f147869a2eee2` through verified immutable Preview and Production deployments. The canonical site is `https://pension-lab-5yh.pages.dev/`; deployed hashes, headers, 404 behavior, and live desktop/mobile Chromium evidence are recorded in `docs/QA.md`.

## Synthetic PR2 review mode and UI audit — 2026-08-28

- Added an explicit query-only `?demo=1` review route. It creates a fresh canonical synthetic `new_pension` state with 12 reliable monthly rows, derives its contribution baseline through the production normalizer, fixes the horizon at 25 years by default, and enters the unchanged PR2 simulator APIs without PDF/OCR work.
- Kept demo state fully memory-only: demo startup does not read or write the normal report session, simulator/money-mode interaction does not persist, no `localStorage` or IndexedDB is used, and “יציאה מהדגמה” returns to the normal route without deleting a pre-existing same-tab session.
- Added a compact persistent synthetic-data banner, removed personal wording from the demo heading, hid unrelated flow chrome in demo only, and preserved the normal no-query upload route without a visible demo affordance.
- Corrected misleading rounded fee-track labels so `0.5%–2.5%` and `0.05%–0.30%` remain visible, and replaced alarming red extreme-track treatment with a quieter neutral range while retaining non-color screen-reader status.
- Added 10 fixture tests and 38 Chromium demo checks covering canonical values, production-engine equivalence, all five sliders, simultaneous changes, positive/negative/stress scenarios, reset, real/nominal display, persistence isolation, exit/restore, network privacy, LTR numeric direction inside RTL, and 1440px/390px layout.
- Extended generated-standalone browser coverage to verify both `?demo=1` and the unchanged no-query flow. The build now contains 222 files and 9 inline script blocks; two consecutive builds produced SHA256 `9F69BF50E85C8AB887A46E0E95A5BBCD3BB0D5BB75335F516680D59A710DC0DD`.
- Preserved `document-extraction.js`, `pension-report-parser.js`, Dataset v2 annotations/metrics, fund routing, OCR, confidence, and source-identity behavior byte-for-byte from the reviewed PR1 safety base.

## Interactive Pension What-If Simulator (PR2) — 2026-08-25

- Added an immutable baseline/selected-scenario layer that reuses the existing projection engine. At untouched controls, 6.08% nominal return with 2% inflation maps back to the unchanged 4% real PR1 baseline.
- Added one compact RTL simulator below the central projection with five live slider tracks: nominal return, inflation, either total contribution rate or amount-only fallback, deposit fee, and balance fee. All controls update the same combined result and retain a fixed baseline marker.
- Added a central real/nominal comparison that keeps baseline and signed delta in the same money basis, a global reset to exact baseline, semantic range status for assistive technology, keyboard slider support, and responsive information popovers/bottom sheets.
- Added local reviewed source metadata for the Bank of Israel inflation target, contribution context, management-fee distinctions, selected-fund references, and the return-assurance mechanism. No source is fetched at runtime.
- Preserved the PR1 parser, OCR, fund-type routing, contribution-history logic, source identity, and Dataset v2 ground truth without changes.
- Added 26 deterministic simulator-engine tests and a Chromium simulator browser test covering supported/blocked routes, all controls, combined changes, reset, real/nominal, information UI, no control persistence, no interaction network request, and 390px overflow.

## Reliability and physical-source identity safety — 2026-08-24

- Restricted missing-total derivation so three observed components can clear only a missing-total completeness issue. Any unrelated parser, salary, plausibility, OCR-conflict, or source-identity issue keeps the row review-only; a diagnostic total may still be shown.
- Removed numeric-only cross-pass row deduplication. Matching salary month and contribution values no longer establish physical-row identity without a stable source-row ID, matching page geometry, or matching employer/deposit-date/month evidence.
- Added fail-closed `AMBIGUOUS_SOURCE_ROW_IDENTITY` handling for equal same-month tuples whose physical source cannot be proven, while preserving distinct known employers and valid native/OCR deduplication. Targeted row OCR now retains its page and source-band geometry for positive source matching.
- Expanded the source-safety suite from 28 to 32 cases with negative regressions for ambiguous columns, invalid reported salary, and unproven same-month row identity, plus the positive employer/date/month identity case.
- The independent supported-new parent benchmark remains 21/21 automatic with 100% critical accuracy and zero unsafe acceptances. Full-browser text-layer coverage is 22/22, while image-only coverage is reported separately at 1/8 (12.5%); no 95% overall real-world coverage claim is made.

## Fund-type routing and source-local extraction safety — 2026-08-23

- Separated `fundType` (`new_pension`, `old_pension`, `unknown`) from `reportType` (`annual`, `quarterly`, `unknown`) and added independent ground truth and expected-routing annotations for all 34 pension reports.
- Added positive-evidence old-pension detection and a fail-closed Hebrew review route. Old-pension reports never enter the accumulation forecast; unknown reports require explicit user confirmation.
- Removed cross-month component repair. A numeric component can now come only from the same physical source row; cross-month patterns may affect confidence but cannot create a value.
- Made cross-pass OCR merging source-row aware, retained distinct employers in the same salary month, and routed conflicting observations to review. Canonical contribution normalization now has one implementation.
- Added exact one-sided Clopper-Pearson reporting. The current 21 zero-failure supported-new independent parents have 100% observed automatic critical accuracy but only an 86.7% lower bound; 38 additional zero-failure independent reports are required before a 95/95 claim.
- Added 28 focused fund-routing, zero-fee, cross-month, multi-employer, summary-row, reconciliation, and cross-pass regressions plus browser checks for old/unknown routing.
- Expanded machine-readable failure diagnostics and kept rule confidence (`HIGH`/`MEDIUM`/`LOW`) explicitly separate from statistically calibrated confidence.

## Pension Report Extraction Engine V2 — 2026-08-23

- Annotated all 34 pension-report records with direct contribution-table ground truth: 170 monthly rows, explicit annual/YTD exclusions, normalized months, derived baselines, rates, source pages, and intentional nulls.
- Added a table-first RTL parser with header reconstruction, physical column geometry, split-cell recovery, salary-month/deposit-date separation, arithmetic constraint solving, duplicate/conflict handling, and explicit review states.
- Added local multi-pass OCR with quality gating, grayscale/contrast preprocessing, table and numeric crops, row-level passes, and cross-path evidence consensus; raw PDF/OCR text remains local and is not persisted.
- Added four controlled pension-report robustness augmentations spanning 150/200/300 DPI, JPEG, grayscale, blur, noise, rotation, removed text layers, and mixed text/OCR input.
- Added safety-aware dataset metrics for table/row detection, false extras, per-field accuracy, normalization, derived values, critical automatic acceptance, review rate, unsafe acceptances, fund/report type, text/image path, lineage, split, and exact-binomial uncertainty.
- Added 24 focused Engine V2 regressions and expanded Dataset v2 contract tests. After fund-type separation, the supported-new independent-parent benchmark is 21/21 automatic with 100% critical accuracy, zero unsafe acceptances, and 100% row precision/recall; three old-pension parents are evaluated separately as routing cases.

## Pension-report-first baseline forecast — 2026-08-23

- Replaced the primary journey with one annual-or-quarterly pension-report upload, concise extracted-state review, one `yearsUntilRetirement` input, and one baseline forecast.
- Removed the payslip upload, payslip progress, cross-document reconciliation, birth year, current age, retirement age, salary/rate requirements, scenario comparison, Explorer, and advanced what-if controls from the running PR1 interface.
- Added an explicit `pensionReportState` with report metadata, fees, complete raw contribution history, normalized reliable months, derived means/rates, evidence, and review issues.
- Added semantic and geometric contribution-table extraction for RTL/reversed order, explicit-total arithmetic, partial components, YTD exclusion, duplicate preservation, multi-employer aggregation, and ambiguous-month exclusion.
- Changed the forecast's recurring input from salary multiplied by rates to the mean of all reliable normalized monthly pension deposits; reported pension salary and implied rates remain supporting information.
- Added an exact-month baseline engine entry point driven by `yearsUntilRetirement`; contributions remain constant in real terms through the existing inflation and real-return machinery.
- Missing balance or fee values now require explicit review; a missing provider never blocks the forecast and no absent numeric value is converted silently to zero.
- Extended local OCR to pension reports, removed the running report parser's dependency on the payslip parser, and stripped raw contribution-row text before session persistence.
- Added 14 pension-report-state acceptance tests and rewrote responsive smoke, OCR/privacy, and standalone browser suites around the report-only flow.
- Added pension-only text/browser metrics, annual-versus-quarterly and text-layer-versus-image-only reporting, and an exact parser comparison against a Git ref. Dataset v2 currently has no annotated full contribution histories, so history accuracy is reported as unavailable rather than treating missing annotations as zero.

## Payslip period candidate detection — 2026-08-20

- Replaced first-match payslip month extraction with candidate generation and semantic/spatial scoring across all MM/YYYY values.
- Added positive payroll-period context, negative employment/seniority/birth/document-date context, and conservative confidence for unresolved ambiguity.
- Prevented unreliable explicit payslip periods from chronology-resolving conflicting report values without review.
- Added regressions for misleading dates, ambiguous dates, and preserved newer-payslip/newer-report chronology.

## Standalone and evidence-coherence hardening — 2026-08-20

- Corrected generated-standalone asset resolution so PDF.js, cmap/font/wasm support, Tesseract, and tessdata load from the adjacent `dist/vendor/` tree.
- Added a real Chromium standalone smoke covering ten vendor URLs, native-PDF extraction, scanned-PDF OCR, 404 detection, and console/runtime/network-load errors.
- Made payslip/report chronology explicit with propagated source periods, reliability, symmetric newer-period selection, substantial-evidence fallback, and reviewable same-month ambiguity.
- Expanded each anchor to a deterministic five-row spatial neighborhood so a misleading own-row number cannot hide a correct adjacent observation.
- Applied monthly versus annual/YTD scoring to contribution amounts and rates as well as salary.
- Separated structured-token and flattened-text fallback streams so generated duplicate IDs cannot bypass observation non-reuse.
- Hardened ignore rules for obvious real/private/acceptance JPG, JPEG, and PNG artifacts while retaining explicitly named synthetic fixtures under `tests/fixtures/`.

## Canonical repository and coherent document detection — 2026-08-19

- Consolidated the active source into root-level `app/`, `tests/`, `scripts/`, and `docs/`; moved historical handoff material to `legacy/`.
- Removed tracked deployment and standalone duplicates. `dist/` is generated from the single `app/` source tree.
- Replaced independent nearest-number selection with bounded candidate generation and a global salary/contribution tuple evaluator.
- Added observation reuse prevention, monthly/annual context, financial-identity scoring, ambiguity review, and conservative rejected-conflict handling.
- Reworked management-fee selection around semantic type, geometry, and personal-versus-average context.
- Preserved report provider/date/history metadata and cross-document provenance when report evidence supplies a missing payslip field.
- Expanded adversarial regressions for false neighbors, annual/YTD values, impossible tuples, ambiguity, OCR corruption, fee confusion, and cross-document supply/conflict.

## Pension report reconciliation — 2026-08-19

- Added native-text pension report extraction for closing balance, personal management fees, contribution history, chronology, recurring-month evidence, and derived rates.
- Added independent payslip/report reconciliation with cross-document confidence and explicit conflicts.
- Fixed salary candidate scoring so nearby decimal or OCR values cannot outrank financially consistent evidence.
- Added Hebrew review presentation for reconciled values, balance date, and management fees while preserving local-only processing.

## Local PDF payslip OCR — 2026-08-19

- Restricted payslip upload to PDF and preserved the existing annual-report fallback behavior.
- Added lazy local PDF.js text extraction and page rendering with a multi-signal OCR fallback heuristic.
- Added a single cancellable Tesseract.js worker with locally bundled Hebrew and English runtime/language assets.
- Added centralized payslip aliases, spatial row matching, financial normalization, amount/rate derivation and contradiction checks.
- Integrated direct, derived, uncertain and user-corrected values into the existing review/provenance flow without changing pension formulas.
- Added two synthetic PDF fixtures, 15 deterministic OCR/parser tests and 5 real-browser OCR/privacy tests.
- Verified same-origin-only OCR asset requests, no request bodies, no raw document/OCR persistence, session refresh, cancellation and 390px mobile overflow.

## Document-first onboarding and review flow — 2026-08-18

- Moved payslip and annual pension-report selection into the primary journey, with partial-document and manual paths.
- Added a review gate for birth year, statutory retirement track, insured salary, current balance, contribution assumptions and additional pension savings.
- Replaced persistent main-flow state with session-only storage; legacy scenarios are detected but not imported or deleted.
- Added a modular local PDF text-layer reader, direct/derived provenance, calm error states and explicit manual fallback without cloud OCR.
- Changed the default salary assumption to 0% nominal growth and exposed the 2%, 4% and 6% real-return comparisons using the existing engine.
- Added visible forecast assumptions, one money-mode control, a data-source disclosure, accessible comparison fallback and 320px mobile QA.
- Preserved salary/return stages, contributions, fees, career breaks, protected-return planning, charts and Retirement Explorer in Advanced.

## תחזית מהירה וחשיפה מדורגת — 2026-08-18

### חוויית שימוש

- מסך הפתיחה פושט לארבעה שדות בלבד: שכר מבוטח, גיל, יתרה כוללת ותשואה ריאלית.
- העלאת מסמכים, גיל פרישה, שינויי שכר, הפסקות עבודה ושאר ההנחות הועברו לשלבי השיפור וההגדרות המתקדמות.
- נוספו הסברי tooltip בריחוף ובמיקוד מקלדת למונחים מרכזיים, לרבות ההבדל בין שקלים של היום לשקלים עתידיים.
- שדות מספריים מאפשרים הקלדה חופשית ומתחייבים לאחר סיום העריכה, בלי לאפס ערך באמצע ההקלדה.
- צבעי מקור הנתון עודכנו: הנחת מערכת באדום עדין, ערך שהוזן על ידי המשתמש בירוק ומקור מסמך בכחול.
- נוסף מסך פתיחה קצר עם בחירת תלוש שכר ודוח פנסיה או מעבר ישיר להערכה מהירה.
- התוצאה מוצגת לפני ההגדרות, ולאחריה שכבת "שפר את התחזית" ושכבת הנחות מתקדמות.
- כל יכולות המנוע, הגרפים, Explorer והתרחישים נשמרו בשכבה המתקדמת.
- נוספו תגי מקור לנתונים: הנחת מערכת, מהתלוש, מדוח הפנסיה ושונה על ידך.
- ברירות המחדל הראשוניות עודכנו לגיל 35, פרישה 67, אינפלציה 2%, גידול שכר ריאלי 1% ותשואה ריאלית 4%.

### מסמכים ופרטיות

- נוסף adapter מסודר לשדות עתידיים מתלוש ומדוח פנסיה, כולל value, source, confidence ו-confirmedByUser.
- הקבצים אינם מועלים ואינם נשמרים. אין עדיין OCR או חילוץ נתונים, והממשק מציג זאת במפורש.
- נוסף abstraction מקומי לאירועי analytics ללא שליחת ערכים פיננסיים או מידע אישי.

### בדיקות

- נוספו 4 בדיקות למודל המסמכים ול-fallback שאינו ממציא נתונים.
- Browser QA הורחב לברירות המחדל, provenance, progressive disclosure ואי-שינוי תוצאה בפתיחת ההנחות המתקדמות.

## גרסת חיזוק MVP — 2026-08-18

### מנוע החישוב

- תוקן המשך שלב השכר או התשואה האחרון כאשר גיל הפרישה מוארך, וכן התנהגות במרווחים בין שלבים.
- תוקן פירוק התוצאה כך שהפקדות מוצגות לפני דמי ניהול, דמי הניהול מוצגים בנפרד, וצמיחת ההשקעות נשארת עקבית עם היתרה הסופית.
- נוספו נתוני הפקדות ברוטו ונטו, דמי ניהול מהפקדה ומהצבירה, וצמיחה נומינלית וריאלית.
- חוזקו בדיקות קלט עבור גילי פרישה ושיעורים שנתיים לא תקינים.

### ממשק ושמירת נתונים

- נוספה שכבת אחסון בטוחה עם חלופה זמנית בזיכרון כאשר `localStorage` אינו זמין.
- נוספה הגירה אוטומטית מגרסאות השמירה הקודמות.
- שלבי שכר ותשואה מנורמלים לתקופות רציפות; נקודת ההתחלה והגבול האחרון מנוהלים אוטומטית.
- הפסקות עבודה ממוינות, נחתכות בגיל הפרישה ומנורמלות במקרה של חפיפה.
- כפתורי שמירה ואיפוס נשארים זמינים במובייל.
- הותאמו טווחי האינפלציה ומקדם הקצבה בין שדות המספר לסליידרים.
- שופרו מצבי מיקוד, תוויות נגישות, ציור הגרפים ושינוי גודל החלון.
- ניסוח רכיב התשואה המובטחת הובהר: 30% הוא ערך דוגמה ניתן לעריכה ולא חישוב זכאות רגולטורי אחיד.

### בנייה ו-QA

- נוסף `build-standalone.js` ליצירה דטרמיניסטית של קובץ HTML עצמאי.
- חבילת הבדיקות הורחבה מ-10 ל-23 בדיקות מנוע.
- נוסף `browser-smoke.js` לבדיקת Chromium בדסקטופ ובמובייל, לרבות גלישה אופקית, גרפים, שינוי גיל פרישה, הפסקת עבודה, מעבר בין כסף ריאלי לנומינלי ושמירת תרחיש.
- נוספו צילומי QA ודו"ח `QA.md`.
## Dataset v2 coverage and date-fragment safety — 2026-08-20

- Added the synthetic/augmented Dataset v2 manifest, ground truth, split validation, text benchmark and 66-document browser benchmark.
- Added candidate-date regression coverage and prevented split MM/YYYY fragments from being interpreted as financial amounts.
- Added conservative reporting of dense-layout, flat-text column-association and genuinely missing-field limitations.
## Generic provider extraction and fail-closed dataset validation — 2026-08-20

- Removed fixture-specific provider-name fallbacks from the production pension parser.
- Added generic same-row, nearby-row and structured-token provider extraction plus full-date numeric filtering.
- Added fail-closed manifest/ground-truth contract validation and separate arithmetic validation coverage metrics.
## Nearby provider safety and annotation-based validation coverage — 2026-08-20

- Reject nearby provider candidates that are financial rows, report headings, investment tracks, dates or percentage rows, while retaining same-row, nearby-row and structured-token extraction.
- Derive possible arithmetic checks from annotated salary/rate/amount triplets and exclude expected-absent or non-finite values.
