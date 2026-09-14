import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const mocks = {
  'electron-xpc/preload': 'export class XpcPreloadHandler {}',
  './sqliteManager': 'export const sqliteManager = { get db() { return globalThis.__chatDraftDb } };'
};
const bundled = await build({
  stdin: { contents: `export { MaestroChatDao } from './src/preload/maestro/sqlite/maestroChat.dao.ts'; export { createMaestroSqliteSchema } from './src/preload/maestro/sqlite/maestroSqlite.release.ts';`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [{ name: 'chat-draft-boundary', setup(context) {
    context.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'chat-draft' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'chat-draft' }, ({ path }) => ({ contents: mocks[path] }));
  } }]
});
const { MaestroChatDao, createMaestroSqliteSchema } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
after(() => { delete globalThis.__chatDraftDb; });
const harness = t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let inTransaction = false;
  const adapter = {
    exec: sql => db.exec(sql),
    prepare: sql => {
      if (sql === 'SELECT 1 FROM cowork_chat_message WHERE session_id = ? LIMIT 1') assert.equal(inTransaction, true, 'eligibility and deletion share one transaction');
      return db.prepare(sql);
    },
    transaction: fn => (...args) => {
      db.exec('BEGIN'); inTransaction = true;
      try { const result = fn(...args); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      finally { inTransaction = false; }
    }
  };
  createMaestroSqliteSchema(adapter);
  globalThis.__chatDraftDb = adapter;
  return { dao: new MaestroChatDao(), db };
};
const session = (id, content) => ({
  id, operationTabId: '', title: 'Draft', createdAt: 1, updatedAt: 2, detail: { compressedContext: '' },
  messages: content === undefined ? [] : [{ id: `message-${id}`, source: 'cowork', role: 'human', type: 'text', content, streaming: false, ts: 2 }]
});

test('conditional draft deletion removes empty or absent sessions and refuses persisted messages', async t => {
  const { dao } = harness(t);
  await dao.saveSession({ session: session('empty') });
  await dao.saveSession({ session: session('used', 'late task result') });
  assert.deepEqual(await dao.deleteSession({ id: 'empty', onlyIfEmpty: true }), { ok: true });
  assert.equal(await dao.getSession({ id: 'empty' }), null);
  assert.deepEqual(await dao.deleteSession({ id: 'missing', onlyIfEmpty: true }), { ok: true });
  assert.deepEqual(await dao.deleteSession({ id: 'used', onlyIfEmpty: true }), { ok: false });
  assert.equal((await dao.getSession({ id: 'used' })).messages[0].content, 'late task result');
  assert.deepEqual(await dao.deleteSession({ id: 'used' }), { ok: true }, 'explicit deletion keeps its existing semantics');
  assert.equal(await dao.getSession({ id: 'used' }), null);
});

test('failed database deletion rolls back and retains the empty session', async t => {
  const { dao, db } = harness(t);
  await dao.saveSession({ session: session('protected') });
  db.exec("CREATE TRIGGER refuse_delete BEFORE DELETE ON cowork_chat_session BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END");
  await assert.rejects(dao.deleteSession({ id: 'protected', onlyIfEmpty: true }), /storage unavailable/);
  assert.equal((await dao.getSession({ id: 'protected' })).id, 'protected');
});
