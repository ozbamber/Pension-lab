(function (root) {
  'use strict';

  const F = root.PensionFinancial;
  const P = root.PensionPayslipParser;
  if (!F || !P) throw new Error('Financial and spatial parsers must be loaded first.');

  const ALIASES = Object.freeze({
    closingBalance: Object.freeze(['יתרת הכספים בקרן בסוף תקופת הדיווח', 'יתרה בסוף תקופת הדיווח', 'יתרה בסוף השנה', 'יתרה נוכחית', 'closing balance', 'current balance']),
    openingBalance: Object.freeze(['יתרה בתחילת תקופת הדיווח', 'יתרת פתיחה', 'opening balance', 'beginning balance']),
    personalFees: Object.freeze(['דמי ניהול אישיים', 'דמי הניהול שנגבו ממך', 'דמי ניהול שנגבו מהעמית', 'personal management fees']),
    fundAverage: Object.freeze(['ממוצע דמי ניהול בקרן', 'דמי ניהול ממוצעים', 'fund average', 'average management fees']),
    depositFee: Object.freeze(['דמי ניהול מהפקדה', 'מהפקדה', 'deposit fee']),
    balanceFee: Object.freeze(['דמי ניהול מחיסכון', 'דמי ניהול מצבירה', 'מחיסכון', 'מצבירה', 'balance fee']),
    provider: Object.freeze(['שם הגוף המוסדי', 'שם הקרן', 'שם קופת הגמל', 'pension provider', 'fund provider']),
  });

  const CLOSING_BALANCE_ALIASES = Object.freeze([...ALIASES.closingBalance, 'יתרה/ערך נצבר', 'ערך נצבר', 'accumulated value']);

  function normalized(value) { return P.normalizeSearchText(value); }
  function containsAlias(text, aliases) { const value = normalized(text); return aliases.some((alias) => value.includes(normalized(alias))); }
  function amountFragments(text) { return String(text || '').match(/[-−]?[\dOoIl|]+(?:[.,][\dOoIl|]+)*/g) || []; }
  function percentageFragments(text) { return String(text || '').match(/[\dOoIl|]+(?:[.,][\dOoIl|]+)?\s*%/g) || []; }
  function percentageMatches(text) {
    const value = String(text || '');
    return [...value.matchAll(/[\dOoIl|]+(?:[.,][\dOoIl|]+)?\s*%/g)].map((match) => ({ raw: match[0], index: match.index }));
  }
  function field(value, unit, origin, confidence, evidence) {
    return { value, unit, origin, confidence, requiresConfirmation: confidence < 0.9, sourceDate: evidence?.salaryMonth || null, evidence };
  }
  function rowsFromInput(input) { return P.buildRows(P.tokensFromInput(input)); }
  function rowText(row) { return `${row.directText} ${row.reverseText}`; }
  function nearbyRows(rows, index, radius = 2) { return rows.slice(Math.max(0, index - radius), Math.min(rows.length, index + radius + 1)); }

  function parseDate(value) {
    const text = String(value || '');
    let match = text.match(/\b([0-3]?\d)[\/.\-](0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/);
    if (match) return { display: `${String(match[1]).padStart(2, '0')}/${String(match[2]).padStart(2, '0')}/${match[3]}`, key: Number(match[3]) * 372 + Number(match[2]) * 31 + Number(match[1]) };
    match = text.match(/\b(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/);
    if (match) return { display: `${String(match[1]).padStart(2, '0')}/${match[2]}`, key: Number(match[2]) * 372 + Number(match[1]) * 31 };
    return null;
  }

  function extractProviderByLabel(rows) {
    for (const row of rows) {
      if (!containsAlias(row.directText, ALIASES.provider)) continue;
      for (const source of [row.directText, row.reverseText]) {
        for (const alias of ALIASES.provider) {
          const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = String(source).match(new RegExp(`${escaped}\\s*[:|]?\\s*([^|]+)(?:\\|\\s*(\\d+))?`, 'i'));
          if (!match) continue;
          const candidate = `${match[1]} ${match[2] || ''}`
            .split(/(?:שם העמית|גיל פרישה|מספר עמית|member name|retirement age|member id|מהפקדה|מחיסכון|דמי ניהול|annual report|quarterly report)/i)[0]
            .replace(/[-â€“â€”:]+/g, ' ')
            .replace(/[^\u0590-\u05ff\da-zA-Z .'-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (candidate.length >= 3 && /[\u0590-\u05ffa-z]/i.test(candidate)) return { value: candidate, page: row.page };
        }
      }
    }
    for (const row of rows) {
      const text = normalized(row.directText);
      const datedSynthetic = text.match(/(קרן\s+פנסיה\s+פיקטיבית|pension\s+fund\s+synthetic)\s*(?:\d{1,2}[./]\d{1,2}[./]20\d{2}\s*[·-]\s*)?(\d+)(?=\s|$)/i);
      if (datedSynthetic) return { value: `${datedSynthetic[1]} ${datedSynthetic[2]}`, page: row.page };
      const synthetic = text.match(/((?:קרן\s+פנסיה|pension\s+fund)[^|]*?)\s*[-–]\s*(\d+)\s*(?:דוח|annual|report)/i);
      if (synthetic) return { value: `${synthetic[1].trim()} ${synthetic[2]}`.replace(/\s+/g, ' '), page: row.page };
    }
    return null;
  }

  function extractProvider(rows) {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!containsAlias(row.directText, ALIASES.provider)) continue;
      const contexts = [row.directText, rows[index + 1]?.directText || ''];
      for (const context of contexts) {
        let candidate = String(context);
        for (const alias of ALIASES.provider) candidate = candidate.replace(new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
        candidate = candidate.replace(/[-–—:|]+/g, ' ').replace(/\b\d[\d.,/%-]*\b/g, ' ').replace(/\s+/g, ' ').trim();
        if (candidate.length >= 3 && /[\u0590-\u05ffa-z]/i.test(candidate)) return { value: candidate, page: row.page };
      }
    }
    return null;
  }

  function extractClosingBalance(rows) {
    const candidates = [];
    rows.forEach((row, index) => {
      const text = rowText(row);
      const semanticClosing = /סוף/.test(normalized(text)) && /(?:תקופת|דיווח|שנה)/.test(normalized(text));
      if (!containsAlias(text, CLOSING_BALANCE_ALIASES) && !semanticClosing) return;
      nearbyRows(rows, index, 1).forEach((candidateRow) => amountFragments(rowText(candidateRow)).forEach((raw) => {
        const parsed = F.normalizeFinancialValue(raw, { kind: 'amount' });
        if (parsed.value >= 100 && parsed.value <= 100000000) candidates.push({ value: parsed.value, score: candidateRow === row ? 1 : 0.84, page: row.page });
      }));
    });
    candidates.sort((a, b) => b.score - a.score || b.value - a.value);
    return candidates[0] || null;
  }

  function extractFees(rows) {
    const anchors = {
      depositManagementFeeRate: ALIASES.depositFee,
      balanceManagementFeeRate: ALIASES.balanceFee,
    };
    const headers = rows.map((row, index) => ({
      index,
      personal: containsAlias(rowText(row), ALIASES.personalFees),
      average: containsAlias(rowText(row), ALIASES.fundAverage),
    })).filter((item) => item.personal || item.average);
    const byField = { depositManagementFeeRate: [], balanceManagementFeeRate: [] };

    rows.forEach((row, rowIndex) => {
      const percentages = percentageMatches(row.directText);
      percentages.forEach(({ raw, index: percentageIndex }, fragmentIndex) => {
        const parsed = F.normalizeFinancialValue(raw, { kind: 'rate' });
        if (parsed.value == null || parsed.value <= 0 || parsed.value > 0.2) return;
        const nearestHeader = [...headers].sort((a, b) => Math.abs(a.index - rowIndex) - Math.abs(b.index - rowIndex))[0];
        for (const [fieldName, aliases] of Object.entries(anchors)) {
          const matchingRows = rows.map((candidateRow, candidateIndex) => ({ candidateRow, candidateIndex }))
            .filter(({ candidateRow }) => containsAlias(rowText(candidateRow), aliases));
          if (!matchingRows.length) continue;
          const nearest = matchingRows.sort((a, b) => {
            const pagePenaltyA = a.candidateRow.page === row.page ? 0 : 100;
            const pagePenaltyB = b.candidateRow.page === row.page ? 0 : 100;
            return pagePenaltyA + Math.abs(a.candidateRow.y - row.y) - pagePenaltyB - Math.abs(b.candidateRow.y - row.y);
          })[0];
          const rowDistance = Math.abs(nearest.candidateIndex - rowIndex);
          if (nearest.candidateRow.page !== row.page || rowDistance > 5) continue;
          let score = 1.1 - rowDistance * 0.16;
          if (nearest.candidateIndex === rowIndex) score += 0.75;
          const beforePercentage = row.directText.slice(0, percentageIndex);
          const personalPosition = Math.max(...ALIASES.personalFees.map((alias) => normalized(beforePercentage).lastIndexOf(normalized(alias))));
          const averagePosition = Math.max(...ALIASES.fundAverage.map((alias) => normalized(beforePercentage).lastIndexOf(normalized(alias))));
          let headerKind = null;
          if (nearestHeader?.personal && nearestHeader?.average) {
            const headerText = rowText(rows[nearestHeader.index]);
            const headerPositions = [];
            for (const alias of ALIASES.personalFees) {
              const position = normalized(headerText).indexOf(normalized(alias));
              if (position >= 0) headerPositions.push({ position, kind: 'personal' });
            }
            for (const alias of ALIASES.fundAverage) {
              const position = normalized(headerText).indexOf(normalized(alias));
              if (position >= 0) headerPositions.push({ position, kind: 'average' });
            }
            headerPositions.sort((a, b) => a.position - b.position);
            headerKind = headerPositions[fragmentIndex]?.kind || null;
          }
          if (headerKind === 'personal' || personalPosition > averagePosition) score += 0.9;
          else if (headerKind === 'average' || averagePosition > personalPosition) score -= 1.4;
          else if (nearestHeader && Math.abs(nearestHeader.index - rowIndex) <= 5) score += nearestHeader.personal ? 0.45 : -1.05;
          byField[fieldName].push({
            id: `${row.id || `p${row.page}-r${rowIndex}`}-fee${fragmentIndex}`,
            value: parsed.value,
            page: row.page,
            score,
            spatialDistance: rowDistance,
          });
        }
      });
    });

    const deposit = byField.depositManagementFeeRate.sort((a, b) => b.score - a.score);
    const balance = byField.balanceManagementFeeRate.sort((a, b) => b.score - a.score);
    let bestPair = null;
    for (const depositCandidate of deposit.concat([null])) {
      for (const balanceCandidate of balance.concat([null])) {
        if (depositCandidate && balanceCandidate && depositCandidate.id === balanceCandidate.id) continue;
        const score = (depositCandidate?.score || 0) + (balanceCandidate?.score || 0);
        if (!bestPair || score > bestPair.score) bestPair = { depositCandidate, balanceCandidate, score };
      }
    }
    const output = {};
    if (bestPair?.depositCandidate && bestPair.depositCandidate.score > 0.35) output.depositManagementFeeRate = bestPair.depositCandidate;
    if (bestPair?.balanceCandidate && bestPair.balanceCandidate.score > 0.35) output.balanceManagementFeeRate = bestPair.balanceCandidate;
    return output;
  }

  function parseContributionRows(rows) {
    const output = [];
    for (const row of rows) {
      const text = row.directText;
      const normalizedText = normalized(text);
      if (/(?:שנתי|שנתית|מצטבר|מתחילת השנה|annual|yearly|ytd)/.test(normalizedText)) continue;
      const dates = [...String(text).matchAll(/\b(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/g)].map((match) => `${match[1]}/${match[2]}`);
      const withoutDates = text.replace(/\b(?:[0-3]?\d[\/.\-])?(?:0?[1-9]|1[0-2])[\/.\-]20\d{2}\b/g, ' ');
      const numbers = amountFragments(withoutDates).map((raw) => F.normalizeFinancialValue(raw, { kind: 'amount' }).value)
        .filter((value) => Number.isFinite(value));
      const monetary = numbers.filter((value) => value >= 20);
      if (!dates.length || monetary.length < 4) continue;
      const salary = monetary.filter((value) => value > 0).sort((a, b) => b - a)[0];
      if (!salary) continue;
      const salaryIndex = monetary.indexOf(salary);
      const after = monetary.slice(salaryIndex + 1).filter((value) => value > 0 && value < salary);
      const before = monetary.slice(0, salaryIndex).filter((value) => value > 0 && value < salary);
      const side = after.length >= 3 ? after : before.slice().reverse();
      let contributions = side.slice(0, 3);
      if (side.length >= 4) {
        const totalIndex = side.findIndex((candidate, candidateIndex) => {
          const others = side.filter((_, index) => index !== candidateIndex).slice(0, 3);
          return others.length === 3 && F.approximatelyEqual(candidate, others.reduce((sum, value) => sum + value, 0), 3, 0.012);
        });
        if (totalIndex >= 0) {
          const withoutTotal = side.filter((_, index) => index !== totalIndex).slice(0, 3);
          contributions = totalIndex === 0 ? withoutTotal.reverse() : withoutTotal;
        }
      }
      if (contributions.length < 3) continue;
      const [employeeContribution, employerContribution, severanceContribution] = contributions;
      const rates = contributions.map((value) => value / salary);
      if (rates.some((rate) => !Number.isFinite(rate) || rate <= 0 || rate > 0.35)) continue;
      if (contributions.reduce((sum, value) => sum + value, 0) >= salary * 0.65) continue;
      const salaryMonth = parseDate(dates[dates.length - 1]);
      output.push({
        depositDate: dates.length > 1 ? parseDate(dates[0])?.display : null,
        salaryMonth: salaryMonth?.display || null,
        chronologyKey: salaryMonth?.key || 0,
        pensionableSalary: salary,
        employeeContribution,
        employerContribution,
        severanceContribution,
        totalContribution: employeeContribution + employerContribution + severanceContribution,
        page: row.page,
      });
    }
    return output;
  }

  function recurringEvidence(history, latest) {
    const recent = [...history].sort((a, b) => b.chronologyKey - a.chronologyKey).slice(0, 6);
    const agrees = recent.filter((row) => ['pensionableSalary', 'employeeContribution', 'employerContribution', 'severanceContribution']
      .every((name) => F.approximatelyEqual(row[name], latest[name], 2, 0.012))).length;
    return { recentRows: recent.length, agreeingRows: agrees, recurring: agrees >= 2 };
  }

  function parsePensionReport(input, options = {}) {
    const method = options.method === 'ocr' ? 'ocr' : 'pdf-text';
    const rows = rowsFromInput(input);
    const fields = {};
    const balance = extractClosingBalance(rows);
    if (balance) fields.currentBalance = field(balance.value, 'ILS', 'direct', balance.score >= 0.95 ? 0.97 : 0.88, { aliasId: 'closing-balance', page: balance.page, method });
    const fees = extractFees(rows);
    Object.entries(fees).forEach(([name, item]) => { fields[name] = field(item.value, 'ratio', 'direct', 0.95, { aliasId: name, page: item.page, method }); });
    const provider = extractProviderByLabel(rows);
    if (provider) fields.pensionProvider = field(provider.value, 'text', 'direct', 0.9, { aliasId: 'pension-provider', page: provider.page, method });
    const history = parseContributionRows(rows);
    history.sort((a, b) => b.chronologyKey - a.chronologyKey);
    const latest = history[0];
    if (latest) {
      const pattern = recurringEvidence(history, latest);
      const confidence = pattern.recurring ? 0.97 : 0.88;
      const evidence = { aliasId: 'contribution-table', page: latest.page, method, salaryMonth: latest.salaryMonth, sourceDateConfidence: 0.95, recurringPattern: pattern };
      fields.latestReportedPensionableSalary = field(latest.pensionableSalary, 'ILS', 'direct', confidence, evidence);
      fields.latestEmployeeContributionAmount = field(latest.employeeContribution, 'ILS', 'direct', confidence, evidence);
      fields.latestEmployerContributionAmount = field(latest.employerContribution, 'ILS', 'direct', confidence, evidence);
      fields.latestSeveranceContributionAmount = field(latest.severanceContribution, 'ILS', 'direct', confidence, evidence);
      fields.latestEmployeeContributionRate = field(latest.employeeContribution / latest.pensionableSalary, 'ratio', 'derived', confidence - 0.01, evidence);
      fields.latestEmployerContributionRate = field(latest.employerContribution / latest.pensionableSalary, 'ratio', 'derived', confidence - 0.01, evidence);
      fields.latestSeveranceRate = field(latest.severanceContribution / latest.pensionableSalary, 'ratio', 'derived', confidence - 0.01, evidence);
    }
    const allText = typeof input === 'string' ? input : String(input?.text || rows.map(rowText).join('\n'));
    const dates = [...allText.matchAll(/\b(?:[0-3]?\d[\/.\-])?(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/g)].map((match) => parseDate(match[0])).filter(Boolean).sort((a, b) => b.key - a.key);
    if (dates[0]) fields.reportDate = field(dates[0].display, 'date', 'direct', 0.82, { aliasId: 'latest-date', page: 1, method });
    if (dates[0] && fields.currentBalance) fields.balanceDate = field(dates[0].display, 'date', 'derived', 0.8, { aliasId: 'report-period-end', page: 1, method });
    return { fields, contributionHistory: history, method, classification: /דוח\s*שנתי|annual\s*report/i.test(allText) ? 'ANNUAL_PENSION_REPORT' : 'PERIODIC_PENSION_REPORT' };
  }

  function parseManagementFeesFromTokens(input) {
    return extractFees(rowsFromInput(input));
  }

  function countReportAnchors(text) {
    const value = normalized(text);
    return [ALIASES.closingBalance, ALIASES.depositFee, ALIASES.balanceFee].filter((aliases) => aliases.some((alias) => value.includes(normalized(alias)))).length;
  }

  root.PensionReportParser = Object.freeze({ ALIASES, parseDate, parseContributionRows, parsePensionReport, parseManagementFeesFromTokens, countReportAnchors });
})(typeof window !== 'undefined' ? window : globalThis);
