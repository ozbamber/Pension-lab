(function (root) {
  'use strict';

  let pdfModulePromise = null;
  let tesseractPromise = null;

  function assetRoot() {
    if (root.PENSION_LAB_ASSET_ROOT) return new URL(root.PENSION_LAB_ASSET_ROOT, root.location && root.location.href ? root.location.href : undefined);
    const current = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    if (current) return new URL('./', current);
    const href = root.location && root.location.href ? root.location.href : 'http://localhost/';
    if (/pension-lab-he-standalone\.html(?:$|[?#])/.test(href)) return new URL('./pension-lab-he/', href);
    return new URL('./', href);
  }

  function assetUrl(path) {
    return new URL(path, assetRoot()).href;
  }

  function abortError() {
    try { return new DOMException('Document processing cancelled.', 'AbortError'); }
    catch (_) { const error = new Error('Document processing cancelled.'); error.name = 'AbortError'; return error; }
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError();
  }

  async function loadPdfJs() {
    if (!pdfModulePromise) {
      pdfModulePromise = import(assetUrl('vendor/pdfjs/pdf.min.mjs')).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('vendor/pdfjs/pdf.worker.min.mjs');
        return pdfjs;
      });
    }
    return pdfModulePromise;
  }

  async function openPdf(bytes, options = {}) {
    throwIfAborted(options.signal);
    const pdfjs = await loadPdfJs();
    throwIfAborted(options.signal);
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      cMapUrl: assetUrl('vendor/pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: assetUrl('vendor/pdfjs/standard_fonts/'),
      wasmUrl: assetUrl('vendor/pdfjs/wasm/'),
      useSystemFonts: true,
      stopAtErrors: false,
    });
    const cancel = () => { try { loadingTask.destroy(); } catch (_) {} };
    if (options.signal) options.signal.addEventListener('abort', cancel, { once: true });
    try {
      const pdf = await loadingTask.promise;
      throwIfAborted(options.signal);
      return pdf;
    } finally {
      if (options.signal) options.signal.removeEventListener('abort', cancel);
    }
  }

  function textTokens(content, pageNumber) {
    return (content.items || []).filter((item) => item && typeof item.str === 'string' && item.str.trim()).map((item) => {
      const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
      return {
        text: item.str,
        x: Number(transform[4]) || 0,
        y: Number(transform[5]) || 0,
        width: Math.max(0, Number(item.width) || 0),
        height: Math.max(8, Math.abs(Number(item.height) || Number(transform[3]) || 12)),
        confidence: 0.99,
        page: pageNumber,
      };
    });
  }

  async function extractNativePages(pdf, options = {}) {
    const maxPages = Math.min(pdf.numPages, Math.max(1, Number(options.maxPages) || 1));
    const pages = [];
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      throwIfAborted(options.signal);
      if (typeof options.onProgress === 'function') options.onProgress({ phase: 'pdf-text', pageNumber, pageCount: maxPages });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const tokens = textTokens(content, pageNumber);
      pages.push({ pageNumber, tokens, text: tokens.map((token) => token.text).join(' ') });
      page.cleanup();
    }
    return { pages, text: pages.map((page) => page.text).join('\n') };
  }

  function assessNativeText(nativeResult, kind = 'payslip') {
    const text = String(nativeResult && nativeResult.text || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const letters = (text.match(/[\u0590-\u05ffa-z]/gi) || []).length;
    const digits = (text.match(/\d/g) || []).length;
    const anchors = kind === 'payslip' && root.PensionPayslipParser
      ? root.PensionPayslipParser.countPayslipAnchors(text)
      : root.PensionReportParser ? root.PensionReportParser.countReportAnchors(text) : Number(/יתרה|דמי\s*ניהול|current\s*balance|annual\s*report/i.test(text));
    const printable = (text.match(/[\u0590-\u05ff\x20-\x7e]/g) || []).length;
    const printableRatio = text.length ? printable / text.length : 0;
    const signals = {
      enoughLength: text.length >= 36,
      meaningfulLetters: letters >= 8,
      meaningfulDigits: digits >= 3,
      printable: printableRatio >= 0.65,
      anchors: anchors >= 1,
    };
    const score = Object.values(signals).filter(Boolean).length;
    let reason = 'native-text-usable';
    if (!signals.enoughLength) reason = 'too-little-text';
    else if (!signals.printable) reason = 'unusable-character-order';
    else if (!signals.meaningfulDigits) reason = 'too-few-digits';
    else if (!signals.meaningfulLetters) reason = 'too-few-words';
    else if (!signals.anchors) reason = 'no-payslip-anchors';
    return { useful: score >= 4 && signals.enoughLength && signals.meaningfulDigits && signals.anchors, reason, score, signals };
  }

  async function loadTesseract() {
    if (root.Tesseract) return root.Tesseract;
    if (!tesseractPromise) {
      tesseractPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = assetUrl('vendor/tesseract/tesseract.min.js');
        script.async = true;
        script.onload = () => root.Tesseract ? resolve(root.Tesseract) : reject(new Error('Local OCR runtime did not initialize.'));
        script.onerror = () => reject(new Error('Local OCR runtime could not be loaded.'));
        document.head.appendChild(script);
      });
    }
    return tesseractPromise;
  }

  function ocrStatus(progress) {
    const status = String(progress && progress.status || '');
    if (/recognizing text/i.test(status)) return 'recognizing';
    if (/loading language/i.test(status)) return 'loading-language';
    return 'loading-ocr';
  }

  async function createOcrEngine(options = {}) {
    throwIfAborted(options.signal);
    const Tesseract = await loadTesseract();
    throwIfAborted(options.signal);
    let worker = null;
    const logger = (progress) => {
      if (typeof options.onProgress === 'function') options.onProgress({
        phase: ocrStatus(progress),
        progress: Number.isFinite(Number(progress && progress.progress)) ? Number(progress.progress) : null,
      });
    };
    worker = await Tesseract.createWorker('heb+eng', 1, {
      workerPath: assetUrl('vendor/tesseract/worker.min.js'),
      corePath: assetUrl('vendor/tesseract/tesseract-core-lstm.wasm.js'),
      langPath: assetUrl('vendor/tessdata/'),
      gzip: true,
      workerBlobURL: false,
      logger,
    });
    const cancel = () => { if (worker) worker.terminate().catch(() => {}); };
    if (options.signal) options.signal.addEventListener('abort', cancel, { once: true });
    return {
      async recognize(canvas, pageNumber) {
        throwIfAborted(options.signal);
        const result = await worker.recognize(canvas, { rotateAuto: false }, { text: true, blocks: true });
        throwIfAborted(options.signal);
        const data = result && result.data ? result.data : {};
        return {
          pageNumber,
          text: String(data.text || ''),
          blocks: data.blocks || [],
          confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) / 100 : null,
        };
      },
      async terminate() {
        if (options.signal) options.signal.removeEventListener('abort', cancel);
        if (worker) {
          const current = worker;
          worker = null;
          await current.terminate().catch(() => {});
        }
      },
    };
  }

  async function renderPage(pdf, pageNumber, options = {}) {
    throwIfAborted(options.signal);
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetScale = Math.min(2.4, Math.max(1.7, Number(options.scale) || 2.1), 3200 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale: targetScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!context) throw new Error('Canvas rendering is unavailable.');
    const renderTask = page.render({ canvasContext: context, viewport, background: '#ffffff' });
    const cancel = () => { try { renderTask.cancel(); } catch (_) {} };
    if (options.signal) options.signal.addEventListener('abort', cancel, { once: true });
    try {
      await renderTask.promise;
      throwIfAborted(options.signal);
      return canvas;
    } finally {
      if (options.signal) options.signal.removeEventListener('abort', cancel);
      page.cleanup();
    }
  }

  function releaseCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
  }

  root.PensionLocalDocuments = Object.freeze({
    assetRoot,
    assetUrl,
    abortError,
    throwIfAborted,
    loadPdfJs,
    openPdf,
    extractNativePages,
    assessNativeText,
    createOcrEngine,
    renderPage,
    releaseCanvas,
  });
})(typeof window !== 'undefined' ? window : globalThis);
