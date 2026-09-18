/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Ral, 2026-09-18:「bl cowork 中 技能要能用/触发,及将技能列表拼到现有 slash short cut 后面
// 不需要单独的 skill select 组件」. Contract: docs/features/maestro-slash-commands.md
// 「Skills in the slash menu」; micromeet-cowork carries the paired change and its own guard
// assertions inside `check:slash-commands`.
//
// The store is deliberately dependency-free (one `import type`), which is exactly why the ordering,
// the default selection and the commit shape can be asserted here without a DOM, Electron or Vue —
// the three things this kind of panel breaks in silently.
const root = resolve(import.meta.dirname, '../..');
const result = await build({
  entryPoints: [resolve(root, 'src/renderer/maestro/control/src/store/shortcut.store.ts')],
  tsconfig: resolve(root, 'tsconfig.node.json'),
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external'
});
const module = { exports: {} };
runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(resolve(root, 'package.json')), console });
const { ShortcutStore, slashTokenAt } = module.exports;

const COMMANDS = [
  { kind: 'command', name: '/view_context', hint: 'copy the next turn context' },
  { kind: 'command', name: '/clear', hint: 'start a fresh chat' },
  { kind: 'command', name: '/compact', hint: 'compact now' }
];
const skillRow = (name, layer, reference) => ({
  kind: 'skill', name: `/${name}`, hint: `${layer} · /tmp/${name}/SKILL.md`,
  skill: { reference, name, layer, path: `/tmp/${name}/SKILL.md` }
});
const SKILLS = [skillRow('zzz-probe', 'workspace', 'workspace:z'), skillRow('aaa-probe', 'global', 'shared:a')];
const staged = (skills = SKILLS) => {
  const store = new ShortcutStore(COMMANDS.slice());
  store.registerSkills(skills.slice());
  store.update({ query: '', start: 0, end: 1 });
  return store;
};
// The store is loaded through runInNewContext, so everything it returns carries that realm's
// Array/Object prototype and deepEqual (which compares prototypes) fails on identical values.
// Copy into this realm before asserting.
const names = store => [...store.matches].map(item => item.name);

test('commands keep their ASCII order and every skill comes after them', () => {
  const commandsOnly = new ShortcutStore(COMMANDS.slice());
  commandsOnly.update({ query: '', start: 0, end: 1 });
  const before = names(commandsOnly);
  assert.deepEqual(before, [...before].sort(), 'the command block must stay ASCII-sorted');

  const store = staged();
  const listed = names(store);
  assert.deepEqual(listed.slice(0, before.length), before, 'commands must keep their exact order once skills exist');
  assert.deepEqual(listed.slice(before.length), ['/aaa-probe', '/zzz-probe'], 'the skill block must be ASCII-sorted on its own');
});

test('with no skills the menu is byte-identical to before', () => {
  const plain = new ShortcutStore(COMMANDS.slice());
  plain.update({ query: '', start: 0, end: 1 });
  assert.deepEqual(names(staged([])), names(plain));
});

test('the query filters commands and skills together, and the first match stays selected', () => {
  const store = staged();
  store.update({ query: 'probe', start: 0, end: 6 });
  assert.deepEqual(names(store), ['/aaa-probe', '/zzz-probe'], 'a skill-only query must drop every command');
  assert.equal(store.active.name, '/aaa-probe', 'the first match is selected by default');
  store.update({ query: 'clear', start: 0, end: 6 });
  assert.deepEqual(names(store), ['/clear']);
});

test('committing a skill returns it to attach and never runs a command', async () => {
  const store = staged();
  store.update({ query: 'aaa', start: 0, end: 4 });
  const ran = [];
  const context = new Proxy({}, { get: (_t, key) => async () => { ran.push(String(key)); } });
  const commit = await store.commit(context);
  assert.equal(commit.ok, true);
  assert.equal(commit.skill?.reference, 'shared:a', 'the panel must hand back the skill it selected');
  assert.deepEqual(ran, [], 'selecting a skill must not execute any command');
  assert.equal(store.open, false, 'committing must close the panel');
  assert.equal(store.pending, false, 'a skill commit must not leave the panel pending');
});

test('a command still runs, and an unknown one still fails visibly', async () => {
  const store = staged();
  store.update({ query: 'clear', start: 0, end: 6 });
  let cleared = 0;
  const commandCommit = await store.commit({ newChat: async () => { cleared += 1; return true; } });
  assert.equal(commandCommit.ok, true);
  assert.equal(commandCommit.skill, undefined, 'a command commit must not look like a skill attachment');
  assert.equal(cleared, 1);

  // The `default:` branch is what turns "a command was added but never dispatched" into a visible
  // failure instead of a wrong action. Narrowing must not have quietly removed it.
  const stray = new ShortcutStore([{ kind: 'command', name: '/not_dispatched', hint: 'never wired up' }]);
  stray.update({ query: '', start: 0, end: 1 });
  const result = await stray.commit({});
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown command \/not_dispatched/);
});

test('the slash token still refuses paths and mid-word slashes', () => {
  assert.equal(slashTokenAt('/aaa-probe', 10)?.query, 'aaa-probe', 'a skill name is a valid token');
  assert.equal(slashTokenAt('~/Downloads/a.pdf', 17), null, 'a path must not open the panel');
  assert.equal(slashTokenAt('and/or', 6), null, 'a mid-word slash must not open the panel');
});
