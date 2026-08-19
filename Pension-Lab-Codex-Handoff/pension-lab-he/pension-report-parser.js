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
  });

  function normalized(value) { return P.normalizeSearchText(value); }
  function containsAlias(text, aliases) { const value = normalized(text); return aliases.some((alias) => value.includes(normalized(alias))); }
  function amountFragments(text) { return String(text || '').match(/[-−]?[\dOoIl|]+(?:[.,][\dOoIl|]+)*/g) || []; }
  function percentageFragments(text) { return String(text || '').match(/[\dOoIl|]+(?:[.,][\dOoIl|]+)?\s*%/g) || []; }
  function field(value, unit, origin, confidence, evidence) {
    return { value, unit, origin, confidence, requiresConfirmation: confidence < 0.9, evidence };
  }
  function rowsFromInput(input) { return P.buildRows(P.tokensFromInput(input)); }
  function rowText(row) { return `${row.directText} ${row.reverseText}`; }
  function nearbyRows(rows, index, radius = 2) { return rows.slice(Math.max(0, index - radius), Math.min(rows.length, index + radius + 1)); }

  function parseDate(value) {
    const text = String(value || '');
    let match = text.match(/\b(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/);
    if (match) return { display: `${String(match[1]).padStart(2, '0')}/${match[2]}`, key: Number(match[2]) * 12 + Number(match[1]) };
    match = text.match(/\b([0-3]?\d)[\/.\-](0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/);
    if (match) return { display: `${String(match[1]).padStart(2, '0')}/${String(match[2]).padStart(2, '0')}/${match[3]}`, key: Number(match[3]) * 372 + Number(match[2]) * 31 + Number(match[1]) };
    return null;
  }

  function extractClosingBalance(rows) {
    const candidates = [];
    rows.forEach((row, index) => {
      const text = rowText(row);
      const semanticClosing = /סוף/.test(normalized(text)) && /(?:תקופת|דיווח|שנה)/.test(normalized(text));
      if (!containsAlias(text, ALIASES.closingBalance) && !semanticClosing) return;
      nearbyRows(rows, index, 1).forEach((candidateRow) => amountFragments(rowText(candidateRow)).forEach((raw) => {
        const parsed = F.normalizeFinancialValue(raw, { kind: 'amount' });
        if (parsed.value >= 100 && parsed.value <= 100000000) candidates.push({ value: parsed.value, score: candidateRow === row ? 1 : 0.84, page: row.page });
      }));
    });
    candidates.sort((a, b) => b.score - a.score || b.value - a.value);
    return candidates[0] || null;
  }

  function extractFees(rows) {
    const candidates = { depositManagementFeeRate: [], balanceManagementFeeRate: [] };
    const averageHeaderIndexes = rows.map((row, index) => ({ index, text: normalized(rowText(row)) }))
      .filter((item) => /ממוצע/.test(item.text) && /דמי/.test(item.text) && /ניהול/.test(item.text)).map((item) => item.index);
    rows.forEach((row, index) => {
      const text = rowText(row);
      if (containsAlias(text, ALIASES.fundAverage) || (/ממוצע/.test(normalized(text)) && /דמי/.test(normalized(text)) && /ניהול/.test(normalized(text)))) return;
      const percentages = percentageFragments(text);
      if (!percentages.length) return;
      const parsed = F.normalizeFinancialValue(percentages[0], { kind: 'rate' });
      if (parsed.value == null || parsed.value > 0.2) return;
      const directContext = normalized(text);
      const nearestAliasDistance = (aliases) => rows.reduce((best, candidateRow, candidateIndex) => containsAlias(rowText(candidateRow), aliases) ? Math.min(best, Math.abs(candidateIndex - index)) : best, Infinity);
      const depositDistance = nearestAliasDistance(ALIASES.depositFee);
      const balanceDistance = nearestAliasDistance(ALIASES.balanceFee);
      const preceding = rows.slice(Math.max(0, index - 4), index + 1).map(rowText).join(' ');
      const nearAverage = averageHeaderIndexes.some((headerIndex) => Math.abs(headerIndex - index) <= 4);
      const score = nearAverage || containsAlias(preceding, ALIASES.fundAverage) ? 0.25 : containsAlias(preceding, ALIASES.personalFees) ? 1 : 0.78 + index * 0.0001;
      if (depositDistance <= 8 && depositDistance <= balanceDistance) candidates.depositManagementFeeRate.push({ value: parsed.value, page: row.page, score });
      if (balanceDistance <= 8 && balanceDistance < depositDistance) candidates.balanceManagementFeeRate.push({ value: parsed.value, page: row.page, score });
    });
    return Object.fromEntries(Object.entries(candidates).map(([name, values]) => [name, values.sort((a, b) => b.score - a.score)[0]]).filter(([, item]) => item));
  }

  function parseContributionRows(rows) {
    const output = [];
    for (const row of rows) {
      const text = rowText(row);
      const dates = [...String(text).matchAll(/\b(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/g)].map((match) => `${match[1]}/${match[2]}`);
      const withoutDates = text.replace(/\b(?:[0-3]?\d[\/.\-])?(?:0?[1-9]|1[0-2])[\/.\-]20\d{2}\b/g, ' ');
      const numbers = amountFragments(withoutDates).map((raw) => F.normalizeFinancialValue(raw, { kind: 'amount' }).value)
        .filter((value) => Number.isFinite(value));
      const monetary = numbers.filter((value) => value >= 20);
      if (!dates.length || monetary.length < 4) continue;
      const salary = monetary.filter((value) => value >= 1000 && value <= 200000).sort((a, b) => b - a)[0];
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
    const history = parseContributionRows(rows);
    history.sort((a, b) => b.chronologyKey - a.chronologyKey);
    const latest = history[0];
    if (latest) {
      const pattern = recurringEvidence(history, latest);
      const confidence = pattern.recurring ? 0.97 : 0.88;
      const evidence = { aliasId: 'contribution-table', page: latest.page, method, salaryMonth: latest.salaryMonth, recurringPattern: pattern };
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
    const tokens = P.tokensFromInput(input);
    const output = {};
    for (let index = 0; index < tokens.length; index += 1) {
      const labelContext = tokens.slice(index, index + 3).map((token) => token.text).join(' ');
      const valueContext = tokens.slice(index, index + 8).map((token) => token.text).join(' ');
      const percentages = percentageFragments(valueContext);
      if (!percentages.length) continue;
      const value = F.normalizeFinancialValue(percentages[0], { kind: 'rate' }).value;
      if (value == null || value > 0.2) continue;
      if (!output.depositManagementFeeRate && containsAlias(labelContext, ALIASES.depositFee)) output.depositManagementFeeRate = { value, page: tokens[index].page };
      if (!output.balanceManagementFeeRate && containsAlias(labelContext, ALIASES.balanceFee)) output.balanceManagementFeeRate = { value, page: tokens[index].page };
      if (output.depositManagementFeeRate && output.balanceManagementFeeRate) break;
    }
    return output;
  }

  function countReportAnchors(text) {
    const value = normalized(text);
    return [ALIASES.closingBalance, ALIASES.depositFee, ALIASES.balanceFee].filter((aliases) => aliases.some((alias) => value.includes(normalized(alias)))).length;
  }

  root.PensionReportParser = Object.freeze({ ALIASES, parseDate, parseContributionRows, parsePensionReport, parseManagementFeesFromTokens, countReportAnchors });
})(typeof window !== 'undefined' ? window : globalThis);
