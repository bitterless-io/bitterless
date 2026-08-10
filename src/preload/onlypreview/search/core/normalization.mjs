const CJK_RANGES = [
  [0x2e80, 0x2fff],
  [0x3040, 0x30ff],
  [0x31f0, 0x31ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0x20000, 0x2fa1f],
];

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export const normalizeSearchText = (value) =>
  String(value ?? '').normalize('NFKC').toLocaleLowerCase('und');

export const cleanRelativePath = (value) =>
  String(value ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+|\/+$/gu, '');

export const normalizeRelativePath = (value) =>
  normalizeSearchText(cleanRelativePath(value));

export const filenameFromPath = (value) => {
  const path = cleanRelativePath(value);
  const separatorIndex = path.lastIndexOf('/');
  return separatorIndex < 0 ? path : path.slice(separatorIndex + 1);
};

export const isCjkCodePoint = (codePoint) =>
  CJK_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);

export const isCjkQuery = (query) => {
  const codePoints = [...normalizeSearchText(query)];
  return codePoints.length > 0 && codePoints.every((character) =>
    isCjkCodePoint(character.codePointAt(0)));
};

export const isIndexedShortQuery = (query) => {
  const codePoints = [...normalizeSearchText(query)];
  return codePoints.length > 0 && codePoints.length <= 2 &&
    codePoints.some((character) => character.codePointAt(0) > 0x7f);
};

export const extractCjkPostingTokens = (value) => {
  const tokens = new Set();
  const codePoints = [...normalizeSearchText(value)];
  for (let index = 0; index < codePoints.length; index += 1) {
    const current = codePoints[index];
    const next = codePoints[index + 1];
    const currentNonAscii = current.codePointAt(0) > 0x7f;
    const nextNonAscii = next?.codePointAt(0) > 0x7f;
    if (currentNonAscii) tokens.add(current);
    if (next !== undefined && (currentNonAscii || nextNonAscii)) {
      tokens.add(`${current}${next}`);
    }
  }
  return [...tokens];
};

const projectDirectLiteralMatch = (source, normalizedQuery, normalizedMatchIndex) => {
  let rawMatchIndex = source.indexOf(normalizedQuery);
  if (rawMatchIndex < 0 || source.length === 0) return undefined;
  const segments = graphemeSegmenter.segment(source);
  let firstMatch;
  let normalizedOffset;
  while (rawMatchIndex >= 0) {
    const segment = segments.containing(rawMatchIndex);
    if (!segment) return undefined;
    const segmentOffset = normalizeSearchText(source.slice(0, segment.index)).length;
    const segmentEnd = segmentOffset + normalizeSearchText(segment.segment).length;
    if (segmentOffset <= normalizedMatchIndex && segmentEnd > normalizedMatchIndex) {
      firstMatch = segment;
      normalizedOffset = segmentOffset;
      break;
    }
    if (segmentOffset > normalizedMatchIndex) return undefined;
    rawMatchIndex = source.indexOf(normalizedQuery, rawMatchIndex + 1);
  }
  if (!firstMatch) return undefined;

  const matched = [];
  let sourceOffset = firstMatch.index;
  while (sourceOffset < source.length &&
      normalizedOffset < normalizedMatchIndex + normalizedQuery.length) {
    const segment = segments.containing(sourceOffset);
    if (!segment) return undefined;
    const normalizedEnd = normalizedOffset + normalizeSearchText(segment.segment).length;
    if (normalizedEnd > normalizedMatchIndex &&
        normalizedOffset < normalizedMatchIndex + normalizedQuery.length) {
      matched.push(segment.segment);
    }
    normalizedOffset = normalizedEnd;
    sourceOffset = segment.index + segment.segment.length;
  }
  if (matched.length === 0 || normalizedOffset < normalizedMatchIndex + normalizedQuery.length) {
    return undefined;
  }

  const beforeRing = [];
  let beforeOffset = firstMatch.index;
  while (beforeOffset > 0 && beforeRing.length < 16) {
    const segment = segments.containing(beforeOffset - 1);
    if (!segment) return undefined;
    beforeRing.unshift(segment.segment);
    beforeOffset = segment.index;
  }
  const beforeBudget = matched.length <= 16
    ? 16
    : matched.length <= 48
      ? Math.ceil((48 - matched.length) / 2)
      : 0;
  const afterBudget = matched.length <= 16
    ? 16
    : matched.length <= 48
      ? Math.floor((48 - matched.length) / 2)
      : 0;
  const after = [];
  while (sourceOffset < source.length && after.length < afterBudget) {
    const segment = segments.containing(sourceOffset);
    if (!segment) return undefined;
    after.push(segment.segment);
    sourceOffset = segment.index + segment.segment.length;
  }
  const before = beforeBudget === 0 ? [] : beforeRing.slice(-beforeBudget);
  return {
    snippetText: [...before, ...matched, ...after].join(''),
    highlightStart: before.length,
    highlightLength: matched.length,
  };
};

export const projectNormalizedMatchToSource = (
  sourceValue,
  queryValue,
  normalizedMatchIndex,
) => {
  const source = String(sourceValue ?? '');
  const normalizedQuery = normalizeSearchText(queryValue);
  if (!normalizedQuery || normalizedMatchIndex < 0) return undefined;
  const direct = projectDirectLiteralMatch(source, normalizedQuery, normalizedMatchIndex);
  if (direct) return direct;

  const beforeRing = [];
  const matched = [];
  const after = [];
  let normalizedOffset = 0;
  let sourceStart = -1;
  let afterBudget;

  for (const { segment } of graphemeSegmenter.segment(source)) {
    const normalizedSegment = normalizeSearchText(segment);
    const normalizedEnd = normalizedOffset + normalizedSegment.length;
    const overlapsMatch = normalizedEnd > normalizedMatchIndex &&
      normalizedOffset < normalizedMatchIndex + normalizedQuery.length;
    if (sourceStart < 0 && overlapsMatch) sourceStart = normalizedOffset;
    if (overlapsMatch) {
      matched.push(segment);
    } else if (sourceStart < 0) {
      beforeRing.push(segment);
      if (beforeRing.length > 16) beforeRing.shift();
    } else if (normalizedOffset >= normalizedMatchIndex + normalizedQuery.length) {
      if (afterBudget === undefined) {
        if (matched.length <= 16) afterBudget = 16;
        else if (matched.length <= 48) afterBudget = Math.floor((48 - matched.length) / 2);
        else afterBudget = 0;
      }
      if (after.length < afterBudget) after.push(segment);
      if (after.length >= afterBudget) break;
    }
    normalizedOffset = normalizedEnd;
  }
  if (sourceStart < 0 || matched.length === 0) return undefined;
  const beforeBudget = matched.length <= 16
    ? 16
    : matched.length <= 48
      ? Math.ceil((48 - matched.length) / 2)
      : 0;
  const before = beforeBudget === 0 ? [] : beforeRing.slice(-beforeBudget);
  return {
    snippetText: [...before, ...matched, ...after].join(''),
    highlightStart: before.length,
    highlightLength: matched.length,
  };
};

export const createPlainTextSnippet = (sourceValue, queryValue) => {
  const source = String(sourceValue ?? '');
  const normalizedSource = normalizeSearchText(source);
  const normalizedQuery = normalizeSearchText(queryValue);
  const index = normalizedSource.indexOf(normalizedQuery);
  if (index < 0) return undefined;
  return projectNormalizedMatchToSource(source, normalizedQuery, index);
};
