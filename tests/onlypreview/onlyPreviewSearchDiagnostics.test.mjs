import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

test('search diagnostics emit one bounded allowlisted string with fake monotonic time', () => {
  const lines = [];
  let time = 20;
  const diagnostics = createOnlyPreviewSearchDiagnostics({
    clock: () => time,
    write: (line) => lines.push(line)
  });
  const startedAt = diagnostics.now();
  time = 12;
  diagnostics.emit('search-terminal', {
    tag: diagnostics.nextTag('q'),
    outcome: 'success',
    filesCount: Number.POSITIVE_INFINITY,
    contentsCount: -4,
    elapsedMs: diagnostics.elapsed(startedAt),
    query: 'must never be recorded',
    relativePath: 'private/name.ts'
  });
  assert.deepEqual(lines, [
    '[onlypreview-search] event=search-terminal tag=q1 outcome=success filesCount=0 contentsCount=0 elapsedMs=0'
  ]);
  assert.doesNotMatch(lines[0], /query|private|relativePath|name\.ts/);
});

test('search diagnostics reject unknown events and swallow writer and clock failures', () => {
  const diagnostics = createOnlyPreviewSearchDiagnostics({
    clock: () => {
      throw new Error('clock failed');
    },
    write: () => {
      throw new Error('writer failed');
    }
  });
  assert.equal(diagnostics.now(), 0);
  assert.equal(diagnostics.emit('unknown', { body: 'secret' }), false);
  assert.equal(
    diagnostics.emit('xpc-terminal', {
      tag: diagnostics.nextTag('x'),
      method: 'search',
      outcome: 'failure',
      elapsedMs: 4
    }),
    false
  );
});

test('first section logging can be guarded once per section without per-batch events', () => {
  const lines = [];
  const diagnostics = createOnlyPreviewSearchDiagnostics({ clock: () => 5, write: (line) => lines.push(line) });
  const seen = new Set();
  for (const section of ['files', 'files', 'contents', 'contents']) {
    if (seen.has(section)) continue;
    seen.add(section);
    diagnostics.emit('search-first-section', { tag: 'q1', section, elapsedMs: 5 });
  }
  assert.equal(lines.length, 2);
  assert.match(lines[0], /section=files/);
  assert.match(lines[1], /section=contents/);
});

test('production diagnostic payloads exclude private text fields and tight loops contain no emit', () => {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sources = [
    'src/main/fileSearch/fileSearchRuntimeRelay.service.ts',
    'src/main/fileSearch/fileSearchWindow.service.ts',
    'src/main/windows/onlyPreviewWindow.helper.ts',
    'src/preload/fileSearch/fileSearchRuntime.ts',
    'src/preload/onlypreview/search/core/search-engine.mjs',
    'src/preload/onlypreview/search/core/global-search-executor.mjs',
    'src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts',
    'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts'
  ].map((path) => readFileSync(resolve(projectRoot, path), 'utf8'));
  const diagnosticPayloads = sources
    .flatMap((source) => source.match(/diagnostics\.emit\([\s\S]{0,320}?\}\);/g) ?? [])
    .join('\n');
  assert.doesNotMatch(
    diagnosticPayloads,
    /\b(query|snippet|body|relativePath|rootPath|databasePath|workspaceId|hostToken|capability|error)\s*:/
  );
  const executor = sources[5];
  const authorityLoop = executor.match(/const emitAuthority = \(authority\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.doesNotMatch(authorityLoop, /diagnostics\.emit/);
  const traversalBatch = sources[4].match(/const onBatch = \([^)]*\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert.doesNotMatch(traversalBatch, /diagnostics\.emit/);
});
