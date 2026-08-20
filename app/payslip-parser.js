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
    // Structured observations are authoritative. Adding the flattened text as
    // another token stream would duplicate the same numbers under new IDs and
    // could bypass the global tuple evaluator's non-reuse guarantee.
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
    return rows.map((row, rowIndex) => {
      row.tokens.sort((a, b) => a.x - b.x);
      row.id = `p${row.page}-r${rowIndex}`;
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

  function isDateLikeFragment(raw) {
    return /^(?:0?[1-9]|1[0-2])[\/\.\-]20\d{2}$/.test(String(raw || '').trim()) ||
      /^(?:[0-3]?\d)[\/\.\-](?:0?[1-9]|1[0-2])[\/\.\-]20\d{2}$/.test(String(raw || '').trim());
  }

  function isDateComponentFragment(raw, tokenText) {
    const value = String(raw || '').replace(/^0+/, '');
    const text = String(tokenText || '');
    const matches = text.match(/(?:0?[1-9]|1[0-2])[\/\.\-](20\d{2})/g) || [];
    return matches.some((date) => {
      const [month, year] = date.split(/[\/\.\-]/);
      return value === month.replace(/^0+/, '') || value === year;
    });
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
    for (let tokenIndex = 0; tokenIndex < row.tokens.length; tokenIndex += 1) {
      const token = row.tokens[tokenIndex];
      const fragments = numericFragments(token.text);
      for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex += 1) {
        const raw = fragments[fragmentIndex];
        if (isDateLikeFragment(raw) || isDateComponentFragment(raw, token.text)) continue;
        const key = `${raw}|${token.x}|${tokenIndex}|${fragmentIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const amount = F.normalizeFinancialValue(raw, { kind: 'amount' });
        const rate = F.normalizeFinancialValue(raw, { kind: 'rate' });
        candidates.push({
          id: `${row.id}-t${tokenIndex}-n${fragmentIndex}`,
          raw, amount, rate, explicitRate: /%/.test(raw), x: token.x,
          y: token.y, page: row.page, rowId: row.id, confidence: token.confidence,
        });
      }
    }
    if (!candidates.length) {
      const fragments = numericFragments(row.directText);
      for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex += 1) {
        const raw = fragments[fragmentIndex];
        if (isDateLikeFragment(raw) || isDateComponentFragment(raw, row.directText)) continue;
        candidates.push({
          id: `${row.id}-n${fragmentIndex}`,
          raw,
          amount: F.normalizeFinancialValue(raw, { kind: 'amount' }),
          rate: F.normalizeFinancialValue(raw, { kind: 'rate' }),
          explicitRate: /%/.test(raw), x: 0, y: row.y, page: row.page, rowId: row.id, confidence: rowConfidence(row),
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
    return {
      id: candidate.id,
      value: normalized.value,
      confidence,
      explicitRate: candidate.explicitRate,
      x: candidate.x,
      y: candidate.y,
      page: candidate.page,
      rowId: candidate.rowId,
    };
  }

  function allRowValues(rows, fieldName) {
    const matches = [];
    for (const row of rows) {
      const alias = matchAlias(row, fieldName);
      if (!alias) continue;
      const rowIndex = rows.indexOf(row);
      const candidateRows = rows.map((candidateRow, candidateIndex) => ({ candidateRow, candidateIndex }))
        .filter(({ candidateRow, candidateIndex }) => candidateRow.page === row.page &&
          (Math.abs(candidateRow.y - row.y) <= 72 || Math.abs(candidateIndex - rowIndex) <= 2))
        .sort((left, right) => {
          const vertical = Math.abs(left.candidateRow.y - row.y) - Math.abs(right.candidateRow.y - row.y);
          if (vertical) return vertical;
          const indexDistance = Math.abs(left.candidateIndex - rowIndex) - Math.abs(right.candidateIndex - rowIndex);
          return indexDistance || left.candidateIndex - right.candidateIndex;
        })
        .slice(0, 5)
        .map(({ candidateRow }) => candidateRow);
      const candidateEntries = candidateRows.flatMap((candidateRow) => candidatesForRow(candidateRow).map((candidate) => ({ candidate, candidateRow })));
      const amountCandidates = candidateEntries.map(({ candidate, candidateRow }) => {
        const scored = scoredCandidate(candidateRow, candidate, 'amount');
        if (scored) {
          const verticalDistance = Math.abs(candidateRow.y - row.y);
          scored.confidence = Math.max(0, scored.confidence - verticalDistance / 260);
          scored.periodContextScore = periodContextScore(`${row.searchText} ${candidateRow.searchText}`);
          scored.anchorDistance = verticalDistance;
        }
        return scored;
      }).filter(Boolean);
      const rateCandidates = candidateEntries.map(({ candidate, candidateRow }) => {
        const scored = scoredCandidate(candidateRow, candidate, 'rate');
        if (scored) {
          const verticalDistance = Math.abs(candidateRow.y - row.y);
          scored.confidence = Math.max(0, scored.confidence - verticalDistance / 260);
          scored.periodContextScore = periodContextScore(`${row.searchText} ${candidateRow.searchText}`);
          scored.anchorDistance = verticalDistance;
        }
        return scored;
      }).filter(Boolean);
      amountCandidates.sort((a, b) => b.confidence - a.confidence);
      rateCandidates.sort((a, b) => b.confidence - a.confidence);
      matches.push({
        aliasId: alias.id, page: row.page, rowId: row.id, rowText: row.searchText,
        amount: amountCandidates[0] || null,
        rate: rateCandidates[0] || null,
        amountCandidates,
        rateCandidates,
      });
    }
    matches.sort((a, b) => Math.max(b.amount?.confidence || 0, b.rate?.confidence || 0) - Math.max(a.amount?.confidence || 0, a.rate?.confidence || 0));
    return matches;
  }

  function bestRowValues(rows, fieldName) {
    return allRowValues(rows, fieldName)[0] || null;
  }

  function periodContextScore(text) {
    const value = normalizeSearchText(text);
    if (/(?:שנתי|שנתית|מצטבר|מתחילת השנה|annual|yearly|ytd)/.test(value)) return -1.8;
    if (/(?:חודשי|לחודש|monthly|current month)/.test(value)) return 0.45;
    return 0;
  }

  function contributionOptions(rows, fieldName) {
    const options = [];
    for (const match of allRowValues(rows, fieldName)) {
      const amounts = match.amountCandidates.slice(0, 5);
      const rates = match.rateCandidates.slice(0, 4);
      for (const amount of amounts) options.push({ amount, rate: null, match, unaryScore: amount.confidence + amount.periodContextScore });
      for (const rate of rates) options.push({ amount: null, rate, match, unaryScore: rate.confidence * (rate.explicitRate ? 1 : 0.92) + rate.periodContextScore });
      for (const amount of amounts) {
        for (const rate of rates) {
          if (amount.id === rate.id) continue;
          const sameRow = amount.rowId === rate.rowId;
          options.push({
            amount,
            rate,
            match,
            unaryScore: amount.confidence + rate.confidence + amount.periodContextScore + rate.periodContextScore + (sameRow ? 0.2 : 0),
          });
        }
      }
    }
    const unique = new Map();
    for (const option of options) {
      const key = `${option.amount?.id || '-'}|${option.rate?.id || '-'}|${option.match.aliasId}`;
      if (!unique.has(key) || unique.get(key).unaryScore < option.unaryScore) unique.set(key, option);
    }
    return [...unique.values()].sort((a, b) => b.unaryScore - a.unaryScore).slice(0, 10).concat([null]);
  }

  function salaryOptions(rows) {
    const output = [];
    for (const match of allRowValues(rows, 'insuredSalary')) {
      for (const amount of match.amountCandidates.slice(0, 8)) {
        if (!Number.isFinite(amount.value) || amount.value <= 0) continue;
        output.push({ amount, match, unaryScore: amount.confidence * 2 + amount.periodContextScore });
      }
    }
    const unique = new Map();
    for (const option of output) {
      if (!unique.has(option.amount.id) || unique.get(option.amount.id).unaryScore < option.unaryScore) unique.set(option.amount.id, option);
    }
    return [...unique.values()].sort((a, b) => b.unaryScore - a.unaryScore).slice(0, 10);
  }

  function evaluateTuple(salary, roles) {
    const salaryValue = salary.amount.value;
    if (!Number.isFinite(salaryValue) || salaryValue <= 0) return null;
    let score = salary.unaryScore;
    let directFields = 1;
    const used = new Set([salary.amount.id]);
    const selected = {};
    let contributionTotal = 0;

    for (const [roleName, option] of Object.entries(roles)) {
      if (!option) { selected[roleName] = null; continue; }
      const ids = [option.amount?.id, option.rate?.id].filter(Boolean);
      if (ids.some((id) => used.has(id))) return null;
      ids.forEach((id) => used.add(id));
      let roleScore = option.unaryScore;
      const amount = option.amount?.value;
      const rate = option.rate?.value;
      if (amount != null) {
        if (!Number.isFinite(amount) || amount <= 0 || amount >= salaryValue) return null;
        const derivedRate = amount / salaryValue;
        if (derivedRate <= 0 || derivedRate > 0.35) return null;
        contributionTotal += amount;
        directFields += 1;
        if (rate == null) roleScore += 0.65;
      }
      if (rate != null) {
        if (!Number.isFinite(rate) || rate <= 0 || rate > 0.35) return null;
        directFields += 1;
        if (amount == null) roleScore += 0.45;
      }
      let validation = 'single-observation';
      if (amount != null && rate != null) {
        const derivedRate = amount / salaryValue;
        if (F.approximatelyEqual(rate, derivedRate, 0.00075, 0.02)) {
          roleScore += 1.35;
          validation = 'amount-rate-agree';
        } else {
          roleScore -= 2.75;
          validation = 'amount-rate-conflict';
        }
      }
      score += roleScore;
      selected[roleName] = { ...option, validation };
    }
    if (contributionTotal >= salaryValue * 0.65) return null;
    score += directFields * 0.12;
    return { salary, roles: selected, score, directFields };
  }

  function selectGlobalTuple(rows) {
    const salaries = salaryOptions(rows);
    if (!salaries.length) return null;
    const choices = {
      employee: contributionOptions(rows, 'employeeContribution'),
      employer: contributionOptions(rows, 'employerContribution'),
      severance: contributionOptions(rows, 'severanceContribution'),
    };
    const solutions = [];
    for (const salary of salaries) {
      for (const employee of choices.employee) {
        for (const employer of choices.employer) {
          for (const severance of choices.severance) {
            const solution = evaluateTuple(salary, { employee, employer, severance });
            if (solution) solutions.push(solution);
          }
        }
      }
    }
    solutions.sort((a, b) => b.score - a.score || b.directFields - a.directFields);
    const best = solutions[0] || null;
    if (!best) return null;
    const alternativeSalary = solutions.find((item) => item.salary.amount.id !== best.salary.amount.id);
    best.ambiguousSalary = Boolean(alternativeSalary && best.score - alternativeSalary.score < 0.22 &&
      !F.approximatelyEqual(best.salary.amount.value, alternativeSalary.salary.amount.value, 2, 0.025));
    best.candidateCounts = {
      salaries: salaries.length,
      employee: Math.max(0, choices.employee.length - 1),
      employer: Math.max(0, choices.employer.length - 1),
      severance: Math.max(0, choices.severance.length - 1),
      evaluatedSolutions: solutions.length,
    };
    return best;
  }

  function hasRejectedConflict(rows, fieldName, salaryValue, selected) {
    if (!selected || !Number.isFinite(salaryValue) || salaryValue <= 0) return false;
    if (selected.amount && selected.rate && selected.validation === 'amount-rate-agree') return false;
    for (const match of allRowValues(rows, fieldName)) {
      for (const amount of match.amountCandidates.slice(0, 5)) {
        for (const rate of match.rateCandidates.slice(0, 4)) {
          if (amount.id === rate.id) continue;
          const touchesSelection = amount.id === selected.amount?.id || rate.id === selected.rate?.id;
          if (!touchesSelection) continue;
          if (!F.approximatelyEqual(rate.value, amount.value / salaryValue, 0.00075, 0.02)) return true;
        }
      }
    }
    return false;
  }

  function directResult(candidate, aliasMatch, method, unit) {
    if (!candidate) return null;
    return {
      value: candidate.value,
      unit,
      origin: 'direct',
      confidence: Math.max(0, Math.min(1, candidate.confidence * (method === 'ocr' ? 0.94 : 1))),
      requiresConfirmation: method === 'ocr',
      evidence: {
        aliasId: aliasMatch.aliasId,
        page: aliasMatch.page,
        method,
        candidateId: candidate.id,
        selection: 'global-coherent-tuple',
        validation: 'not-checked',
      },
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

  const PERIOD_PATTERN = /(^|[^\d])(0?[1-9]|1[0-2])[\/\.\-](20\d{2})(?!\d)/g;
  const POSITIVE_PERIOD_CONTEXT = /(?:חודש שכר|חודש משכורת|תקופת שכר|לתקופה|חודש עבודה|payroll month|pay period|salary month|period)/;
  const NEGATIVE_PERIOD_CONTEXT = /(?:תחילת עבודה|תאריך תחילת עבודה|ותק|תאריך לידה|birth(?:\s+date)?|date of birth|printed|printing|generated|document date|הודפס|הפקה)/;

  function periodCandidates(rows, text) {
    const sourceRows = rows.length ? rows : buildRows(tokensFromInput(String(text || '')));
    const candidates = [];
    sourceRows.forEach((row, rowIndex) => {
      const rowText = normalizeSearchText(row.directText);
      PERIOD_PATTERN.lastIndex = 0;
      let match;
      while ((match = PERIOD_PATTERN.exec(rowText))) {
        const value = `${String(match[2]).padStart(2, '0')}/${match[3]}`;
        const nearby = sourceRows.map((nearRow, nearIndex) => ({ nearRow, nearIndex }))
          .filter(({ nearRow, nearIndex }) => nearRow.page === row.page &&
            (Math.abs(nearRow.y - row.y) <= 72 || Math.abs(nearIndex - rowIndex) <= 2))
          .sort((left, right) => Math.abs(left.nearRow.y - row.y) - Math.abs(right.nearRow.y - row.y))
          .slice(0, 5);
        let score = 0.2;
        let positive = false;
        let negative = false;
        for (const { nearRow } of nearby) {
          const context = nearRow.searchText;
          const distance = Math.abs(nearRow.y - row.y);
          if (POSITIVE_PERIOD_CONTEXT.test(context)) {
            score += nearRow.id === row.id ? 3.1 : Math.max(0.12, 0.55 - distance / 180);
            if (nearRow.id === row.id) positive = true;
          }
          if (NEGATIVE_PERIOD_CONTEXT.test(context)) {
            score -= nearRow.id === row.id ? 2.8 : Math.max(0.12, 0.5 - distance / 180);
            if (nearRow.id === row.id) negative = true;
          }
        }
        candidates.push({ value, page: row.page, rowId: row.id, score, positive, negative });
      }
    });
    const grouped = new Map();
    for (const candidate of candidates) {
      const existing = grouped.get(candidate.value);
      if (!existing || candidate.score > existing.score) grouped.set(candidate.value, candidate);
    }
    return [...grouped.values()].sort((a, b) => b.score - a.score);
  }

  function selectPayslipPeriod(rows, text, method) {
    const candidates = periodCandidates(rows, text);
    if (!candidates.length) return null;
    const best = candidates[0];
    const runnerUp = candidates[1];
    const margin = runnerUp ? best.score - runnerUp.score : Infinity;
    const clearlySupported = best.positive && !best.negative && (!runnerUp || margin >= 0.75);
    const genuinelyAmbiguous = Boolean(runnerUp && margin < 0.75);
    let confidence = clearlySupported ? (method === 'ocr' ? 0.86 : 0.97) : 0.58;
    if (genuinelyAmbiguous) confidence = Math.min(confidence, 0.68);
    return { ...best, confidence, candidates, clearlySupported, genuinelyAmbiguous };
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
    const grossMatch = bestRowValues(rows, 'grossSalary');
    const solution = selectGlobalTuple(rows);

    if (solution) {
      fields.insuredSalary = directResult(solution.salary.amount, solution.salary.match, method, 'ILS');
      fields.insuredSalary.evidence.globalScore = Number(solution.score.toFixed(4));
      fields.insuredSalary.evidence.candidateCounts = solution.candidateCounts;
      if (solution.ambiguousSalary) {
        fields.insuredSalary.confidence = Math.max(0, fields.insuredSalary.confidence - 0.12);
        fields.insuredSalary.requiresConfirmation = true;
        fields.insuredSalary.evidence.alternativesDetected = true;
        fields.insuredSalary.evidence.validation = 'ambiguous-salary-candidates';
      }
    }
    if (grossMatch) fields.grossSalary = directResult(grossMatch.amount, grossMatch, method, 'ILS');
    const roleMappings = [
      ['employee', 'employeeContributionAmount', 'employeeContributionRate'],
      ['employer', 'employerContributionAmount', 'employerContributionRate'],
      ['severance', 'severanceContributionAmount', 'severanceRate'],
    ];
    for (const [roleName, amountName, rateName] of roleMappings) {
      const selected = solution && solution.roles[roleName];
      if (!selected) continue;
      if (selected.amount) fields[amountName] = directResult(selected.amount, selected.match, method, 'ILS');
      if (selected.rate) fields[rateName] = directResult(selected.rate, selected.match, method, 'ratio');
      for (const name of [amountName, rateName]) {
        if (!fields[name]) continue;
        fields[name].evidence.validation = selected.validation;
        if (selected.validation === 'amount-rate-conflict') {
          fields[name].confidence = Math.max(0, fields[name].confidence - 0.18);
          fields[name].requiresConfirmation = true;
          fields[name].evidence.alternativesDetected = true;
        }
      }
    }
    Object.keys(fields).forEach((name) => { if (!fields[name]) delete fields[name]; });

    crossValidate(fields, 'employeeContributionAmount', 'employeeContributionRate', method);
    crossValidate(fields, 'employerContributionAmount', 'employerContributionRate', method);
    crossValidate(fields, 'severanceContributionAmount', 'severanceRate', method);

    if (solution && fields.insuredSalary) {
      const conflictMappings = [
        ['employee', 'employeeContribution', 'employeeContributionAmount', 'employeeContributionRate'],
        ['employer', 'employerContribution', 'employerContributionAmount', 'employerContributionRate'],
        ['severance', 'severanceContribution', 'severanceContributionAmount', 'severanceRate'],
      ];
      for (const [roleName, parserField, amountName, rateName] of conflictMappings) {
        if (!hasRejectedConflict(rows, parserField, fields.insuredSalary.value, solution.roles[roleName])) continue;
        for (const name of [amountName, rateName]) {
          if (!fields[name]) continue;
          fields[name].confidence = Math.max(0, fields[name].confidence - 0.08);
          fields[name].requiresConfirmation = true;
          fields[name].evidence = { ...fields[name].evidence, validation: 'amount-rate-conflict', rejectedAlternative: true, alternativesDetected: true };
        }
      }
    }

    const combinedText = typeof input === 'string' ? input : (input && input.text) || rows.map((row) => row.directText).join('\n');
    const period = selectPayslipPeriod(rows, combinedText, method);
    const month = period?.value || null;
    const monthConfidence = period?.confidence || 0;
    if (month) fields.payslipMonth = {
      value: month, unit: 'month', origin: 'direct', confidence: monthConfidence, sourceDate: month,
      requiresConfirmation: !period.clearlySupported, evidence: {
        aliasId: 'month-pattern', page: period.page, method,
        validation: period.clearlySupported ? 'semantic-period-context' : 'ambiguous-period-context',
        sourceDateConfidence: monthConfidence, candidateCount: period.candidates.length,
      },
    };
    if (month) Object.entries(fields).forEach(([name, item]) => {
      if (name === 'payslipMonth' || !item) return;
      item.sourceDate = month;
      item.evidence = { ...item.evidence, sourceDate: month, sourceDateConfidence: monthConfidence };
    });

    const contributionFields = ['employeeContributionAmount', 'employeeContributionRate', 'employerContributionAmount', 'employerContributionRate', 'severanceContributionAmount', 'severanceRate'];
    const output = {
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
    if (!output.hasCriticalFields && typeof input !== 'string' && typeof input?.text === 'string' && input.text.trim() && tokens.length) {
      const fallback = parsePayslip(input.text, options);
      if (fallback.hasCriticalFields) {
        Object.values(fallback.fields).forEach((item) => {
          if (item?.evidence) item.evidence = { ...item.evidence, observationStream: 'flattened-text-fallback' };
        });
        fallback.diagnostics = fallback.diagnostics.map((item) => ({ ...item, observationStream: 'flattened-text-fallback' }));
        return fallback;
      }
    }
    return output;
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
