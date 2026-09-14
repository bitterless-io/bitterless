/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * Composite mini-app tabs survive a restart — against the REAL schema, not a paraphrase of it.
 *
 * The bug this pins is a quiet one. `replaceAll` drops any row whose URL is empty, one line before
 * the insert, and a composite tab is born with `url: ''`. So relaxing the renderer's filter and
 * widening the columns is not enough: without the DAO's own gate opening too, every Zellij tab is
 * discarded inside the transaction and the strip comes back short with nothing logged.
 *
 * It also pins the lockstep the release gate cares about: `CREATE_TABS` covers a fresh install and
 * the registered migration covers an upgrade, and a schema that has only one of the two is broken
 * for exactly half of the installs.
 */
const root = resolve(import.meta.dirname, '../..');
const directory = mkdtempSync(join(tmpdir(), 'maestro-tabs-dao-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

/**
 * `node:sqlite` has no `db.transaction(fn)`; better-sqlite3 does, and the DAO uses it. Wrap rather
 * than rewrite the DAO for testability — the point is to exercise the shipping code path.
 */
const adapt = (db) => ({
  prepare: (sql) => db.prepare(sql),
  exec: (sql) => db.exec(sql),
  transaction: (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
});

let current = null;
const mocks = {
  'electron-xpc/preload': 'export class XpcPreloadHandler {}',
  './sqliteManager': 'export const sqliteManager = { get db() { return globalThis.__tabsDb } };'
};

const bundled = await build({
  stdin: {
    contents: `
      export { TabsDao } from './src/preload/maestro/sqlite/tabs.dao.ts';
      export { createMaestroSqliteSchema, maestroSqliteMigrations }
        from './src/preload/maestro/sqlite/maestroSqlite.release.ts';
    `,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'tabs-dao-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'tabs-dao' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'tabs-dao' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const { TabsDao, createMaestroSqliteSchema, maestroSqliteMigrations } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

let dbSeq = 0;
const freshSchema = () => {
  const db = new DatabaseSync(join(directory, `fresh-${++dbSeq}.db`));
  createMaestroSqliteSchema(adapt(db));
  current = adapt(db);
  globalThis.__tabsDb = current;
  return new TabsDao();
};

const zellijRow = (instanceId, position) => ({
  url: '',
  title: 'Zellij',
  favicon: '',
  position,
  kind: 'zellij',
  instanceId
});

test('a composite tab round-trips through the real schema, empty URL and all', async () => {
  const dao = freshSchema();
  await dao.replaceAll({
    tabs: [
      zellijRow('deadbeef0001', 0),
      { url: 'https://example.invalid/docs', title: 'Docs', favicon: 'f', position: 1 },
      zellijRow('deadbeef0002', 2)
    ]
  });
  const saved = await dao.listAll();
  assert.deepEqual(saved, [
    { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0001' },
    { url: 'https://example.invalid/docs', title: 'Docs', favicon: 'f', position: 1 },
    { url: '', title: 'Zellij', favicon: '', position: 2, kind: 'zellij', instanceId: 'deadbeef0002' }
  ]);
});

test('a row with neither URL nor kind is still dropped — the gate narrowed, it did not open', async () => {
  const dao = freshSchema();
  await dao.replaceAll({
    tabs: [
      { url: '   ', title: 'blank new tab', favicon: '', position: 0 },
      zellijRow('deadbeef0003', 1)
    ]
  });
  const saved = await dao.listAll();
  assert.deepEqual(
    saved.map((t) => t.instanceId ?? t.url),
    ['deadbeef0003'],
    'a blank New Tab must not be resurrected on the next launch'
  );
});

test('an EXISTING database reaches the same shape through the registered migration', async () => {
  // The half that fresh installs can never catch: an upgrader arrives with the pre-composite table.
  const db = new DatabaseSync(join(directory, 'legacy.db'));
  db.exec(`
    CREATE TABLE tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favicon TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(
    "INSERT INTO tabs (url, title, favicon, position, updated_at) VALUES ('https://example.invalid/a','A','',0,1)"
  );
  current = adapt(db);
  globalThis.__tabsDb = current;

  // Looked up BY VERSION, not by `at(-1)`: every later column lands another migration after this
  // one, and "the newest entry" would then silently stop being the one this test is about.
  const migration = maestroSqliteMigrations.find((entry) => entry.versionCode === '260911140000');
  assert.ok(migration, 'the composite-tab migration is registered');
  migration.runner(current);
  // Idempotent, because an older release used incompatible width and corrected entries replay.
  migration.runner(current);
  // The alias column arrives the same way — its own registered migration, paired with CREATE_TABS.
  const aliasMigration = maestroSqliteMigrations.find((entry) => entry.versionCode === '260914120000');
  assert.ok(aliasMigration, 'the tab-alias migration is registered');
  aliasMigration.runner(current);
  aliasMigration.runner(current);

  const dao = new TabsDao();
  assert.deepEqual(await dao.listAll(), [
    { url: 'https://example.invalid/a', title: 'A', favicon: '', position: 0 }
  ]);
  await dao.replaceAll({ tabs: [zellijRow('deadbeef0004', 0)] });
  assert.deepEqual(await dao.listAll(), [
    { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0004' }
  ]);
});

/**
 * The operator's own name for a tab survives a restart — and does NOT live in `title`.
 *
 * `title` is rewritten by six separate writers (page-title-updated, the composite setTitle seam,
 * both tab factories, setTabKind, restore), so a name stored there is gone after one navigation.
 * The round trip below is what proves `alias` is carried by its own column through all three
 * hand-written column lists in the DAO: miss the SELECT and it reads back undefined, miss the
 * INSERT and it writes the default — neither one throws.
 */
test('an alias round-trips beside the title, and blank means no alias', async () => {
  const dao = freshSchema();
  await dao.replaceAll({
    tabs: [
      { ...zellijRow('deadbeef0005', 0), alias: 'left pane' },
      { url: 'https://example.invalid/docs', title: 'Docs', favicon: 'f', position: 1, alias: '  ' }
    ]
  });
  const saved = await dao.listAll();
  assert.equal(saved[0].alias, 'left pane');
  assert.equal(saved[0].title, 'Zellij', 'the alias must not have replaced the page title');
  assert.equal(saved[1].alias, undefined, 'a whitespace-only alias is no alias at all');
});

/**
 * 少一列 `alias`,最多是没有别名 —— **绝不能变成没有 tab**。
 *
 * 这个库是够得着的:`runSqliteMigrations` 的「全新库」分支(账本为空且开库前文件不存在)会把
 * **当前构建的 version_code 直接盖进账本、一条迁移都不跑**。本地打的 DEBUG/PREVIEW 包,
 * version_code 是打包时刻的时间戳 —— 一个在 alias 列存在之前打出来、时间戳却比 alias 迁移
 * (260914120000)还大的包,建出来的库账本上写着「已经迁过了」,表里却没有这一列,那条迁移
 * 从此**永远**跳过。
 *
 * 这时 `SELECT … alias …` 抛 `no such column: alias`,而渲染层 `listAll().catch(() => [])` 把它
 * 吞成「一个 tab 都没有」:整条持久化 tab 条每次启动静默清空,没有任何报错。
 */
test('a database missing the alias column still reads and writes the whole strip', async () => {
  const db = new DatabaseSync(join(directory, 'stamped-without-alias.db'));
  db.exec(`
    CREATE TABLE tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favicon TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT '',
      instance_id TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(
    "INSERT INTO tabs (url, title, favicon, position, kind, instance_id, updated_at) " +
      "VALUES ('https://example.invalid/a','A','',0,'','',1)"
  );
  current = adapt(db);
  globalThis.__tabsDb = current;

  const dao = new TabsDao();
  assert.deepEqual(
    await dao.listAll(),
    [{ url: 'https://example.invalid/a', title: 'A', favicon: '', position: 0 }],
    'the strip degrades to "no aliases", never to "no tabs"'
  );

  // 写侧同样降级:整条 INSERT 报错会被防抖里的 `.catch()` 吞掉,tab 条从此再也不更新。
  await dao.replaceAll({ tabs: [{ ...zellijRow('deadbeef0006', 0), alias: 'left pane' }] });
  assert.deepEqual(await dao.listAll(), [
    { url: '', title: 'Zellij', favicon: '', position: 0, kind: 'zellij', instanceId: 'deadbeef0006' }
  ]);

  // 补上那一列之后,同一个 DAO 立刻恢复完整行为 —— 列的存在与否是每次现问的,不是启动时缓存的。
  const aliasMigration = maestroSqliteMigrations.find((entry) => entry.versionCode === '260914120000');
  aliasMigration.runner(current);
  await dao.replaceAll({ tabs: [{ ...zellijRow('deadbeef0007', 0), alias: 'left pane' }] });
  assert.equal((await dao.listAll())[0].alias, 'left pane');
});
