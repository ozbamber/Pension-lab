# Corpus v1 import notes

Imported on 2026-08-20 from `Pension-Lab-Document-Corpus-66.zip`.

Important provenance correction in Dataset v2:

- `public-layout-derived` does **not** mean the PDF itself is a public real document.
- Those eight PDFs are generated synthetic replicas informed by public layout/explanation sources.
- Dataset v2 therefore classifies them as `source_type=synthetic` and stores the external source only as `layout_reference`.
- The 12 degraded documents are `source_type=augmented` and point to their generated parent via `parent_document`.
- No document in this import is `consented_real` or `public_example`.
