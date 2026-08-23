# Pension Lab Dataset v2

This directory is the versioned benchmark contract for Israeli payslip and pension-report extraction. It is intentionally separate from parser implementation.

## Current contents

- 70 documents total: 36 payslips and 34 pension reports.
- Pension-report routing corpus: 30 new-pension reports (21 independent parents and 9 augmentations) and 4 old-pension reports (3 independent parents and 1 augmentation).
- 55 PDFs with at least one text-layer page.
- 15 image-only/degraded PDFs plus one mixed text/OCR pension report for robustness testing.
- 15 layout families.
- No real person's financial document is included in this version.

The eight documents previously described as `public-layout-derived` are **synthetic replicas informed by public layout references**, not copies of public people's documents. They remain `source_type=synthetic`; their external references are stored separately under `layout_reference`.

## Splits

- `development` - known template families used for parser iteration.
- `validation` - new variants of known families. Public-layout-derived replicas are preferentially placed here.
- `unseen-template-test` - entire template families held out from development/validation.
- `golden-real-test` - reserved for consented, de-identified real documents. It is empty today and should normally remain local/private.

Never perform a random document-level split. Parent documents and every augmented/degraded child must remain in the same split. The validator enforces lineage and unseen-family isolation.

## Metadata and ground truth

`metadata/manifest.jsonl` is one record per document and includes stable id, SHA256, source type, family, split, lineage, scan/text-layer metadata and provenance.

`ground-truth/<id>.json` uses a parser-independent canonical schema. Pension-report truth records independently label `fund_type`, `report_type`, and `expectedRouting`; old-pension records are routing/classification cases and are excluded from supported-new forecast-coverage denominators. `annotation.annotated_fields` distinguishes a genuinely labeled field from an unannotated/null field. `annotation.expected_absent_fields` is the only source used for abstention scoring.

## Evaluation profiles

The default `core` profile evaluates fields the current Pension Lab parser is designed to return. `extended` evaluates every annotated field, including fields such as net salary or fund-average fees that may intentionally be outside the current parser contract.

Metrics:

1. field accuracy;
2. critical-document accuracy - every critical field in the document must pass;
3. validation accuracy - internal salary x rate = contribution amount identities;
4. abstention accuracy - only where an annotator explicitly labeled a field as absent.

## Commands

```bash
npm run dataset:validate
npm run test:dataset
npm run dataset:benchmark:text
npm run dataset:benchmark:browser
```

The text benchmark is a fast parser-only loop over the 55 safe derived text observations. It does **not** prove PDF.js/browser performance. The browser benchmark runs actual PDFs through the application document pipeline and is the authoritative full-pipeline benchmark.

The headline safety benchmark is the supported-new-pension independent-parent set. Augmented children remain useful robustness cases but are not independent statistical observations. Automatic accuracy reports both the observed result and an exact one-sided 95% Clopper-Pearson lower bound. With zero failures, 59 independent automatic successes are required for that lower bound to reach 95%; the current 21-parent supported-new set therefore still needs 38 additional zero-failure independent reports. `HIGH`, `MEDIUM`, and `LOW` are rule/evidence confidence bands, not calibrated probabilities.

Generated evaluation output belongs under `dataset/evaluation/` and is ignored by Git.

Pension-report V2 robustness children are generated locally with
`scripts/dataset/generate-pension-augmentations.py`. They cover 150/200/300 DPI,
JPEG compression, grayscale, light blur/noise, ±1.5° rotation, removed text
layers, and a mixed text/OCR document. These children inherit the parent split
and are reported separately from synthetic parents.

## Real documents

Consented real documents require a separate collection/de-identification workflow. Do not place them in this distributable directory unless distribution is explicitly authorized. The validator rejects real/consented manifest records without `distribution_authorized=true`.

The expansion target is at least 59 independent supported-new reports spanning annual and quarterly formats, providers, generations, layouts, multipage tables, employer multiplicity, salary/rate changes, late deposits, corrections, zero/non-zero fees, explicit/missing totals, bilingual content, and native/scanned PDFs. Synthetic cases alone are insufficient for a production reliability claim. A meaningful consented, irreversibly de-identified `golden-real-test` set must remain separate; synthetic files must never be relabeled as real.
