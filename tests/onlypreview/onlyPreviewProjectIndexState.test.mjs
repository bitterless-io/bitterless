/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-index-state-'));
const bundlePath = join(buildRoot, 'indexState.mjs');
const broadcasts = [];
globalThis.__onlyPreviewIndexStateBroadcasts = broadcasts;

await build({
  entryPoints: [join(projectRoot, 'src/main/onlypreview/onlyPreviewProjectIndexState.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  alias: { 'electron-xpc/main': join(projectRoot, 'tests/onlypreview/fixtures/xpcMain.stub.mjs') }
});

const { OnlyPreviewProjectIndexStateService } = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const service = () => {
  broadcasts.length = 0;
  return new OnlyPreviewProjectIndexStateService();
};

test('a bound Project is building before its index can exist', () => {
  const state = service();
  assert.equal(state.get('workspace-a'), null);
  state.markBound('host-1', 'workspace-a');
  assert.equal(state.get('workspace-a'), 'building');
  // Scoped to its workspace: another Project must not inherit this one's progress.
  assert.equal(state.get('workspace-b'), null);
  assert.equal(state.get(null), null);
  assert.deepEqual(broadcasts, [
    { eventName: 'onlypreview/previewPresentation', params: { hostId: 'host-1' } }
  ]);
});

test('ready latches, so ordinary file churn cannot re-show the loading state', () => {
  const state = service();
  state.markBound('host-1', 'workspace-a');
  state.markObserved('host-1', 'workspace-a', 'ready');
  assert.equal(state.get('workspace-a'), 'ready');
  // The search engine re-enters building/reconciling on every watch-driven refresh — a save, a
  // checkout, a build touching files. Forwarding that would flip the pane back to "Loading
  // project" on a Project that is already usable.
  state.markObserved('host-1', 'workspace-a', 'reconciling');
  state.markObserved('host-1', 'workspace-a', 'building');
  assert.equal(state.get('workspace-a'), 'ready');
  state.markFailed('host-1', 'workspace-a');
  assert.equal(state.get('workspace-a'), 'ready');
  // Only a fresh bind starts a new build as far as this pane is concerned.
  state.markBound('host-1', 'workspace-a');
  assert.equal(state.get('workspace-a'), 'building');
});

test('a stale workspace or host can never overwrite the current Project', () => {
  const state = service();
  state.markBound('host-1', 'workspace-a');
  state.markObserved('host-1', 'workspace-b', 'ready');
  state.markObserved('host-2', 'workspace-a', 'ready');
  state.markFailed('host-1', 'workspace-b');
  state.markFailed('host-2', 'workspace-a');
  assert.equal(state.get('workspace-a'), 'building');
});

test('an abandoned bind is cleared instead of animating over an empty tree', () => {
  const state = service();
  state.markBound('host-1', 'workspace-a');
  // A bind can succeed and then be discarded — superseded generation, non-canonical directory, a
  // revoked host — without the presentation ever naming that workspace.
  state.clear('workspace-b');
  assert.equal(state.get('workspace-a'), 'building', 'clearing another workspace is a no-op');
  state.clear('workspace-a');
  assert.equal(state.get('workspace-a'), null);
  state.markBound('host-1', 'workspace-a');
  state.clear();
  assert.equal(state.get('workspace-a'), null);
});

test('a failed first build is terminal, and every change republishes exactly once', () => {
  const state = service();
  state.markBound('host-1', 'workspace-a');
  state.markObserved('host-1', 'workspace-a', 'building');
  assert.equal(broadcasts.length, 1, 'an unchanged state must not republish');
  state.markObserved('host-1', 'workspace-a', 'reconciling');
  state.markFailed('host-1', 'workspace-a');
  assert.equal(state.get('workspace-a'), 'failed');
  state.markFailed('host-1', 'workspace-a');
  state.markObserved('host-1', 'workspace-a', 'building');
  assert.equal(state.get('workspace-a'), 'building', 'a later real build is still observable');
  assert.deepEqual(
    broadcasts.map(({ params }) => params.hostId),
    ['host-1', 'host-1', 'host-1', 'host-1']
  );
});

test('every index-state transition leaves a record', () => {
  // `ready` latches, so a Project whose index never reports it answers `building` for the whole
  // session. Until 2026-09-04 that was invisible in every record we keep — the pane only surfaces
  // the state when nothing else is selected — so diagnosing it meant re-reading the source.
  const state = service();
  const traced = [];
  state.setTrace((event, fields) => traced.push({ event, ...fields }));

  state.markBound('host-1', 'workspace-a');
  state.markObserved('host-1', 'workspace-a', 'reconciling');
  state.markObserved('host-1', 'workspace-a', 'ready');
  state.markObserved('host-1', 'workspace-a', 'building');
  state.markObserved('host-1', 'workspace-b', 'building');
  state.clear('workspace-a');

  assert.deepEqual(traced, [
    { event: 'project-index', workspaceId: 'workspace-a', from: 'none', to: 'building' },
    { event: 'project-index', workspaceId: 'workspace-a', from: 'building', to: 'reconciling' },
    { event: 'project-index', workspaceId: 'workspace-a', from: 'reconciling', to: 'ready' },
    { event: 'project-index', workspaceId: 'workspace-a', from: 'ready', to: 'cleared' }
  ]);
});

test('a service without a wired trace still publishes', () => {
  const state = service();
  state.markBound('host-1', 'workspace-a');
  assert.equal(state.get('workspace-a'), 'building');
});
