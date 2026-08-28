import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const findFile = (response, relativePath) =>
  response.files.find((result) => result.relativePath === relativePath);

test('result preview is token-only, bounded, typed, and revoked by the next query', async () => {
  const base = mkdtempSync(join(tmpdir(), 'onlypreview-global-preview-'));
  const rootPath = join(base, 'workspace');
  const databasePath = join(base, 'search.sqlite');
  mkdirSync(rootPath);
  writeFileSync(join(rootPath, 'preview-readme.md'), '# Preview\nneedle');
  writeFileSync(join(rootPath, 'preview-readme.markdown'), '# Preview\nneedle');
  writeFileSync(join(rootPath, 'preview-readme.mdx'), '# Preview\nneedle');
  writeFileSync(join(rootPath, 'preview-page.html'), '<script>alert(1)</script><b>needle</b>');
  writeFileSync(join(rootPath, 'preview-page.htm'), '<b>needle</b>');
  writeFileSync(join(rootPath, 'preview-manual.pdf'), Buffer.from('%PDF fake needle'));
  writeFileSync(join(rootPath, 'preview-large.txt'), `needle\n${'x'.repeat(300 * 1024)}`);
  writeFileSync(
    join(rootPath, 'deep-match.md'),
    `# File head\n${'x'.repeat(270 * 1024)}\nbeyondheadneedle`
  );
  writeFileSync(join(rootPath, 'preview-too-large.txt'), 'x'.repeat(1024 * 1024 + 1));
  mkdirSync(join(rootPath, 'preview-directory'));
  for (let index = 0; index < 205; index += 1) {
    writeFileSync(
      join(rootPath, 'preview-directory', `child-${String(index).padStart(3, '0')}.txt`),
      'x'
    );
  }
  const engine = createOnlyPreviewSearchEngine();
  try {
    await engine.initialize({ workspaceId: 'workspace', generation: 3, rootPath, databasePath });
    const response = await engine.search({
      workspaceId: 'workspace',
      generation: 3,
      requestId: 'preview-request',
      query: 'preview',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    const preview = async (result) =>
      await engine.preview({
        workspaceId: 'workspace',
        generation: 3,
        requestId: 'preview-request',
        resultToken: result.resultToken,
        isCancelled: () => false
      });
    assert.equal((await preview(findFile(response, 'preview-readme.md'))).adapter, 'markdown');
    assert.equal((await preview(findFile(response, 'preview-readme.markdown'))).adapter, 'plain');
    assert.equal((await preview(findFile(response, 'preview-readme.mdx'))).adapter, 'plain');
    assert.equal((await preview(findFile(response, 'preview-page.html'))).adapter, 'html-static');
    assert.equal((await preview(findFile(response, 'preview-page.htm'))).adapter, 'html-static');
    assert.equal((await preview(findFile(response, 'preview-manual.pdf'))).kind, 'info');
    const large = await preview(findFile(response, 'preview-large.txt'));
    assert.equal(large.kind, 'text');
    assert.equal(large.truncated, true);
    assert.ok(large.text.length <= 256 * 1024);
    assert.equal((await preview(findFile(response, 'preview-too-large.txt'))).kind, 'info');
    const directory = await preview(findFile(response, 'preview-directory'));
    assert.equal(directory.kind, 'directory');
    assert.equal(directory.entries.length, 200);
    assert.equal(directory.truncated, true);
    assert.equal(JSON.stringify(directory).includes(rootPath), false);

    const content = response.contents.find(
      ({ relativePath }) => relativePath === 'preview-readme.md'
    );
    const fileHead = await preview(findFile(response, 'preview-readme.md'));
    const contentHead = await preview(content);
    assert.deepEqual(contentHead, fileHead);
    assert.equal(contentHead.kind, 'text');
    assert.equal(contentHead.adapter, 'markdown');
    assert.equal(contentHead.text, '# Preview\nneedle');

    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 3,
        requestId: 'preview-request',
        resultToken: 'forged-token',
        isCancelled: () => false
      })
    );
    const deepResponse = await engine.search({
      workspaceId: 'workspace',
      generation: 3,
      requestId: 'deep-preview-request',
      query: 'beyondheadneedle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    const deepContent = deepResponse.contents.find(
      ({ relativePath }) => relativePath === 'deep-match.md'
    );
    assert.match(deepContent.contentMatch.snippetText, /beyondheadneedle/i);
    const deepHead = await engine.preview({
      workspaceId: 'workspace',
      generation: 3,
      requestId: 'deep-preview-request',
      resultToken: deepContent.resultToken,
      isCancelled: () => false
    });
    assert.equal(deepHead.kind, 'text');
    assert.equal(deepHead.adapter, 'markdown');
    assert.equal(deepHead.truncated, true);
    assert.match(deepHead.text, /^# File head\n/);
    assert.doesNotMatch(deepHead.text, /beyondheadneedle/i);
    assert.ok(Buffer.byteLength(deepHead.text) <= 256 * 1024);

    const replacement = await engine.search({
      workspaceId: 'workspace',
      generation: 3,
      requestId: 'replacement-request',
      query: 'manual',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    await assert.rejects(() => preview(findFile(response, 'preview-readme.md')));
    const replacementFile = findFile(replacement, 'preview-manual.pdf');
    engine.revokeSearch('unrelated-request');
    assert.equal(
      (
        await engine.preview({
          workspaceId: 'workspace',
          generation: 3,
          requestId: 'replacement-request',
          resultToken: replacementFile.resultToken,
          isCancelled: () => false
        })
      ).kind,
      'info'
    );
    engine.revokeSearch('replacement-request');
    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 3,
        requestId: 'replacement-request',
        resultToken: replacementFile.resultToken,
        isCancelled: () => false
      })
    );

    const beforeRefresh = await engine.search({
      workspaceId: 'workspace',
      generation: 3,
      requestId: 'before-refresh',
      query: 'manual',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    await engine.refresh({ workspaceId: 'workspace', generation: 3 });
    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 3,
        requestId: 'before-refresh',
        resultToken: findFile(beforeRefresh, 'preview-manual.pdf').resultToken,
        isCancelled: () => false
      })
    );
  } finally {
    await engine.shutdown();
    rmSync(base, { recursive: true, force: true });
  }
});

test('every file-backed preview rejects changed, replaced, deleted, or symlinked identity', async () => {
  const base = mkdtempSync(join(tmpdir(), 'onlypreview-global-preview-identity-'));
  const rootPath = join(base, 'workspace');
  const databasePath = join(base, 'search.sqlite');
  mkdirSync(rootPath);
  writeFileSync(join(rootPath, 'context.txt'), 'before needle after');
  writeFileSync(join(rootPath, 'manual.pdf'), '%PDF current');
  writeFileSync(join(rootPath, '.env'), 'SECRET=current');
  writeFileSync(join(rootPath, 'huge.txt'), 'x'.repeat(1024 * 1024 + 1));
  writeFileSync(join(rootPath, 'link.pdf'), '%PDF link');
  writeFileSync(join(rootPath, 'gone.pdf'), '%PDF gone');
  writeFileSync(join(base, 'outside.pdf'), '%PDF outside');
  const engine = createOnlyPreviewSearchEngine();
  const request = async (requestId, query) =>
    await engine.search({
      workspaceId: 'workspace',
      generation: 5,
      requestId,
      query,
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
  const preview = async (requestId, result) =>
    await engine.preview({
      workspaceId: 'workspace',
      generation: 5,
      requestId,
      resultToken: result.resultToken,
      isCancelled: () => false
    });
  try {
    await engine.initialize({ workspaceId: 'workspace', generation: 5, rootPath, databasePath });

    const contextResponse = await request('context-request', 'needle');
    const context = contextResponse.contents.find(
      ({ relativePath }) => relativePath === 'context.txt'
    );
    writeFileSync(join(rootPath, 'context.txt'), 'before absent after');
    await assert.rejects(() => preview('context-request', context));

    const infoResponse = await request('info-request', 'manual');
    const info = findFile(infoResponse, 'manual.pdf');
    unlinkSync(join(rootPath, 'manual.pdf'));
    writeFileSync(join(rootPath, 'manual.pdf'), '%PDF replaced');
    await assert.rejects(() => preview('info-request', info));

    const sensitiveResponse = await request('sensitive-request', '.env');
    const sensitive = findFile(sensitiveResponse, '.env');
    writeFileSync(join(rootPath, '.env'), 'SECRET=changed');
    await assert.rejects(() => preview('sensitive-request', sensitive));

    const hugeResponse = await request('huge-request', 'huge');
    const huge = findFile(hugeResponse, 'huge.txt');
    writeFileSync(join(rootPath, 'huge.txt'), 'y'.repeat(1024 * 1024 + 1));
    await assert.rejects(() => preview('huge-request', huge));

    const linkResponse = await request('link-request', 'link');
    const link = findFile(linkResponse, 'link.pdf');
    unlinkSync(join(rootPath, 'link.pdf'));
    symlinkSync(join(base, 'outside.pdf'), join(rootPath, 'link.pdf'));
    await assert.rejects(() => preview('link-request', link));

    const goneResponse = await request('gone-request', 'gone');
    const gone = findFile(goneResponse, 'gone.pdf');
    unlinkSync(join(rootPath, 'gone.pdf'));
    await assert.rejects(() => preview('gone-request', gone));
  } finally {
    await engine.shutdown();
    rmSync(base, { recursive: true, force: true });
  }
});

test('failed replacement search, refresh, and initialize attempts revoke prior tokens', async () => {
  const base = mkdtempSync(join(tmpdir(), 'onlypreview-global-preview-lifecycle-'));
  const rootPath = join(base, 'workspace');
  const databasePath = join(base, 'search.sqlite');
  mkdirSync(rootPath);
  writeFileSync(join(rootPath, 'manual.pdf'), '%PDF current');
  const engine = createOnlyPreviewSearchEngine();
  const search = async (requestId) =>
    await engine.search({
      workspaceId: 'workspace',
      generation: 6,
      requestId,
      query: 'manual',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
  const expectStale = async (requestId, result) =>
    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 6,
        requestId,
        resultToken: result.resultToken,
        isCancelled: () => false
      })
    );
  try {
    await engine.initialize({ workspaceId: 'workspace', generation: 6, rootPath, databasePath });

    const beforeInvalidScope = await search('before-invalid-scope');
    await assert.rejects(() =>
      engine.search({
        workspaceId: 'workspace',
        generation: 6,
        requestId: 'invalid-scope',
        query: 'manual',
        maxResults: 500,
        scope: { kind: 'directory', relativePath: 'missing' },
        isCancelled: () => false
      })
    );
    await expectStale('before-invalid-scope', findFile(beforeInvalidScope, 'manual.pdf'));

    const beforeRefresh = await search('before-failed-refresh');
    mkdirSync(join(rootPath, '.bitterless'));
    writeFileSync(join(rootPath, '.bitterless', 'preview-config.yml'), '[]');
    await assert.rejects(() => engine.refresh({ workspaceId: 'workspace', generation: 6 }));
    await expectStale('before-failed-refresh', findFile(beforeRefresh, 'manual.pdf'));

    rmSync(join(rootPath, '.bitterless'), { recursive: true, force: true });
    const beforeInitialize = await search('before-failed-initialize');
    await assert.rejects(() =>
      engine.initialize({
        workspaceId: 'replacement-workspace',
        generation: 7,
        rootPath: join(rootPath, 'missing-root'),
        databasePath: join(base, 'replacement.sqlite')
      })
    );
    await expectStale('before-failed-initialize', findFile(beforeInitialize, 'manual.pdf'));
  } finally {
    await engine.shutdown();
    rmSync(base, { recursive: true, force: true });
  }
});
