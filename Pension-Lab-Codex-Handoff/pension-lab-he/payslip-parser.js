(function (root) {
  'use strict';

  const F = root.PensionFinancial;
  if (!F) throw new Error('PensionFinancial must be loaded before PensionPayslipParser.');

  const ALIASES = Object.freeze({
    insuredSalary: Object.freeze([
      ['insured_salary', 'שכר מבוטח'], ['pension_salary', 'שכר לפנסיה'],
      ['determining_salary', 'שכר קובע'], ['pensionable_salary_he', 'שכר פנסיוני'],
      ['pension_base', 'בסיס לפנסיה'], ['provident_base', 'בסיס גמל'],
      ['pensionable_salary_en', 'pensionable salary'], ['insured_salary_en', 'insured salary'],
    ]),
    grossSalary: Object.freeze([
      ['gross_salary_he', 'שכר ברוטו'], ['gross_total_he', 'סהכ ברוטו'],
      ['gross_salary_en', 'gross salary'], ['gross_pay_en', 'gross pay'],
    ]),
    employeeContribution: Object.freeze([
      ['employee_benefits', 'תגמולי עובד'], ['employee_provident', 'גמל עובד'],
      ['employee_pension', 'עובד פנסיה'], ['employee_deposit', 'הפרשת עובד'],
      ['employee_deduction', 'ניכוי עובד לפנסיה'], ['employee_contribution_en', 'employee contribution'],
    ]),
    employerContribution: Object.freeze([
      ['employer_benefits', 'תגמולי מעסיק'], ['employer_provident', 'גמל מעסיק'],
      ['employer_pension', 'מעסיק פנסיה'], ['employer_deposit', 'הפרשת מעסיק'],
      ['employer_contribution_en', 'employer contribution'],
    ]),
    severanceContribution: Object.freeze([
      ['severance', 'פיצויים'], ['severance_deposit', 'הפרשת פיצויים'],
      ['employer_severance', 'פיצויי מעסיק'], ['severance_en', 'severance'],
    ]),
  });

  function normalizeSearchText(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .normalize('NFKC')
      .replace(/["״'׳:;()\[\]{}]/g, ' ')
      .replace(/[^\u0590-\u05ff\da-z%.,/\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function flattenWords(blocks) {
    const words = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (typeof node.text === 'string' && node.bbox && !node.words && !node.lines && !node.paragraphs) {
        words.push(node);
      }
      for (const key of ['blocks', 'paragraphs', 'lines', 'words', 'symbols']) {
        if (Array.isArray(node[key])) node[key].forEach(visit);
      }
    };
    visit(blocks);
    return words;
  }

  function normalizeToken(token, pageNumber) {
    if (!token || !String(token.text || '').trim()) return null;
    const bbox = token.bbox || {};
    const x = Number.isFinite(Number(token.x)) ? Number(token.x) : Number(bbox.x0) || 0;
    const y = Number.isFinite(Number(token.y)) ? Number(token.y) : Number(bbox.y0) || 0;
    const width = Number.isFinite(Number(token.width)) ? Number(token.width) : Math.max(0, (Number(bbox.x1) || x) - x);
    const height = Number.isFinite(Number(token.height)) ? Number(token.height) : Math.max(8, (Number(bbox.y1) || y + 12) - y);
    const confidence = Number.isFinite(Number(token.confidence)) ? Math.max(0, Math.min(1, Number(token.confidence) > 1 ? Number(token.confidence) / 100 : Number(token.confidence))) : 0.92;
    return { text: String(token.text).trim(), x, y, width, height, confidence, page: Number(token.page || pageNumber || 1) };
  }

  function tokensFromInput(input) {
    if (typeof input === 'string') {
      return input.split(/[\r\n]+/).filter(Boolean).map((text, index) => ({
        text, x: 0, y: index * 18, width: Math.max(40, text.length * 7), height: 14, confidence: 0.96, page: 1,
      }));
    }
    const pages = Array.isArray(input && input.pages) ? input.pages : [];
    const tokens = [];
    for (const page of pages) {
      const pageNumber = Number(page.pageNumber) || 1;
      const pageTokens = Array.isArray(page.tokens) ? page.tokens : [];
      pageTokens.map((token) => normalizeToken(token, pageNumber)).filter(Boolean).forEach((token) => tokens.push(token));
      if (!pageTokens.length && page.blocks) {
        flattenWords(page.blocks).map((token) => normalizeToken(token, pageNumber)).filter(Boolean).forEach((token) => tokens.push(token));
      }
    }
    if (tokens.length && input && typeof input.text === 'string') {
      input.text.split(/[\r\n]+/).filter((line) => normalizeSearchText(line)).forEach((text, index) => {
        tokens.push({
          text,
          x: 0,
          y: 100000 + index * 24,
          width: Math.max(40, text.length * 7),
          height: 16,
          confidence: 0.78,
          page: 1,
        });
      });
    }
    if (!tokens.length && input && typeof input.text === 'string') return tokensFromInput(input.text);
    return tokens;
  }

  function buildRows(tokens) {
    const rows = [];
    const sorted = [...tokens].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    for (const token of sorted) {
      let row = rows.find((candidate) => candidate.page === token.page && Math.abs(candidate.y - token.y) <= Math.max(7, token.height * 0.65));
      if (!row) {
        row = { page: token.page, y: token.y, tokens: [] };
        rows.push(row);
      }
      row.tokens.push(token);
      row.y = row.tokens.reduce((sum, item) => sum + item.y, 0) / row.tokens.length;
    }
    return rows.map((row) => {
      row.tokens.sort((a, b) => a.x - b.x);
      row.directText = row.tokens.map((token) => token.text).join(' ');
      row.reverseText = [...row.tokens].reverse().map((token) => token.text).join(' ');
      row.searchText = normalizeSearchText(`${row.directText} ${row.reverseText}`);
      return row;
    });
  }

  function numericFragments(text) {
    const matches = String(text || '').match(/(?:₪\s*)?[-−]?[\dOoIl|]+(?:[.,][\dOoIl|]+)*(?:[\s\u00a0\u202f][\dOoIl|]{3})*(?:\s*₪)?\s*%?/g) || [];
    return matches.map((raw) => raw.trim()).filter((raw) => /\d/.test(raw));
  }

  function aliasesFor(fieldName) {
    return ALIASES[fieldName] || [];
  }

  function matchAlias(row, fieldName) {
    for (const [id, alias] of aliasesFor(fieldName)) {
      const normalizedAlias = normalizeSearchText(alias);
      if (normalizedAlias && row.searchText.includes(normalizedAlias)) return { id, alias: normalizedAlias };
    }
    return null;
  }

  function candidateDistanceScore(row, raw) {
    const numericToken = row.tokens.find((token) => token.text.includes(raw) || raw.includes(token.text));
    if (!numericToken) return 0.68;
    const labelTokens = row.tokens.filter((token) => !numericFragments(token.text).length);
    if (!labelTokens.length) return 0.72;
    const nearest = Math.min(...labelTokens.map((token) => Math.abs((token.x + token.width / 2) - (numericToken.x + numericToken.width / 2))));
    return Math.max(0.55, 0.92 - nearest / 900);
  }

  function rowConfidence(row) {
    return row.tokens.length ? row.tokens.reduce((sum, token) => sum + token.confidence, 0) / row.tokens.length : 0.8;
  }

  function candidatesForRow(row) {
    const candidates = [];
    const seen = new Set();
    for (const token of row.tokens) {
      for (const raw of numericFragments(token.text)) {
        const key = `${raw}|${token.x}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const amount = F.normalizeFinancialValue(raw, { kind: 'amount' });
        const rate = F.normalizeFinancialValue(raw, { kind: 'rate' });
        candidates.push({ raw, amount, rate, explicitRate: /%/.test(raw), x: token.x, confidence: token.confidence });
      }
    }
    if (!candidates.length) {
      for (const raw of numericFragments(row.directText)) {
        candidates.push({
          raw,
          amount: F.normalizeFinancialValue(raw, { kind: 'amount' }),
          rate: F.normalizeFinancialValue(raw, { kind: 'rate' }),
          explicitRate: /%/.test(raw), x: 0, confidence: rowConfidence(row),
        });
      }
    }
    return candidates;
  }

  function scoredCandidate(row, candidate, type) {
    const normalized = type === 'rate' ? candidate.rate : candidate.amount;
    if (normalized.value == null) return null;
    if (type === 'amount' && (candidate.explicitRate || normalized.value < 20)) return null;
    if (type === 'rate' && (!candidate.explicitRate && normalized.value > 0.30)) return null;
    const formatScore = normalized.confidence;
    const confidence = Math.max(0, Math.min(1,
      rowConfidence(row) * 0.35 + candidate.confidence * 0.25 + candidateDistanceScore(row, candidate.raw) * 0.25 + formatScore * 0.15
    ));
    return { value: normalized.value, confidence, raw: candidate.raw };
  }

  function bestRowValues(rows, fieldName) {
    const matches = [];
    for (const row of rows) {
      const alias = matchAlias(row, fieldName);
      if (!alias) continue;
      const candidates = candidatesForRow(row);
      const amountCandidates = candidates.map((candidate) => scoredCandidate(row, candidate, 'amount')).filter(Boolean);
      const rateCandidates = candidates.map((candidate) => scoredCandidate(row, candidate, 'rate')).filter(Boolean);
      amountCandidates.sort((a, b) => b.confidence - a.confidence);
      rateCandidates.sort((a, b) => b.confidence - a.confidence);
      matches.push({
        aliasId: alias.id, page: row.page,
        amount: amountCandidates[0] || null,
        rate: rateCandidates[0] || null,
      });
    }
    matches.sort((a, b) => Math.max(b.amount?.confidence || 0, b.rate?.confidence || 0) - Math.max(a.amount?.confidence || 0, a.rate?.confidence || 0));
    return matches[0] || null;
  }

  function directResult(candidate, aliasMatch, method, unit) {
    if (!candidate) return null;
    return {
      value: candidate.value,
      unit,
      origin: 'direct',
      confidence: Math.max(0, Math.min(1, candidate.confidence * (method === 'ocr' ? 0.94 : 1))),
      requiresConfirmation: method === 'ocr',
      evidence: { aliasId: aliasMatch.aliasId, page: aliasMatch.page, method, validation: 'not-checked' },
    };
  }

  function derivedResult(value, amountField, method, unit) {
    return {
      value,
      unit,
      origin: 'derived',
      confidence: Math.max(0, Math.min(1, (amountField.confidence || 0.75) - 0.03)),
      requiresConfirmation: method === 'ocr' || Boolean(amountField.requiresConfirmation),
      evidence: { ...amountField.evidence, method, validation: 'derived-from-insured-salary' },
    };
  }

  function crossValidate(fields, amountName, rateName, method) {
    const salary = fields.insuredSalary;
    let amount = fields[amountName];
    let rate = fields[rateName];
    if (!salary || !Number.isFinite(salary.value) || salary.value <= 0) return;
    if (amount && !rate) {
      fields[rateName] = derivedResult(amount.value / salary.value, amount, method, 'ratio');
      return;
    }
    if (!amount && rate) {
      fields[amountName] = derivedResult(rate.value * salary.value, rate, method, 'ILS');
      return;
    }
    if (!amount || !rate) return;
    const derivedRate = amount.value / salary.value;
    const agrees = F.approximatelyEqual(rate.value, derivedRate, 0.00075, 0.02);
    const validation = agrees ? 'amount-rate-agree' : 'amount-rate-conflict';
    amount = { ...amount, evidence: { ...amount.evidence, validation } };
    rate = { ...rate, evidence: { ...rate.evidence, validation } };
    if (agrees) {
      amount.confidence = Math.min(0.99, amount.confidence + 0.05);
      rate.confidence = Math.min(0.99, rate.confidence + 0.05);
    } else {
      amount.confidence = Math.max(0, amount.confidence - 0.18);
      rate.confidence = Math.max(0, rate.confidence - 0.18);
      amount.requiresConfirmation = true;
      rate.requiresConfirmation = true;
      if (method === 'ocr' && amount.confidence >= rate.confidence - 0.12) {
        rate = {
          ...derivedResult(derivedRate, amount, method, 'ratio'),
          confidence: Math.max(0, Math.min(amount.confidence, rate.confidence)),
          requiresConfirmation: true,
          evidence: { ...rate.evidence, validation, alternativesDetected: true },
        };
      }
    }
    fields[amountName] = amount;
    fields[rateName] = rate;
  }

  function extractMonth(text) {
    const match = String(text || '').match(/\b(0?[1-9]|1[0-2])[\/.\-](20\d{2})\b/);
    return match ? `${String(match[1]).padStart(2, '0')}/${match[2]}` : null;
  }

  function parsePayslip(input, options = {}) {
    const method = options.method === 'ocr' ? 'ocr' : 'pdf-text';
    const tokens = tokensFromInput(input);
    const rows = buildRows(tokens);
    const fields = {};
    const salaryMatch = bestRowValues(rows, 'insuredSalary');
    const grossMatch = bestRowValues(rows, 'grossSalary');
    const employeeMatch = bestRowValues(rows, 'employeeContribution');
    const employerMatch = bestRowValues(rows, 'employerContribution');
    const severanceMatch = bestRowValues(rows, 'severanceContribution');

    if (salaryMatch) fields.insuredSalary = directResult(salaryMatch.amount, salaryMatch, method, 'ILS');
    if (grossMatch) fields.grossSalary = directResult(grossMatch.amount, grossMatch, method, 'ILS');
    if (employeeMatch) {
      fields.employeeContributionAmount = directResult(employeeMatch.amount, employeeMatch, method, 'ILS');
      fields.employeeContributionRate = directResult(employeeMatch.rate, employeeMatch, method, 'ratio');
    }
    if (employerMatch) {
      fields.employerContributionAmount = directResult(employerMatch.amount, employerMatch, method, 'ILS');
      fields.employerContributionRate = directResult(employerMatch.rate, employerMatch, method, 'ratio');
    }
    if (severanceMatch) {
      fields.severanceContributionAmount = directResult(severanceMatch.amount, severanceMatch, method, 'ILS');
      fields.severanceRate = directResult(severanceMatch.rate, severanceMatch, method, 'ratio');
    }
    Object.keys(fields).forEach((name) => { if (!fields[name]) delete fields[name]; });

    crossValidate(fields, 'employeeContributionAmount', 'employeeContributionRate', method);
    crossValidate(fields, 'employerContributionAmount', 'employerContributionRate', method);
    crossValidate(fields, 'severanceContributionAmount', 'severanceRate', method);

    const combinedText = typeof input === 'string' ? input : (input && input.text) || rows.map((row) => row.directText).join('\n');
    const month = extractMonth(combinedText);
    if (month) fields.payslipMonth = {
      value: month, unit: 'month', origin: 'direct', confidence: method === 'ocr' ? 0.75 : 0.92,
      requiresConfirmation: false, evidence: { aliasId: 'month-pattern', page: 1, method, validation: 'format-valid' },
    };

    const contributionFields = ['employeeContributionAmount', 'employeeContributionRate', 'employerContributionAmount', 'employerContributionRate', 'severanceContributionAmount', 'severanceRate'];
    return {
      fields,
      method,
      hasCriticalFields: Boolean(fields.insuredSalary && contributionFields.some((name) => fields[name])),
      diagnostics: Object.entries(fields).map(([fieldName, result]) => ({
        fieldName,
        method,
        aliasId: result.evidence && result.evidence.aliasId,
        page: result.evidence && result.evidence.page,
        confidence: result.confidence,
        origin: result.origin,
        validation: result.evidence && result.evidence.validation,
      })),
    };
  }

  function countPayslipAnchors(text) {
    const normalized = normalizeSearchText(text);
    const ids = new Set();
    Object.entries(ALIASES).forEach(([fieldName, aliases]) => {
      if (aliases.some(([, alias]) => normalized.includes(normalizeSearchText(alias)))) ids.add(fieldName);
    });
    return ids.size;
  }

  root.PensionPayslipParser = Object.freeze({
    ALIASES,
    normalizeSearchText,
    tokensFromInput,
    buildRows,
    countPayslipAnchors,
    parsePayslip,
  });
})(typeof window !== 'undefined' ? window : globalThis);
