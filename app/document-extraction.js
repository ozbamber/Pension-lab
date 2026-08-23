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

  function approximatelyEqual(left, right, absolute = 3, relative = 0.012) {
    if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(right))) return left == null && right == null;
    return Math.abs(Number(left) - Number(right)) <= Math.max(absolute, Math.abs(Number(right)) * relative);
  }

  function pensionHistoryRelationship(left, right) {
    const leftMonths = left?.pensionReportState?.normalizedContributionMonths || [];
    const rightMonths = right?.pensionReportState?.normalizedContributionMonths || [];
    if (!leftMonths.length || !rightMonths.length) return 'not-available';
    const matching = (subset, superset) => subset.every((month) => {
      const other = superset.find((candidate) => candidate.salaryMonth === month.salaryMonth);
      return other && ['reportedSalary', 'employeeContribution', 'employerContribution', 'severanceContribution', 'totalContribution']
        .every((name) => approximatelyEqual(month[name], other[name], 2, 0.006));
    });
    if (leftMonths.length === rightMonths.length && matching(leftMonths, rightMonths)) return 'exact';
    if (leftMonths.length < rightMonths.length && matching(leftMonths, rightMonths)) return 'left-subset';
    if (rightMonths.length < leftMonths.length && matching(rightMonths, leftMonths)) return 'right-subset';
    return 'conflict';
  }

  function pensionParseScore(parsed) {
    const state = parsed?.pensionReportState || {};
    const reliableMonths = Number(state.derived?.monthsUsed) || 0;
    const reliableRows = (state.contributionHistory || []).filter((row) => row.reliable).length;
    const criticalFields = ['currentBalance', 'depositManagementFeeRate', 'balanceManagementFeeRate']
      .filter((name) => parsed?.fields?.[name]?.value != null).length;
    return reliableMonths * 8 + reliableRows * 2 + criticalFields * 7 +
      (state.confidence?.tableHeaderConfidence === 'HIGH' ? 6 : 0) +
      (state.confidence?.arithmeticConfidence === 'HIGH' ? 5 : 0) +
      (state.decision?.automaticAccepted ? 20 : 0) - (state.review?.issues?.length || 0) * 2;
  }

  function contributionRowsAgree(left, right) {
    return ['reportedSalary', 'employeeContribution', 'employerContribution', 'severanceContribution', 'totalContribution']
      .every((name) => approximatelyEqual(left?.[name], right?.[name], 2, 0.006));
  }

  function medianValue(values) {
    const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!ordered.length) return null;
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function contributionReferenceRates(candidates) {
    return Object.fromEntries(['employeeContribution', 'employerContribution', 'severanceContribution'].map((name) => {
      const rates = candidates.map((candidate) => {
        const salary = Number(candidate.row.reportedSalary);
        const amount = Number(candidate.row[name]);
        return salary > 0 && amount >= 0 ? amount / salary : null;
      }).filter((rate) => Number.isFinite(rate) && rate >= 0.01 && rate <= 0.2);
      return [name, medianValue(rates)];
    }));
  }

  function contributionCandidateQuality(candidate, referenceRates) {
    const salary = Number(candidate.row.reportedSalary);
    let penalty = salary > 0 && salary <= 100000 ? 0 : 4;
    for (const name of ['employeeContribution', 'employerContribution', 'severanceContribution']) {
      const reference = referenceRates[name];
      const amount = Number(candidate.row[name]);
      if (!(reference > 0) || !(salary > 0) || !Number.isFinite(amount)) { penalty += 1; continue; }
      penalty += Math.abs(amount / salary - reference) / reference;
    }
    penalty += (1 - Number(candidate.row.confidence || 0.5)) * 0.08;
    return penalty;
  }

  function mergePensionContributionRows(passes) {
    const byMonth = new Map();
    for (const pass of passes) {
      for (const row of pass.parsed?.pensionReportState?.contributionHistory || []) {
        if (!row?.salaryMonth) continue;
        if (!byMonth.has(row.salaryMonth)) byMonth.set(row.salaryMonth, []);
        byMonth.get(row.salaryMonth).push({ row, pass: pass.name });
      }
    }
    const rows = [];
    const conflicts = [];
    const allCandidates = [...byMonth.values()].flat().filter((candidate) => candidate.row.reliable);
    const referenceRates = contributionReferenceRates(allCandidates);
    for (const [salaryMonth, candidates] of byMonth) {
      const reliable = candidates.filter((candidate) => candidate.row.reliable);
      const pool = reliable.length ? reliable : candidates;
      pool.forEach((candidate) => { candidate.quality = contributionCandidateQuality(candidate, referenceRates); });
      pool.sort((left, right) => left.quality - right.quality || Number(right.row.confidence || 0) - Number(left.row.confidence || 0));
      const selected = pool[0];
      if (reliable.some((candidate) => candidate.quality - selected.quality <= 0.08 && !contributionRowsAgree(selected.row, candidate.row))) {
        conflicts.push({ salaryMonth, passes: [...new Set(reliable.map((candidate) => candidate.pass))] });
      }
      rows.push({ ...selected.row, evidence: { ...(selected.row.evidence || {}), ocrPass: selected.pass } });
    }
    rows.sort((left, right) => Number(left.chronologyKey || 0) - Number(right.chronologyKey || 0));
    return { rows, conflicts };
  }

  function repairMergedContributionRows(merged, passes) {
    const reliableReferences = merged.rows.filter((row) => row.reliable && row.reportedSalary > 0);
    if (!reliableReferences.length) return merged;
    const rateReferences = Object.fromEntries(['employeeContribution', 'employerContribution', 'severanceContribution'].map((name) => [name,
      medianValue(reliableReferences.map((row) => Number(row[name]) / Number(row.reportedSalary)).filter((rate) => Number.isFinite(rate) && rate >= 0.01 && rate <= 0.2)),
    ]));
    const candidatesByMonth = new Map();
    for (const pass of passes) {
      for (const row of pass.parsed?.pensionReportState?.contributionHistory || []) {
        if (!row?.salaryMonth) continue;
        if (!candidatesByMonth.has(row.salaryMonth)) candidatesByMonth.set(row.salaryMonth, []);
        candidatesByMonth.get(row.salaryMonth).push({ row, pass: pass.name });
      }
    }
    merged.rows = merged.rows.map((row) => {
      if (row.reliable) return row;
      const candidates = candidatesByMonth.get(row.salaryMonth) || [];
      const peerRepairs = [];
      for (const candidate of candidates) {
        if (!(candidate.row.reportedSalary > 0)) continue;
        for (const reference of reliableReferences) {
          if (!approximatelyEqual(candidate.row.reportedSalary, reference.reportedSalary, 2, 0.005)) continue;
          const matchingComponents = ['employeeContribution', 'employerContribution', 'severanceContribution']
            .filter((name) => approximatelyEqual(candidate.row[name], reference[name], 2, 0.006)).length;
          if (matchingComponents >= 2) peerRepairs.push({ candidate, reference, matchingComponents });
        }
      }
      peerRepairs.sort((left, right) => right.matchingComponents - left.matchingComponents || Number(right.candidate.row.confidence || 0) - Number(left.candidate.row.confidence || 0));
      if (peerRepairs.length) {
        const repair = peerRepairs[0];
        return {
          ...repair.candidate.row,
          reportedSalary: repair.reference.reportedSalary,
          employeeContribution: repair.reference.employeeContribution,
          employerContribution: repair.reference.employerContribution,
          severanceContribution: repair.reference.severanceContribution,
          totalContribution: repair.reference.totalContribution,
          totalSource: 'document-pattern',
          reliable: true,
          requiresReview: false,
          issues: ['DOCUMENT_PATTERN_RECONCILED'],
          evidence: { ...(repair.candidate.row.evidence || {}), ocrPass: repair.candidate.pass, peerSalaryMonth: repair.reference.salaryMonth },
        };
      }
      const arithmeticRepairs = candidates.map((candidate) => {
        const salary = Number(candidate.row.reportedSalary);
        const components = ['employeeContribution', 'employerContribution', 'severanceContribution'].map((name) => Number(candidate.row[name]));
        if (!(salary > 0) || components.some((value) => !Number.isFinite(value) || value < 0)) return null;
        const rateDeviation = ['employeeContribution', 'employerContribution', 'severanceContribution'].reduce((sum, name) => {
          const reference = rateReferences[name];
          const rate = Number(candidate.row[name]) / salary;
          return sum + (!(reference > 0) ? 1 : Math.abs(rate - reference) / reference);
        }, 0);
        const total = components.reduce((sum, value) => sum + value, 0);
        if (rateDeviation > 0.18 || total >= salary * 0.65) return null;
        return { candidate, total, rateDeviation };
      }).filter(Boolean).sort((left, right) => left.rateDeviation - right.rateDeviation);
      if (!arithmeticRepairs.length) return row;
      const repair = arithmeticRepairs[0];
      return {
        ...repair.candidate.row,
        totalContribution: repair.total,
        totalSource: 'components-document-pattern',
        reliable: true,
        requiresReview: false,
        issues: ['OCR_TOTAL_RECONCILED_FROM_COMPONENTS'],
        confidence: Math.min(0.9, Number(repair.candidate.row.confidence || 0.8)),
        confidenceBand: 'MEDIUM',
        evidence: { ...(repair.candidate.row.evidence || {}), ocrPass: repair.candidate.pass, documentRateReconciliation: true },
      };
    });
    return merged;
  }

  function applyMergedContributionRows(parsed, merged) {
    const state = parsed?.pensionReportState;
    if (!state || !merged.rows.length) return;
    const reliableRows = merged.rows.filter((row) => row.reliable);
    reliableRows.forEach((row) => { row.normalizationStatus = 'used'; });
    const normalized = reliableRows.map((row) => ({
      salaryMonth: row.salaryMonth,
      chronologyKey: row.chronologyKey,
      employerNames: row.employerName ? [row.employerName] : [],
      reportedSalary: row.reportedSalary,
      employeeContribution: row.employeeContribution,
      employerContribution: row.employerContribution,
      severanceContribution: row.severanceContribution,
      totalContribution: row.totalContribution,
      confidence: row.confidence,
      sourceRows: [row.evidence?.rowId].filter(Boolean),
      sourcePages: [row.sourcePage].filter(Number.isFinite),
      status: 'reliable',
    }));
    const mean = (name) => normalized.length ? normalized.reduce((sum, row) => sum + Number(row[name] || 0), 0) / normalized.length : null;
    const meanRate = (name) => {
      const rates = normalized.filter((row) => row.reportedSalary > 0 && row[name] != null).map((row) => row[name] / row.reportedSalary);
      return rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null;
    };
    state.contributionHistory = merged.rows;
    state.normalizedContributionMonths = normalized;
    state.derived = {
      monthsUsed: normalized.length,
      baselineMonthlyContribution: mean('totalContribution'),
      averageReportedPensionSalary: mean('reportedSalary'),
      employeeContributionRate: meanRate('employeeContribution'),
      employerContributionRate: meanRate('employerContribution'),
      severanceRate: meanRate('severanceContribution'),
    };
    parsed.contributionHistory = merged.rows;
    parsed.normalizedContributionMonths = normalized;
    state.extraction.counts.monthsDetected = merged.rows.length;
    state.extraction.counts.monthsAccepted = normalized.length;
    state.extraction.counts.monthsExcluded = merged.rows.length - normalized.length;
    state.confidence.arithmeticConfidence = normalized.length && reliableRows.length === merged.rows.length ? 'HIGH' : 'LOW';
    state.confidence.baselineConfidence = normalized.length && reliableRows.length === merged.rows.length ? 'HIGH' : 'LOW';
    const latest = normalized[normalized.length - 1];
    if (latest) {
      const confidence = Math.min(0.96, Number(latest.confidence || 0.88));
      const evidence = { aliasId: 'contribution-table-multipass', salaryMonth: latest.salaryMonth, method: 'ocr', confidenceBand: confidence >= 0.94 ? 'HIGH' : 'MEDIUM' };
      const setField = (name, value, unit, origin = 'direct') => {
        if (value == null) return;
        parsed.fields[name] = { value, unit, origin, confidence, confidenceBand: evidence.confidenceBand, requiresConfirmation: evidence.confidenceBand !== 'HIGH', sourceDate: latest.salaryMonth, evidence };
      };
      setField('latestReportedPensionableSalary', latest.reportedSalary, 'ILS');
      setField('latestEmployeeContributionAmount', latest.employeeContribution, 'ILS');
      setField('latestEmployerContributionAmount', latest.employerContribution, 'ILS');
      setField('latestSeveranceContributionAmount', latest.severanceContribution, 'ILS');
      if (latest.reportedSalary > 0) {
        setField('latestEmployeeContributionRate', latest.employeeContribution / latest.reportedSalary, 'ratio', 'derived');
        setField('latestEmployerContributionRate', latest.employerContribution / latest.reportedSalary, 'ratio', 'derived');
        setField('latestSeveranceRate', latest.severanceContribution / latest.reportedSalary, 'ratio', 'derived');
      }
    }
  }

  function ocrPassDiagnostics(input) {
    const text = String(input?.text || '');
    return {
      characters: text.length,
      lines: text.split(/\r?\n/).filter((line) => line.trim()).length,
      monthAnchors: (text.match(/(?:0?[1-9]|1[0-2])[/.-]20\d{2}/g) || []).length,
      yearAnchors: (text.match(/20\d{2}/g) || []).length,
      compactMonthAnchors: (text.replace(/(?<=\d)\s+(?=\d)/g, '').match(/(?:0[1-9]|1[0-2])(?:[/.-])?20\d{2}/g) || []).length,
      numericFragments: (text.match(/[\dOoIl|]+(?:[.,][\dOoIl|]+)*/g) || []).length,
    };
  }

  function linearizedOcrInput(input) {
    const confidences = (input?.pages || []).map((page) => Number(page.confidence)).filter(Number.isFinite);
    return {
      pages: [],
      text: String(input?.text || ''),
      confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0.72,
    };
  }

  function pensionTableNeedsSecondSource(parsed) {
    const state = parsed?.pensionReportState;
    const tableQualityHigh = state?.confidence?.tableHeaderConfidence === 'HIGH' && state?.confidence?.arithmeticConfidence === 'HIGH' &&
      state?.confidence?.baselineConfidence === 'HIGH' && state?.derived?.monthsUsed > 0 && state?.extraction?.tableTotalReconciliation?.pass !== false;
    return !tableQualityHigh || state?.extraction?.crossPathAgreement === false;
  }

  function resolvePensionOcrPasses(passes) {
    const available = passes.filter((pass) => pass?.parsed);
    if (!available.length) return null;
    available.forEach((pass) => { pass.score = pensionParseScore(pass.parsed); });
    available.sort((left, right) => right.score - left.score);
    const selected = available[0];
    const conflicts = [];
    const agreements = [];
    const mergedRows = repairMergedContributionRows(mergePensionContributionRows(available), available);
    applyMergedContributionRows(selected.parsed, mergedRows);
    if (mergedRows.conflicts.length) conflicts.push({ pass: 'row-consensus', fields: [], contributionHistory: 'conflict', months: mergedRows.conflicts });
    const passSource = (name) => name.replace(/-linear$/, '');
    for (const name of ['currentBalance', 'depositManagementFeeRate', 'balanceManagementFeeRate']) {
      const allCandidates = available.filter((pass) => pass.parsed.fields?.[name]?.value != null);
      const highCandidates = allCandidates.filter((pass) => Number(pass.parsed.fields[name].confidence || 0) >= 0.94);
      const candidates = highCandidates.length ? highCandidates : allCandidates;
      if (!candidates.length) continue;
      const clusters = [];
      for (const candidate of candidates) {
        const value = candidate.parsed.fields[name].value;
        let cluster = clusters.find((item) => approximatelyEqual(item.value, value, name === 'currentBalance' ? 3 : 0.00005, 0.006));
        if (!cluster) { cluster = { value, candidates: [], sources: new Set() }; clusters.push(cluster); }
        cluster.candidates.push(candidate);
        cluster.sources.add(passSource(candidate.name));
      }
      clusters.sort((left, right) => right.sources.size - left.sources.size || right.candidates.length - left.candidates.length);
      if (clusters[1] && clusters[1].sources.size >= clusters[0].sources.size) {
        conflicts.push({ pass: 'field-consensus', fields: [name], contributionHistory: 'not-available' });
        continue;
      }
      selected.parsed.fields[name] = clusters[0].candidates.sort((left, right) =>
        Number(right.parsed.fields[name].confidence || 0) - Number(left.parsed.fields[name].confidence || 0))[0].parsed.fields[name];
    }
    for (const name of ['pensionProvider', 'reportDate', 'balanceDate']) {
      const candidates = available.filter((pass) => pass.parsed.fields?.[name]?.value != null)
        .sort((left, right) => Number(right.parsed.fields[name].confidence || 0) - Number(left.parsed.fields[name].confidence || 0));
      if (candidates.length && selected.parsed.fields?.[name]?.value == null) selected.parsed.fields[name] = candidates[0].parsed.fields[name];
    }
    const selectedState = selected.parsed.pensionReportState;
    if (selectedState) {
      selectedState.currentBalance = selected.parsed.fields?.currentBalance?.value ?? null;
      selectedState.fees.depositRate = selected.parsed.fields?.depositManagementFeeRate?.value ?? null;
      selectedState.fees.balanceRate = selected.parsed.fields?.balanceManagementFeeRate?.value ?? null;
      selectedState.provider = selected.parsed.fields?.pensionProvider?.value ?? null;
      selectedState.report.reportDate = selected.parsed.fields?.reportDate?.value ?? selectedState.report.reportDate;
      selectedState.report.period = selected.parsed.fields?.balanceDate?.value ?? selectedState.report.period;
    }
    for (const candidate of available.slice(1)) {
      const history = pensionHistoryRelationship(selected.parsed, candidate.parsed);
      if (['exact', 'left-subset', 'right-subset'].includes(history)) agreements.push({ pass: candidate.name, contributionHistory: history });
    }
    const state = selected.parsed.pensionReportState;
    if (state) {
      state.extraction.multiPass = {
        selected: selected.name,
        passes: available.map((pass) => ({
          name: pass.name,
          score: pass.score,
          reliableMonths: pass.parsed.pensionReportState?.derived?.monthsUsed || 0,
          diagnostics: pass.diagnostics || null,
        })),
        agreements,
        conflicts,
      };
      state.confidence.ocrMultiPassAgreementConfidence = conflicts.length ? 'LOW' : agreements.length ? 'HIGH' : 'NOT_AVAILABLE';
      if (conflicts.length) {
        state.confidence.overall = 'LOW';
        state.decision.confidenceBand = 'LOW';
        state.decision.automaticAccepted = false;
        state.decision.requiresReview = true;
        state.decision.reasons = [...new Set([...(state.decision.reasons || []), 'OCR_PASS_CONFLICT'])];
        state.review.requiresReview = true;
        state.review.issues = [...(state.review.issues || []), { code: 'OCR_PASS_CONFLICT', conflicts }];
      }
      const bandRank = { NOT_AVAILABLE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, NOT_APPLICABLE: 3 };
      const strongestBand = (name, fallback = 'LOW') => available.map((pass) => pass.parsed.pensionReportState?.confidence?.[name])
        .filter(Boolean).sort((left, right) => (bandRank[right] || 0) - (bandRank[left] || 0))[0] || fallback;
      const bestTablePass = available.slice().sort((left, right) =>
        (right.parsed.pensionReportState?.extraction?.tables?.length || 0) - (left.parsed.pensionReportState?.extraction?.tables?.length || 0))[0];
      if (!state.extraction.tables?.length && bestTablePass?.parsed.pensionReportState?.extraction?.tables?.length) {
        state.extraction.tables = bestTablePass.parsed.pensionReportState.extraction.tables;
        state.extraction.geometryAvailable = bestTablePass.parsed.pensionReportState.extraction.geometryAvailable;
      }
      state.confidence.tableHeaderConfidence = strongestBand('tableHeaderConfidence');
      state.confidence.columnGeometryConfidence = strongestBand('columnGeometryConfidence');
      state.confidence.rowGeometryConfidence = strongestBand('rowGeometryConfidence');
      state.confidence.crossMonthConsistencyConfidence = strongestBand('crossMonthConsistencyConfidence');
      state.confidence.currentBalanceConfidence = selected.parsed.fields?.currentBalance?.confidenceBand || 'LOW';
      state.confidence.depositFeeConfidence = selected.parsed.fields?.depositManagementFeeRate?.confidenceBand || 'LOW';
      state.confidence.balanceFeeConfidence = selected.parsed.fields?.balanceManagementFeeRate?.confidenceBand || 'LOW';
      if (!conflicts.length && agreements.length) state.confidence.ocrConfidence = 'HIGH';
      if (state.confidence.tableHeaderConfidence === 'MEDIUM' && state.confidence.columnGeometryConfidence === 'HIGH' &&
        state.confidence.arithmeticConfidence === 'HIGH' && state.confidence.crossMonthConsistencyConfidence === 'HIGH' &&
        state.derived?.monthsUsed >= 3 && agreements.length >= 2 && !conflicts.length) {
        state.confidence.tableHeaderConfidence = 'HIGH';
        state.extraction.multiPass.headerPromotion = {
          from: 'MEDIUM', to: 'HIGH', basis: ['column-geometry', 'row-arithmetic', 'cross-month-consistency', 'multi-pass-agreement'],
        };
      }
      const reasons = [];
      if (state.currentBalance == null) reasons.push('MISSING_CURRENT_BALANCE');
      if (state.fees.depositRate == null) reasons.push('MISSING_DEPOSIT_FEE');
      if (state.fees.balanceRate == null) reasons.push('MISSING_BALANCE_FEE');
      if (!state.derived?.monthsUsed) reasons.push('MISSING_RELIABLE_CONTRIBUTION_MONTH');
      if (!state.extraction.tables?.length) reasons.push('CONTRIBUTION_TABLE_NOT_FOUND');
      else if (state.confidence.tableHeaderConfidence !== 'HIGH') reasons.push('CONTRIBUTION_HEADER_NOT_RECONSTRUCTED');
      if (state.confidence.arithmeticConfidence !== 'HIGH') reasons.push('CONTRIBUTION_ARITHMETIC_NOT_HIGH');
      if (conflicts.length) reasons.push('OCR_PASS_CONFLICT');
      const requiredHigh = [
        state.confidence.currentBalanceConfidence,
        state.confidence.depositFeeConfidence,
        state.confidence.balanceFeeConfidence,
        state.confidence.tableHeaderConfidence,
        state.confidence.arithmeticConfidence,
        state.confidence.baselineConfidence,
        state.confidence.ocrConfidence,
      ].every((band) => band === 'HIGH');
      const automaticAccepted = requiredHigh && reasons.length === 0;
      state.confidence.overall = automaticAccepted ? 'HIGH' : conflicts.length ? 'LOW' : 'MEDIUM';
      state.decision = { confidenceBand: state.confidence.overall, automaticAccepted, requiresReview: !automaticAccepted, reasons };
      state.review = { requiresReview: !automaticAccepted, issues: reasons.map((code) => ({ code })) };
    }
    return selected.parsed;
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
      normalizedContributionMonths: metadata.normalizedContributionMonths || [],
      pensionReportState: metadata.pensionReportState || null,
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
    let nativePensionParsed = null;
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
        const parsed = assessment.useful && root.PensionReportParser ? root.PensionReportParser.parsePensionReport(nativeResult, { method: 'pdf-text' }) : null;
        nativePensionParsed = parsed;
        const fields = parsed ? wrapPensionReportFields(parsed, file.name) : (assessment.useful ? parsePensionReport(nativeResult.text, file.name) : emptyExtraction(kind));
        if (identifiedCount(fields)) {
          const tableNeedsSecondSource = pensionTableNeedsSecondSource(parsed);
          if (!tableNeedsSecondSource) {
            return result('partial', kind, fields, file.name, {
              method: 'pdf-text', reason: assessment.reason, pageCount: pdf.numPages,
              contributionHistory: parsed?.contributionHistory || [],
              normalizedContributionMonths: parsed?.normalizedContributionMonths || [],
              pensionReportState: parsed?.pensionReportState || null,
              classification: parsed?.classification || null,
            });
          }
        }
      }

      if (kind === SOURCES.PAYSLIP) {
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
      const enhancedOcrPages = [];
      const sparseOcrPages = [];
      const tableOcrPages = [];
      const numericTableOcrPages = [];
      const tableRowTexts = [];
      const tableRowConfidences = [];
      try {
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          L.throwIfAborted(options.signal);
          if (typeof options.onProgress === 'function') options.onProgress({ phase: 'rendering', pageNumber, pageCount: maxPages });
          const canvas = await L.renderPage(pdf, pageNumber, { signal: options.signal });
          const coarseDimensions = { width: canvas.width, height: canvas.height };
          let coarsePageResult = null;
          try {
            coarsePageResult = await ocr.recognize(canvas, pageNumber, { psm: 3, dpi: 300 });
            ocrPages.push(coarsePageResult);
          } finally {
            L.releaseCanvas(canvas);
          }
          if (kind === SOURCES.PENSION_REPORT) {
            const highResolution = await L.renderPage(pdf, pageNumber, { signal: options.signal, scale: 3.2, maxScale: 3.4, maxDimension: 4200 });
            const enhanced = L.prepareOcrCanvas(highResolution, { grayscale: true, contrast: 1.35 });
            try {
              enhancedOcrPages.push(await ocr.recognize(enhanced, pageNumber, { psm: 6, dpi: 300 }));
              sparseOcrPages.push(await ocr.recognize(enhanced, pageNumber, { psm: 11, dpi: 300 }));
              const numericRegion = L.detectNumericTableRegion(coarsePageResult, coarseDimensions.width, coarseDimensions.height);
              const scaledNumericRegion = numericRegion ? {
                x: numericRegion.x * highResolution.width / coarseDimensions.width,
                y: numericRegion.y * highResolution.height / coarseDimensions.height,
                width: numericRegion.width * highResolution.width / coarseDimensions.width,
                height: numericRegion.height * highResolution.height / coarseDimensions.height,
                rowBands: (numericRegion.rowBands || []).map((band) => ({
                  x: band.x * highResolution.width / coarseDimensions.width,
                  y: band.y * highResolution.height / coarseDimensions.height,
                  width: band.width * highResolution.width / coarseDimensions.width,
                  height: band.height * highResolution.height / coarseDimensions.height,
                })),
                evidence: numericRegion.evidence,
              } : null;
              const gridRegion = L.detectTableRegion(highResolution);
              const tableRegion = scaledNumericRegion || gridRegion;
              const tableCrop = L.cropCanvas(highResolution, tableRegion, { padding: 12, scale: 1.45 });
              const tableCanvas = tableCrop ? L.prepareOcrCanvas(tableCrop, { grayscale: true, contrast: 1.18 }) : null;
              if (tableCanvas) {
                try {
                  tableOcrPages.push(await ocr.recognize(tableCanvas, pageNumber, { psm: 6, dpi: 300 }));
                  numericTableOcrPages.push(await ocr.recognize(tableCanvas, pageNumber, {
                    psm: 6, dpi: 300, whitelist: '0123456789.,/%-−₪',
                  }));
                } finally {
                  L.releaseCanvas(tableCanvas);
                  L.releaseCanvas(tableCrop);
                }
              }
              for (const rowBand of (tableRegion?.rowBands || []).slice(0, 12)) {
                const rowCrop = L.cropCanvas(highResolution, rowBand, { padding: 2, scale: 2.1 });
                if (!rowCrop) continue;
                const rowCanvas = L.prepareOcrCanvas(rowCrop, { grayscale: true, contrast: 1.12 });
                try {
                  const rowResult = await ocr.recognize(rowCanvas, pageNumber, {
                    psm: 7, dpi: 300, whitelist: '0123456789.,/%-−₪ ',
                  });
                  if (String(rowResult.text || '').trim()) {
                    tableRowTexts.push(String(rowResult.text).trim());
                    if (Number.isFinite(Number(rowResult.confidence))) tableRowConfidences.push(Number(rowResult.confidence));
                  }
                } finally {
                  L.releaseCanvas(rowCanvas);
                  L.releaseCanvas(rowCrop);
                }
              }
            } finally {
              L.releaseCanvas(enhanced);
              L.releaseCanvas(highResolution);
            }
          }
          const current = { pages: ocrPages, text: ocrPages.map((page) => page.text).join('\n') };
          const parsed = kind === SOURCES.PAYSLIP ? parsePayslipInput(current, 'ocr', file.name) : null;
          if (kind === SOURCES.PAYSLIP && parsed && parsed.hasCriticalFields) {
            return result('partial', kind, parsed.fields, file.name, {
              method: 'ocr', reason: assessment.reason, diagnostics: parsed.diagnostics, pageCount: pdf.numPages,
            });
          }
        }
      } finally {
        await ocr.terminate();
      }
      if (kind === SOURCES.PENSION_REPORT && root.PensionReportParser) {
        const ocrInput = { pages: ocrPages, text: ocrPages.map((page) => page.text).join('\n') };
        const enhancedInput = { pages: enhancedOcrPages, text: enhancedOcrPages.map((page) => page.text).join('\n') };
        const sparseInput = { pages: sparseOcrPages, text: sparseOcrPages.map((page) => page.text).join('\n') };
        const tableInput = { pages: tableOcrPages, text: tableOcrPages.map((page) => page.text).join('\n') };
        const numericTableInput = { pages: numericTableOcrPages, text: numericTableOcrPages.map((page) => page.text).join('\n') };
        const tableRowsInput = {
          pages: [],
          text: tableRowTexts.join('\n'),
          confidence: tableRowConfidences.length ? tableRowConfidences.reduce((sum, value) => sum + value, 0) / tableRowConfidences.length : 0.72,
        };
        const enhancedLinearInput = linearizedOcrInput(enhancedInput);
        const sparseLinearInput = linearizedOcrInput(sparseInput);
        const parsed = resolvePensionOcrPasses([
          ...(nativePensionParsed ? [{ name: 'native-pdf', parsed: nativePensionParsed, diagnostics: { tableQualityFallback: true } }] : []),
          { name: 'whole-page-default', parsed: root.PensionReportParser.parsePensionReport(ocrInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(ocrInput) },
          { name: 'whole-page-enhanced', parsed: root.PensionReportParser.parsePensionReport(enhancedInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(enhancedInput) },
          { name: 'whole-page-sparse', parsed: root.PensionReportParser.parsePensionReport(sparseInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(sparseInput) },
          { name: 'whole-page-enhanced-linear', parsed: root.PensionReportParser.parsePensionReport(enhancedLinearInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(enhancedLinearInput) },
          { name: 'whole-page-sparse-linear', parsed: root.PensionReportParser.parsePensionReport(sparseLinearInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(sparseLinearInput) },
          ...(tableOcrPages.length ? [{ name: 'targeted-table', parsed: root.PensionReportParser.parsePensionReport(tableInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(tableInput) }] : []),
          ...(numericTableOcrPages.length ? [{ name: 'targeted-table-numeric', parsed: root.PensionReportParser.parsePensionReport(numericTableInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(numericTableInput) }] : []),
          ...(tableRowTexts.length ? [{ name: 'targeted-table-rows', parsed: root.PensionReportParser.parsePensionReport(tableRowsInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(tableRowsInput) }] : []),
        ]);
        const fields = wrapPensionReportFields(parsed, file.name);
        if (identifiedCount(fields)) {
          return result('partial', kind, fields, file.name, {
            method: nativePensionParsed ? 'hybrid' : 'ocr', reason: assessment.reason, pageCount: pdf.numPages,
            contributionHistory: parsed.contributionHistory || [],
            normalizedContributionMonths: parsed.normalizedContributionMonths || [],
            pensionReportState: parsed.pensionReportState || null,
            classification: parsed.classification || null,
          });
        }
        return result(pdf.numPages > maxPages ? 'page-limit' : 'manual-required', kind, fields, file.name, {
          method: 'ocr', reason: assessment.reason, pageCount: pdf.numPages,
          contributionHistory: parsed.contributionHistory || [],
          normalizedContributionMonths: parsed.normalizedContributionMonths || [],
          pensionReportState: parsed.pensionReportState || null,
          classification: parsed.classification || null,
        });
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
      const parsed = root.PensionReportParser ? root.PensionReportParser.parsePensionReport(text, { method: 'pdf-text' }) : null;
      const fields = parsed ? wrapPensionReportFields(parsed, file.name) : parsePensionReport(text, file.name);
      return result(identifiedCount(fields) ? 'partial' : 'manual-required', kind, fields, file.name, {
        method: 'pdf-text', reason: 'legacy-text-layer',
        contributionHistory: parsed?.contributionHistory || [],
        normalizedContributionMonths: parsed?.normalizedContributionMonths || [],
        pensionReportState: parsed?.pensionReportState || null,
        classification: parsed?.classification || null,
      });
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
    _test: Object.freeze({ pdfLiteralText, parsePensionReport, looksLikeWrongDocument, classifyPdfError, pensionTableNeedsSecondSource }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
