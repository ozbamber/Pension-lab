# Pension Lab

Pension Lab is a static, client-side Hebrew RTL pension planning tool. Its PR1 journey is pension-report-first: upload one annual or quarterly pension report, review the extracted pension state, enter years until retirement, and receive one transparent baseline forecast. Document processing stays in the browser and uses locally bundled PDF.js and Tesseract assets; there is no document backend or cloud OCR.

The normal product flow does not require a payslip, date of birth, current age, retirement age, gross salary, or manually entered contribution rates. Historical payslip parser modules remain isolated in the repository for regression coverage, but the running application does not load or depend on them.

## Repository layout

- `app/` — the only application source tree, including vendored browser assets.
- `tests/` — calculation, extraction, reconciliation, privacy, and responsive browser tests plus synthetic fixtures.
- `scripts/` — deterministic build and synthetic-fixture helpers.
- `docs/` — architecture, QA evidence, change history, sources, and notices.
- `dist/` — generated standalone and Cloudflare Pages output; ignored by Git.
- `legacy/` — historical handoff material and the original archive; not active source.

Private acceptance documents belong only in the ignored `private-qa/` directory. Never commit real payslips, pension reports, OCR text, extracted text, or QA output containing personal financial data.

## Run locally

```bash
python -m http.server 8080 --directory app
```

Then open `http://127.0.0.1:8080/`.

## Build

```bash
npm run build
```

The build removes and recreates `dist/`, copies the canonical `app/` tree, and generates `dist/pension-lab-he-standalone.html`. Generated deployment files are never edited or tracked as a second implementation.

## Test

Core suites:

```bash
npm run test:core
```

Browser privacy/OCR and responsive smoke suites:

```bash
npm run build
npm run test:browser:ocr
npm run test:browser:standalone
npm run test:browser:smoke
```

Node.js 22+ and Chromium/Chrome are required for browser suites. Set `CHROMIUM_PATH` if the executable is not discoverable.

The suites cover the projection engine, normalized pension-report state, complete contribution history, arithmetic and ambiguity rules, OCR normalization, the generated standalone artifact, local-only privacy behavior, cancellation, refresh persistence, exact forecast horizons, and desktop/mobile overflow.

## Pension-report model

Annual and quarterly reports use one semantic parser. It extracts balance, personal fees, provider/report metadata, and every reliable contribution row with source evidence. Raw rows are preserved; reliable rows are normalized by salary month; legitimate distinct-employer deposits are aggregated; conflicting corrections remain reviewable. The baseline monthly contribution is the arithmetic mean of all reliable normalized monthly totals, while reported pension salary and implied rates remain supporting information. See [docs/DETECTION-ARCHITECTURE.md](docs/DETECTION-ARCHITECTURE.md).

## Product and modeling boundaries

- This is a planning/simulation tool, not personal pension advice.
- PR1 uses a visible 4% real-return, 2% inflation, and coefficient-200 baseline; these are planning assumptions, not forecasts or recommendations.
- Files and raw extracted text remain local to the active browser processing session.
- Contributions are modeled gross; deposit and balance fees remain separate for accounting consistency.
- The recurring pension deposit remains constant in real terms, and `yearsUntilRetirement × 12` determines the projection horizon exactly.
- Interactive what-if controls and scenario comparison are deferred to PR2.
- Taxes, benefit eligibility, provider-specific product rules, and stochastic simulation are outside the current model.

See [docs/QA.md](docs/QA.md), [docs/SOURCES.md](docs/SOURCES.md), and [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md) for evidence and dependencies.
