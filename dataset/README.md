# Pension Lab Dataset v2

This directory is the versioned benchmark contract for Israeli payslip and pension-report extraction. It is intentionally separate from parser implementation.

## Current contents

- 70 documents total: 36 payslips and 34 pension reports.
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

`ground-truth/<id>.json` uses a parser-independent canonical schema. `annotation.annotated_fields` distinguishes a genuinely labeled field from an unannotated/null field. `annotation.expected_absent_fields` is the only source used for abstention scoring.

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

Generated evaluation output belongs under `dataset/evaluation/` and is ignored by Git.

Pension-report V2 robustness children are generated locally with
`scripts/dataset/generate-pension-augmentations.py`. They cover 150/200/300 DPI,
JPEG compression, grayscale, light blur/noise, ±1.5° rotation, removed text
layers, and a mixed text/OCR document. These children inherit the parent split
and are reported separately from synthetic parents.

## Real documents

Consented real documents require a separate collection/de-identification workflow. Do not place them in this distributable directory unless distribution is explicitly authorized. The validator rejects real/consented manifest records without `distribution_authorized=true`.
