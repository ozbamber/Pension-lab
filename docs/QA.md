# QA status

Reviewed: **2026-08-20**.

The canonical repository and coherent detector were verified with synthetic adversarial cases, browser privacy checks, deterministic builds, and ignored local-only private acceptance. Private source text was never logged; only whitelisted normalized expectations and provenance were compared.

## Completed

- `npm run test:engine`: **23/23 calculation-engine tests passed**.
- `npm run test:documents`: **10/10 document-model tests passed**.
- `npm run test:ocr`: **30/30 OCR/parser tests passed**.
- `npm run test:pension`: **20/20 pension-report/reconciliation tests passed**.
- `npm run test:browser:ocr`: **5/5 native-PDF, OCR, privacy, refresh, mobile and cancellation groups passed**.
- `npm run test:browser:standalone`: **4/4 generated-artifact checks passed**, covering 10 vendor URLs, native PDF, scanned OCR and zero 404/console/runtime/network-load errors.
- `npm run test:browser:smoke`: desktop, tablet-width, mobile and 320px mobile flows passed in Chromium.
- `npm run build`: generated **219 files** in ignored `dist/` from canonical `app/`.
- `npm run check:standalone`: **8/8 inline script blocks passed syntax validation**.
- `node --check`: **18/18 authored JavaScript files passed syntax validation**.
- `npm run dataset:validate`: **66/66 dataset documents and ground-truth records passed**, with 54 text-layer and 12 image-only/degraded documents.
- `npm run test:dataset`: **8/8 Dataset v2 contract tests passed**.
- Dataset v2 text benchmark: **75.5% field, 55.6% critical-document, 100.0% validation**, with **140/162 arithmetic checks run (86.4% coverage)** across 54 text-layer documents.
- Dataset v2 full browser benchmark: **60.6% field, 33.3% critical-document, 100.0% validation**, with **142/198 arithmetic checks run (71.7% coverage)** across all 66 documents.
- Ignored local private acceptance passed for the normalized salary, three contribution rates, balance, both fees, and report-supplied employee provenance.
- Viewports tested at 1440×1000, 822×950, 390×844 and 320×800.
- The landing screen presents two optional document cards plus a manual path; forecast and advanced controls stay hidden.
- The review gate requires birth year, statutory retirement track, insured salary, current balance and explicit contribution confirmation.
- The female statutory default was verified at age 65 for the tested birth year; retirement age remains editable.
- Default model assumptions verified: inflation 2%, nominal salary growth 0%, real base return 4%, no career break and today's-shekels display.
- Forecast generation, 2%/4%/6% engine comparison, retirement updates, real/nominal switching, career breaks and reset passed.
- Field provenance changes from system to user after editing and returns to system after reset.
- Multi-digit values can be typed directly into numeric fields and commit correctly after editing.
- Explanatory tooltip copy is present for real/nominal money modes and key pension terms.
- Provenance colors were reviewed for system, user-entered and document-derived states.
- Opening advanced assumptions does not change the forecast by itself.
- No browser runtime or console errors were reported.
- No horizontal overflow was detected.
- Desktop, tablet and both mobile screenshots were generated in `qa-output/`; desktop and 320px images were visually reviewed.

## Document extraction status

Payslip processing is PDF-only and local in the browser. PDF.js first reads native text and a multi-signal heuristic avoids OCR for healthy text PDFs. Scanned payslip PDFs use one lazy Tesseract.js worker with bundled `heb+eng` data. Every anchor evaluates a bounded own/nearby-row neighborhood, and monthly/YTD context applies to salary and contribution candidates. Structured geometry and flattened OCR fallback are separate observation streams, so fallback IDs cannot bypass non-reuse. The parser evaluates a global salary/employee/employer/severance tuple using semantic, spatial, confidence, non-reuse, period, and financial-identity signals. Critical OCR values and ambiguous/conflicting alternatives require review; missing values are not fabricated. Annual-report OCR remains out of scope.

Adversarial regressions cover a same-row misleading 925 with the true salary on an adjacent spatial row, split-row contribution pairs, monthly versus annual/YTD salary and contribution candidates, a complete multi-contribution tuple, impossible relationships, near-tied salaries, missing amount/rate pairs, conflicts, conservative OCR corruption, candidate-based payslip period detection with employment/seniority distractor dates and ambiguous dates, annual/YTD report rows, personal-versus-average fee confusion, newer-payslip and newer-report chronology, same-month ambiguity, and report supply of a genuinely missing payslip amount.

Two synthetic PDFs are committed: one native-text fixture and one image-only fixture. The acceptance fixture covers insured salary, employee contribution, employer contribution, severance and payslip month. The real browser test confirms the native fixture does not request Tesseract assets and the scanned fixture does.

The generated `dist/pension-lab-he-standalone.html` is also served directly to Chromium. Its asset base is the artifact directory itself; PDF.js module/worker, representative cmap/font/wasm files, Tesseract runtime/worker/core, and both language files resolve from `dist/vendor`. Both synthetic PDFs extract salary 23,500 without a legacy `/pension-lab-he/` request.

## Privacy and network verification

- A local HTTP server recorded every same-origin request during native and scanned fixture processing.
- Chromium DevTools Network events were inspected for the page process.
- Scanned processing used only same-origin GET requests with no request bodies.
- The PDF itself was supplied through the file input and was never requested or uploaded.
- Tesseract runtime, worker, core and both language files were served from `/vendor/` on the application origin.
- The generated standalone made no 404 requests and reported no console, runtime, or network-loading errors during native and OCR processing.
- Session storage was checked after review/forecast: no filename or OCR text was present; confirmed numeric values and provenance survived refresh.
- Product code contains no document-processing `fetch`, XHR, analytics transmission or external OCR endpoint.

## OCR performance and size

- Initial authored HTML/CSS/JS assets are approximately 208 KB on disk, excluding vendor assets.
- PDF.js module + worker are approximately 1.7 MB and load after PDF selection; optional PDF support assets remain local.
- OCR runtime + worker + core + `heb+eng` trained data are approximately 17.2 MB on disk and lazy-load only for scanned PDFs.
- Desktop and emulated 390×844 mobile scanned-PDF runs completed without browser errors or horizontal overflow.
- Cancellation terminated active processing and preserved existing session values.

## Remaining scope

Cross-browser testing outside Chromium, assistive-technology testing with a screen reader, broad provider-specific PDF parsing, JPG/PNG/camera payslip input, pension-report OCR, selective second-pass numeric OCR, detailed multi-product pension modeling, tax modeling, benefit eligibility and stochastic simulation are not included.
