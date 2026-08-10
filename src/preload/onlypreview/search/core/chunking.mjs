import { createHash } from 'node:crypto';

import { CONTENT_CHUNK_OPTIONS } from './constants.mjs';
import { normalizeSearchText } from './normalization.mjs';

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const hashText = (value) => createHash('sha256').update(value).digest('hex');

const hashGrapheme = (grapheme) => {
  let hash = 2166136261;
  for (const codePoint of grapheme) {
    hash ^= codePoint.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const multiplyUint32 = (left, right) => Math.imul(left, right) >>> 0;

const powerUint32 = (base, exponent) => {
  let result = 1;
  let factor = base >>> 0;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining & 1) result = multiplyUint32(result, factor);
    factor = multiplyUint32(factor, factor);
    remaining = Math.floor(remaining / 2);
  }
  return result >>> 0;
};

const createRollingAnchor = (windowSize) => {
  const base = 257;
  const removalFactor = powerUint32(base, windowSize);
  const values = [];
  let hash = 0;
  return (grapheme) => {
    const value = hashGrapheme(grapheme);
    hash = (multiplyUint32(hash, base) + value) >>> 0;
    values.push(value);
    if (values.length > windowSize) {
      const removed = values.shift();
      hash = (hash - multiplyUint32(removed, removalFactor)) >>> 0;
    }
    return hash;
  };
};

const appendRightOverlap = (graphemes, coreEnd, budget) => {
  const overlap = [];
  let codePointCount = 0;
  for (let index = coreEnd; index < graphemes.length && codePointCount < budget; index += 1) {
    overlap.push(graphemes[index]);
    codePointCount += [...normalizeSearchText(graphemes[index])].length;
  }
  return overlap.join('');
};

export const splitContentDefinedChunks = (sourceValue, options = {}) => {
  const source = String(sourceValue ?? '');
  const resolved = { ...CONTENT_CHUNK_OPTIONS, ...options };
  const graphemes = [...segmenter.segment(source)].map(({ segment }) => segment);
  if (graphemes.length === 0) return [];
  const nextAnchor = createRollingAnchor(resolved.rollingWindowGraphemes);
  const divisor = Math.max(1, resolved.targetGraphemes - resolved.minGraphemes);
  const boundaries = [];
  let chunkStart = 0;
  for (let index = 0; index < graphemes.length; index += 1) {
    const chunkLength = index + 1 - chunkStart;
    const anchored = chunkLength >= resolved.minGraphemes && nextAnchor(graphemes[index]) % divisor === 0;
    if (anchored || chunkLength >= resolved.maxGraphemes) {
      boundaries.push([chunkStart, index + 1]);
      chunkStart = index + 1;
    }
  }
  if (chunkStart < graphemes.length) boundaries.push([chunkStart, graphemes.length]);
  return boundaries.map(([coreStart, coreEnd], ordinal) => {
    const text = graphemes.slice(coreStart, coreEnd).join('');
    const leftContextText = graphemes
      .slice(Math.max(0, coreStart - resolved.leftContextGraphemes), coreStart)
      .join('');
    const rightOverlapText = appendRightOverlap(
      graphemes,
      coreEnd,
      resolved.rightOverlapCodePoints,
    );
    const normalizedCore = normalizeSearchText(text);
    return {
      ordinal,
      text,
      hash: hashText(text),
      leftContextText,
      rightOverlapText,
      normalizedSearchableText: normalizeSearchText(`${text}${rightOverlapText}`),
      normalizedCoreLength: normalizedCore.length,
    };
  });
};
