# Dataset v2 and evaluation strategy

Pension Lab treats the dataset as a product asset independent from the parser. Parser changes should be evaluated against stable documents and annotations rather than changing fixtures to match implementation behavior.

## Source hierarchy

Target long-term composition:

- consented, de-identified real documents: primary production evidence;
- official/public examples that are safe to redistribute;
- generated replicas informed by public layouts;
- synthetic and augmented documents for adversarial cases.

The current v2 import contains only generated/augmented documents. It should not be described as a real-world accuracy test.

## Golden real test

`golden-real-test` is intentionally empty. When real documents are collected:

- obtain explicit consent for the intended use;
- de-identify locally;
- retain real numeric distributions when re-identification risk permits;
- record consent/license and lineage;
- never commit raw source text, OCR output or identifying metadata;
- keep the golden set unavailable to routine parser tuning.

## Split policy

The unit of isolation is a lineage/template family, not an individual PDF. A degraded image and its clean parent always share a split. `unseen-template-test` uses families absent from development and validation so it measures template generalization rather than memorization.

## Evidence and future annotations

Current v1-imported ground truth contains expected numeric/text values but not page/box evidence. Future real annotations should add evidence locations (page, row/table label, bounding box where practical) and full monthly pension contribution history. This enables auditable reconciliation rather than number-only extraction.

## Reconciliation as the target task

The long-term benchmark should measure not only OCR/extraction but reconciliation:

1. infer expected pension contributions from the payslip;
2. locate actual deposits in the pension report;
3. align salary month/deposit date;
4. detect missing, late, corrected or mismatched contributions;
5. abstain when evidence is insufficient.

## Current execution snapshot

The current local v2 overlay contains 66 synthetic or augmented documents: 36 payslips and 30 pension reports. All 66 have ground truth; 54 have a PDF text layer and 12 are image-only/degraded. The `golden-real-test` split remains empty.

The current fast text-layer benchmark reports 75.5% field accuracy, 55.6% critical-document accuracy, and 100.0% validation accuracy across 54 eligible documents. Its arithmetic validation coverage is 86.4%: 140 of 162 possible checks ran and all 140 passed. The full browser benchmark, including OCR/image-only processing, reports 60.6% field accuracy, 33.3% critical-document accuracy, and 100.0% validation accuracy across all 66 documents. Its arithmetic validation coverage is 71.7%: 142 of 198 possible checks ran and all 142 passed.

The strongest remaining coverage gaps are dense/grid and landscape payslip layouts, split-value rows where flat PDF text loses column association, and some pension-report provider/fee/balance variants. Missing or spatially ambiguous values are intentionally left reviewable; the benchmark does not treat an inferred value as a successful extraction when the source lacks reliable label/position evidence.
