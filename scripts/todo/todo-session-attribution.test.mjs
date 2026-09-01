import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

// The classifier is deliberately free of Vue, i18n, and XPC imports so it can execute here instead
// of being asserted only as source text.
const loadClassifier = async () => {
  const source = read('src/renderer/todo/src/store/todoSessionState.service.ts');
  const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'node22' });
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const withSilencedWarnings = async (run) => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = original;
  }
};

test('an inactive sync session is reported as a sign-in requirement', async () => {
  const { resolveTodoUnavailableReason } = await loadClassifier();
  assert.equal(
    await resolveTodoUnavailableReason({ getStatus: async () => ({ active: false }) }),
    'sessionRequired'
  );
});

test('an active sync session keeps the local runtime failure reason', async () => {
  const { resolveTodoUnavailableReason } = await loadClassifier();
  assert.equal(
    await resolveTodoUnavailableReason({ getStatus: async () => ({ active: true }) }),
    'runtimeUnavailable'
  );
});

test('a failing session probe degrades to the local runtime failure reason', async () => {
  const { resolveTodoUnavailableReason } = await loadClassifier();
  const { result, warnings } = await withSilencedWarnings(
    async () =>
      await resolveTodoUnavailableReason({
        getStatus: async () => {
          throw new Error('xpc timeout');
        }
      })
  );
  assert.equal(result, 'runtimeUnavailable');
  assert.equal(warnings.length, 1);
});

test('every Todo failure surface classifies before naming a cause', () => {
  const board = read('src/renderer/todo/src/App.vue');
  const mutation = read('src/renderer/todo/src/store/todoMutation.service.ts');
  const homePlaceholder = read('src/renderer/home/src/views/todo/Todo.vue');

  for (const [name, source] of [
    ['Todo board', board],
    ['Todo mutation', mutation]
  ]) {
    assert.match(
      source,
      /resolveTodoUnavailableReason\(todoistSyncStatusEmitter\)/,
      `${name} must resolve its reason from the sync session`
    );
    assert.match(
      source,
      /Message\.error\(i18nHelper\.todo\[[^\]]+\]\)/,
      `${name} must name the cause from the resolved reason`
    );
    assert.doesNotMatch(
      source,
      /i18nHelper\.todo\.runtimeUnavailable/,
      `${name} must not name the local data runtime unconditionally`
    );
  }

  assert.match(
    homePlaceholder,
    /authStore\.current \? i18nHelper\.todo\.runtimeUnavailable : i18nHelper\.todo\.sessionRequired/
  );
});

test('both languages own the sign-in message', () => {
  for (const path of ['src/renderer/common/i18n/en.ts', 'src/renderer/common/i18n/zh.ts']) {
    assert.match(read(path), /\n {4}sessionRequired:/, `${path} must define todo.sessionRequired`);
  }
});
