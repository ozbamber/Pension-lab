# Evaluation output

Generated evaluation JSON belongs here during local work and is ignored by Git.
Do not commit raw extracted text, OCR output, or predictions containing private financial information.

Pension-report benchmark JSON separates:

- supported-new independent parents (the statistical headline);
- supported-new augmentations (robustness only);
- old-pension routing/classification;
- unknown review routing;
- annual/quarterly and text-layer/image-only subgroups.

`observedAccuracy` is accompanied by an exact one-sided 95% Clopper-Pearson lower bound. Related augmented children never increase `independentSampleSize`. With zero failures, the 95% lower bound reaches 95% only at 59 independent successes.

Diagnostics for every reviewed/failed supported-new document include the document/fund/report identity, automatic decision, failure stage and reasons, table/row status, critical-field status, baseline status, reconciliation status, and extraction passes. Financial values and raw document/OCR text are intentionally excluded.
