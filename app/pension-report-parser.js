(function (root) {
  'use strict';

  const F = root.PensionFinancial;
  if (!F) throw new Error('PensionFinancial must be loaded before PensionReportParser.');

  const ALIASES = Object.freeze({
    closingBalance: Object.freeze(['יתרת הכספים בקרן בסוף תקופת הדיווח', 'יתרה בסוף תקופת הדיווח', 'יתרה בסוף השנה', 'יתרה לסוף תקופה', 'יתרה נוכחית', 'closing balance', 'current balance']),
    openingBalance: Object.freeze(['יתרה בתחילת תקופת הדיווח', 'יתרת פתיחה', 'opening balance', 'beginning balance']),
    personalFees: Object.freeze(['דמי ניהול אישיים', 'דמי הניהול שנגבו ממך', 'דמי ניהול שנגבו מהעמית', 'personal management fees']),
    fundAverage: Object.freeze(['ממוצע דמי ניהול בקרן', 'דמי ניהול ממוצעים', 'fund average', 'average management fees']),
    depositFee: Object.freeze(['דמי ניהול מהפקדה', 'מהפקדה', 'deposit fee']),
    balanceFee: Object.freeze(['דמי ניהול מחיסכון', 'דמי ניהול מצבירה', 'מחיסכון', 'מצבירה', 'balance fee']),
    provider: Object.freeze(['שם הגוף המוסדי', 'שם הקרן', 'שם קופת הגמל', 'pension provider', 'fund provider', 'institution name', 'provider name']),
  });

  const CONTRIBUTION_HEADERS = Object.freeze({
    employerName: Object.freeze(['שם מעסיק', 'שם המעסיק', 'employer name']),
    depositDate: Object.freeze(['תאריך הפקדה', 'מועד הפקדה', 'deposit date']),
    salaryMonth: Object.freeze(['עבור חודש משכורת', 'חודש משכורת', 'חודש שכר', 'salary month', 'payroll month']),
    reportedSalary: Object.freeze(['שכר מדווח לפנסיה', 'שכר לפנסיה', 'משכורת', 'שכר מדווח', 'pensionable salary', 'reported salary']),
    employeeContribution: Object.freeze(['תגמולי עובד', 'הפקדת עובד', 'employee contribution', 'employee']),
    employerContribution: Object.freeze(['תגמולי מעסיק', 'הפקדת מעסיק', 'employer contribution']),
    severanceContribution: Object.freeze(['פיצויים', 'הפקדת פיצויים', 'severance']),
    totalContribution: Object.freeze(['סה״כ הפקדות', 'סה"כ הפקדות', 'סהכ הפקדות', 'סה״כ', 'סה"כ', 'סהכ', 'total contributions', 'total']),
  });

  const NUMERIC_CONTRIBUTION_FIELDS = Object.freeze([
    'reportedSalary', 'employeeContribution', 'employerContribution', 'severanceContribution', 'totalContribution',
  ]);
  const SUMMARY_PATTERN = /(?:שנתי|שנתית|מצטבר|מתחילת\s*השנה|סיכום|annual|yearly|ytd|year\s*to\s*date|summary)/i;
  const CLOSING_BALANCE_ALIASES = Object.freeze([...ALIASES.closingBalance, 'יתרה/ערך נצבר', 'ערך נצבר', 'accumulated value']);

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
      if (typeof node.text === 'string' && node.bbox && !node.words && !node.lines && !node.paragraphs) words.push(node);
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
    const rawConfidence = Number(token.confidence);
    const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence)) : 0.92;
    return { text: String(token.text).trim(), x, y, width, height, confidence, page: Number(token.page || pageNumber || 1) };
  }

  function tokensFromInput(input) {
    if (typeof input === 'string') {
      return input.split(/[\r\n]+/).filter((line) => line.trim()).map((text, index) => ({
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

  function normalized(value) { return normalizeSearchText(value); }
  function containsAlias(text, aliases) { const value = normalized(text); return aliases.some((alias) => value.includes(normalized(alias))); }
  function rowsFromInput(input) { return buildRows(tokensFromInput(input)); }
  function rowText(row) { return `${row.directText} ${row.reverseText}`; }
  function nearbyRows(rows, index, radius = 2) { return rows.slice(Math.max(0, index - radius), Math.min(rows.length, index + radius + 1)); }
  function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
  function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }

  function amountFragments(text) {
    return String(text || '').match(/[-−]?[\dOoIl|]+(?:[.,][\dOoIl|]+)*/g) || [];
  }

  function dateMatches(text) {
    const source = String(text || '');
    const full = [...source.matchAll(/\b([0-3]?\d)[/.\-](0?[1-9]|1[0-2])[/.\-](20\d{2})\b/g)].map((match) => ({
      raw: match[0], display: `${String(match[1]).padStart(2, '0')}/${String(match[2]).padStart(2, '0')}/${match[3]}`,
      monthDisplay: `${String(match[2]).padStart(2, '0')}/${match[3]}`, key: Number(match[3]) * 12 + Number(match[2]), full: true, index: match.index,
    }));
    const scrubbed = [...source];
    full.forEach((item) => { for (let index = item.index; index < item.index + item.raw.length; index += 1) scrubbed[index] = ' '; });
    const month = [...scrubbed.join('').matchAll(/\b(0?[1-9]|1[0-2])[/.\-](20\d{2})\b/g)].map((match) => ({
      raw: match[0], display: `${String(match[1]).padStart(2, '0')}/${match[2]}`, monthDisplay: `${String(match[1]).padStart(2, '0')}/${match[2]}`,
      key: Number(match[2]) * 12 + Number(match[1]), full: false, index: match.index,
    }));
    return [...full, ...month].sort((a, b) => a.index - b.index);
  }

  function parseDate(value) {
    const matches = dateMatches(value);
    if (!matches.length) return null;
    const match = matches[0];
    return { display: match.display, key: match.key * 31 + (match.full ? Number(match.display.slice(0, 2)) : 0) };
  }

  function isDateComponent(raw, text) {
    const value = String(raw || '').replace(/^0+/, '');
    return dateMatches(text).some((date) => date.raw.split(/[/.\-]/).some((part) => value === part.replace(/^0+/, '')));
  }

  function percentageMatches(text) {
    return [...String(text || '').matchAll(/[\dOoIl|]+(?:[.,][\dOoIl|]+)?\s*%/g)].map((match) => ({ raw: match[0], index: match.index }));
  }

  function field(value, unit, origin, confidence, evidence) {
    return { value, unit, origin, confidence, requiresConfirmation: confidence < 0.9, sourceDate: evidence?.salaryMonth || null, evidence };
  }

  const PROVIDER_STOP_ALIASES = Object.freeze([
    'שם העמית', 'גיל פרישה', 'מספר עמית', 'member name', 'retirement age', 'member id',
    'דמי ניהול', 'מהפקדה', 'מחיסכון', 'מצבירה', 'annual report', 'quarterly report',
    'report period', 'תקופת הדיווח', 'תאריך הדוח', 'date of report',
  ]);
  const PROVIDER_REJECT_ALIASES = Object.freeze([
    ...ALIASES.closingBalance, ...ALIASES.openingBalance, ...ALIASES.personalFees, ...ALIASES.fundAverage,
    ...ALIASES.depositFee, ...ALIASES.balanceFee, ...PROVIDER_STOP_ALIASES, 'מסלול השקעה', 'investment track',
    'מסלול', 'track', 'הפקדות', 'contributions', 'שכר', 'salary', 'תאריך', 'date', 'תקופה', 'period',
    'טבלה', 'table', 'דוח', 'report', 'סיכום', 'summary', 'פרטי העמית', 'member details',
  ]);

  function looksLikeProviderRejectRow(value) {
    const text = String(value || '');
    if (/(?:\d[\d.,]*\s*%?|\b(?:[0-3]?\d)[/.\-](?:0?[1-9]|1[0-2])[/.-]20\d{2}\b|\b(?:0?[1-9]|1[0-2])[/.-]20\d{2}\b)/.test(text)) return true;
    return PROVIDER_REJECT_ALIASES.some((alias) => normalized(text).includes(normalized(alias)));
  }

  function cleanProviderCandidate(value) {
    let candidate = String(value || '').replace(/^[\s:|;,\-–—]+|[\s:|;,\-–—]+$/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    const stop = PROVIDER_STOP_ALIASES.map((alias) => normalized(alias)).filter(Boolean).sort((a, b) => b.length - a.length);
    const normalizedCandidate = normalized(candidate);
    for (const marker of stop) {
      const index = normalizedCandidate.indexOf(marker);
      if (index >= 0) candidate = candidate.slice(0, index).trim();
    }
    candidate = candidate.replace(/^[\s:|;,\-–—]+|[\s:|;,\-–—]+$/g, '').replace(/\s+/g, ' ').trim();
    if (candidate.length < 3 || !/[\u0590-\u05ffa-z]/i.test(candidate)) return null;
    if (containsAlias(candidate, ALIASES.provider) || containsAlias(candidate, PROVIDER_STOP_ALIASES) || looksLikeProviderRejectRow(candidate)) return null;
    return candidate;
  }

  function providerCandidateAfterLabel(text, alias) {
    const source = String(text || '');
    const lower = source.toLocaleLowerCase();
    const position = lower.indexOf(String(alias).toLocaleLowerCase());
    if (position < 0) return null;
    return cleanProviderCandidate(source.slice(position + alias.length)) || cleanProviderCandidate(source.slice(0, position));
  }

  function extractProviderByLabel(rows) {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      for (const source of [row.directText, row.reverseText]) {
        for (const alias of ALIASES.provider) {
          const candidate = providerCandidateAfterLabel(source, alias);
          if (candidate) return { value: candidate, page: row.page, rowId: row.id };
        }
      }
      if (!containsAlias(row.directText, ALIASES.provider)) continue;
      for (const nextRow of rows.slice(index + 1, index + 3)) {
        if (containsAlias(nextRow.directText, ALIASES.provider)) continue;
        if (nextRow.page !== row.page || Math.abs(nextRow.y - row.y) > 54 || looksLikeProviderRejectRow(nextRow.directText)) continue;
        const candidate = cleanProviderCandidate(nextRow.directText);
        if (candidate) return { value: candidate, page: nextRow.page, rowId: nextRow.id };
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
      nearbyRows(rows, index, 1).forEach((candidateRow) => amountFragments(rowText(candidateRow)).filter((raw) => !isDateComponent(raw, rowText(candidateRow))).forEach((raw) => {
        const parsed = F.normalizeFinancialValue(raw, { kind: 'amount' });
        if (parsed.value >= 100 && parsed.value <= 100000000) candidates.push({ value: parsed.value, score: candidateRow === row ? 1 : 0.84, page: row.page, rowId: candidateRow.id, raw });
      }));
    });
    candidates.sort((a, b) => b.score - a.score || b.value - a.value);
    return candidates[0] || null;
  }

  function geometryDistance(left, right) {
    if (!left || !right || left.page !== right.page) return Infinity;
    const leftX = left.x + (left.width || 0) / 2;
    const rightX = right.x + (right.width || 0) / 2;
    return Math.abs(leftX - rightX) + Math.abs(left.y - right.y) * 2.4;
  }

  function extractFeesByGeometry(rows) {
    const tokenCount = rows.reduce((sum, row) => sum + row.tokens.length, 0);
    if (tokenCount <= rows.length) return {};
    const tokens = rows.flatMap((row) => row.tokens.map((token, index) => ({ ...token, tokenId: `${row.id}-t${index}`, row })));
    const anchors = {
      depositManagementFeeRate: tokens.filter((token) => containsAlias(token.text, ALIASES.depositFee)),
      balanceManagementFeeRate: tokens.filter((token) => containsAlias(token.text, ALIASES.balanceFee)),
    };
    const personalHeaders = tokens.filter((token) => containsAlias(token.text, ALIASES.personalFees));
    const averageHeaders = tokens.filter((token) => containsAlias(token.text, ALIASES.fundAverage));
    const candidates = { depositManagementFeeRate: [], balanceManagementFeeRate: [] };

    for (const token of tokens) {
      const percentages = percentageMatches(token.text);
      percentages.forEach(({ raw }, fragmentIndex) => {
        const parsed = F.normalizeFinancialValue(raw, { kind: 'rate' });
        if (parsed.value == null || parsed.value < 0 || parsed.value > 0.2) return;
        for (const fieldName of Object.keys(anchors)) {
          const nearestAnchor = anchors[fieldName].slice().sort((a, b) => geometryDistance(token, a) - geometryDistance(token, b))[0];
          const anchorDistance = geometryDistance(token, nearestAnchor);
          if (!nearestAnchor || anchorDistance > 420) continue;
          let score = 3.2 - anchorDistance / 170;
          if (nearestAnchor.tokenId === token.tokenId) score += 2.2;
          if (containsAlias(token.text, ALIASES.personalFees) || containsAlias(nearestAnchor.text, ALIASES.personalFees)) score += 1.2;
          if (containsAlias(token.text, ALIASES.fundAverage) || containsAlias(nearestAnchor.text, ALIASES.fundAverage)) score -= 2.5;
          const personalDistance = personalHeaders.length ? Math.min(...personalHeaders.map((header) => geometryDistance(token, header))) : Infinity;
          const averageDistance = averageHeaders.length ? Math.min(...averageHeaders.map((header) => geometryDistance(token, header))) : Infinity;
          if (personalDistance + 30 < averageDistance) score += 1;
          else if (averageDistance + 30 < personalDistance) score -= 1.8;
          candidates[fieldName].push({
            id: `${token.tokenId}-fee${fragmentIndex}`,
            value: parsed.value,
            page: token.page,
            rowId: token.row.id,
            raw,
            score,
            spatialDistance: anchorDistance,
          });
        }
      });
    }

    const deposit = candidates.depositManagementFeeRate.sort((a, b) => b.score - a.score);
    const balance = candidates.balanceManagementFeeRate.sort((a, b) => b.score - a.score);
    let bestPair = null;
    for (const depositCandidate of deposit.concat([null])) {
      for (const balanceCandidate of balance.concat([null])) {
        if (depositCandidate && balanceCandidate && depositCandidate.id === balanceCandidate.id) continue;
        const score = (depositCandidate?.score || 0) + (balanceCandidate?.score || 0);
        if (!bestPair || score > bestPair.score) bestPair = { depositCandidate, balanceCandidate, score };
      }
    }
    const output = {};
    if (bestPair?.depositCandidate && bestPair.depositCandidate.score > 0.5) output.depositManagementFeeRate = bestPair.depositCandidate;
    if (bestPair?.balanceCandidate && bestPair.balanceCandidate.score > 0.5) output.balanceManagementFeeRate = bestPair.balanceCandidate;
    return output;
  }

  function extractFees(rows) {
    const geometricOutput = extractFeesByGeometry(rows);
    if (geometricOutput.depositManagementFeeRate && geometricOutput.balanceManagementFeeRate) return geometricOutput;
    const anchors = { depositManagementFeeRate: ALIASES.depositFee, balanceManagementFeeRate: ALIASES.balanceFee };
    const headers = rows.map((row, index) => ({ index, personal: containsAlias(rowText(row), ALIASES.personalFees), average: containsAlias(rowText(row), ALIASES.fundAverage) })).filter((item) => item.personal || item.average);
    const byField = { depositManagementFeeRate: [], balanceManagementFeeRate: [] };

    rows.forEach((row, rowIndex) => {
      const percentages = percentageMatches(row.directText);
      percentages.forEach(({ raw, index: percentageIndex }, fragmentIndex) => {
        const parsed = F.normalizeFinancialValue(raw, { kind: 'rate' });
        if (parsed.value == null || parsed.value < 0 || parsed.value > 0.2) return;
        const nearestHeader = [...headers].sort((a, b) => Math.abs(a.index - rowIndex) - Math.abs(b.index - rowIndex))[0];
        for (const [fieldName, aliases] of Object.entries(anchors)) {
          const matchingRows = rows.map((candidateRow, candidateIndex) => ({ candidateRow, candidateIndex })).filter(({ candidateRow }) => containsAlias(rowText(candidateRow), aliases));
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
            for (const alias of ALIASES.personalFees) { const position = normalized(headerText).indexOf(normalized(alias)); if (position >= 0) headerPositions.push({ position, kind: 'personal' }); }
            for (const alias of ALIASES.fundAverage) { const position = normalized(headerText).indexOf(normalized(alias)); if (position >= 0) headerPositions.push({ position, kind: 'average' }); }
            headerPositions.sort((a, b) => a.position - b.position);
            headerKind = headerPositions[fragmentIndex]?.kind || null;
          }
          if (headerKind === 'personal' || personalPosition > averagePosition) score += 0.9;
          else if (headerKind === 'average' || averagePosition > personalPosition) score -= 1.4;
          else if (nearestHeader && Math.abs(nearestHeader.index - rowIndex) <= 5) score += nearestHeader.personal ? 0.45 : -1.05;
          byField[fieldName].push({ id: `${row.id}-fee${fragmentIndex}`, value: parsed.value, page: row.page, rowId: row.id, raw, score, spatialDistance: rowDistance });
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
    return { ...output, ...geometricOutput };
  }

  function headerFields(row) {
    const found = {};
    for (const [fieldName, aliases] of Object.entries(CONTRIBUTION_HEADERS)) {
      const token = row.tokens.find((item) => containsAlias(item.text, aliases));
      if (token && row.tokens.length > 1) found[fieldName] = { x: token.x + token.width / 2, alias: aliases.find((alias) => containsAlias(token.text, [alias])) || aliases[0] };
      else {
        const source = normalized(row.directText);
        const positions = aliases.map((alias) => ({ alias, index: source.indexOf(normalized(alias)) })).filter((item) => item.index >= 0)
          .sort((a, b) => normalized(b.alias).length - normalized(a.alias).length || a.index - b.index);
        if (positions[0]) found[fieldName] = { x: null, index: positions[0].index, alias: positions[0].alias };
      }
    }
    return found;
  }

  function isContributionHeader(row) {
    const fields = headerFields(row);
    const numericHeaders = NUMERIC_CONTRIBUTION_FIELDS.filter((name) => fields[name]).length;
    return Boolean(fields.salaryMonth && fields.reportedSalary && numericHeaders >= 4);
  }

  function nearestContributionHeader(rows, rowIndex) {
    for (let index = rowIndex - 1; index >= Math.max(0, rowIndex - 10); index -= 1) {
      if (rows[index].page !== rows[rowIndex].page) break;
      if (isContributionHeader(rows[index])) return rows[index];
    }
    return null;
  }

  function numericEntries(row) {
    const entries = [];
    for (const token of row.tokens) {
      for (const raw of amountFragments(token.text)) {
        if (isDateComponent(raw, token.text)) continue;
        const parsed = F.normalizeFinancialValue(raw, { kind: 'amount' });
        if (parsed.value == null) continue;
        entries.push({ value: parsed.value, raw, x: token.x + token.width / 2, confidence: token.confidence, tokenText: token.text });
      }
    }
    return entries;
  }

  function valuesFromHeaderOrder(entries, header) {
    if (!header) return {};
    const fields = headerFields(header);
    const geometric = NUMERIC_CONTRIBUTION_FIELDS.filter((name) => Number.isFinite(fields[name]?.x));
    if (geometric.length >= 4 && new Set(entries.map((entry) => entry.x)).size >= 4) {
      const output = {};
      for (const entry of entries) {
        const availableFields = geometric.filter((fieldName) => output[fieldName] == null)
          .sort((a, b) => Math.abs(entry.x - fields[a].x) - Math.abs(entry.x - fields[b].x));
        if (availableFields[0]) output[availableFields[0]] = entry.value;
      }
      return output;
    }
    const orderedFields = NUMERIC_CONTRIBUTION_FIELDS.filter((name) => Number.isFinite(fields[name]?.index)).sort((a, b) => fields[a].index - fields[b].index);
    if (orderedFields.length >= 4 && entries.length === orderedFields.length) {
      return Object.fromEntries(orderedFields.map((fieldName, index) => [fieldName, entries[index].value]));
    }
    return {};
  }

  function inferContributionValues(entries) {
    const values = entries.map((entry) => entry.value).filter((value) => value >= 0);
    if (values.length < 4) return {};
    const salary = Math.max(...values);
    if (!(salary > 0)) return {};
    const salaryIndex = values.indexOf(salary);
    const after = values.slice(salaryIndex + 1).filter((value) => value >= 0 && value < salary);
    const before = values.slice(0, salaryIndex).filter((value) => value >= 0 && value < salary);
    const side = after.length >= 3 ? after : before.slice().reverse();
    if (side.length < 3) return {};
    let components = side.slice(0, 3);
    let explicitTotal = null;
    if (side.length >= 4) {
      const totalIndex = side.findIndex((candidate, candidateIndex) => {
        const others = side.filter((_, index) => index !== candidateIndex).slice(0, 3);
        return others.length === 3 && F.approximatelyEqual(candidate, others.reduce((sum, value) => sum + value, 0), 3, 0.012);
      });
      if (totalIndex >= 0) {
        explicitTotal = side[totalIndex];
        const withoutTotal = side.filter((_, index) => index !== totalIndex).slice(0, 3);
        components = totalIndex === 0 ? withoutTotal.reverse() : withoutTotal;
      }
    }
    return {
      reportedSalary: salary,
      employeeContribution: components[0],
      employerContribution: components[1],
      severanceContribution: components[2],
      totalContribution: explicitTotal,
    };
  }

  function cleanEmployerName(row) {
    const withoutDates = String(row.directText || '').replace(/\b(?:[0-3]?\d[/.-])?(?:0?[1-9]|1[0-2])[/.-]20\d{2}\b/g, ' ');
    const withoutNumbers = withoutDates.replace(/[-−]?[\dOoIl|]+(?:[.,][\dOoIl|]+)*/g, ' ').replace(/[₪%|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (withoutNumbers.length < 3 || SUMMARY_PATTERN.test(withoutNumbers)) return null;
    return /[\u0590-\u05ffa-z]/i.test(withoutNumbers) ? withoutNumbers : null;
  }

  function normalizeContributionRow(row, values, header, method) {
    const dates = dateMatches(row.directText);
    const salaryMonthDate = dates.find((date) => !date.full) || null;
    if (!salaryMonthDate) return null;
    const depositDate = dates.find((date) => date.full) || null;
    const reportedSalary = finite(values.reportedSalary);
    const employeeContribution = finite(values.employeeContribution);
    const employerContribution = finite(values.employerContribution);
    const severanceContribution = finite(values.severanceContribution);
    const explicitTotal = finite(values.totalContribution);
    const components = [employeeContribution, employerContribution, severanceContribution];
    const presentComponents = components.filter((value) => value != null);
    const componentSum = presentComponents.reduce((sum, value) => sum + value, 0);
    const issues = [];
    let totalContribution = null;
    let totalSource = null;
    let reliable = true;

    if (!(reportedSalary > 0) || reportedSalary > 1000000) { reliable = false; issues.push('INVALID_REPORTED_SALARY'); }
    if (presentComponents.some((value) => value < 0 || (reportedSalary > 0 && value > reportedSalary * 0.35))) { reliable = false; issues.push('IMPLAUSIBLE_COMPONENT'); }
    if (presentComponents.length === 3) {
      if (explicitTotal != null) {
        totalContribution = explicitTotal;
        totalSource = 'explicit';
        if (!F.approximatelyEqual(explicitTotal, componentSum, 3, 0.012)) { reliable = false; issues.push('TOTAL_COMPONENT_MISMATCH'); }
      } else {
        totalContribution = componentSum;
        totalSource = 'components';
      }
    } else if (explicitTotal != null && presentComponents.length >= 1) {
      const impliedRemainder = explicitTotal - componentSum;
      totalContribution = explicitTotal;
      totalSource = 'explicit';
      if (impliedRemainder < -3 || !(reportedSalary > 0) || explicitTotal > reportedSalary * 0.65 || impliedRemainder > reportedSalary * 0.35) {
        reliable = false;
        issues.push('PARTIAL_COMPONENTS_INCONSISTENT_WITH_TOTAL');
      } else {
        issues.push('MISSING_COMPONENT_WITH_EXPLICIT_TOTAL');
      }
    } else {
      reliable = false;
      issues.push('INCOMPLETE_CONTRIBUTION_ROW');
    }
    if (!(totalContribution >= 0) || (reportedSalary > 0 && totalContribution >= reportedSalary * 0.65)) { reliable = false; issues.push('IMPLAUSIBLE_TOTAL'); }

    const tokenConfidence = average(row.tokens.map((token) => Number(token.confidence)).filter(Number.isFinite)) || 0.88;
    const confidence = Math.max(0.5, Math.min(0.99, tokenConfidence + (header ? 0.02 : -0.08) + (reliable ? 0.01 : -0.2)));
    return {
      employerName: cleanEmployerName(row),
      depositDate: depositDate?.display || null,
      salaryMonth: salaryMonthDate.monthDisplay,
      chronologyKey: salaryMonthDate.key,
      reportedSalary,
      pensionableSalary: reportedSalary,
      employeeContribution,
      employerContribution,
      severanceContribution,
      totalContribution,
      totalSource,
      sourcePage: row.page,
      page: row.page,
      confidence,
      reliable,
      requiresReview: !reliable,
      issues: [...new Set(issues)],
      evidence: {
        aliasId: 'contribution-table', rowId: row.id, sourcePage: row.page, method,
        rawText: row.directText, headerRowId: header?.id || null, explicitTotal: explicitTotal != null,
      },
    };
  }

  function parseContributionRows(rowsOrInput, options = {}) {
    const rows = Array.isArray(rowsOrInput) && rowsOrInput.every((item) => item && item.directText != null) ? rowsOrInput : rowsFromInput(rowsOrInput);
    const method = options.method === 'ocr' ? 'ocr' : 'pdf-text';
    const output = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (isContributionHeader(row) || SUMMARY_PATTERN.test(normalized(row.directText))) continue;
      const dates = dateMatches(row.directText);
      if (!dates.some((date) => !date.full)) continue;
      const entries = numericEntries(row);
      if (entries.length < 3) continue;
      const header = nearestContributionHeader(rows, rowIndex);
      const mapped = valuesFromHeaderOrder(entries, header);
      const inferred = Object.keys(mapped).length >= 3 ? mapped : inferContributionValues(entries);
      const normalizedRow = normalizeContributionRow(row, inferred, header, method);
      if (normalizedRow) output.push(normalizedRow);
    }
    return output;
  }

  function sameContributionTuple(left, right) {
    return ['reportedSalary', 'employeeContribution', 'employerContribution', 'severanceContribution', 'totalContribution']
      .every((name) => (left[name] == null && right[name] == null) || F.approximatelyEqual(left[name], right[name], 2, 0.006));
  }

  function aggregateContributionHistory(history) {
    const grouped = new Map();
    for (const row of history) {
      if (!grouped.has(row.salaryMonth)) grouped.set(row.salaryMonth, []);
      grouped.get(row.salaryMonth).push(row);
    }
    const months = [];
    const issues = [];
    for (const [salaryMonth, rawRows] of grouped) {
      const reliableRows = rawRows.filter((row) => row.reliable);
      const unreliableRows = rawRows.filter((row) => !row.reliable);
      if (unreliableRows.length) issues.push({ code: 'UNRELIABLE_CONTRIBUTION_ROW', salaryMonth, sourceRows: unreliableRows.map((row) => row.evidence.rowId) });
      if (!reliableRows.length) {
        rawRows.forEach((row) => { row.normalizationStatus = 'excluded'; });
        continue;
      }

      const byEmployer = new Map();
      for (const row of reliableRows) {
        const key = normalizeSearchText(row.employerName || 'unknown');
        if (!byEmployer.has(key)) byEmployer.set(key, []);
        byEmployer.get(key).push(row);
      }
      let ambiguous = false;
      const selectedRows = [];
      for (const employerRows of byEmployer.values()) {
        if (employerRows.length === 1) { selectedRows.push(employerRows[0]); continue; }
        const allSame = employerRows.every((row) => sameContributionTuple(row, employerRows[0]));
        if (allSame) {
          selectedRows.push(employerRows[0]);
          employerRows.forEach((row, index) => { row.normalizationStatus = index === 0 ? 'duplicate-canonical' : 'duplicate-preserved'; });
        } else {
          ambiguous = true;
          employerRows.forEach((row) => { row.normalizationStatus = 'ambiguous'; row.requiresReview = true; });
        }
      }
      if (ambiguous || (byEmployer.has('unknown') && reliableRows.length > 1 && byEmployer.size > 1)) {
        issues.push({ code: 'AMBIGUOUS_SALARY_MONTH', salaryMonth, sourceRows: reliableRows.map((row) => row.evidence.rowId) });
        reliableRows.forEach((row) => { row.normalizationStatus = 'ambiguous'; row.requiresReview = true; });
        continue;
      }

      const sumOrNull = (name) => selectedRows.every((row) => row[name] != null) ? selectedRows.reduce((sum, row) => sum + row[name], 0) : null;
      const totalContribution = selectedRows.reduce((sum, row) => sum + row.totalContribution, 0);
      const reportedSalary = sumOrNull('reportedSalary');
      const employeeContribution = sumOrNull('employeeContribution');
      const employerContribution = sumOrNull('employerContribution');
      const severanceContribution = sumOrNull('severanceContribution');
      selectedRows.forEach((row) => { if (!row.normalizationStatus) row.normalizationStatus = selectedRows.length > 1 ? 'aggregated' : 'used'; });
      months.push({
        salaryMonth,
        chronologyKey: selectedRows[0].chronologyKey,
        employerNames: selectedRows.map((row) => row.employerName).filter(Boolean),
        reportedSalary,
        employeeContribution,
        employerContribution,
        severanceContribution,
        totalContribution,
        confidence: Math.min(...selectedRows.map((row) => row.confidence)),
        sourceRows: selectedRows.map((row) => row.evidence.rowId),
        sourcePages: [...new Set(selectedRows.map((row) => row.sourcePage))],
        status: 'reliable',
      });
    }
    months.sort((a, b) => a.chronologyKey - b.chronologyKey);
    return { months, issues };
  }

  function deriveContributionBaseline(history) {
    const normalizedHistory = aggregateContributionHistory(history);
    const months = normalizedHistory.months;
    const totals = months.map((month) => month.totalContribution).filter((value) => Number.isFinite(value));
    const salaries = months.map((month) => month.reportedSalary).filter((value) => Number.isFinite(value));
    const monthRate = (month, component) => month.reportedSalary > 0 && month[component] != null ? month[component] / month.reportedSalary : null;
    const rateAverage = (component) => average(months.map((month) => monthRate(month, component)).filter((value) => Number.isFinite(value)));
    return {
      normalizedMonths: months,
      issues: normalizedHistory.issues,
      derived: {
        monthsUsed: totals.length,
        baselineMonthlyContribution: average(totals),
        averageReportedPensionSalary: average(salaries),
        employeeContributionRate: rateAverage('employeeContribution'),
        employerContributionRate: rateAverage('employerContribution'),
        severanceRate: rateAverage('severanceContribution'),
      },
    };
  }

  function detectReportType(text) {
    if (/דוח\s*רבעוני|quarterly\s*report/i.test(text)) return 'quarterly';
    if (/דוח\s*שנתי|annual\s*report/i.test(text)) return 'annual';
    return 'unknown';
  }

  function extractReportDate(rows, allText) {
    const labeled = rows.find((row) => /תאריך\s*הדוח|date\s*of\s*report|report\s*date/i.test(rowText(row)));
    const labeledDate = labeled ? dateMatches(rowText(labeled)).sort((a, b) => Number(b.full) - Number(a.full))[0] : null;
    if (labeledDate) return { display: labeledDate.display, page: labeled.page, rowId: labeled.id, confidence: 0.96 };
    const dates = dateMatches(allText).sort((a, b) => b.key - a.key);
    return dates[0] ? { display: dates[0].display, page: 1, rowId: null, confidence: 0.8 } : null;
  }

  function parsePensionReport(input, options = {}) {
    const method = options.method === 'ocr' ? 'ocr' : 'pdf-text';
    const rows = rowsFromInput(input);
    const fields = {};
    const balance = extractClosingBalance(rows);
    if (balance) fields.currentBalance = field(balance.value, 'ILS', 'direct', balance.score >= 0.95 ? 0.97 : 0.88, { aliasId: 'closing-balance', page: balance.page, rowId: balance.rowId, raw: balance.raw, method });
    const fees = extractFees(rows);
    Object.entries(fees).forEach(([name, item]) => { fields[name] = field(item.value, 'ratio', 'direct', 0.95, { aliasId: name, page: item.page, rowId: item.rowId, raw: item.raw, method }); });
    const provider = extractProviderByLabel(rows);
    if (provider) fields.pensionProvider = field(provider.value, 'text', 'direct', 0.9, { aliasId: 'pension-provider', page: provider.page, rowId: provider.rowId, method });

    const contributionHistory = parseContributionRows(rows, { method });
    const baseline = deriveContributionBaseline(contributionHistory);
    const latest = [...baseline.normalizedMonths].sort((a, b) => b.chronologyKey - a.chronologyKey)[0] || null;
    if (latest) {
      const recent = [...baseline.normalizedMonths].sort((a, b) => b.chronologyKey - a.chronologyKey).slice(0, 6);
      const agreeingRows = recent.filter((month) => ['reportedSalary', 'employeeContribution', 'employerContribution', 'severanceContribution']
        .every((name) => month[name] != null && latest[name] != null && F.approximatelyEqual(month[name], latest[name], 2, 0.012))).length;
      const evidence = {
        aliasId: 'contribution-table', page: latest.sourcePages[0] || null, method, salaryMonth: latest.salaryMonth,
        sourceDateConfidence: 0.96, sourceRows: latest.sourceRows, monthsUsed: baseline.derived.monthsUsed,
        recurringPattern: { recentRows: recent.length, agreeingRows, recurring: agreeingRows >= 2 },
      };
      const confidence = Math.min(0.98, latest.confidence + (baseline.derived.monthsUsed >= 2 ? 0.02 : 0));
      fields.latestReportedPensionableSalary = field(latest.reportedSalary, 'ILS', 'direct', confidence, evidence);
      if (latest.employeeContribution != null) fields.latestEmployeeContributionAmount = field(latest.employeeContribution, 'ILS', 'direct', confidence, evidence);
      if (latest.employerContribution != null) fields.latestEmployerContributionAmount = field(latest.employerContribution, 'ILS', 'direct', confidence, evidence);
      if (latest.severanceContribution != null) fields.latestSeveranceContributionAmount = field(latest.severanceContribution, 'ILS', 'direct', confidence, evidence);
      if (latest.reportedSalary > 0 && latest.employeeContribution != null) fields.latestEmployeeContributionRate = field(latest.employeeContribution / latest.reportedSalary, 'ratio', 'derived', confidence - 0.01, evidence);
      if (latest.reportedSalary > 0 && latest.employerContribution != null) fields.latestEmployerContributionRate = field(latest.employerContribution / latest.reportedSalary, 'ratio', 'derived', confidence - 0.01, evidence);
      if (latest.reportedSalary > 0 && latest.severanceContribution != null) fields.latestSeveranceRate = field(latest.severanceContribution / latest.reportedSalary, 'ratio', 'derived', confidence - 0.01, evidence);
    }

    const allText = typeof input === 'string' ? input : String(input?.text || rows.map((row) => row.directText).join('\n'));
    const reportType = detectReportType(allText);
    const reportDate = extractReportDate(rows, allText);
    if (reportDate) fields.reportDate = field(reportDate.display, 'date', 'direct', reportDate.confidence, { aliasId: 'report-date', page: reportDate.page, rowId: reportDate.rowId, method });
    if (reportDate && fields.currentBalance) fields.balanceDate = field(reportDate.display, 'date', 'derived', Math.min(0.9, reportDate.confidence), { aliasId: 'report-period-end', page: reportDate.page, method });

    const reviewIssues = [...baseline.issues];
    if (fields.currentBalance == null) reviewIssues.push({ code: 'MISSING_CURRENT_BALANCE' });
    if (fields.depositManagementFeeRate == null) reviewIssues.push({ code: 'MISSING_DEPOSIT_FEE' });
    if (fields.balanceManagementFeeRate == null) reviewIssues.push({ code: 'MISSING_BALANCE_FEE' });
    if (!baseline.derived.monthsUsed) reviewIssues.push({ code: 'MISSING_RELIABLE_CONTRIBUTION_MONTH' });
    const pensionReportState = {
      currentBalance: fields.currentBalance?.value ?? null,
      provider: fields.pensionProvider?.value ?? null,
      report: { type: reportType, reportDate: fields.reportDate?.value ?? null, period: fields.balanceDate?.value ?? null },
      fees: { depositRate: fields.depositManagementFeeRate?.value ?? null, balanceRate: fields.balanceManagementFeeRate?.value ?? null },
      contributionHistory,
      normalizedContributionMonths: baseline.normalizedMonths,
      derived: baseline.derived,
      evidence: {
        currentBalance: fields.currentBalance?.evidence ?? null,
        provider: fields.pensionProvider?.evidence ?? null,
        reportDate: fields.reportDate?.evidence ?? null,
        depositFee: fields.depositManagementFeeRate?.evidence ?? null,
        balanceFee: fields.balanceManagementFeeRate?.evidence ?? null,
      },
      review: { requiresReview: reviewIssues.length > 0, issues: reviewIssues },
    };
    return {
      fields,
      contributionHistory,
      normalizedContributionMonths: baseline.normalizedMonths,
      pensionReportState,
      method,
      classification: reportType === 'annual' ? 'ANNUAL_PENSION_REPORT' : reportType === 'quarterly' ? 'QUARTERLY_PENSION_REPORT' : 'PENSION_REPORT',
    };
  }

  function parseManagementFeesFromTokens(input) { return extractFees(rowsFromInput(input)); }

  function countReportAnchors(text) {
    const value = normalized(text);
    return [ALIASES.closingBalance, ALIASES.depositFee, ALIASES.balanceFee, CONTRIBUTION_HEADERS.salaryMonth]
      .filter((aliases) => aliases.some((alias) => value.includes(normalized(alias)))).length;
  }

  root.PensionReportParser = Object.freeze({
    ALIASES,
    CONTRIBUTION_HEADERS,
    normalizeSearchText,
    tokensFromInput,
    buildRows,
    parseDate,
    parseContributionRows,
    aggregateContributionHistory,
    deriveContributionBaseline,
    parsePensionReport,
    parseManagementFeesFromTokens,
    countReportAnchors,
  });
})(typeof window !== 'undefined' ? window : globalThis);
