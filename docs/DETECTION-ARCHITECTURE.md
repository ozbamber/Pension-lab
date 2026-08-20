# Detection Architecture

## Scope and privacy boundary

Pension Lab processes documents locally in the browser. PDF text extraction, optional OCR, candidate generation, scoring, and reconciliation run without uploading the file or raw extracted text. Diagnostics contain field names, method, alias identifiers, confidence, origin, and validation state—not source text or financial values.

## Pipeline

1. PDF.js extracts token text and page geometry. If the native text layer is unusable for a payslip, locally bundled Tesseract OCR is loaded lazily.
2. Financial normalization parses currencies, grouping separators, decimal separators, and percentages. OCR repair is conservative: only ambiguous `O/o/I/l/|` characters are repaired when surrounded by sufficient numeric evidence; unrelated letters are not guessed as digits.
3. Semantic alias groups identify salary, employee, employer, severance, balance, fee, and provider anchors in Hebrew and English.
4. Tokens are grouped into spatial rows. Every numeric observation receives a stable in-document candidate identity so one observation cannot silently fill multiple roles. Structured tokens and flattened-text fallback tokens are evaluated as separate streams, never as duplicate candidates in one pool.
5. Every semantic anchor considers a deterministic neighborhood of at most five own/nearby rows even when its own row already contains a number. Candidate eligibility stays spatially broad while geometry affects score. Unary scores combine OCR confidence, format confidence, label proximity, page/row distance, and monthly-versus-annual semantics.
6. The payslip selector evaluates bounded combinations of salary and contribution candidates. It rewards amount/rate agreement and completeness, rejects reused observations and impossible ratios, and penalizes annual or YTD salary and contribution contexts when a monthly value is required.
7. Pension-report parsing independently selects the closing balance, personal fee percentages, provider, report date, and contribution rows. Fee selection scores semantic type, spatial distance, and personal-versus-fund-average section context. It never uses a broad first-percentage window rule.
8. Contribution history is ordered by salary month. Annual/YTD summary rows do not replace monthly deposit rows, and recurring recent rows increase confidence.
9. Cross-document reconciliation compares independent observations with tolerance, explicit source periods, period reliability, and evidence strength. Agreement raises confidence. Reliable different-month conflicts select the newer observation symmetrically; same-month, missing-date, or unreliable-date ambiguity remains visible unless one source has substantially stronger independent evidence. When the payslip truly lacks a value, a directly observed report value may supply it with its report provenance intact.

## Financial consistency

The scorer uses identities rather than fixture values or legal-rate constants:

- `contribution amount / insured salary ≈ contribution rate` when both are printed;
- contribution amounts must be positive and smaller than the salary;
- individual and combined ratios must remain within broad mathematical guardrails;
- a printed total may corroborate, but does not replace, its component observations;
- mutually exclusive fields cannot reuse the same candidate identity.

## Provenance and review

- `direct` — the returned value is a selected document observation.
- `derived` — the value is calculated from direct observations, such as amount divided by insured salary.
- Relationship inference influences selection and confidence but does not invent a numeric value. Cross-document evidence is labeled `crossValidated`, `STRONGER_INDEPENDENT_EVIDENCE`, `CHRONOLOGY_RESOLVED`, or `CROSS_DOCUMENT_CONFLICT`.
- OCR-derived critical values, materially conflicting alternatives, and near-tied salary candidates require user confirmation.
- Missing fields remain missing; the application does not insert document-derived legal defaults.

## Candidate pruning and determinism

Each semantic anchor first searches at most five own/nearby spatial rows, then retains only its highest-scoring bounded set of amount and rate candidates. The global evaluator explores the Cartesian product of those bounded sets and sorts deterministically by score and evidence completeness. This keeps browser runtime predictable while preserving genuine alternatives for adversarial layouts.

## Regression coverage

Synthetic tests cover a misleading `925` on the salary-anchor row with the true salary on a separate adjacent row, split-row contribution amount/rate pairs, monthly versus annual/YTD salary and contribution candidates, full contribution tuples, impossible relationships, ambiguous salaries, missing amounts or rates, amount/rate conflicts, conservative OCR corruption (`23,5OO`, `1,64S`, `1,64O`), annual/YTD report rows, fee-average confusion, symmetric cross-document chronology, same-month conflict, and report-only supply of a genuinely missing payslip amount.
