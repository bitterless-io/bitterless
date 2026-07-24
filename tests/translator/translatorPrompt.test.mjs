import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(
  new URL('../../src/main/translator/translator.service.ts', import.meta.url),
  'utf8'
);
const promptMatch = serviceSource.match(/export const TRANSLATOR_SYSTEM_PROMPT = `([\s\S]*?)`;/);

test('Translator prompt keeps abbreviation meanings inside the strict translation output', () => {
  assert.ok(promptMatch, 'Missing TRANSLATOR_SYSTEM_PROMPT');
  const prompt = promptMatch[1];

  assert.match(prompt, /targetLanguage is Simplified Chinese/);
  assert.match(prompt, /English abbreviation or acronym/);
  assert.match(prompt, /common Chinese interpretations in the translation string/);
  assert.match(prompt, /most common general meaning to less common meanings/);
  assert.match(prompt, /established English expansion with an interpretation when useful/);
  assert.match(prompt, /multiple interpretations only when they are genuinely common/);
  assert.match(prompt, /separate each one with a newline inside the translation string/);
  assert.match(prompt, /never add another JSON field or output outside that field/);
  assert.match(prompt, /never invent an expansion or meaning/);
  assert.match(
    prompt,
    /Return exactly one JSON object with this shape and no additional keys: \{"translation":"string"\}/
  );
  assert.match(prompt, /Return no Markdown, code fence, preamble, explanation/);
});
