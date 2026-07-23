import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTranslatorCharacters,
  resolveTranslatorTargetLanguage
} from '../../src/shared/translator/translatorLanguage.service.ts';

const verifyDirection = (sourceText, expectedCounts, expectedTargetLanguage) => {
  assert.deepEqual(classifyTranslatorCharacters(sourceText), expectedCounts);
  assert.equal(resolveTranslatorTargetLanguage(sourceText), expectedTargetLanguage);
};

test('Chinese-majority input targets English', () => {
  verifyDirection('你好 world', { chinese: 2, english: 5, other: 0 }, 'zh-CN');
  verifyDirection('你好世界 hi', { chinese: 4, english: 2, other: 0 }, 'en');
});

test('English-majority input targets Simplified Chinese', () => {
  verifyDirection('hello 世界', { chinese: 2, english: 5, other: 0 }, 'zh-CN');
});

test('other scripts, symbols, and digits count as other and fall back to Simplified Chinese', () => {
  verifyDirection('日本語', { chinese: 2, english: 0, other: 1 }, 'en');
  verifyDirection('かなカナ', { chinese: 0, english: 0, other: 4 }, 'zh-CN');
  verifyDirection('🙂!?123', { chinese: 0, english: 0, other: 6 }, 'zh-CN');
});

test('tied counts fall back to Simplified Chinese', () => {
  verifyDirection('中a', { chinese: 1, english: 1, other: 0 }, 'zh-CN');
  verifyDirection('中文!!', { chinese: 2, english: 0, other: 2 }, 'zh-CN');
});

test('whitespace-only and empty input fall back to Simplified Chinese', () => {
  verifyDirection('', { chinese: 0, english: 0, other: 0 }, 'zh-CN');
  verifyDirection(' \t\n\u3000\ufeff', { chinese: 0, english: 0, other: 0 }, 'zh-CN');
});

test('CJK extension-plane ideographs count as Chinese code points', () => {
  verifyDirection('\u{20000}\u{31350}a', { chinese: 2, english: 1, other: 0 }, 'en');
});
