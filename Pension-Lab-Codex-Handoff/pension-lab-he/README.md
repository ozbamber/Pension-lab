# Pension Lab — Hebrew RTL MVP

A static, client-side Hebrew pension scenario simulator with locally bundled PDF/OCR dependencies.

## Quick start

The easiest option is the single-file build located next to this folder:

```text
pension-lab-he-standalone.html
```

Open it directly in a modern browser. The source version can also be opened directly through `index.html`, or served locally:

```bash
cd pension-lab-he
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Build the standalone file

After changing `index.html`, `styles.css`, `engine.js`, or `app.js`, rebuild the single-file version:

```bash
node build-standalone.js
```

The command writes `../pension-lab-he-standalone.html`.

## Automated tests

Calculation-engine tests:

```bash
node tests.js
```

The suite currently contains **23 tests**, including compounding, inflation, fees, contribution accounting, career breaks, salary restart rules, phase continuation, retirement-age exploration, protected-return blending, and pension coefficients.

Browser smoke test and screenshots:

```bash
node browser-smoke.js
```

Document-model tests:

```bash
node document-extraction-tests.js
```

Local OCR/parser and real-browser privacy tests:

```bash
node ocr-parser-tests.js
node ocr-browser-tests.js
```

Requirements: Node.js 22+ and Chromium/Chrome. Set `CHROMIUM_PATH` when the browser executable is not on `PATH`.

The smoke test renders the standalone app at 1440px, 822px, 390px and 320px widths. It checks the document/manual onboarding, review validation, statutory retirement-age default, forecast, return comparison, advanced controls, career breaks, real/nominal switching, reset, console errors and horizontal overflow. Screenshots are written to `qa-output/`.

## What is implemented

- Document-first onboarding with payslip, annual pension report, partial-document and manual paths
- Review gate for birth year, statutory retirement track, insured salary, current balance and contribution assumptions
- Session-only numerical state in `sessionStorage`; raw files and file names are not persisted
- Local PDF.js text extraction with a testable usefulness heuristic
- Lazy, browser-local Tesseract.js OCR fallback for scanned payslip PDFs using bundled Hebrew and English data
- Spatial payslip parsing, centralized financial normalization, amount/rate cross-validation and confirmation flags
- PDF-only payslip upload with progress, cancellation and a safe manual fallback
- Engine-based 2% / 4% / 6% real-return comparison with an accessible text fallback
- Progressive disclosure for forecast improvement and advanced assumptions
- Field provenance badges for system, document and user-edited values
- Local-only document processing with no cloud OCR, document backend or third-party runtime CDN
- Privacy-safe `trackEvent()` abstraction that sends no data
- Full Hebrew and RTL interface
- Editable current age and retirement age
- Current balance, salary and pensionable salary
- Fixed or percentage contributions, including severance
- Multi-phase salary growth, real or nominal
- Multi-phase investment returns, real or nominal
- Optional protected-return planning approximation
- Inflation and real/nominal views
- Career breaks with partial contributions and salary restart rules
- Deposit and balance fees
- Pension conversion coefficient and sensitivity view
- Monthly projection engine
- Balance-over-time chart
- Retirement-age explorer
- Editable 2%, 4% and 6% real-return assumption scenarios
- Legacy persistent scenarios are not imported into the new main flow
- Responsive desktop/mobile layout
- Safe in-memory storage fallback when browser persistence is unavailable
- Generated standalone HTML build

## Local OCR assets

PDF.js and Tesseract.js runtime assets are under `vendor/` and are served from the application's own static origin. PDF.js is loaded only after a PDF is selected. The OCR runtime, worker, WebAssembly core and `heb+eng` language files are loaded only when native PDF text is insufficient.

The OCR payload is approximately 17.2 MB on disk before HTTP compression. The English and Hebrew language files account for approximately 10.9 MB and 2.2 MB respectively and are already gzip-compressed. See `THIRD_PARTY_NOTICES.md` for versions and licenses.

Synthetic fixtures live in `tests/fixtures/payslips/`. Real or identifiable payslips must never be committed; private fixture paths and private/real PDF suffixes are ignored.

## Modeling notes

- Defaults are examples, not recommendations.
- Contributions in the result decomposition are shown **before fees**, while deposit and balance fees are shown separately. This keeps the accounting identity consistent: starting balance + contributions + investment growth − fees = retirement balance.
- Phase schedules are normalized into contiguous periods. The first start age and final retirement boundary are fixed; editing an intermediate end age updates the following phase boundary.
- Overlapping career breaks are normalized into sequential periods and clipped at retirement.
- The optional 30% / 5.15% values are an editable planning example. The statutory mechanism uses a 5.15% real target, but the allocation applied in practice may depend on age, investment track and transition rules. The simulator does not calculate regulatory eligibility and does not assume today's rules will persist for decades.
- Taxes and National Insurance benefits are not modeled.
- The projection is deterministic; Monte Carlo simulation is outside this MVP.
