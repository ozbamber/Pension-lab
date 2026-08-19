# Third-party browser assets

The OCR path is bundled locally so document processing does not depend on a CDN or remote OCR service.

| Component | Version | Purpose | License file |
| --- | --- | --- | --- |
| PDF.js (`pdfjs-dist`) | 6.2.108 | Local PDF text extraction and page rendering | `vendor/pdfjs/LICENSE` |
| Tesseract.js | 7.0.0 | Browser-local OCR worker | `vendor/tesseract/LICENSE-tesseract-js.md` |
| Tesseract.js Core | 7.0.0 | Local WebAssembly OCR runtime | `vendor/tesseract/LICENSE-tesseract-core` |
| Tesseract `heb` trained data | 4.0.0 | Hebrew OCR language data | Apache-2.0 |
| Tesseract `eng` trained data | 4.0.0 | English OCR language data | Apache-2.0 |

All runtime and language assets are served from this application's own static origin. They are loaded only after a payslip PDF requires OCR.
