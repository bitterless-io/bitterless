import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(
  new URL('../../src/main/translator/translator.service.ts', import.meta.url),
  'utf8'
);
const promptMatch = serviceSource.match(/export const TRANSLATOR_SYSTEM_PROMPT = `([\s\S]*?)`;/);

test('Translator prompt makes semantic direction and translation one strict operation', () => {
  assert.ok(promptMatch, 'Missing TRANSLATOR_SYSTEM_PROMPT');
  const prompt = promptMatch[1];

  assert.match(prompt, /primary semantic natural-language content/);
  assert.match(prompt, /Simplified or Traditional Chinese/);
  assert.match(
    prompt,
    /primary content is English, another language, ambiguous, or materially mixed/
  );
  assert.match(
    prompt,
    /Do not select direction by character count, UTF-8 byte length, or token count/
  );
  assert.match(prompt, /Product names, abbreviations, acronyms, code identifiers, URLs/);
  assert.match(
    prompt,
    /must not dominate direction merely because they contain more characters or tokens/
  );
});

test('Translator prompt keeps abbreviation meanings inside the strict translation output', () => {
  assert.ok(promptMatch, 'Missing TRANSLATOR_SYSTEM_PROMPT');
  const prompt = promptMatch[1];

  assert.match(prompt, /chosen targetLanguage is "zh-CN"/);
  assert.match(prompt, /English abbreviation or acronym/);
  assert.match(prompt, /common Chinese interpretations in the translation string/);
  assert.match(prompt, /most common general meaning to less common meanings/);
  assert.match(prompt, /established English expansion with an interpretation when useful/);
  assert.match(prompt, /multiple interpretations only when they are genuinely common/);
  assert.match(prompt, /separate each one with a newline inside the translation string/);
  assert.match(prompt, /never add another JSON field or output outside that field/);
  assert.match(prompt, /never invent an expansion or meaning/);
  assert.match(prompt, /Return exactly one JSON object with no additional keys/);
  assert.match(prompt, /\{"targetLanguage":"en","translation":"string"\}/);
  assert.match(prompt, /\{"targetLanguage":"zh-CN","translation":"string"\}/);
  assert.match(prompt, /targetLanguage must be exactly "en" or "zh-CN"/);
  assert.match(prompt, /Return no Markdown, code fence, preamble, explanation/);
});
