# Pension Lab

Pension Lab is a static, client-side Hebrew RTL pension planning tool. Its report-first journey is: upload one annual or quarterly pension report, review the extracted pension state, enter years until retirement, receive one transparent baseline forecast, and optionally explore one compact combined what-if scenario. Document processing stays in the browser and uses locally bundled PDF.js and Tesseract assets; there is no document backend or cloud OCR.

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

For a review-only synthetic simulator, open `http://127.0.0.1:8080/?demo=1`. Demo mode is activated only by this query parameter, bypasses document upload/OCR, is visibly labeled as synthetic, and keeps its pension state and simulator choices in memory only. It does not read, replace, or delete a normal same-tab session; leaving demo mode restores the ordinary product route.

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
npm run test:browser:simulator
npm run test:browser:demo
```

Node.js 22+ and Chromium/Chrome are required for browser suites. Set `CHROMIUM_PATH` if the executable is not discoverable.

The suites cover the projection engine, immutable simulator scenarios, normalized pension-report state, complete contribution history, arithmetic and ambiguity rules, OCR normalization, the generated standalone artifact, local-only privacy behavior, cancellation, refresh persistence, exact forecast horizons, central real/nominal comparisons, and desktop/mobile overflow.

## Pension-report model

Annual and quarterly reports use one semantic parser. It extracts balance, personal fees, provider/report metadata, and every reliable contribution row with source evidence. Raw rows are preserved; reliable rows are normalized by salary month; legitimate distinct-employer deposits are aggregated; conflicting corrections remain reviewable. The baseline monthly contribution is the arithmetic mean of all reliable normalized monthly totals, while reported pension salary and implied rates remain supporting information. See [docs/DETECTION-ARCHITECTURE.md](docs/DETECTION-ARCHITECTURE.md).

## Product and modeling boundaries

- This is a planning/simulation tool, not personal pension advice.
- PR1 uses a visible 4% real-return, 2% inflation, and coefficient-200 baseline; these are planning assumptions, not forecasts or recommendations.
- Files and raw extracted text remain local to the active browser processing session.
- Contributions are modeled gross; deposit and balance fees remain separate for accounting consistency.
- The recurring pension deposit remains constant in real terms, and `yearsUntilRetirement × 12` determines the projection horizon exactly.
- PR2 keeps an immutable PR1 baseline and a separate session-only selected scenario. It exposes nominal return, inflation, either a safe contribution-rate/amount fallback, and two fee controls; it uses the same projection engine and never uploads or persists what-if choices.
- `?demo=1` constructs a fresh canonical synthetic `new_pension` state after parsing, applies a 25-year horizon, and enters the same simulator APIs and gating path. It never creates a PDF, invokes OCR, or uses browser persistence.
- The 6.08% nominal default is the exact equivalent of the visible 4% real return and 2% inflation baseline. Green slider ranges are comparison context, not a statement that an outcome is good.
- Saved scenarios, salary growth, career breaks, investment allocation, retirement-age Explorer, coefficient controls, and personalized optimization remain deferred.
- Taxes, benefit eligibility, provider-specific product rules, and stochastic simulation are outside the current model.

See [docs/QA.md](docs/QA.md), [docs/PR2-AUDIT-2026-08-31.md](docs/PR2-AUDIT-2026-08-31.md), [docs/RELEASE.md](docs/RELEASE.md), [docs/SOURCES.md](docs/SOURCES.md), and [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md) for evidence, release operations, and dependencies.
