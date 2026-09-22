/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import fsPromises, {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { OnlyPreviewSqliteIndex } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

const sampleFiles = {
  'network/network.md': '# network\nA small searchable recovery fixture.\n',
  'unchanged.txt': 'Keep this project file unchanged.\n'
};
const header = Buffer.from('SQLite format 3\0');

const withFixture = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), 'onlypreview-corrupt-index-'));
  const rootPath = join(directory, 'workspace');
  const databasePath = join(directory, 'cache', 'search.sqlite');
  const engines = [];
  try {
    for (const [relativePath, content] of Object.entries(sampleFiles)) {
      const path = join(rootPath, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    await mkdir(dirname(databasePath), { recursive: true });
    const create = () => {
      const logs = [];
      const snapshots = [];
      const engine = createOnlyPreviewSearchEngine({
        watchFactory: () => ({ on: () => undefined, close: () => undefined }),
        onSnapshot: (snapshot) => snapshots.push(snapshot),
        diagnostics: createOnlyPreviewSearchDiagnostics({ write: (line) => logs.push(line) })
      });
      engines.push(engine);
      const identity = { workspaceId: 'fixture-project', generation: engines.length };
      return {
        engine,
        logs,
        snapshots,
        initialize: () => engine.initialize({ ...identity, rootPath, databasePath }),
        search: (requestId = 'recovered-search') =>
          engine.search({
            ...identity,
            requestId,
            query: 'network',
            maxResults: 20,
            scope: { kind: 'project' }
          })
      };
    };
    const quarantinePaths = async () =>
      (await readdir(dirname(databasePath)))
        .filter(
          (name) => name.startsWith(`${basename(databasePath)}.`) && name.includes('.quarantine-')
        )
        .map((name) => join(dirname(databasePath), name))
        .sort();
    await run({ create, rootPath, databasePath, quarantinePaths });
    for (const [relativePath, content] of Object.entries(sampleFiles)) {
      assert.equal(await readFile(join(rootPath, relativePath), 'utf8'), content);
    }
  } finally {
    for (const engine of engines) await engine.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
};

const assertSearchable = async (runtime) => {
  assert.equal(runtime.engine.state, 'ready');
  assert.equal(runtime.snapshots.at(-1).state, 'ready');
  const result = await runtime.search();
  assert.deepEqual(
    result.files.map(({ relativePath, nodeKind }) => [relativePath, nodeKind]),
    [
      ['network', 'directory'],
      ['network/network.md', 'file']
    ]
  );
  assert.deepEqual(
    result.contents.map(({ relativePath }) => relativePath),
    ['network/network.md']
  );
  assert.ok(
    runtime.logs.some(
      (line) => line.includes('event=initialize-terminal') && line.includes('outcome=success')
    )
  );
  assert.equal(
    runtime.logs.some((line) => line.includes('event=initialize-failure')),
    false
  );
};

const assertQuarantined = async (fixture, original) => {
  const quarantines = await fixture.quarantinePaths();
  assert.equal(quarantines.length, 1, 'a corrupt open is quarantined exactly once');
  const [databaseName] = (await readdir(quarantines[0])).filter(
    (name) => !['-wal', '-shm', '-journal'].some((suffix) => name.endsWith(suffix))
  );
  assert.deepEqual(
    await readFile(join(quarantines[0], databaseName)),
    original,
    'the original damaged database remains recoverable, byte for byte'
  );
  const replacement = await readFile(fixture.databasePath);
  assert.deepEqual(replacement.subarray(0, header.length), header);
  return quarantines;
};

const prepareLateCorruption = async (fixture) => {
  const seeded = fixture.create();
  await seeded.initialize();
  const identity = { ...seeded.engine.identity };
  await seeded.engine.shutdown();
  const database = new DatabaseSync(fixture.databasePath);
  const rootPage = Number(
    database.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'chunks'").get().rootpage
  );
  const pageSize = Number(database.prepare('PRAGMA page_size').get().page_size);
  database.close();
  const file = await open(fixture.databasePath, 'r+');
  try {
    await file.write(Buffer.from([0xff]), 0, 1, (rootPage - 1) * pageSize);
  } finally {
    await file.close();
  }
  const damaged = await readFile(fixture.databasePath);
  const readable = new OnlyPreviewSqliteIndex(fixture.databasePath);
  try {
    assert.equal(readable.isReusable(identity), true);
    assert.equal(readable.canReconcile(identity), true);
    assert.equal(readable.readTreeSnapshot().treeMetadataReady, true);
    assert.throws(
      () => readable.database.prepare('SELECT * FROM chunks').all(),
      (error) => (error.errcode & 0xff) === 11
    );
  } finally {
    readable.close();
  }
  const path = join(fixture.rootPath, 'network/network.md');
  const metadata = await stat(path);
  await utimes(path, metadata.atime, new Date(metadata.mtimeMs + 5000));
  return damaged;
};

const sqliteError = (errcode) =>
  Object.assign(new Error('fixture SQLite failure'), {
    code: 'ERR_SQLITE_ERROR',
    errcode
  });

test('a real malformed database header is quarantined once and initialization rebuilds searchable data', async () => {
  await withFixture(async (fixture) => {
    const malformed = Buffer.alloc(4096, 0x5a);
    await writeFile(fixture.databasePath, malformed);
    assert.throws(
      () => new OnlyPreviewSqliteIndex(fixture.databasePath),
      (error) => (error.errcode & 0xff) === 26
    );
    const runtime = fixture.create();
    await runtime.initialize();
    await assertSearchable(runtime);
    assert.equal(
      runtime.logs.filter(
        (line) => line.includes('event=sqlite-recovery') && line.includes('sqliteCode=26')
      ).length,
      1
    );
    const quarantines = await assertQuarantined(fixture, malformed);
    await runtime.engine.shutdown();

    const warm = fixture.create();
    await warm.initialize();
    await assertSearchable(warm);
    assert.deepEqual(
      await fixture.quarantinePaths(),
      quarantines,
      'healthy reopen does not add another quarantine'
    );
    assert.ok(
      warm.logs.some((line) => line.includes('event=sqlite-open') && line.includes('reusable=true'))
    );
    assert.equal(
      warm.logs.some((line) => line.includes('event=sqlite-recovery')),
      false
    );
  });
});

test('a valid-header database with a damaged search_tree page recovers after warm metadata restoration fails', async () => {
  await withFixture(async (fixture) => {
    const seeded = fixture.create();
    await seeded.initialize();
    const identity = { ...seeded.engine.identity };
    await seeded.engine.shutdown();
    const database = new DatabaseSync(fixture.databasePath);
    let rootPage;
    let pageSize;
    try {
      rootPage = Number(
        database.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'search_tree'").get()
          .rootpage
      );
      pageSize = Number(database.prepare('PRAGMA page_size').get().page_size);
    } finally {
      database.close();
    }
    assert.ok(rootPage > 1 && pageSize >= 512);
    const file = await open(fixture.databasePath, 'r+');
    try {
      await file.write(Buffer.from([0xff]), 0, 1, (rootPage - 1) * pageSize);
    } finally {
      await file.close();
    }
    const damaged = await readFile(fixture.databasePath);
    assert.deepEqual(
      damaged.subarray(0, header.length),
      header,
      'the SQLite file header remains valid'
    );
    const readable = new OnlyPreviewSqliteIndex(fixture.databasePath);
    try {
      assert.equal(
        readable.isReusable(identity),
        true,
        'identity and content tables are still reusable'
      );
      assert.equal(readable.database.prepare('SELECT COUNT(*) AS count FROM files').get().count, 2);
      assert.throws(
        () => readable.readTreeSnapshot(),
        (error) => (error.errcode & 0xff) === 11
      );
    } finally {
      readable.close();
    }

    const runtime = fixture.create();
    await runtime.initialize();
    await assertSearchable(runtime);
    const opens = runtime.logs.filter((line) => line.includes('event=sqlite-open'));
    assert.equal(opens.length, 2);
    assert.match(opens[0], /reusable=true/);
    assert.match(opens[1], /reusable=false/);
    assert.equal(
      runtime.logs.filter(
        (line) => line.includes('event=sqlite-recovery') && line.includes('sqliteCode=11')
      ).length,
      1
    );
    await assertQuarantined(fixture, damaged);
  });
});

test('a healthy persisted index retains its warm reconcile path with no quarantine', async () => {
  await withFixture(async (fixture) => {
    const seeded = fixture.create();
    await seeded.initialize();
    await assertSearchable(seeded);
    await seeded.engine.shutdown();
    const warm = fixture.create();
    await warm.initialize();
    await assertSearchable(warm);
    assert.deepEqual(await fixture.quarantinePaths(), []);
    const opens = warm.logs.filter((line) => line.includes('event=sqlite-open'));
    assert.equal(opens.length, 1);
    assert.match(opens[0], /reusable=true reconcile=true/);
    // 候选镜像走文件级克隆(APFS clonefile),不支持克隆的卷退化成普通拷贝。两者都属于
    // 「从现有索引复制一份」这条路径,`fresh` 才是另一条 —— 所以认 clone|copy,不写死其中一个:
    // 测试跑在什么文件系统上不是测试能控制的。
    assert.ok(
      warm.logs.some((line) => /event=candidate-backup .*mode=(clone|copy)\b/u.test(line))
    );
    assert.ok(
      warm.logs.some(
        (line) => line.includes('event=traversal-index') && line.includes('mode=reconcile')
      )
    );
    assert.equal(
      warm.logs.some((line) => line.includes('event=sqlite-recovery')),
      false
    );
  });
});

test('corruption first read by warm reconciliation retries a fresh candidate and preserves the seed', async () => {
  await withFixture(async (fixture) => {
    const damaged = await prepareLateCorruption(fixture);
    const runtime = fixture.create();
    await runtime.initialize();
    await assertSearchable(runtime);
    assert.deepEqual(
      runtime.logs
        .filter((line) => line.includes('event=candidate-backup'))
        // clone 与 copy 归一成 reuse:这条断言关心的是「先复用既有索引、失败后重来一份 fresh」
        // 这个**顺序**,而不是复用时用的哪种文件系统能力。
        .map((line) => /mode=(\w+)/.exec(line)[1].replace(/^(clone|copy)$/u, 'reuse')),
      ['reuse', 'fresh']
    );
    assert.equal(runtime.logs.filter((line) => line.includes('event=sqlite-recovery')).length, 1);
    const quarantines = await assertQuarantined(fixture, damaged);
    await runtime.engine.shutdown();
    const warm = fixture.create();
    await warm.initialize();
    await assertSearchable(warm);
    assert.deepEqual(await fixture.quarantinePaths(), quarantines);
    assert.equal(
      warm.logs.some((line) => line.includes('event=sqlite-recovery')),
      false
    );
  });
});

test('ordinary candidate errors and cancellation never retry or quarantine a warm seed', async () => {
  for (const failure of [
    sqliteError(10),
    Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
  ]) {
    await withFixture(async (fixture) => {
      const seeded = fixture.create();
      await seeded.initialize();
      await seeded.engine.shutdown();
      const original = await readFile(fixture.databasePath);
      const runtime = fixture.create();
      let attempts = 0;
      runtime.engine.runTraversal = async () => {
        attempts += 1;
        throw failure;
      };
      await assert.rejects(runtime.initialize(), (error) => error === failure);
      assert.equal(attempts, 1);
      assert.deepEqual(await fixture.quarantinePaths(), []);
      assert.deepEqual(await readFile(fixture.databasePath), original);
      assert.equal((await runtime.search()).contents.length, 1);
    });
  }
});

test('a failed fresh recovery attempt propagates without retrying or altering the suspect seed', async () => {
  await withFixture(async (fixture) => {
    const damaged = await prepareLateCorruption(fixture);
    const runtime = fixture.create();
    const traverse = runtime.engine.runTraversal.bind(runtime.engine);
    const attempts = [];
    const freshFailure = sqliteError(11);
    runtime.engine.runTraversal = async (options) => {
      attempts.push(options.reconcileExisting);
      if (!options.reconcileExisting) throw freshFailure;
      return await traverse(options);
    };
    await assert.rejects(runtime.initialize(), (error) => error === freshFailure);
    assert.deepEqual(attempts, [true, false]);
    assert.deepEqual(await fixture.quarantinePaths(), []);
    assert.deepEqual(await readFile(fixture.databasePath), damaged);
    assert.equal(
      (await readdir(dirname(fixture.databasePath))).some((name) => name.includes('.candidate-')),
      false
    );
  });
});

test('recovery promotion moves leftover seed sidecars away before opening the replacement', async () => {
  await withFixture(async (fixture) => {
    const damaged = await prepareLateCorruption(fixture);
    const runtime = fixture.create();
    const promote = runtime.engine.promoteCandidate.bind(runtime.engine);
    const sidecars = ['-wal', '-shm', '-journal'];
    runtime.engine.promoteCandidate = async (candidate, candidatePath, seedIndex, ...args) => {
      const close = seedIndex.close.bind(seedIndex);
      seedIndex.close = () => {
        close();
        for (const suffix of sidecars)
          writeFileSync(`${fixture.databasePath}${suffix}`, `preserved${suffix}`);
      };
      return await promote(candidate, candidatePath, seedIndex, ...args);
    };
    await runtime.initialize();
    await assertSearchable(runtime);
    const [quarantine] = await assertQuarantined(fixture, damaged);
    const names = await readdir(quarantine);
    for (const suffix of sidecars) {
      const name = names.find((entry) => entry.endsWith(suffix));
      assert.ok(name, `quarantine retains ${suffix}`);
      assert.equal(await readFile(join(quarantine, name), 'utf8'), `preserved${suffix}`);
    }
  });
});

test('fresh candidate promotion failure rolls back without quarantining or retrying again', async () => {
  await withFixture(async (fixture) => {
    const damaged = await prepareLateCorruption(fixture);
    const runtime = fixture.create();
    const promote = runtime.engine.promoteCandidate.bind(runtime.engine);
    let promotions = 0;
    runtime.engine.promoteCandidate = async (candidate, ...args) => {
      promotions += 1;
      candidate.invalidateTreeSnapshot();
      return await promote(candidate, ...args);
    };
    await assert.rejects(runtime.initialize(), /Promoted Search tree snapshot is not ready/);
    assert.equal(promotions, 1);
    assert.deepEqual(await fixture.quarantinePaths(), []);
    assert.deepEqual(await readFile(fixture.databasePath), damaged);
    assert.equal(runtime.engine.index.readTreeSnapshot().treeMetadataReady, true);
    assert.equal(
      (await readdir(dirname(fixture.databasePath))).some((name) =>
        /\.(candidate|previous|recovery)-/.test(name)
      ),
      false
    );
  });
});

test('quarantine failure rolls the validated fresh promotion back to its preserved seed', async () => {
  await withFixture(async (fixture) => {
    const damaged = await prepareLateCorruption(fixture);
    const runtime = fixture.create();
    const originalMkdtemp = fsPromises.mkdtemp;
    const failure = Object.assign(new Error('fixture quarantine permission failure'), {
      code: 'EACCES'
    });
    let quarantines = 0;
    fsPromises.mkdtemp = async (prefix, ...args) => {
      if (
        String(prefix).startsWith(runtime.engine.databasePath) &&
        String(prefix).includes('.quarantine-')
      ) {
        quarantines += 1;
        throw failure;
      }
      return await originalMkdtemp(prefix, ...args);
    };
    try {
      await assert.rejects(runtime.initialize(), (error) => error === failure);
    } finally {
      fsPromises.mkdtemp = originalMkdtemp;
    }
    assert.equal(quarantines, 1);
    assert.deepEqual(await fixture.quarantinePaths(), []);
    assert.deepEqual(await readFile(fixture.databasePath), damaged);
    assert.equal(runtime.engine.index.readTreeSnapshot().treeMetadataReady, true);
    assert.equal(
      (await readdir(dirname(fixture.databasePath))).some((name) =>
        /\.(candidate|previous|recovery)-/.test(name)
      ),
      false
    );
  });
});
