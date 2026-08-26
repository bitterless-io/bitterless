import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const createWorkspace = () => {
  const base = mkdtempSync(join(tmpdir(), 'onlypreview-global-engine-'));
  const rootPath = join(base, 'workspace');
  mkdirSync(rootPath);
  return { base, rootPath, databasePath: join(base, 'search.sqlite') };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

test('Global Search independently caps Files and Contents and includes directories', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'needle-directory'));
  mkdirSync(join(workspace.rootPath, 'content'));
  for (let index = 0; index < 260; index += 1) {
    writeFileSync(
      join(workspace.rootPath, `needle-file-${String(index).padStart(3, '0')}.txt`),
      'other'
    );
    writeFileSync(
      join(workspace.rootPath, 'content', `body-${String(index).padStart(3, '0')}.txt`),
      'before needle after'
    );
  }
  const engine = createOnlyPreviewSearchEngine();
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const streamedTokens = new Map();
    const response = await engine.search({
      workspaceId: 'workspace',
      generation: 1,
      requestId: 'request-one',
      query: 'needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) =>
        streamedTokens.set(`${result.section}:${result.relativePath}`, result.resultToken)
    });
    assert.equal(response.files.length, 250);
    assert.equal(response.contents.length, 250);
    assert.equal(response.filesTruncated, true);
    assert.equal(response.contentsTruncated, true);
    assert.equal(
      response.files.some(({ nodeKind }) => nodeKind === 'directory'),
      true
    );
    assert.equal(
      response.contents.every(({ contentMatch }) => contentMatch.highlightLength > 0),
      true
    );
    assert.equal(new Set(response.files.map(({ resultToken }) => resultToken)).size, 250);
    assert.equal(new Set(response.contents.map(({ resultToken }) => resultToken)).size, 250);
    assert.equal(engine.globalSearchSession.resultsByToken.size, 500);
    for (const result of [...response.files, ...response.contents]) {
      assert.equal(
        result.resultToken,
        streamedTokens.get(`${result.section}:${result.relativePath}`),
        'terminal rows retain valid tokens already published by normal batches'
      );
    }
    assert.equal(JSON.stringify(response).includes(workspace.rootPath), false);
  } finally {
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('directory scope fences both sections while project scope remains complete', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'one'));
  mkdirSync(join(workspace.rootPath, 'two'));
  writeFileSync(join(workspace.rootPath, 'one', 'needle-one.txt'), 'needle one');
  writeFileSync(join(workspace.rootPath, 'two', 'needle-two.txt'), 'needle two');
  const engine = createOnlyPreviewSearchEngine();
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 2,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const scoped = await engine.search({
      workspaceId: 'workspace',
      generation: 2,
      requestId: 'scoped',
      query: 'needle',
      maxResults: 500,
      scope: { kind: 'directory', relativePath: 'one' },
      isCancelled: () => false
    });
    assert.deepEqual(
      scoped.files.map(({ relativePath }) => relativePath),
      ['one/needle-one.txt']
    );
    assert.deepEqual(
      scoped.contents.map(({ relativePath }) => relativePath),
      ['one/needle-one.txt']
    );
    const project = await engine.search({
      workspaceId: 'workspace',
      generation: 2,
      requestId: 'project',
      query: 'needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    assert.equal(project.files.length, 2);
    assert.equal(project.contents.length, 2);
  } finally {
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('first-build priority rows publish early and terminal promotion replaces their tokens', async () => {
  const workspace = createWorkspace();
  writeFileSync(join(workspace.rootPath, 'opened.txt'), 'opened priority needle');
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const releasePromotion = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    candidateReady.resolve();
    await releasePromotion.promise;
    return await promote(...args);
  };
  try {
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 4,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    const priority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 4,
      relativePath: 'opened.txt'
    });
    await engine.prioritizeFile(priority);
    const firstResult = deferred();
    const batches = [];
    const searching = engine.search({
      workspaceId: 'workspace',
      generation: 4,
      requestId: 'priority-request',
      query: 'priority needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) => {
        batches.push(result);
        firstResult.resolve();
      }
    });
    await firstResult.promise;
    const earlyToken = batches[0].resultToken;
    releasePromotion.resolve();
    await initialize;
    const response = await searching;
    assert.deepEqual(
      response.contents.map(({ relativePath }) => relativePath),
      ['opened.txt']
    );
    assert.notEqual(response.contents[0].resultToken, earlyToken);
    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 4,
        requestId: 'priority-request',
        resultToken: earlyToken,
        isCancelled: () => false
      })
    );
  } finally {
    releasePromotion.resolve();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('priority plus normal batches retain exact independent 250 Files and Contents ceilings', async () => {
  const workspace = createWorkspace();
  for (let index = 0; index < 250; index += 1) {
    writeFileSync(
      join(workspace.rootPath, `a-${String(index).padStart(3, '0')}-needle.txt`),
      'body needle'
    );
  }
  writeFileSync(join(workspace.rootPath, 'z-priority-needle.txt'), 'body needle');
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const releasePromotion = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    candidateReady.resolve();
    await releasePromotion.promise;
    return await promote(...args);
  };
  try {
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 8,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    const priority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 8,
      relativePath: 'z-priority-needle.txt'
    });
    await engine.prioritizeFile(priority);
    const firstResult = deferred();
    const streamed = [];
    const searching = engine.search({
      workspaceId: 'workspace',
      generation: 8,
      requestId: 'full-priority-sections',
      query: 'needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) => {
        streamed.push(result);
        firstResult.resolve();
      }
    });
    await firstResult.promise;
    releasePromotion.resolve();
    await initialize;
    const response = await searching;
    assert.equal(streamed.filter(({ section }) => section === 'files').length, 250);
    assert.equal(streamed.filter(({ section }) => section === 'contents').length, 250);
    assert.equal(response.files.length, 250);
    assert.equal(response.contents.length, 250);
    assert.equal(
      response.files.some(({ relativePath }) => relativePath === 'z-priority-needle.txt'),
      false
    );
    assert.equal(
      response.contents.some(({ relativePath }) => relativePath === 'z-priority-needle.txt'),
      false
    );
    assert.deepEqual(
      [...engine.globalSearchSession.resultCountBySection.entries()],
      [
        ['files', 250],
        ['contents', 250]
      ]
    );
  } finally {
    releasePromotion.resolve();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});
