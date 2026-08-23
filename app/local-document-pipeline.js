(function (root) {
  'use strict';

  let pdfModulePromise = null;
  let tesseractPromise = null;

  function assetRoot() {
    if (root.PENSION_LAB_ASSET_ROOT) return new URL(root.PENSION_LAB_ASSET_ROOT, root.location && root.location.href ? root.location.href : undefined);
    const current = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    if (current) return new URL('./', current);
    const href = root.location && root.location.href ? root.location.href : 'http://localhost/';
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
      async recognize(canvas, pageNumber, recognizeOptions = {}) {
        throwIfAborted(options.signal);
        const parameters = {
          tessedit_pageseg_mode: String(Number(recognizeOptions.psm) || 3),
          preserve_interword_spaces: '1',
          user_defined_dpi: String(Number(recognizeOptions.dpi) || 300),
          tessedit_char_whitelist: String(recognizeOptions.whitelist || ''),
        };
        await worker.setParameters(parameters);
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
    const maxScale = Math.max(1.7, Number(options.maxScale) || 2.4);
    const maxDimension = Math.max(2400, Number(options.maxDimension) || 3200);
    const targetScale = Math.min(maxScale, Math.max(1.7, Number(options.scale) || 2.1), maxDimension / Math.max(baseViewport.width, baseViewport.height));
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

  function prepareOcrCanvas(sourceCanvas, options = {}) {
    const scale = Math.max(1, Math.min(2.5, Number(options.scale) || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
    canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('Canvas preprocessing is unavailable.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    if (options.grayscale || Number(options.contrast) > 1 || Number.isFinite(Number(options.threshold))) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const contrast = Math.max(1, Math.min(2.5, Number(options.contrast) || 1));
      const threshold = Number.isFinite(Number(options.threshold)) ? Math.max(0, Math.min(255, Number(options.threshold))) : null;
      for (let index = 0; index < image.data.length; index += 4) {
        const gray = Math.round(image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114);
        let value = Math.max(0, Math.min(255, Math.round((gray - 128) * contrast + 128)));
        if (threshold != null) value = value < threshold ? 0 : 255;
        image.data[index] = value;
        image.data[index + 1] = value;
        image.data[index + 2] = value;
        image.data[index + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    }
    return canvas;
  }

  function detectTableRegion(sourceCanvas) {
    const context = sourceCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) return null;
    const { width, height } = sourceCanvas;
    const image = context.getImageData(0, 0, width, height).data;
    const longestRuns = new Array(height).fill(0);
    for (let y = 0; y < height; y += 1) {
      let longest = 0;
      let run = 0;
      let lightGap = 0;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const gray = image[index] * 0.299 + image[index + 1] * 0.587 + image[index + 2] * 0.114;
        if (gray < 232) {
          run += lightGap + 1;
          lightGap = 0;
          if (run > longest) longest = run;
        } else if (run && lightGap < 3) {
          lightGap += 1;
        } else {
          run = 0;
          lightGap = 0;
        }
      }
      longestRuns[y] = longest;
    }
    const lineThreshold = width * 0.24;
    const lineGroups = [];
    for (let y = 0; y < height; y += 1) {
      if (longestRuns[y] < lineThreshold) continue;
      const start = y;
      while (y + 1 < height && longestRuns[y + 1] >= lineThreshold) y += 1;
      lineGroups.push({ start, end: y, center: (start + y) / 2 });
    }
    const clusters = [];
    const maximumGap = Math.max(42, Math.min(140, height * 0.035));
    for (const line of lineGroups) {
      const current = clusters[clusters.length - 1];
      if (!current || line.center - current[current.length - 1].center > maximumGap) clusters.push([line]);
      else current.push(line);
    }
    const candidates = clusters.filter((cluster) => cluster.length >= 3).sort((left, right) =>
      right.length - left.length || (right[right.length - 1].center - right[0].center) - (left[left.length - 1].center - left[0].center));
    if (!candidates.length) return null;
    const best = candidates[0];
    const y0 = Math.max(0, Math.floor(best[0].start - Math.max(30, height * 0.025)));
    const y1 = Math.min(height, Math.ceil(best[best.length - 1].end + Math.max(24, height * 0.018)));
    if (y1 - y0 < 60) return null;
    const rowBands = best.slice(0, -1).map((line, index) => ({
      x: Math.floor(width * 0.025),
      y: Math.max(0, Math.ceil(line.end + 2)),
      width: Math.ceil(width * 0.95),
      height: Math.max(0, Math.floor(best[index + 1].start - line.end - 4)),
    })).filter((band) => band.height >= 14 && band.height <= Math.max(180, height * 0.08));
    return {
      x: Math.floor(width * 0.025), y: y0, width: Math.ceil(width * 0.95), height: y1 - y0,
      rowBands,
      evidence: { horizontalLines: best.length, rowBands: rowBands.length },
    };
  }

  function ocrWords(blocks) {
    const words = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (Array.isArray(node.words) && node.words.length) {
        node.words.forEach((word) => { if (word?.bbox && String(word.text || '').trim()) words.push(word); });
        return;
      }
      ['blocks', 'paragraphs', 'lines'].forEach((key) => { if (Array.isArray(node[key])) node[key].forEach(visit); });
    };
    visit(blocks);
    return words;
  }

  function detectNumericTableRegion(ocrPage, sourceWidth, sourceHeight) {
    const words = ocrWords(ocrPage?.blocks || []);
    if (!words.length) return null;
    const normalized = words.map((word) => ({
      text: String(word.text || ''),
      x0: Number(word.bbox.x0) || 0,
      y0: Number(word.bbox.y0) || 0,
      x1: Number(word.bbox.x1) || 0,
      y1: Number(word.bbox.y1) || 0,
    })).filter((word) => word.x1 > word.x0 && word.y1 > word.y0);
    const rows = [];
    for (const word of normalized.sort((left, right) => (left.y0 + left.y1) - (right.y0 + right.y1))) {
      const centerY = (word.y0 + word.y1) / 2;
      let row = rows.find((candidate) => Math.abs(candidate.y - centerY) <= Math.max(10, (word.y1 - word.y0) * 0.75));
      if (!row) { row = { y: centerY, words: [] }; rows.push(row); }
      row.words.push(word);
      row.y = row.words.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / row.words.length;
    }
    const numericRows = rows.filter((row) => row.words.filter((word) => /[\dOoIl|]/.test(word.text) && !/%/.test(word.text)).length >= 4)
      .sort((left, right) => left.y - right.y);
    const clusters = [];
    for (const row of numericRows) {
      const current = clusters[clusters.length - 1];
      if (!current || row.y - current[current.length - 1].y > Math.max(90, sourceHeight * 0.055)) clusters.push([row]);
      else current.push(row);
    }
    const best = clusters.filter((cluster) => cluster.length >= 3).sort((left, right) => right.length - left.length)[0];
    if (!best) return null;
    const selectedWords = best.flatMap((row) => row.words);
    const x0 = sourceWidth * 0.015;
    const x1 = sourceWidth * 0.985;
    const y0 = Math.max(0, Math.min(...selectedWords.map((word) => word.y0)) - sourceHeight * 0.035);
    const y1 = Math.min(sourceHeight, Math.max(...selectedWords.map((word) => word.y1)) + sourceHeight * 0.035);
    const rowBands = best.map((row) => ({
      x: x0,
      y: Math.max(0, Math.min(...row.words.map((word) => word.y0)) - sourceHeight * 0.008),
      width: x1 - x0,
      height: Math.min(sourceHeight, Math.max(...row.words.map((word) => word.y1)) + sourceHeight * 0.008) -
        Math.max(0, Math.min(...row.words.map((word) => word.y0)) - sourceHeight * 0.008),
    }));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rowBands, evidence: { numericRows: best.length } };
  }

  function cropCanvas(sourceCanvas, region, options = {}) {
    if (!region) return null;
    const padding = Math.max(0, Number(options.padding) || 0);
    const x = Math.max(0, Math.floor(region.x - padding));
    const y = Math.max(0, Math.floor(region.y - padding));
    const width = Math.min(sourceCanvas.width - x, Math.ceil(region.width + padding * 2));
    const height = Math.min(sourceCanvas.height - y, Math.ceil(region.height + padding * 2));
    if (width <= 0 || height <= 0) return null;
    const canvas = document.createElement('canvas');
    const scale = Math.max(1, Math.min(2.5, Number(options.scale) || 1));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(sourceCanvas, x, y, width, height, 0, 0, canvas.width, canvas.height);
    return canvas;
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
    prepareOcrCanvas,
    detectTableRegion,
    detectNumericTableRegion,
    cropCanvas,
    releaseCanvas,
  });
})(typeof window !== 'undefined' ? window : globalThis);
