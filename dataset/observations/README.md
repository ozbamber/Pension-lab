# Derived observations

`pdf-text/*.txt` contains deterministic text-layer observations generated from the synthetic/public-layout-derived PDFs with Poppler `pdftotext -layout`.

These files are **not** the production extraction path and must not be used as proof of browser/PDF.js accuracy. They exist for a fast parser-only regression loop. Full-pipeline PDF/OCR evaluation should run through the browser document pipeline.

No observation file should be generated or committed for private/consented-real documents.
