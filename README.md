# Pension Lab

Pension Lab is a static, client-side Hebrew RTL pension scenario simulator. Payslip and pension-report processing stays in the browser and uses locally bundled PDF.js and Tesseract assets; there is no document backend or cloud OCR.

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

The suites cover the projection engine, document data model, candidate-based salary and contribution detection, OCR normalization, pension-report history and fees, cross-document reconciliation, the generated standalone artifact, local-only privacy behavior, cancellation, refresh persistence, and desktop/mobile overflow.

## Detection model

The parser generates multiple typed candidates from semantic aliases and spatial rows, then scores coherent salary/employee/employer/severance tuples. It uses broad financial identities and document chronology, not fixed legal rates or fixture-specific values. Conflicts and close alternatives remain reviewable instead of being silently guessed. See [docs/DETECTION-ARCHITECTURE.md](docs/DETECTION-ARCHITECTURE.md).

## Product and modeling boundaries

- This is a planning/simulation tool, not personal pension advice.
- Defaults and return scenarios are editable examples, not forecasts.
- Files and raw extracted text remain local to the active browser processing session.
- Contributions are modeled gross; deposit and balance fees remain separate for accounting consistency.
- Taxes, benefit eligibility, provider-specific product rules, and stochastic simulation are outside the current model.

See [docs/QA.md](docs/QA.md), [docs/SOURCES.md](docs/SOURCES.md), and [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md) for evidence and dependencies.
