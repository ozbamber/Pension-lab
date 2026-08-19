(function (root) {
  'use strict';

  const CURRENCY_PATTERN = /(?:₪|ש["״']?ח|ILS)/gi;
  const PERCENT_PATTERN = /%/g;
  const SPACE_PATTERN = /[\s\u00a0\u2007\u202f]+/g;

  function normalizeOcrDigits(input) {
    const text = String(input == null ? '' : input).trim();
    const digitCount = (text.match(/\d/g) || []).length;
    const ambiguousCount = (text.match(/[OoIl|]/g) || []).length;
    if (!digitCount || ambiguousCount > digitCount) return text;
    return text
      .replace(/[Oo]/g, '0')
      .replace(/[Il|]/g, '1');
  }

  function splitSign(text) {
    const negative = /^\s*[-−]/.test(text) || /\(\s*[^)]+\s*\)/.test(text);
    return { negative, unsigned: text.replace(/[()−-]/g, '') };
  }

  function normalizeSeparators(raw, kind) {
    let text = raw.replace(SPACE_PATTERN, '');
    const commaPositions = [...text.matchAll(/,/g)].map((match) => match.index);
    const dotPositions = [...text.matchAll(/\./g)].map((match) => match.index);
    const positions = [...commaPositions, ...dotPositions].sort((a, b) => a - b);
    if (!positions.length) return text;

    const last = positions[positions.length - 1];
    const trailingDigits = text.length - last - 1;
    const separator = text[last];
    const sameSeparatorCount = positions.filter((position) => text[position] === separator).length;
    const hasBoth = commaPositions.length > 0 && dotPositions.length > 0;
    let decimalPosition = -1;
    if (hasBoth && trailingDigits > 0 && trailingDigits <= 2) {
      decimalPosition = last;
    } else if (sameSeparatorCount === 1 && trailingDigits > 0 && trailingDigits <= 2) {
      decimalPosition = last;
    }

    let normalized = '';
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (/\d/.test(character)) normalized += character;
      else if (index === decimalPosition) normalized += '.';
    }
    return normalized;
  }

  function normalizeFinancialValue(input, options = {}) {
    const kind = options.kind === 'rate' ? 'rate' : 'amount';
    const original = String(input == null ? '' : input);
    const hasPercent = /%/.test(original);
    let cleaned = normalizeOcrDigits(original)
      .replace(CURRENCY_PATTERN, '')
      .replace(PERCENT_PATTERN, '')
      .replace(/[^‎\d.,\s\u00a0\u2007\u202f()−-]/g, '')
      .replace(/\u200e/g, '')
      .trim();
    const { negative, unsigned } = splitSign(cleaned);
    cleaned = normalizeSeparators(unsigned, kind);
    if (!cleaned || !/\d/.test(cleaned)) {
      return { value: null, confidence: 0, normalized: null, isPercent: hasPercent, original };
    }
    let numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) {
      return { value: null, confidence: 0, normalized: null, isPercent: hasPercent, original };
    }
    if (negative) numeric *= -1;

    let confidence = 0.96;
    if (/[OoIl|]/.test(original)) confidence -= 0.12;
    if ((original.match(/[,.]/g) || []).length > 2) confidence -= 0.08;
    if (kind === 'rate') {
      if (hasPercent || Math.abs(numeric) > 1) numeric /= 100;
      if (Math.abs(numeric) > 1) confidence -= 0.25;
    }
    if (kind === 'amount' && Math.abs(numeric) > 100000000) confidence -= 0.25;
    return {
      value: numeric,
      confidence: Math.max(0, Math.min(1, confidence)),
      normalized: String(numeric),
      isPercent: hasPercent,
      original,
    };
  }

  function approximatelyEqual(left, right, absoluteTolerance = 0.0005, relativeTolerance = 0.04) {
    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const difference = Math.abs(a - b);
    return difference <= absoluteTolerance || difference <= Math.max(Math.abs(a), Math.abs(b)) * relativeTolerance;
  }

  root.PensionFinancial = Object.freeze({
    normalizeFinancialValue,
    normalizeOcrDigits,
    approximatelyEqual,
  });
})(typeof window !== 'undefined' ? window : globalThis);
