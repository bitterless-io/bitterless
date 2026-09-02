import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeCurrentVue,
  bounds,
  ContractError,
  createHarness,
  descriptorFor,
  fileRef,
  host,
  state
} from './onlyPreviewPreviewRegionTest.helper.mjs';

test('a watch commit rerenders the selected file only when that file itself changed', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  acknowledgeCurrentVue(service);

  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  const presented = service.snapshot(host.hostToken).selectionRevision;
  assert.equal(state.projectAuthorizations.length, 0);

  // A bounded commit that never names the selected file does not even ask the authority.
  await service.handleWatchCommit(host.hostToken, {
    workspaceId: 'workspace-id',
    generation: 1,
    revision: 1,
    full: false,
    changedRelativePaths: ['notes/other.md']
  });
  assert.equal(state.projectAuthorizations.length, 0);
  assert.equal(service.snapshot(host.hostToken).selectionRevision, presented);

  // A full reconcile caused by an unrelated file leaves the mounted surface alone.
  await service.handleWatchCommit(host.hostToken, {
    workspaceId: 'workspace-id',
    generation: 1,
    revision: 2,
    full: true,
    changedRelativePaths: []
  });
  assert.deepEqual(state.projectAuthorizations, [
    { workspaceId: 'workspace-id', workspaceGeneration: 23, relativePath: 'notes/readme.md' }
  ]);
  assert.equal(service.snapshot(host.hostToken).selectionRevision, presented);

  // The same commit shape rerenders once the selected file's own bytes moved.
  state.authorizeProjectItem = async ({ relativePath }) => ({
    relativePath,
    nodeKind: 'file',
    size: 9,
    modifiedAt: 5
  });
  state.describe = async () => ({
    ...descriptorFor('notes/readme.md', 'text'),
    size: 9,
    modifiedAt: 5
  });
  await service.handleWatchCommit(host.hostToken, {
    workspaceId: 'workspace-id',
    generation: 1,
    revision: 3,
    full: true,
    changedRelativePaths: []
  });
  const rerendered = service.snapshot(host.hostToken).selectionRevision;
  assert.equal(rerendered, presented + 1);

  // The refreshed descriptor settles again, so the next unrelated full commit is quiet.
  await service.handleWatchCommit(host.hostToken, {
    workspaceId: 'workspace-id',
    generation: 1,
    revision: 4,
    full: true,
    changedRelativePaths: []
  });
  assert.equal(service.snapshot(host.hostToken).selectionRevision, rerendered);

  // A deleted selection stops rendering its content and reports the typed missing state.
  state.authorizeProjectItem = async () => {
    throw new ContractError('PATH_NOT_FOUND', 'The selected Project item is gone.');
  };
  state.describe = async () => {
    throw new ContractError('PATH_NOT_FOUND', 'The selected Project item is gone.');
  };
  await service.handleWatchCommit(host.hostToken, {
    workspaceId: 'workspace-id',
    generation: 1,
    revision: 5,
    full: true,
    changedRelativePaths: []
  });
  const missing = service.snapshot(host.hostToken);
  assert.equal(missing.selectionRevision, rerendered + 1);
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.error.code, 'PATH_NOT_FOUND');
  assert.equal(missing.fileRef.relativePath, 'notes/readme.md');
});
