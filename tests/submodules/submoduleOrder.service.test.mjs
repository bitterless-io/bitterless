/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import test from 'node:test';
import { orderSubmodules } from '../../src/main/submodules/submoduleOrder.service.ts';
import {
  createDefaultSubmodulesViewSettings,
  isSubmoduleBranchMismatch,
  submoduleDisplayName
} from '../../src/shared/submodules/submodules.type.ts';

const entry = (path, { configuredBranch = 'main', branch = 'main', changedAt = null } = {}) => ({
  name: path,
  path,
  absolutePath: `/root/${path}`,
  url: null,
  configuredBranch,
  branch,
  commit: 'abc1234',
  state: branch ? 'ok' : 'detached',
  errorCode: null,
  changedAt
});

const paths = (entries) => entries.map((item) => item.path);

test('the default is mismatch-first, then ASCII by directory name', () => {
  const settings = createDefaultSubmodulesViewSettings();
  assert.deepEqual(settings, { showDiffOnTop: true, sortMode: 'name' });

  const entries = [
    entry('projects/zulu'),
    entry('projects/alpha'),
    entry('projects/mike', { configuredBranch: 'main', branch: 'dev/next' }),
    entry('areas/bravo')
  ];

  // The mismatched row leads; the rest sort by their own directory name (`alpha` < `bravo` < `zulu`),
  // not by the declared path, so `areas/…` does not win just because `a` < `p`.
  assert.deepEqual(paths(orderSubmodules(entries, settings)), [
    'projects/mike',
    'projects/alpha',
    'areas/bravo',
    'projects/zulu'
  ]);
});

test('name order is ASCII on the leaf, so uppercase sorts before lowercase', () => {
  const settings = { showDiffOnTop: false, sortMode: 'name' };
  const entries = [entry('projects/apple'), entry('projects/Banana'), entry('projects/Apple')];

  // localeCompare would give apple < Apple < Banana; ASCII puts every capital first.
  assert.deepEqual(paths(orderSubmodules(entries, settings)), [
    'projects/Apple',
    'projects/Banana',
    'projects/apple'
  ]);
});

test('turning the switch off drops the mismatch group and leaves pure name order', () => {
  const entries = [
    entry('projects/zulu', { branch: 'dev/next' }),
    entry('projects/alpha'),
    entry('projects/mike')
  ];

  assert.deepEqual(paths(orderSubmodules(entries, { showDiffOnTop: false, sortMode: 'name' })), [
    'projects/alpha',
    'projects/mike',
    'projects/zulu'
  ]);
});

test('update-time order is newest first, with undated rows last and name breaking ties', () => {
  const entries = [
    entry('projects/old', { changedAt: 1_000 }),
    entry('projects/unknown'),
    entry('projects/new', { changedAt: 9_000 }),
    entry('projects/tie-b', { changedAt: 5_000 }),
    entry('projects/tie-a', { changedAt: 5_000 })
  ];

  assert.deepEqual(paths(orderSubmodules(entries, { showDiffOnTop: false, sortMode: 'updated' })), [
    'projects/new',
    'projects/tie-a',
    'projects/tie-b',
    'projects/old',
    'projects/unknown'
  ]);
});

test('both controls compose: mismatch group first, each group by newest change', () => {
  const entries = [
    entry('projects/clean-new', { changedAt: 9_000 }),
    entry('projects/diff-old', { branch: 'dev/next', changedAt: 1_000 }),
    entry('projects/clean-old', { changedAt: 2_000 }),
    entry('projects/diff-new', { branch: 'dev/next', changedAt: 8_000 })
  ];

  assert.deepEqual(paths(orderSubmodules(entries, { showDiffOnTop: true, sortMode: 'updated' })), [
    'projects/diff-new',
    'projects/diff-old',
    'projects/clean-new',
    'projects/clean-old'
  ]);
});

test('a row without a configured or current branch never counts as a mismatch', () => {
  const entries = [
    entry('projects/detached', { branch: null }),
    entry('projects/unpinned', { configuredBranch: null, branch: 'dev/next' }),
    entry('projects/aaa')
  ];

  assert.deepEqual(paths(orderSubmodules(entries, createDefaultSubmodulesViewSettings())), [
    'projects/aaa',
    'projects/detached',
    'projects/unpinned'
  ]);
});

test('ordering never mutates the input array', () => {
  const entries = [entry('projects/b'), entry('projects/a')];
  const ordered = orderSubmodules(entries, createDefaultSubmodulesViewSettings());
  assert.deepEqual(paths(entries), ['projects/b', 'projects/a']);
  assert.notEqual(ordered, entries);
});

test('the local mirrors agree with the shared display name and mismatch helpers', () => {
  // The order service inlines both predicates so it stays runtime-dependency-free; this is the guard
  // against those copies drifting from the shared contract the row itself renders.
  const cases = [
    entry('projects/bitterless'),
    entry('projects/nested/deep', { branch: 'dev/next' }),
    { ...entry('x'), path: '', name: 'section-only' },
    entry('projects/detached', { branch: null }),
    entry('projects/unpinned', { configuredBranch: null, branch: 'dev/next' }),
    entry('projects/pinned-elsewhere', { configuredBranch: 'dev/next' })
  ];

  // `aaa-clean` is never mismatched and sorts first by name, so it leads unless the candidate is
  // grouped ahead of it — which happens exactly when the service considers the candidate mismatched.
  const clean = entry('aaa/aaa-clean');
  for (const candidate of cases) {
    const ordered = orderSubmodules([clean, candidate], { showDiffOnTop: true, sortMode: 'name' });
    assert.equal(
      ordered[0].name === candidate.name,
      isSubmoduleBranchMismatch(candidate),
      `mismatch verdict must match the shared helper for ${candidate.name}`
    );
  }

  // Display-name mirror: with grouping off, two clean rows must order the way the shared helper's
  // names order, even when the declared paths would sort the other way.
  const shallow = entry('zzz/aaa-leaf');
  const deep = entry('aaa/zzz-leaf');
  const [first] = orderSubmodules([deep, shallow], { showDiffOnTop: false, sortMode: 'name' });
  const expected = submoduleDisplayName(shallow) < submoduleDisplayName(deep) ? shallow : deep;
  assert.equal(first.path, expected.path);
});
