(function (root) {
  'use strict';

  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_PDF_PAGES = 10;
  const MAX_PAYSLIP_PROCESSING_PAGES = 3;
  const SOURCES = Object.freeze({
    PAYSLIP: 'payslip',
    PAYSLIP_DIRECT: 'payslip',
    PAYSLIP_DERIVED: 'payslipDerived',
    PENSION_REPORT: 'pensionReport',
    PENSION_REPORT_DIRECT: 'pensionReport',
    PENSION_REPORT_DERIVED: 'pensionReportDerived',
    CROSS_VALIDATED: 'crossValidated',
    SYSTEM: 'system',
    USER: 'user',
    USER_OVERRIDE: 'user',
  });

  const PAYSLIP_FIELDS = Object.freeze([
    'grossSalary', 'insuredSalary', 'employeeContributionAmount', 'employeeContributionRate',
    'employerContributionAmount', 'employerContributionRate', 'severanceContributionAmount',
    'severanceRate', 'payslipMonth',
  ]);

  const PENSION_REPORT_FIELDS = Object.freeze([
    'currentBalance', 'balanceDate', 'depositManagementFeeRate', 'balanceManagementFeeRate', 'pensionProvider',
    'reportDate', 'latestReportedPensionableSalary', 'latestEmployeeContributionAmount',
    'latestEmployerContributionAmount', 'latestSeveranceContributionAmount', 'latestEmployeeContributionRate',
    'latestEmployerContributionRate', 'latestSeveranceRate',
  ]);

  function field(value = null, source = SOURCES.SYSTEM, confidence = null, confirmedByUser = false, metadata = {}) {
    return {
      value,
      unit: metadata.unit || null,
      source,
      sourceDocument: metadata.sourceDocument || null,
      sourceDate: metadata.sourceDate || null,
      confidence,
      requiresConfirmation: metadata.requiresConfirmation == null ? confidence != null && confidence < 0.9 : Boolean(metadata.requiresConfirmation),
      confirmedByUser: Boolean(confirmedByUser),
      lastModified: metadata.lastModified || null,
      extractionMethod: metadata.extractionMethod || null,
      evidence: metadata.evidence || null,
    };
  }

  function emptyExtraction(kind) {
    const names = kind === SOURCES.PAYSLIP ? PAYSLIP_FIELDS : PENSION_REPORT_FIELDS;
    return Object.fromEntries(names.map((name) => [name, field(null, kind, null, false)]));
  }

  function normalizedNumber(value, kind = 'amount') {
    if (root.PensionFinancial) return root.PensionFinancial.normalizeFinancialValue(value, { kind }).value;
    const cleaned = String(value || '').replace(/[₪,%\s]/g, '').replace(/,/g, '');
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? (kind === 'rate' && numeric > 1 ? numeric / 100 : numeric) : null;
  }

  function firstMatch(text, patterns, kind = 'amount') {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = normalizedNumber(match && match[1], kind);
      if (value != null) return value;
    }
    return null;
  }

  function pdfLiteralText(bytes) {
    const raw = new TextDecoder('latin1').decode(bytes);
    const pieces = [];
    const literalPattern = /\(([^()]{2,240})\)\s*Tj/g;
    let match;
    while ((match = literalPattern.exec(raw)) && pieces.length < 2000) {
      pieces.push(match[1].replace(/\\([()\\])/g, '$1').replace(/\\n/g, ' '));
    }
    return pieces.join('\n').replace(/[ \t]+/g, ' ').trim();
  }

  function direct(value, source, unit, fileName, confidence = 0.94, metadata = {}) {
    return field(value, source, confidence, false, {
      unit,
      sourceDocument: metadata.persistDocumentName ? fileName : null,
      requiresConfirmation: metadata.requiresConfirmation == null ? confidence < 0.9 : metadata.requiresConfirmation,
      extractionMethod: metadata.extractionMethod || 'pdf-text',
      evidence: metadata.evidence || null,
    });
  }

  function parsePensionReport(text, fileName) {
    if (root.PensionReportParser) return wrapPensionReportFields(root.PensionReportParser.parsePensionReport(text, { method: 'pdf-text' }), fileName);
    const fields = emptyExtraction(SOURCES.PENSION_REPORT);
    const currentBalance = firstMatch(text, [
      /(?:יתרה\s*(?:נוכחית|לסוף\s*שנה)|סה["״']?כ\s*חיסכון|current\s*balance|closing\s*balance)\s*[:\-]?\s*([\d,.\s]+)/i,
    ]);
    const depositFee = firstMatch(text, [/(?:דמי\s*ניהול\s*מהפקדה|deposit\s*fee)\s*[:\-]?\s*([\d,.]+\s*%)/i], 'rate');
    const balanceFee = firstMatch(text, [/(?:דמי\s*ניהול\s*(?:מחיסכון|מצבירה)|balance\s*fee)\s*[:\-]?\s*([\d,.]+\s*%)/i], 'rate');
    if (currentBalance != null) fields.currentBalance = direct(currentBalance, SOURCES.PENSION_REPORT_DIRECT, 'ILS', fileName);
    if (depositFee != null) fields.depositFee = direct(depositFee, SOURCES.PENSION_REPORT_DIRECT, 'ratio', fileName, 0.9);
    if (balanceFee != null) fields.balanceFee = direct(balanceFee, SOURCES.PENSION_REPORT_DIRECT, 'ratio', fileName, 0.9);
    return fields;
  }

  function wrapPensionReportFields(parsed, fileName) {
    const fields = emptyExtraction(SOURCES.PENSION_REPORT);
    Object.entries(parsed.fields || {}).forEach(([name, item]) => {
      if (!PENSION_REPORT_FIELDS.includes(name) || !item || item.value == null) return;
      fields[name] = field(item.value, item.origin === 'derived' ? SOURCES.PENSION_REPORT_DERIVED : SOURCES.PENSION_REPORT_DIRECT, item.confidence, false, {
        unit: item.unit, sourceDocument: null, requiresConfirmation: item.requiresConfirmation,
        sourceDate: item.sourceDate || item.evidence?.salaryMonth || null,
        extractionMethod: parsed.method, evidence: item.evidence,
      });
    });
    return fields;
  }

  function looksLikeWrongDocument(text, kind) {
    const payslipSignals = /insured\s*salary|gross\s*salary|employee\s*contribution|שכר\s*(מבוטח|ברוטו)|תגמולי\s*עובד/i.test(text);
    const pensionSignals = /current\s*balance|balance\s*fee|annual\s*report|יתרה\s*(נוכחית|לסוף)|דמי\s*ניהול|דוח\s*שנתי/i.test(text);
    return kind === SOURCES.PAYSLIP ? pensionSignals && !payslipSignals : payslipSignals && !pensionSignals;
  }

  function wrapPayslipFields(parsed, fileName) {
    const fields = emptyExtraction(SOURCES.PAYSLIP);
    Object.entries(parsed.fields || {}).forEach(([name, result]) => {
      if (!PAYSLIP_FIELDS.includes(name) || !result || result.value == null) return;
      const source = result.origin === 'derived' ? SOURCES.PAYSLIP_DERIVED : SOURCES.PAYSLIP_DIRECT;
      fields[name] = field(result.value, source, result.confidence, false, {
        unit: result.unit,
        sourceDocument: null,
        sourceDate: result.sourceDate || result.evidence?.sourceDate || null,
        requiresConfirmation: result.requiresConfirmation,
        extractionMethod: parsed.method,
        evidence: result.evidence,
      });
    });
    return fields;
  }

  function identifiedCount(fields) {
    return Object.values(fields || {}).filter((item) => item && item.value != null).length;
  }

  function parsePayslipInput(input, method, fileName) {
    if (!root.PensionPayslipParser) return null;
    const parsed = root.PensionPayslipParser.parsePayslip(input, { method });
    return { ...parsed, fields: wrapPayslipFields(parsed, fileName) };
  }

  function result(status, kind, fields, fileName, metadata = {}) {
    return {
      status,
      kind,
      fields,
      fileName,
      method: metadata.method || null,
      reason: metadata.reason || null,
      diagnostics: metadata.diagnostics || [],
      pageCount: metadata.pageCount || null,
      contributionHistory: metadata.contributionHistory || [],
      classification: metadata.classification || null,
    };
  }

  function classifyPdfError(error) {
    const name = String(error && error.name || '');
    const message = String(error && error.message || '');
    if (name === 'AbortError') return 'cancelled';
    if (/PasswordException/i.test(name) || /password/i.test(message)) return 'password-protected';
    if (/InvalidPDFException|MissingPDFException/i.test(name) || /invalid pdf|pdf structure/i.test(message)) return 'corrupted-pdf';
    return 'unreadable-pdf';
  }

  async function extractWithBrowserPipeline(bytes, file, kind, options) {
    const L = root.PensionLocalDocuments;
    let pdf = null;
    try {
      pdf = await L.openPdf(bytes, { signal: options.signal });
      if (pdf.numPages > MAX_PDF_PAGES) {
        return result('too-many-pages', kind, emptyExtraction(kind), file.name, { pageCount: pdf.numPages, reason: 'page-count-limit' });
      }
      const maxPages = kind === SOURCES.PAYSLIP ? Math.min(pdf.numPages, MAX_PAYSLIP_PROCESSING_PAGES) : Math.min(pdf.numPages, MAX_PDF_PAGES);
      const nativeResult = await L.extractNativePages(pdf, { maxPages, signal: options.signal, onProgress: options.onProgress });
      const assessment = L.assessNativeText(nativeResult, kind);
      if (looksLikeWrongDocument(nativeResult.text, kind)) {
        return result('wrong-document', kind, emptyExtraction(kind), file.name, { method: 'pdf-text', reason: 'document-signals-mismatch', pageCount: pdf.numPages });
      }

      if (kind === SOURCES.PENSION_REPORT) {
        const reportText = root.PensionPayslipParser
          ? root.PensionPayslipParser.buildRows(root.PensionPayslipParser.tokensFromInput(nativeResult)).map((row) => row.directText).join('\n')
          : nativeResult.text;
        const parsed = assessment.useful && root.PensionReportParser ? root.PensionReportParser.parsePensionReport(reportText, { method: 'pdf-text' }) : null;
        if (parsed) {
          const tokenFees = root.PensionReportParser.parseManagementFeesFromTokens(nativeResult);
          Object.entries(tokenFees).forEach(([name, item]) => {
            parsed.fields[name] = { value: item.value, unit: 'ratio', origin: 'direct', confidence: 0.96, requiresConfirmation: false, evidence: { aliasId: name, page: item.page, method: 'pdf-text' } };
          });
        }
        const fields = parsed ? wrapPensionReportFields(parsed, file.name) : (assessment.useful ? parsePensionReport(nativeResult.text, file.name) : emptyExtraction(kind));
        return result(identifiedCount(fields) ? 'partial' : 'manual-required', kind, fields, file.name, {
          method: 'pdf-text', reason: assessment.reason, pageCount: pdf.numPages,
          contributionHistory: parsed?.contributionHistory || [], classification: parsed?.classification || null,
        });
      }

      {
        let parsed = parsePayslipInput(nativeResult, 'pdf-text', file.name);
        if (!parsed?.fields?.insuredSalary?.value) {
          const tokenSequence = nativeResult.pages.flatMap((page) => page.tokens.map((token) => token.text)).join('\n');
          const sequential = parsePayslipInput(tokenSequence, 'pdf-text', file.name);
          if (sequential?.fields?.insuredSalary?.value) parsed = sequential;
        }
        if (parsed && identifiedCount(parsed.fields)) {
          return result('partial', kind, parsed.fields, file.name, {
            method: 'pdf-text', reason: 'native-text-usable', diagnostics: parsed.diagnostics, pageCount: pdf.numPages,
          });
        }
      }

      if (typeof options.onProgress === 'function') options.onProgress({ phase: 'scanned-pdf', progress: null });
      const ocr = await L.createOcrEngine({ signal: options.signal, onProgress: options.onProgress });
      const ocrPages = [];
      try {
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          L.throwIfAborted(options.signal);
          if (typeof options.onProgress === 'function') options.onProgress({ phase: 'rendering', pageNumber, pageCount: maxPages });
          const canvas = await L.renderPage(pdf, pageNumber, { signal: options.signal });
          try {
            const pageResult = await ocr.recognize(canvas, pageNumber);
            ocrPages.push(pageResult);
          } finally {
            L.releaseCanvas(canvas);
          }
          const current = { pages: ocrPages, text: ocrPages.map((page) => page.text).join('\n') };
          const parsed = parsePayslipInput(current, 'ocr', file.name);
          if (parsed && parsed.hasCriticalFields) {
            return result('partial', kind, parsed.fields, file.name, {
              method: 'ocr', reason: assessment.reason, diagnostics: parsed.diagnostics, pageCount: pdf.numPages,
            });
          }
        }
      } finally {
        await ocr.terminate();
      }
      const finalParsed = parsePayslipInput({ pages: ocrPages, text: ocrPages.map((page) => page.text).join('\n') }, 'ocr', file.name);
      if (finalParsed && identifiedCount(finalParsed.fields)) {
        return result('partial', kind, finalParsed.fields, file.name, {
          method: 'ocr', reason: assessment.reason, diagnostics: finalParsed.diagnostics, pageCount: pdf.numPages,
        });
      }
      return result(pdf.numPages > maxPages ? 'page-limit' : 'manual-required', kind, emptyExtraction(kind), file.name, {
        method: 'ocr', reason: assessment.reason, pageCount: pdf.numPages,
      });
    } catch (error) {
      if (options.signal && options.signal.aborted) return result('cancelled', kind, emptyExtraction(kind), file.name, { reason: 'cancelled' });
      const status = classifyPdfError(error);
      return result(status, kind, emptyExtraction(kind), file.name, { reason: status });
    } finally {
      if (pdf && typeof pdf.destroy === 'function') await pdf.destroy().catch(() => {});
      else if (pdf && pdf.loadingTask && typeof pdf.loadingTask.destroy === 'function') await pdf.loadingTask.destroy().catch(() => {});
    }
  }

  async function extractLegacy(bytes, file, kind) {
    const text = pdfLiteralText(bytes);
    if (text.length < 20) return result('no-useful-text', kind, emptyExtraction(kind), file.name, { method: 'pdf-text', reason: 'too-little-text' });
    if (looksLikeWrongDocument(text, kind)) return result('wrong-document', kind, emptyExtraction(kind), file.name, { method: 'pdf-text', reason: 'document-signals-mismatch' });
    if (kind === SOURCES.PENSION_REPORT) {
      const fields = parsePensionReport(text, file.name);
      return result(identifiedCount(fields) ? 'partial' : 'manual-required', kind, fields, file.name, { method: 'pdf-text', reason: 'legacy-text-layer' });
    }
    const parsed = parsePayslipInput(text, 'pdf-text', file.name);
    const fields = parsed ? parsed.fields : emptyExtraction(kind);
    return result(identifiedCount(fields) ? 'partial' : 'manual-required', kind, fields, file.name, {
      method: 'pdf-text', reason: 'legacy-text-layer', diagnostics: parsed ? parsed.diagnostics : [],
    });
  }

  async function extract(file, kind, options = {}) {
    if (!(file instanceof File)) throw new TypeError('A browser File is required.');
    if (![SOURCES.PAYSLIP, SOURCES.PENSION_REPORT].includes(kind)) throw new TypeError('Unknown document kind.');
    const type = String(file.type || '').toLowerCase();
    const pdfByName = /\.pdf$/i.test(String(file.name || ''));
    const isPdf = type === 'application/pdf' || (!type && pdfByName);
    const reportImage = kind === SOURCES.PENSION_REPORT && ['image/jpeg', 'image/png'].includes(type);
    if (!isPdf && !reportImage) return result('unsupported-type', kind, emptyExtraction(kind), file.name);
    if (Number(file.size) > MAX_FILE_BYTES) return result('file-too-large', kind, emptyExtraction(kind), file.name);
    if (!isPdf || typeof file.arrayBuffer !== 'function') return result('manual-required', kind, emptyExtraction(kind), file.name);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const header = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 8192)));
      if (!header.includes('%PDF')) return result('corrupted-pdf', kind, emptyExtraction(kind), file.name);
      if (/\/Encrypt\b/.test(header)) return result('password-protected', kind, emptyExtraction(kind), file.name);
      if (root.PensionLocalDocuments && typeof document !== 'undefined') {
        return extractWithBrowserPipeline(bytes, file, kind, options);
      }
      return extractLegacy(bytes, file, kind);
    } catch (error) {
      if (options.signal && options.signal.aborted) return result('cancelled', kind, emptyExtraction(kind), file.name, { reason: 'cancelled' });
      const status = classifyPdfError(error);
      return result(status, kind, emptyExtraction(kind), file.name, { reason: status });
    }
  }

  root.PensionDocuments = Object.freeze({
    MAX_FILE_BYTES,
    MAX_PDF_PAGES,
    MAX_PAYSLIP_PROCESSING_PAGES,
    SOURCES,
    PAYSLIP_FIELDS,
    PENSION_REPORT_FIELDS,
    field,
    emptyExtraction,
    extract,
    _test: Object.freeze({ pdfLiteralText, parsePensionReport, looksLikeWrongDocument, classifyPdfError }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
