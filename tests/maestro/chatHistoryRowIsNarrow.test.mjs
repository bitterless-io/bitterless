/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * A save must refresh ONE history row, and that row must be the same row the full list would give.
 *
 * Before this, every successful save ended in `listSessions()` — a join over every message of every
 * session plus one correlated preview subquery per session — to recompute counts and previews that
 * could not have changed. While a save already rewrote the whole session that recount was a
 * rounding error; once the write became proportional to the edit it was the remaining
 * whole-database cost on every save (docs/issues/every-save-recounts-the-whole-history.md).
 *
 * Two things have to hold, and neither is visible from the renderer:
 *  · **equivalence** — `getSessionSummary(id)` deep-equals the entry `listSessions()` produces for
 *    that id, for archived sessions, empty sessions, and sessions whose last message is excluded
 *    from the preview. If it can drift, the narrow refresh silently shows a stale list;
 *  · **narrowness** — the single-session query reads only its own message rows. A query that is
 *    "narrow" in its result but still scans the table has moved no cost at all, and nothing in the
 *    result would ever reveal that, so it is asserted against the query plan.
 */
const root = resolve(import.meta.dirname, '../..');
const directory = mkdtempSync(join(tmpdir(), 'maestro-chat-history-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

/** `node:sqlite` has no `db.transaction(fn)`; better-sqlite3 does, and the DAO uses it. */
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
  // `deleteSession` refuses to drop a chat unless workflow cleanup is acknowledged, so the emitter
  // stub has to acknowledge rather than return undefined — otherwise the test would be asserting
  // against that guard instead of against the history row.
  'electron-xpc/preload': `
    export class XpcPreloadHandler {}
    const replies = { listRuns: { runs: [] } };
    export const createXpcPreloadEmitter = () => new Proxy({}, {
      get: (_target, name) => async () => replies[name] ?? { ok: true }
    });
  `,
  './sqliteManager': 'export const sqliteManager = { get db() { return globalThis.__chatDb } };'
};

const bundled = await build({
  stdin: {
    contents: `
      export { MaestroChatDao } from './src/preload/maestro/sqlite/maestroChat.dao.ts';
      export { createMaestroSqliteSchema } from './src/preload/maestro/sqlite/maestroSqlite.release.ts';
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
      name: 'chat-dao-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'chat-dao' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'chat-dao' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const { MaestroChatDao, createMaestroSqliteSchema } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const message = (id, overrides = {}) => ({
  id,
  source: 'cowork',
  role: 'human',
  type: 'text',
  content: `content ${id}`,
  ts: 1,
  ...overrides
});

const seed = () => {
  const db = new DatabaseSync(join(directory, `chat-${Math.random().toString(36).slice(2)}.db`));
  createMaestroSqliteSchema(adapt(db));
  globalThis.__chatDb = adapt(db);
  const dao = new MaestroChatDao();
  return { db, dao };
};

const session = (id, updatedAt, messages, extra = {}) => ({
  id,
  operationTabId: 'tab',
  title: `title ${id}`,
  createdAt: 1,
  updatedAt,
  detail: { compressedContext: '' },
  messages,
  ...extra
});

/** Every shape whose summary is computed differently, in one fixture. */
const fixture = async (dao) => {
  await dao.saveSession({ session: session('busy', 300, [message('a'), message('b'), message('c')]) });
  await dao.saveSession({ session: session('empty', 200, []) });
  await dao.saveSession({ session: session('archived', 100, [message('d')], { archivedAt: 50 }) });
  // The preview must skip these three and fall back to the newest message that qualifies.
  await dao.saveSession({
    session: session('excluded', 400, [
      message('keep', { content: 'visible preview' }),
      message('blank', { content: '' }),
      message('hidden', { content: 'internal', promptExcluded: true }),
      message('summary', { content: 'compacted', type: 'compact' })
    ])
  });
};

test('one session summary deep-equals that session’s entry in the full list', async () => {
  const { dao } = seed();
  await fixture(dao);

  const list = await dao.listSessions({});
  assert.equal(list.length, 4);

  for (const entry of list) {
    const narrow = await dao.getSessionSummary({ id: entry.id });
    assert.deepEqual(narrow, entry, `${entry.id}: the narrow row must be the list row, field for field`);
  }

  // Spot-check the derived fields themselves, so an equivalence that is "both wrong" still fails.
  const byId = Object.fromEntries(list.map((entry) => [entry.id, entry]));
  assert.equal(byId.busy.messageCount, 3);
  assert.equal(byId.empty.messageCount, 0);
  assert.equal(byId.empty.preview, '');
  assert.equal(byId.archived.archivedAt, 50);
  assert.equal(byId.excluded.messageCount, 4, 'the count includes messages the preview skips');
  assert.equal(byId.excluded.preview, 'visible preview', 'empty / prompt-excluded / compact are not previews');
});

test('a missing session reports null, so the caller drops the row instead of keeping a stale one', async () => {
  const { dao } = seed();
  await fixture(dao);
  assert.equal(await dao.getSessionSummary({ id: 'gone' }), null);

  await dao.deleteSession({ id: 'busy' });
  assert.equal(await dao.getSessionSummary({ id: 'busy' }), null);
});

test('the narrow row tracks its own session and no other', async () => {
  const { dao } = seed();
  await fixture(dao);
  const before = await dao.getSessionSummary({ id: 'empty' });

  await dao.saveSession({ session: session('busy', 999, [message('a'), message('b'), message('c'), message('e')]) });

  assert.deepEqual(await dao.getSessionSummary({ id: 'empty' }), before, 'an untouched session’s row must not move');
  const after = await dao.getSessionSummary({ id: 'busy' });
  assert.equal(after.messageCount, 4);
  assert.equal(after.updatedAt, 999);
  assert.deepEqual(after, (await dao.listSessions({})).find((entry) => entry.id === 'busy'));
});

test('the single-session query reads only its own message rows — asserted on the query plan', async () => {
  const { db, dao } = seed();
  await fixture(dao);

  // Capture the SQL the DAO actually runs, rather than restating it here and testing the restatement.
  const statements = [];
  const inner = globalThis.__chatDb;
  globalThis.__chatDb = { ...inner, prepare: (sql) => { statements.push(sql); return inner.prepare(sql); } };
  await dao.getSessionSummary({ id: 'busy' });
  globalThis.__chatDb = inner;

  assert.equal(statements.length, 1, 'one statement — a summary is one read, not a fan-out');
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${statements[0]}`).all('busy').map((row) => row.detail);

  const scans = plan.filter((detail) => /^SCAN /.test(detail) && detail.includes('cowork_chat_message'));
  assert.deepEqual(
    scans,
    [],
    `the message table must never be scanned for one session's summary — plan was:\n${plan.join('\n')}`
  );
  assert.ok(
    plan.some((detail) => detail.includes('cowork_chat_message') && detail.includes('idx_cowork_chat_message_session')),
    `the per-session index must carry both the count and the preview — plan was:\n${plan.join('\n')}`
  );
});
