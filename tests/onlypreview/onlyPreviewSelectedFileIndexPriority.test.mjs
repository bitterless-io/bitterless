import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-selected-priority-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

const gatePromotion = (engine) => {
  const candidateComplete = deferred();
  const release = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    candidateComplete.resolve();
    await release.promise;
    return await promote(...args);
  };
  return { candidateComplete: candidateComplete.promise, release: release.resolve };
};

const search = (engine, requestId, query, onResult) =>
  engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId,
    query,
    maxResults: 500,
    scope: { kind: 'project' },
    isCancelled: () => false,
    onResult
  });

const responsePaths = (response) =>
  [...response.files, ...response.contents].map(({ relativePath }) => relativePath);

test('a complete selected-file lane publishes early without exposing candidate rows', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'late-a.txt'), 'opened priority needle');
    await write(join(root, 'late-b.txt'), 'candidate private needle');
    const engine = createOnlyPreviewSearchEngine();
    const promotion = gatePromotion(engine);
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await promotion.candidateComplete;

    const priority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'late-a.txt'
    });
    assert.ok(priority);
    await engine.prioritizeFile(priority);
    assert.equal(engine.selectedFilePriority.lane.relativePath, 'late-a.txt');
    assert.equal(engine.selectedFilePriority.lane.index.filenameTier.records.size, 1);

    const early = deferred();
    const priorityBatches = [];
    let prioritySettled = false;
    const prioritySearch = search(engine, 'priority', 'opened priority needle', (result) => {
      priorityBatches.push(result.relativePath);
      early.resolve();
    }).finally(() => {
      prioritySettled = true;
    });
    await early.promise;
    assert.deepEqual(priorityBatches, ['late-a.txt']);
    assert.equal(prioritySettled, false);

    assert.equal(engine.index, undefined, 'private first-build candidate must not become searchable');

    promotion.release();
    await initialize;
    assert.deepEqual(responsePaths(await prioritySearch), ['late-a.txt']);
    assert.deepEqual(
      responsePaths(await search(engine, 'candidate', 'candidate private needle')),
      ['late-b.txt']
    );
    assert.equal(
      engine.selectedFilePriority.lane,
      undefined,
      'promotion must release the in-memory lane'
    );
    await engine.shutdown();
  });
});

test('selected-file admission rejects paths beyond the shared traversal depth before I/O', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const directories = Array.from({ length: 32 }, (_, index) =>
      `d${String(index + 1).padStart(2, '0')}`
    );
    const relativePath = `${directories.join('/')}/too-deep.txt`;
    await write(join(root, relativePath), 'over depth priority needle');
    let priorityReadCount = 0;
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async () => {
        priorityReadCount += 1;
        throw new Error('over-depth priority must not read');
      }
    });
    const promotion = gatePromotion(engine);
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await promotion.candidateComplete;

    assert.equal(
      engine.supersedePriority({
        workspaceId: 'workspace',
        generation: 1,
        relativePath
      }),
      undefined
    );
    assert.equal(priorityReadCount, 0);
    const streamed = [];
    const pendingSearch = search(engine, 'over-depth', 'over depth priority needle', (result) => {
      streamed.push(result.relativePath);
    });
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    assert.deepEqual(streamed, []);

    promotion.release();
    await initialize;
    assert.deepEqual(responsePaths(await pendingSearch), []);
    await engine.shutdown();
  });
});

test('newer selections revoke late reads and retain at most one complete file', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'a.txt'), 'normal candidate a');
    await write(join(root, 'b.txt'), 'normal candidate b');
    await write(join(root, 'changed.txt'), 'normal candidate changed');
    const reads = new Map([
      ['a.txt', deferred()],
      ['b.txt', deferred()],
      ['changed.txt', deferred()]
    ]);
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async ({ relativePath }) => await reads.get(relativePath).promise
    });
    const promotion = gatePromotion(engine);
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await promotion.candidateComplete;

    const aPriority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'a.txt'
    });
    const lateA = engine.prioritizeFile(aPriority);
    const bPriority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'b.txt'
    });
    reads.get('a.txt').resolve({
      relativePath: 'a.txt',
      mediaType: 'text',
      contentIndexed: true,
      originalContent: 'late a body',
      size: 11,
      modifiedMs: 1
    });
    await lateA;
    assert.equal(
      engine.selectedFilePriority.lane,
      undefined,
      'a late A read cannot republish after B'
    );

    const latestB = engine.prioritizeFile(bPriority);
    reads.get('b.txt').resolve({
      relativePath: 'b.txt',
      mediaType: 'text',
      contentIndexed: true,
      originalContent: 'latest b body',
      size: 13,
      modifiedMs: 2
    });
    await latestB;
    assert.equal(engine.selectedFilePriority.lane.relativePath, 'b.txt');
    assert.deepEqual(
      [...engine.selectedFilePriority.lane.index.filenameTier.records.keys()],
      ['b.txt']
    );

    assert.throws(
      () =>
        engine.supersedePriority({
          workspaceId: 'workspace',
          generation: 2,
          relativePath: 'b.txt'
        }),
      /stale/u
    );
    const changed = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'changed.txt'
    });
    const changedRead = engine.prioritizeFile(changed);
    reads.get('changed.txt').resolve({
      relativePath: 'changed.txt',
      mediaType: 'text',
      contentIndexed: false,
      originalContent: '',
      size: 24,
      modifiedMs: 3,
      changed: true
    });
    await changedRead;
    assert.equal(
      engine.selectedFilePriority.lane,
      undefined,
      'an unstable read cannot publish a partial row'
    );
    const missing = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'missing.txt'
    });
    await engine.prioritizeFile(missing);
    assert.equal(engine.selectedFilePriority.lane, undefined, 'missing inputs leave the lane empty');
    const excluded = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'node_modules/private.txt'
    });
    await engine.prioritizeFile(excluded);
    assert.equal(
      engine.selectedFilePriority.lane,
      undefined,
      'ordinary Search exclusions apply to priority'
    );

    promotion.release();
    await initialize;
    assert.equal(
      engine.supersedePriority({
        workspaceId: 'workspace',
        generation: 1,
        relativePath: 'b.txt'
      }),
      undefined,
      'ready indexes do not retain a supplemental priority row'
    );
    await engine.shutdown();
  });
});

test('an active index remains terminal authority and duplicate priority paths stream once', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'selected.txt'), 'stable selected needle');
    await write(join(root, 'other.txt'), 'independent priority value');
    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    const promotion = gatePromotion(engine);
    const refresh = engine.refresh({ workspaceId: 'workspace', generation: 1 });
    await promotion.candidateComplete;
    const priority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'selected.txt'
    });
    await engine.prioritizeFile(priority);
    const streamed = [];
    const firstWarmResult = deferred();
    let searchSettled = false;
    const searching = search(engine, 'active', 'stable selected needle', (result) => {
      streamed.push(result.relativePath);
      firstWarmResult.resolve();
    }).finally(() => {
      searchSettled = true;
    });
    await firstWarmResult.promise;
    assert.deepEqual(streamed, ['selected.txt']);
    assert.equal(searchSettled, false, 'warm rows must not terminalize before promotion');
    assert.ok(
      engine.selectedFilePriority.lane,
      'active-index search must not expose or promote candidate state'
    );
    const replacementPriority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 1,
      relativePath: 'other.txt'
    });
    await engine.prioritizeFile(replacementPriority);
    assert.equal(searchSettled, false, 'priority supersede must not revoke Global Search');

    promotion.release();
    await refresh;
    assert.deepEqual(responsePaths(await searching), ['selected.txt']);
    assert.equal(engine.selectedFilePriority.lane, undefined);
    await engine.shutdown();
  });
});
