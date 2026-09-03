/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-authoring-'));
const bundlePath = join(buildRoot, 'authoring.mjs');

await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewProjectAuthoring.service.ts')
  ],
  outfile: bundlePath,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  alias: {
    '@shared': join(projectRoot, 'src/shared')
  }
});

const {
  onlyPreviewEditInputWidthCh,
  resolveOnlyPreviewAuthoringFailure,
  resolveOnlyPreviewEditCommit
} = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

test('only a genuine collision advances Main\'s untitled sequence', () => {
  assert.equal(resolveOnlyPreviewAuthoringFailure({ code: 'NAME_EXISTS' }), 'exists');
  assert.equal(resolveOnlyPreviewAuthoringFailure({ code: 'NAME_INVALID' }), 'invalid');
  // Anything else has to stop the loop: retrying a permission or workspace failure a thousand times
  // would turn one failed click into a thousand round trips.
  for (const error of [
    { code: 'PATH_PERMISSION_DENIED' },
    { code: 'WORKSPACE_ACCESS_DENIED' },
    new Error('boom'),
    null,
    undefined
  ]) {
    assert.equal(resolveOnlyPreviewAuthoringFailure(error), 'other');
  }
});

test('committing an edit distinguishes unchanged, invalid, and a real rename', () => {
  const state = (draft, originalName = 'notes.md') => ({
    relativePath: `docs/${originalName}`,
    draft,
    originalName
  });
  assert.deepEqual(resolveOnlyPreviewEditCommit(state('notes.md')), { kind: 'unchanged' });
  // The trim happens before the comparison, so surrounding whitespace is not a rename either.
  assert.deepEqual(resolveOnlyPreviewEditCommit(state('  notes.md  ')), { kind: 'unchanged' });
  assert.deepEqual(resolveOnlyPreviewEditCommit(state('renamed.md')), {
    kind: 'rename',
    name: 'renamed.md'
  });
  for (const draft of ['', '   ', '.', '..', 'a/b', 'a:b', 'a?b', 'trailing.', 'NUL', 'x'.repeat(256)]) {
    assert.deepEqual(
      resolveOnlyPreviewEditCommit(state(draft)),
      { kind: 'invalid' },
      `${JSON.stringify(draft)} must be refused before the round trip`
    );
  }
  // A case-only change is a real rename on a case-sensitive volume and must not be swallowed.
  assert.deepEqual(resolveOnlyPreviewEditCommit(state('Notes.md')), {
    kind: 'rename',
    name: 'Notes.md'
  });
});

test('the edit input tracks its content within a bounded width', () => {
  assert.equal(onlyPreviewEditInputWidthCh(''), 6, 'an empty draft still needs a usable box');
  assert.equal(onlyPreviewEditInputWidthCh('untitled folder'), 16);
  assert.ok(
    onlyPreviewEditInputWidthCh('中文目录') > onlyPreviewEditInputWidthCh('abcd'),
    'full-width characters occupy two columns'
  );
  assert.equal(onlyPreviewEditInputWidthCh('x'.repeat(200)), 48, 'growth is capped');
});
