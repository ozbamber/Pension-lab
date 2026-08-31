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

  function normalizedRowIdentity(value) {
    if (root.PensionReportParser?.normalizeSearchText) return root.PensionReportParser.normalizeSearchText(value || '');
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function samePhysicalSourceRow(candidate, member) {
    if (candidate.pass === member.pass || candidate.row.salaryMonth !== member.row.salaryMonth) return false;
    const candidatePage = Number(candidate.row.sourcePage || candidate.row.page);
    const memberPage = Number(member.row.sourcePage || member.row.page);
    if (Number.isFinite(candidatePage) && Number.isFinite(memberPage) && candidatePage !== memberPage) return false;
    const candidateEmployer = normalizedRowIdentity(candidate.row.employerName);
    const memberEmployer = normalizedRowIdentity(member.row.employerName);
    if (candidateEmployer && memberEmployer && candidateEmployer !== memberEmployer) return false;
    const candidateDeposit = candidate.row.depositDate || null;
    const memberDeposit = member.row.depositDate || null;
    if (candidateDeposit && memberDeposit && candidateDeposit !== memberDeposit) return false;

    const candidateSource = candidate.row.evidence?.sourceRow || {};
    const memberSource = member.row.evidence?.sourceRow || {};
    const candidateRowId = candidateSource.id || candidate.row.evidence?.rowId || null;
    const memberRowId = memberSource.id || member.row.evidence?.rowId || null;
    const sameRowId = candidateRowId && memberRowId && candidateRowId === memberRowId;
    const candidateY = Number(candidateSource.y);
    const memberY = Number(memberSource.y);
    const sameGeometry = Number.isFinite(candidatePage) && Number.isFinite(memberPage) && candidatePage === memberPage &&
      Number.isFinite(candidateY) && Number.isFinite(memberY) && Math.abs(candidateY - memberY) <= 12;
    const sameNamedDeposit = Boolean(candidateEmployer && memberEmployer && candidateEmployer === memberEmployer &&
      candidateDeposit && memberDeposit && candidateDeposit === memberDeposit);
    return Boolean(sameRowId || sameGeometry || sameNamedDeposit);
  }

  function explicitlyDistinctSourceRows(candidate, member) {
    const candidateEmployer = normalizedRowIdentity(candidate.row.employerName);
    const memberEmployer = normalizedRowIdentity(member.row.employerName);
    if (candidateEmployer && memberEmployer && candidateEmployer !== memberEmployer) return true;
    const candidateDeposit = candidate.row.depositDate || null;
    const memberDeposit = member.row.depositDate || null;
    return Boolean(candidateDeposit && memberDeposit && candidateDeposit !== memberDeposit);
  }

  function deriveObservedComponentTotal(row) {
    if (row.totalContribution != null) return row;
    const componentFields = ['employeeContribution', 'employerContribution', 'severanceContribution'];
    if (componentFields.some((name) => row[name] == null)) return row;
    const components = componentFields.map((name) => Number(row[name]));
    if (components.some((value) => !Number.isFinite(value) || value < 0)) return row;
    const salary = Number(row.reportedSalary);
    const total = components.reduce((sum, value) => sum + value, 0);
    if (!(salary > 0) || total >= salary * 0.65) return row;
    const issues = [...new Set(row.issues || [])];
    const missingTotalIssues = new Set(['INCOMPLETE_CONTRIBUTION_ROW', 'MISSING_TOTAL_CONTRIBUTION']);
    const blockingIssues = issues.filter((issue) => !missingTotalIssues.has(issue));
    const onlyMissingTotalWasBlocking = issues.length > 0 && blockingIssues.length === 0;
    const alreadyReliable = row.reliable === true && row.requiresReview !== true && blockingIssues.length === 0;
    const mayResolveReliability = alreadyReliable || onlyMissingTotalWasBlocking;
    return {
      ...row,
      totalContribution: total,
      totalSource: 'derived-from-observed-components',
      reliable: mayResolveReliability,
      requiresReview: !mayResolveReliability,
      issues: mayResolveReliability ? issues.filter((issue) => !missingTotalIssues.has(issue)) : issues,
    };
  }

  function rowFieldProvenance(row, pass) {
    const sourceRow = row.evidence?.sourceRow || { id: row.evidence?.rowId || null, page: row.sourcePage || row.page || null, y: null };
    return Object.fromEntries(['reportedSalary', 'employeeContribution', 'employerContribution', 'severanceContribution', 'totalContribution'].map((fieldName) => [fieldName, {
      value: row[fieldName] ?? null,
      field: fieldName,
      salaryMonth: row.salaryMonth || null,
      employerName: row.employerName || null,
      depositDate: row.depositDate || null,
      sourcePage: row.sourcePage || row.page || null,
      sourceRow: sourceRow.id || null,
      geometry: Number.isFinite(Number(sourceRow.y)) ? { y: Number(sourceRow.y) } : null,
      extractionPass: pass,
      observedOrDerived: fieldName === 'totalContribution' && row.totalSource === 'derived-from-observed-components' ? 'derived' : 'observed',
    }]));
  }

  function mergePensionContributionRows(passes) {
    const candidates = [];
    for (const pass of passes) {
      for (const row of pass.parsed?.pensionReportState?.contributionHistory || []) {
        if (!row?.salaryMonth) continue;
        candidates.push({ row: deriveObservedComponentTotal(row), pass: pass.name });
      }
    }
    const clusters = [];
    const identityConflicts = [];
    const identityAmbiguousCandidates = new Set();
    for (const candidate of candidates) {
      const compatible = clusters.filter((cluster) => cluster.members.some((member) => samePhysicalSourceRow(candidate, member)));
      if (compatible.length === 1) compatible[0].members.push(candidate);
      else {
        if (compatible.length > 1) identityConflicts.push({ salaryMonth: candidate.row.salaryMonth, pass: candidate.pass, reason: 'AMBIGUOUS_SOURCE_ROW_IDENTITY' });
        if (!compatible.length) {
          const ambiguousPeer = clusters.flatMap((cluster) => cluster.members).find((member) =>
            member.pass !== candidate.pass && member.row.salaryMonth === candidate.row.salaryMonth &&
            !explicitlyDistinctSourceRows(candidate, member) && contributionRowsAgree(candidate.row, member.row));
          if (ambiguousPeer) {
            identityAmbiguousCandidates.add(candidate);
            identityAmbiguousCandidates.add(ambiguousPeer);
            identityConflicts.push({
              salaryMonth: candidate.row.salaryMonth,
              passes: [ambiguousPeer.pass, candidate.pass],
              sourceRows: [
                ambiguousPeer.row.evidence?.sourceRow?.id || ambiguousPeer.row.evidence?.rowId || null,
                candidate.row.evidence?.sourceRow?.id || candidate.row.evidence?.rowId || null,
              ],
              reason: 'AMBIGUOUS_SOURCE_ROW_IDENTITY',
            });
          }
        }
        clusters.push({ members: [candidate] });
      }
    }
    const rows = [];
    const conflicts = [...identityConflicts];
    const allCandidates = candidates.filter((candidate) => candidate.row.reliable);
    const referenceRates = contributionReferenceRates(allCandidates);
    for (const cluster of clusters) {
      const reliable = cluster.members.filter((candidate) => candidate.row.reliable);
      const pool = reliable.length ? reliable : cluster.members;
      pool.forEach((candidate) => { candidate.quality = contributionCandidateQuality(candidate, referenceRates); });
      pool.sort((left, right) => left.quality - right.quality || Number(right.row.confidence || 0) - Number(left.row.confidence || 0));
      const selected = pool[0];
      const contradictory = reliable.filter((candidate) => !contributionRowsAgree(selected.row, candidate.row));
      const identityAmbiguous = cluster.members.some((candidate) => identityAmbiguousCandidates.has(candidate));
      if (contradictory.length) {
        conflicts.push({
          salaryMonth: selected.row.salaryMonth,
          sourcePage: selected.row.sourcePage || selected.row.page || null,
          sourceRow: selected.row.evidence?.sourceRow?.id || selected.row.evidence?.rowId || null,
          passes: [...new Set(reliable.map((candidate) => candidate.pass))],
          reason: 'SAME_SOURCE_ROW_CONFLICT',
        });
      }
      rows.push({
        ...selected.row,
        reliable: contradictory.length || identityAmbiguous ? false : selected.row.reliable,
        requiresReview: contradictory.length || identityAmbiguous ? true : selected.row.requiresReview,
        issues: contradictory.length || identityAmbiguous ? [...new Set([
          ...(selected.row.issues || []),
          ...(contradictory.length ? ['OCR_PASS_ROW_CONFLICT'] : []),
          ...(identityAmbiguous ? ['AMBIGUOUS_SOURCE_ROW_IDENTITY'] : []),
        ])] : selected.row.issues,
        evidence: {
          ...(selected.row.evidence || {}),
          extractionPass: selected.pass,
          fieldProvenance: rowFieldProvenance(selected.row, selected.pass),
          crossPassObservations: cluster.members.map((candidate) => ({
            extractionPass: candidate.pass,
            sourcePage: candidate.row.sourcePage || candidate.row.page || null,
            sourceRow: candidate.row.evidence?.sourceRow?.id || candidate.row.evidence?.rowId || null,
            salaryMonth: candidate.row.salaryMonth,
            employerName: candidate.row.employerName || null,
            depositDate: candidate.row.depositDate || null,
          })),
        },
      });
    }
    rows.sort((left, right) => Number(left.chronologyKey || 0) - Number(right.chronologyKey || 0));
    return { rows, conflicts };
  }

  function applyMergedContributionRows(parsed, merged) {
    const state = parsed?.pensionReportState;
    if (!state || !merged.rows.length) return;
    const baseline = root.PensionReportParser.deriveContributionBaseline(merged.rows);
    const normalized = baseline.normalizedMonths;
    state.contributionHistory = merged.rows;
    state.normalizedContributionMonths = normalized;
    state.derived = baseline.derived;
    parsed.contributionHistory = merged.rows;
    parsed.normalizedContributionMonths = normalized;
    state.extraction.counts.monthsDetected = merged.rows.length;
    state.extraction.counts.monthsAccepted = baseline.derived.monthsUsed;
    state.extraction.counts.monthsExcluded = merged.rows.filter((row) => row.normalizationStatus === 'excluded').length;
    state.extraction.counts.monthsAmbiguous = merged.rows.filter((row) => row.normalizationStatus === 'ambiguous').length;
    const cleanBaseline = baseline.derived.monthsUsed > 0 && baseline.issues.length === 0 && merged.rows.every((row) => row.reliable);
    state.confidence.arithmeticConfidence = cleanBaseline ? 'HIGH' : 'LOW';
    state.confidence.baselineConfidence = cleanBaseline ? 'HIGH' : 'LOW';
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
        if (latest.employeeContribution != null) setField('latestEmployeeContributionRate', latest.employeeContribution / latest.reportedSalary, 'ratio', 'derived');
        if (latest.employerContribution != null) setField('latestEmployerContributionRate', latest.employerContribution / latest.reportedSalary, 'ratio', 'derived');
        if (latest.severanceContribution != null) setField('latestSeveranceRate', latest.severanceContribution / latest.reportedSalary, 'ratio', 'derived');
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

  function attachTargetedRowSources(parsed, sources) {
    const rows = parsed?.pensionReportState?.contributionHistory || [];
    const unused = new Set(sources.map((_, index) => index));
    for (const row of rows) {
      const monthDigits = String(row.salaryMonth || '').replace(/\D/g, '');
      if (!monthDigits) continue;
      const matches = [...unused].filter((index) => String(sources[index].text || '').replace(/\D/g, '').includes(monthDigits));
      if (matches.length !== 1) continue;
      const index = matches[0];
      const source = sources[index];
      unused.delete(index);
      row.sourcePage = source.page;
      row.page = source.page;
      row.evidence = {
        ...(row.evidence || {}),
        rowId: source.id,
        sourcePage: source.page,
        sourceRow: { id: source.id, page: source.page, y: source.y },
        identityBasis: 'targeted-row-crop-source-band',
      };
    }
    return parsed;
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

  function resolveFundRouting(passes) {
    const classified = passes.map((pass) => ({
      pass: pass.name,
      type: pass.parsed?.pensionReportState?.fundType || 'unknown',
      confidenceBand: pass.parsed?.pensionReportState?.confidence?.fundTypeConfidence || 'LOW',
      evidence: pass.parsed?.pensionReportState?.evidence?.fundType?.signalIds || [],
    })).filter((item) => item.confidenceBand === 'HIGH' && item.type !== 'unknown');
    const types = [...new Set(classified.map((item) => item.type))];
    if (types.length > 1) {
      return {
        fundType: 'unknown', supportedForCurrentForecast: false, reason: 'FUND_TYPE_CONFIRMATION_REQUIRED',
        confidenceBand: 'LOW', conflict: true, evidence: classified,
      };
    }
    if (types[0] === 'old_pension') {
      return {
        fundType: 'old_pension', supportedForCurrentForecast: false, reason: 'OLD_PENSION_REQUIRES_RIGHTS_BASED_MODEL',
        confidenceBand: 'HIGH', conflict: false, evidence: classified,
      };
    }
    if (types[0] === 'new_pension') {
      return {
        fundType: 'new_pension', supportedForCurrentForecast: true, reason: 'SUPPORTED_NEW_PENSION',
        confidenceBand: 'HIGH', conflict: false, evidence: classified,
      };
    }
    return {
      fundType: 'unknown', supportedForCurrentForecast: false, reason: 'FUND_TYPE_CONFIRMATION_REQUIRED',
      confidenceBand: 'LOW', conflict: false, evidence: [],
    };
  }

  function resolvePensionOcrPasses(passes) {
    const available = passes.filter((pass) => pass?.parsed);
    if (!available.length) return null;
    available.forEach((pass) => { pass.score = pensionParseScore(pass.parsed); });
    available.sort((left, right) => right.score - left.score);
    const selected = available[0];
    const conflicts = [];
    const agreements = [];
    const mergedRows = mergePensionContributionRows(available);
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
      const routing = resolveFundRouting(available);
      selectedState.fundType = routing.fundType;
      selectedState.supportedForCurrentForecast = routing.supportedForCurrentForecast;
      selectedState.routingReason = routing.reason;
      selectedState.confidence.fundTypeConfidence = routing.confidenceBand;
      selectedState.evidence.fundType = {
        signalIds: [...new Set(routing.evidence.flatMap((item) => item.evidence || []))],
        confidenceBand: routing.confidenceBand,
        extractionPasses: routing.evidence.map((item) => item.pass),
      };
      if (routing.conflict) conflicts.push({ pass: 'fund-type-consensus', fields: ['fundType'], contributionHistory: 'not-available' });
    }
    for (const row of mergedRows.rows) {
      const observations = row.evidence?.crossPassObservations || [];
      const passesForRow = [...new Set(observations.map((observation) => observation.extractionPass))];
      if (passesForRow.length < 2 || (row.issues || []).includes('OCR_PASS_ROW_CONFLICT')) continue;
      agreements.push({
        passes: passesForRow,
        contributionHistory: 'same-source-row',
        salaryMonth: row.salaryMonth,
        sourcePage: row.sourcePage || row.page || null,
        sourceRow: row.evidence?.sourceRow?.id || row.evidence?.rowId || null,
      });
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
      if (state.fundType !== 'new_pension' || state.confidence.fundTypeConfidence !== 'HIGH' || !state.supportedForCurrentForecast) {
        reasons.push(state.fundType === 'old_pension' ? 'OLD_PENSION_REQUIRES_RIGHTS_BASED_MODEL' : 'FUND_TYPE_CONFIRMATION_REQUIRED');
      }
      const requiredHigh = [
        state.confidence.currentBalanceConfidence,
        state.confidence.depositFeeConfidence,
        state.confidence.balanceFeeConfidence,
        state.confidence.tableHeaderConfidence,
        state.confidence.arithmeticConfidence,
        state.confidence.baselineConfidence,
        state.confidence.ocrConfidence,
      ].every((band) => band === 'HIGH');
      if (state.fundType === 'old_pension' && state.confidence.fundTypeConfidence === 'HIGH') {
        state.confidence.overall = 'HIGH';
        state.decision = {
          confidenceBand: 'HIGH', automaticAccepted: false, requiresReview: false,
          reasons: ['OLD_PENSION_REQUIRES_RIGHTS_BASED_MODEL'],
        };
        state.review = { requiresReview: false, issues: [] };
      } else {
        const automaticAccepted = requiredHigh && reasons.length === 0;
        state.confidence.overall = automaticAccepted ? 'HIGH' : conflicts.length ? 'LOW' : 'MEDIUM';
        state.decision = { confidenceBand: state.confidence.overall, automaticAccepted, requiresReview: !automaticAccepted, reasons: [...new Set(reasons)] };
        state.review = { requiresReview: !automaticAccepted, issues: [...new Set(reasons)].map((code) => ({ code })) };
      }
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
      const tableRowSources = [];
      const ocrProgressStart = 0.42;
      const ocrProgressEnd = 0.98;
      const pageProgress = (rangeStart, rangeEnd, pageNumber, fraction = 0) => {
        const pageIndex = Math.max(0, Number(pageNumber) - 1);
        const normalizedFraction = Math.max(0, Math.min(1, Number(fraction) || 0));
        return rangeStart + ((pageIndex + normalizedFraction) / Math.max(1, maxPages)) * (rangeEnd - rangeStart);
      };
      const progressContext = (pageNumber, start, end, stage, stageLabel) => ({
        start: pageProgress(ocrProgressStart, ocrProgressEnd, pageNumber, start),
        end: pageProgress(ocrProgressStart, ocrProgressEnd, pageNumber, end),
        pageCount: maxPages,
        stage,
        stageLabel,
      });
      try {
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          L.throwIfAborted(options.signal);
          if (typeof options.onProgress === 'function') options.onProgress({
            phase: 'rendering', pageNumber, pageCount: maxPages,
            overallProgress: pageProgress(ocrProgressStart, ocrProgressEnd, pageNumber, 0),
          });
          const canvas = await L.renderPage(pdf, pageNumber, { signal: options.signal });
          const coarseDimensions = { width: canvas.width, height: canvas.height };
          let coarsePageResult = null;
          try {
            coarsePageResult = await ocr.recognize(canvas, pageNumber, {
              psm: 3,
              dpi: 300,
              progressContext: progressContext(
                pageNumber, 0.02, kind === SOURCES.PENSION_REPORT ? 0.24 : 0.98, 'coarse', 'סריקה ראשונית',
              ),
            });
            ocrPages.push(coarsePageResult);
          } finally {
            L.releaseCanvas(canvas);
          }
          if (kind === SOURCES.PENSION_REPORT) {
            const highResolution = await L.renderPage(pdf, pageNumber, { signal: options.signal, scale: 3.2, maxScale: 3.4, maxDimension: 4200 });
            const enhanced = L.prepareOcrCanvas(highResolution, { grayscale: true, contrast: 1.35 });
            try {
              enhancedOcrPages.push(await ocr.recognize(enhanced, pageNumber, {
                psm: 6,
                dpi: 300,
                progressContext: progressContext(
                  pageNumber, 0.24, 0.44, 'enhanced', 'קריאה מחודדת',
                ),
              }));
              sparseOcrPages.push(await ocr.recognize(enhanced, pageNumber, {
                psm: 11,
                dpi: 300,
                progressContext: progressContext(
                  pageNumber, 0.44, 0.6, 'sparse', 'איתור טקסט מפוזר',
                ),
              }));
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
                  tableOcrPages.push(await ocr.recognize(tableCanvas, pageNumber, {
                    psm: 6,
                    dpi: 300,
                    progressContext: progressContext(
                      pageNumber, 0.6, 0.72, 'table', 'קריאת טבלת הפקדות',
                    ),
                  }));
                  numericTableOcrPages.push(await ocr.recognize(tableCanvas, pageNumber, {
                    psm: 6,
                    dpi: 300,
                    whitelist: '0123456789.,/%-−₪',
                    progressContext: progressContext(
                      pageNumber, 0.72, 0.84, 'numeric-table', 'אימות מספרים בטבלה',
                    ),
                  }));
                } finally {
                  L.releaseCanvas(tableCanvas);
                  L.releaseCanvas(tableCrop);
                }
              }
              const rowBands = (tableRegion?.rowBands || []).slice(0, 12);
              for (let rowIndex = 0; rowIndex < rowBands.length; rowIndex += 1) {
                const rowBand = rowBands[rowIndex];
                const rowCrop = L.cropCanvas(highResolution, rowBand, { padding: 2, scale: 2.1 });
                if (!rowCrop) continue;
                const rowCanvas = L.prepareOcrCanvas(rowCrop, { grayscale: true, contrast: 1.12 });
                try {
                  const rowStart = 0.84 + (rowIndex / Math.max(1, rowBands.length)) * 0.14;
                  const rowEnd = 0.84 + ((rowIndex + 1) / Math.max(1, rowBands.length)) * 0.14;
                  const rowResult = await ocr.recognize(rowCanvas, pageNumber, {
                    psm: 7,
                    dpi: 300,
                    whitelist: '0123456789.,/%-−₪ ',
                    progressContext: progressContext(
                      pageNumber,
                      rowStart,
                      rowEnd,
                      'table-row',
                      `קריאת שורה ${rowIndex + 1} מתוך ${rowBands.length}`,
                    ),
                  });
                  if (String(rowResult.text || '').trim()) {
                    const rowText = String(rowResult.text).trim();
                    const sourceY = Number(rowBand.y) + Number(rowBand.height) / 2;
                    tableRowTexts.push(rowText);
                    tableRowSources.push({
                      text: rowText,
                      page: pageNumber,
                      y: sourceY,
                      id: `p${pageNumber}-y${Math.round(sourceY)}`,
                    });
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
          if (typeof options.onProgress === 'function') options.onProgress({
            phase: 'ocr-page-complete', pageNumber, pageCount: maxPages,
            overallProgress: pageProgress(ocrProgressStart, ocrProgressEnd, pageNumber, 1),
          });
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
      if (typeof options.onProgress === 'function') options.onProgress({
        phase: 'finalizing', pageNumber: maxPages, pageCount: maxPages, overallProgress: 0.99,
      });
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
        const targetedRowsParsed = tableRowTexts.length ? attachTargetedRowSources(
          root.PensionReportParser.parsePensionReport(tableRowsInput, { method: 'ocr' }), tableRowSources,
        ) : null;
        const parsed = resolvePensionOcrPasses([
          ...(nativePensionParsed ? [{ name: 'native-pdf', parsed: nativePensionParsed, diagnostics: { tableQualityFallback: true } }] : []),
          { name: 'whole-page-default', parsed: root.PensionReportParser.parsePensionReport(ocrInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(ocrInput) },
          { name: 'whole-page-enhanced', parsed: root.PensionReportParser.parsePensionReport(enhancedInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(enhancedInput) },
          { name: 'whole-page-sparse', parsed: root.PensionReportParser.parsePensionReport(sparseInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(sparseInput) },
          { name: 'whole-page-enhanced-linear', parsed: root.PensionReportParser.parsePensionReport(enhancedLinearInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(enhancedLinearInput) },
          { name: 'whole-page-sparse-linear', parsed: root.PensionReportParser.parsePensionReport(sparseLinearInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(sparseLinearInput) },
          ...(tableOcrPages.length ? [{ name: 'targeted-table', parsed: root.PensionReportParser.parsePensionReport(tableInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(tableInput) }] : []),
          ...(numericTableOcrPages.length ? [{ name: 'targeted-table-numeric', parsed: root.PensionReportParser.parsePensionReport(numericTableInput, { method: 'ocr' }), diagnostics: ocrPassDiagnostics(numericTableInput) }] : []),
          ...(targetedRowsParsed ? [{ name: 'targeted-table-rows', parsed: targetedRowsParsed, diagnostics: ocrPassDiagnostics(tableRowsInput) }] : []),
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
    _test: Object.freeze({
      pdfLiteralText,
      parsePensionReport,
      looksLikeWrongDocument,
      classifyPdfError,
      pensionTableNeedsSecondSource,
      mergePensionContributionRows,
      resolvePensionOcrPasses,
      samePhysicalSourceRow,
    }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
