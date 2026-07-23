import type { TranslatorTargetLanguage } from './translator.contract';

type CodePointRange = readonly [start: number, end: number];

export interface TranslatorCharacterCounts {
  chinese: number;
  english: number;
  other: number;
}

const CHINESE_CODE_POINT_RANGES: readonly CodePointRange[] = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0x2ceb0, 0x2ebef],
  [0x2ebf0, 0x2ee5f],
  [0x2f800, 0x2fa1f],
  [0x30000, 0x3134f],
  [0x31350, 0x323af],
  [0x323b0, 0x3347f]
];

const WHITESPACE_CODE_POINT_RANGES: readonly CodePointRange[] = [
  [0x0009, 0x000d],
  [0x0020, 0x0020],
  [0x0085, 0x0085],
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff]
];

const isInRanges = (codePoint: number, ranges: readonly CodePointRange[]): boolean => {
  for (const [start, end] of ranges) {
    if (codePoint >= start && codePoint <= end) return true;
  }
  return false;
};

const isAsciiEnglishLetter = (codePoint: number): boolean =>
  (codePoint >= 0x0041 && codePoint <= 0x005a) ||
  (codePoint >= 0x0061 && codePoint <= 0x007a);

export const classifyTranslatorCharacters = (sourceText: string): TranslatorCharacterCounts => {
  const counts: TranslatorCharacterCounts = {
    chinese: 0,
    english: 0,
    other: 0
  };

  for (const character of sourceText) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || isInRanges(codePoint, WHITESPACE_CODE_POINT_RANGES)) continue;
    if (isInRanges(codePoint, CHINESE_CODE_POINT_RANGES)) {
      counts.chinese += 1;
    } else if (isAsciiEnglishLetter(codePoint)) {
      counts.english += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
};

export const resolveTranslatorTargetLanguage = (
  sourceText: string
): TranslatorTargetLanguage => {
  const counts = classifyTranslatorCharacters(sourceText);
  return counts.chinese > counts.english && counts.chinese > counts.other ? 'en' : 'zh-CN';
};
