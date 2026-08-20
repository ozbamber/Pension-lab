# יומן שינויים

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
