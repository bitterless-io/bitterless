import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  createPlainTextSnippet,
  extractCjkPostingTokens,
  isIndexedShortQuery,
  normalizeSearchText
} from '../../src/preload/onlypreview/search/core/normalization.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';

const identity = {
  workspaceHash: 'workspace',
  configHash: 'config',
  engineHash: createHash('sha256').update(SEARCH_ENGINE_IDENTITY).digest('hex')
};

const entry = (relativePath, originalContent) => ({
  relativePath,
  mediaType: 'text',
  contentIndexed: true,
  originalContent,
  size: Buffer.byteLength(originalContent),
  modifiedMs: 1
});

const highlightedText = (contentMatch) => {
  const graphemes = [
    ...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(contentMatch.snippetText)
  ].map(({ segment }) => segment);
  return graphemes
    .slice(contentMatch.highlightStart, contentMatch.highlightStart + contentMatch.highlightLength)
    .join('');
};

test('short postings contain every normalized one/two-codepoint token with non-ASCII', () => {
  const sources = ['aé b界 c 日本 한국 👩‍💻', 'cafe\u0301 ＡＢ ﬁ 𠀀x', '界 search 한국어'];
  for (const source of sources) {
    const normalized = [...normalizeSearchText(source)];
    const postings = new Set(extractCjkPostingTokens(source));
    for (let start = 0; start < normalized.length; start += 1) {
      for (const length of [1, 2]) {
        const token = normalized.slice(start, start + length).join('');
        if ([...token].length !== length || !isIndexedShortQuery(token)) continue;
        assert.equal(postings.has(token), true, JSON.stringify({ source, token }));
      }
    }
  }
  assert.equal(isIndexedShortQuery('e\u0301'), true);
  assert.equal(isIndexedShortQuery('界 '), true);
  assert.equal(isIndexedShortQuery('ab'), false);
  assert.equal(isIndexedShortQuery('日本語'), false);
});

test('direct literal projection preserves exact NFKC and grapheme snippet contracts', () => {
  assert.deepEqual(createPlainTextSnippet(`${'a'.repeat(4_000)}搜索${'z'.repeat(32)}`, '搜索'), {
    snippetText: `${'a'.repeat(16)}搜索${'z'.repeat(16)}`,
    highlightStart: 16,
    highlightLength: 2
  });
  const compatibility = createPlainTextSnippet('before ﬁＡ after', 'fia');
  assert.ok(compatibility);
  assert.equal(highlightedText(compatibility), 'ﬁＡ');
  assert.equal(compatibility.highlightLength, 2);
  const decomposed = createPlainTextSnippet('before cafe\u0301 after', 'é');
  assert.ok(decomposed);
  assert.equal(highlightedText(decomposed), 'e\u0301');
  assert.equal(decomposed.highlightLength, 1);

  for (const matchLength of [16, 17, 18, 47, 48, 49]) {
    const match = '界'.repeat(matchLength);
    const projected = createPlainTextSnippet(`${'a'.repeat(32)}${match}${'z'.repeat(32)}`, match);
    const remaining = Math.max(0, 48 - matchLength);
    assert.ok(projected);
    assert.equal(projected.highlightLength, matchLength);
    assert.equal(projected.highlightStart, matchLength <= 16 ? 16 : Math.ceil(remaining / 2));
    assert.equal(
      [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(projected.snippetText)]
        .length,
      matchLength <= 16 ? matchLength + 32 : Math.max(matchLength, 48)
    );
  }
});

test('non-ASCII short postings keep exact results, scope, order, and truncation', async () => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  const fixtures = [
    entry('a-composed.txt', 'prefix café suffix'),
    entry('b-decomposed.txt', 'prefix cafe\u0301 suffix'),
    entry('c-plain.txt', 'prefix cafe suffix'),
    entry('d-cjk-space.txt', 'prefix 界 target'),
    entry('e-cjk-tight.txt', 'prefix 界target'),
    entry('f-japanese.txt', 'prefix 日本 suffix'),
    entry('g-korean.txt', 'prefix 한국 suffix'),
    entry('h-emoji.txt', 'prefix 👩‍💻 suffix'),
    entry('.hidden/i-hidden.txt', 'prefix café hidden')
  ];
  await index.rebuild(fixtures, identity);

  const combining = await index.search('e\u0301', { scope: { kind: 'project' } });
  assert.equal(combining.engine, 'cjk-postings');
  assert.deepEqual(
    combining.results.map(({ relativePath }) => relativePath),
    ['a-composed.txt', 'b-decomposed.txt']
  );
  assert.equal(combining.truncated, false);
  for (const result of combining.results) {
    assert.ok(result.contentMatch);
    assert.equal(normalizeSearchText(highlightedText(result.contentMatch)), 'é');
  }
  const exactSqlPaths = index.database
    .prepare(
      `
    SELECT DISTINCT f.relative_path FROM chunks AS c
    JOIN files AS f ON f.id = c.file_id
    WHERE f.in_project = 1 AND instr(c.normalized_searchable, ?) > 0
    ORDER BY f.relative_path
  `
    )
    .all('é')
    .map(({ relative_path }) => relative_path);
  assert.deepEqual(
    combining.results.map(({ relativePath }) => relativePath),
    exactSqlPaths
  );

  const cjkSpace = await index.search('界 ', { scope: { kind: 'project' } });
  assert.equal(cjkSpace.engine, 'cjk-postings');
  assert.deepEqual(
    cjkSpace.results.map(({ relativePath }) => relativePath),
    ['d-cjk-space.txt']
  );
  assert.deepEqual(
    (await index.search('日本', { scope: { kind: 'project' } })).results.map(
      ({ relativePath }) => relativePath
    ),
    ['f-japanese.txt']
  );
  assert.deepEqual(
    (await index.search('한국', { scope: { kind: 'project' } })).results.map(
      ({ relativePath }) => relativePath
    ),
    ['g-korean.txt']
  );
  assert.deepEqual(
    (await index.search('👩‍💻', { scope: { kind: 'project' } })).results.map(
      ({ relativePath }) => relativePath
    ),
    ['h-emoji.txt']
  );
  assert.deepEqual(
    (
      await index.search('é', {
        scope: { kind: 'directory', relativePath: '.hidden' }
      })
    ).results.map(({ relativePath }) => relativePath),
    []
  );

  const capped = new OnlyPreviewSqliteIndex(':memory:');
  await capped.rebuild(
    Array.from({ length: 501 }, (_, item) =>
      entry(`item-${String(item).padStart(3, '0')}.txt`, `café ${item}`)
    ),
    identity
  );
  const limited = await capped.search('e\u0301', {
    maxResults: 500,
    scope: { kind: 'project' }
  });
  assert.equal(limited.engine, 'cjk-postings');
  assert.equal(limited.results.length, 500);
  assert.equal(limited.truncated, true);
  assert.deepEqual(
    limited.results.slice(0, 2).map(({ relativePath }) => relativePath),
    ['item-000.txt', 'item-001.txt']
  );
  let cancellationChecks = 0;
  const cancelled = await capped.search('e\u0301', {
    scope: { kind: 'project' },
    isCancelled: () => ++cancellationChecks > 550
  });
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancelled.results, []);
  capped.close();
  index.close();
});
