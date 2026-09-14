/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const directory = mkdtempSync(join(tmpdir(), 'maestro-browser-history-'));
test.after(() => {
  delete globalThis.__browserHistoryDb;
  rmSync(directory, { recursive: true, force: true });
});

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

const mocks = {
  'electron-xpc/preload': 'export class XpcPreloadHandler {}',
  './sqliteManager':
    'export const sqliteManager = { get db() { return globalThis.__browserHistoryDb; } };'
};
const bundle = await build({
  stdin: {
    contents: `
      export { BrowserHistoryDao } from './src/preload/maestro/sqlite/browserHistory.dao.ts';
      export { normalizeBrowserHistoryUrl, normalizeBrowserHistoryFavicon }
        from './src/shared/maestro/browserHistory.service.ts';
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
  plugins: [{
    name: 'browser-history-boundary',
    setup(context) {
      context.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(mocks, path) ? { path, namespace: 'browser-history' } : undefined
      );
      context.onLoad({ filter: /.*/, namespace: 'browser-history' }, ({ path }) => ({
        contents: mocks[path], loader: 'js'
      }));
    }
  }]
});
const {
  BrowserHistoryDao,
  normalizeBrowserHistoryUrl,
  normalizeBrowserHistoryFavicon,
  createMaestroSqliteSchema,
  maestroSqliteMigrations
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const fixture = (context, path = ':memory:') => {
  const db = new DatabaseSync(path);
  context.after(() => db.close());
  globalThis.__browserHistoryDb = adapt(db);
  createMaestroSqliteSchema(globalThis.__browserHistoryDb);
  return { db, dao: new BrowserHistoryDao() };
};
const rows = (db) => db.prepare('SELECT * FROM browser_history ORDER BY last_visited_at DESC').all();

test('normalization removes userinfo, preserves distinct hash routes and rejects non-web URLs', async (context) => {
  const { db, dao } = fixture(context);
  let time = 1000;
  context.mock.method(Date, 'now', () => time++);
  await dao.record({ url: 'HTTPS://name:password@EXAMPLE.invalid:443/a/../#/order/review', title: 'Review' });
  await dao.record({ url: 'https://example.invalid/#/order/review' });
  await dao.record({ url: 'https://example.invalid/#/order/list' });
  for (const url of ['file:///tmp/local.html', 'about:blank', 'bitterless://home', 'javascript:alert(1)', 'data:text/plain,home', '', 'not a URL']) {
    await dao.record({ url });
    assert.equal(normalizeBrowserHistoryUrl(url), null);
  }
  const saved = rows(db);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].url, 'https://example.invalid/#/order/review');
  assert.equal(saved[1].title, 'Review');
  assert.equal(saved[1].visit_count, 2);
  assert.equal(saved[1].last_visited_at, 1001);
  assert.equal(db.prepare('SELECT typeof(last_visited_at) AS type FROM browser_history LIMIT 1').get().type, 'integer');
});

test('1000-row retention prunes the oldest and a revisit refreshes recency before eviction', async (context) => {
  const { db, dao } = fixture(context);
  let time = 1700000000000;
  context.mock.method(Date, 'now', () => time++);
  for (let index = 0; index < 1000; index++) {
    await dao.record({ url: `https://retention.invalid/${index}`, title: `Page ${index}` });
  }
  await dao.record({ url: 'https://retention.invalid/0' });
  await dao.record({ url: 'https://retention.invalid/1000' });
  await dao.record({ url: 'https://retention.invalid/1001' });
  assert.equal(rows(db).length, 1000);
  assert.equal(db.prepare('SELECT visit_count FROM browser_history WHERE url = ?').get('https://retention.invalid/0').visit_count, 2);
  for (const index of [1, 2]) {
    assert.equal(db.prepare('SELECT url FROM browser_history WHERE url = ?').get(`https://retention.invalid/${index}`), undefined);
  }
  const recent = await dao.search({ query: '' });
  assert.equal(recent.length, 8);
  assert.equal(recent[0].url, 'https://retention.invalid/1001');
});

test('visit upsert and retention execute atomically if pruning fails', async (context) => {
  const { db, dao } = fixture(context);
  let time = 2000;
  context.mock.method(Date, 'now', () => time++);
  for (let index = 0; index < 1000; index++) await dao.record({ url: `https://atomic.invalid/${index}` });
  db.exec("CREATE TRIGGER reject_history_prune BEFORE DELETE ON browser_history BEGIN SELECT RAISE(ABORT, 'blocked prune'); END");
  await assert.rejects(dao.record({ url: 'https://atomic.invalid/new' }), /blocked prune/);
  assert.equal(rows(db).length, 1000);
  assert.equal(db.prepare('SELECT url FROM browser_history WHERE url = ?').get('https://atomic.invalid/new'), undefined);
});

test('late metadata updates preserve count/time, ignore unavailable fields and never recreate removed history', async (context) => {
  const { db, dao } = fixture(context);
  context.mock.method(Date, 'now', () => 9000);
  const url = 'https://metadata.invalid/';
  await dao.record({ url, title: 'First', favicon: 'https://icons.invalid/first.png' });
  await dao.updateMetadata({ url, title: 'Late title', favicon: 'https://icons.invalid/late.png' });
  await dao.updateMetadata({ url, title: '', favicon: 'file:///private/icon.png' });
  const [entry] = await dao.search({ query: 'Late title' });
  assert.deepEqual({ ...entry }, { url, title: 'Late title', favicon: 'https://icons.invalid/late.png', visitCount: 1, lastVisitedAt: 9000 });
  await dao.remove({ url: 'https://ignored:secret@metadata.invalid/' });
  await dao.updateMetadata({ url, title: 'Too late' });
  assert.equal(rows(db).length, 0);
  await dao.record({ url });
  assert.equal(rows(db)[0].visit_count, 1);
});

test('history persists across close/reopen and the idempotent upgrade creates the fresh schema', async (context) => {
  const path = join(directory, 'reopen.db');
  const db = new DatabaseSync(path);
  const migration = maestroSqliteMigrations.find((entry) => entry.versionCode === '260914160000');
  assert.ok(migration, 'browser history has an explicit upgrade migration');
  migration.runner(adapt(db));
  migration.runner(adapt(db));
  globalThis.__browserHistoryDb = adapt(db);
  const dao = new BrowserHistoryDao();
  await dao.record({ url: 'https://persist.invalid/#/orders', title: 'Orders' });
  const saved = await dao.search({ query: '' });
  db.close();
  const reopened = new DatabaseSync(path);
  context.after(() => reopened.close());
  globalThis.__browserHistoryDb = adapt(reopened);
  createMaestroSqliteSchema(globalThis.__browserHistoryDb);
  assert.deepEqual(await dao.search({ query: '' }), saved);
  assert.equal(reopened.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_browser_history_recency'").get().count, 1);
  const fresh = new DatabaseSync(':memory:');
  context.after(() => fresh.close());
  createMaestroSqliteSchema(adapt(fresh));
  assert.deepEqual(reopened.prepare('PRAGMA table_info(browser_history)').all(), fresh.prepare('PRAGMA table_info(browser_history)').all());
});

test('matching is literal, case-insensitive and includes Unicode titles and encoded URLs', async (context) => {
  const { dao } = fixture(context);
  await dao.record({ url: 'https://literal.invalid/a', title: '100% complete' });
  await dao.record({ url: 'https://literal.invalid/b', title: 'under_score' });
  await dao.record({ url: 'https://literal.invalid/c', title: '100X complete' });
  await dao.record({ url: 'https://unicode.invalid/发现?bad=%ZZ', title: '中文页面 CAFÉ' });
  assert.deepEqual((await dao.search({ query: '%' })).map((entry) => entry.title).sort(), ['100% complete', '中文页面 CAFÉ'].sort());
  assert.deepEqual((await dao.search({ query: '_' })).map((entry) => entry.title), ['under_score']);
  assert.equal((await dao.search({ query: '发现' }))[0].url, 'https://unicode.invalid/%E5%8F%91%E7%8E%B0?bad=%ZZ');
  assert.equal((await dao.search({ query: '中文' }))[0].title, '中文页面 CAFÉ');
  assert.equal((await dao.search({ query: 'cafe\u0301' }))[0].title, '中文页面 CAFÉ');
  assert.equal((await dao.search({ query: "' OR 1=1 --" })).length, 0);
});

test('matching ranks exact then prefix before recent substrings with deterministic count ties', async (context) => {
  const { dao } = fixture(context);
  let time = 1;
  context.mock.method(Date, 'now', () => time++);
  await dao.record({ url: 'https://rank.invalid/exact', title: 'Docs' });
  await dao.record({ url: 'https://rank.invalid/prefix', title: 'Docs guide' });
  await dao.record({ url: 'https://rank.invalid/substring', title: 'Latest docs' });
  assert.deepEqual((await dao.search({ query: 'DOCS' })).map((entry) => entry.title), ['Docs', 'Docs guide', 'Latest docs']);
  assert.equal((await dao.search({ query: 'rank.invalid/exact' }))[0].title, 'Docs');
  context.mock.restoreAll();
  context.mock.method(Date, 'now', () => 100);
  await dao.record({ url: 'https://tie.invalid/b', title: 'Tied' });
  await dao.record({ url: 'https://tie.invalid/a', title: 'Tied' });
  await dao.record({ url: 'https://tie.invalid/c', title: 'Tied' });
  await dao.record({ url: 'https://tie.invalid/c', title: 'Tied' });
  assert.deepEqual((await dao.search({ query: 'Tied' })).map((entry) => entry.url), ['https://tie.invalid/c', 'https://tie.invalid/a', 'https://tie.invalid/b']);
});

test('metadata accepts safe bounded favicons and caps title/URL payloads', async (context) => {
  const { dao } = fixture(context);
  assert.equal(normalizeBrowserHistoryFavicon('https://user:pass@icon.invalid/icon.png'), 'https://icon.invalid/icon.png');
  for (const favicon of ['javascript:alert(1)', 'file:///private/icon.png', 'data:text/html,hello', `data:image/png;base64,${'a'.repeat(131072)}`]) {
    assert.equal(normalizeBrowserHistoryFavicon(favicon), '');
  }
  assert.equal(normalizeBrowserHistoryFavicon('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
  await dao.record({ url: 'https://bounds.invalid/', title: 'x'.repeat(3000), favicon: 'file:///private/icon.png' });
  await dao.record({ url: `https://bounds.invalid/${'x'.repeat(16384)}` });
  const saved = await dao.search({ query: '' });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title.length, 2048);
  assert.equal(saved[0].favicon, '');
});
