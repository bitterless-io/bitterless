/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime } from './onlyPreviewCoreTest.helper.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const finishSelectionAfter = async (coordinator, hostToken, fileRef, gate, onSelect) => {
  const generation = coordinator.beginSelection(hostToken, fileRef);
  await gate.promise;
  const current = coordinator.isCurrent(hostToken, generation);
  if (current) onSelect(fileRef);
  coordinator.finishSelection(hostToken, generation);
  return current;
};

const deleteAndInvalidateAfterSuccess = async (
  coordinator,
  hostToken,
  fileRef,
  deleteOperation
) => {
  await deleteOperation();
  return coordinator.invalidatePendingSelection(hostToken, fileRef);
};

test('deleting unselected A does not cancel an in-flight selection B', async () => {
  const coordinator = new runtime.OnlyPreviewSelectionCoordinator();
  const hostToken = 'host-delete-unselected';
  const fileA = { workspaceId: 'workspace', relativePath: 'a.md' };
  const fileB = { workspaceId: 'workspace', relativePath: 'b.md' };
  const selectionGate = deferred();
  let selected = null;
  const selectingB = finishSelectionAfter(
    coordinator,
    hostToken,
    fileB,
    selectionGate,
    (fileRef) => {
      selected = fileRef;
    }
  );

  assert.equal(
    await deleteAndInvalidateAfterSuccess(coordinator, hostToken, fileA, async () => undefined),
    false
  );
  selectionGate.resolve();

  assert.equal(await selectingB, true);
  assert.deepEqual(selected, fileB);
});

test('selection B started after confirming deletion of selected A remains current after success', async () => {
  const coordinator = new runtime.OnlyPreviewSelectionCoordinator();
  const hostToken = 'host-delete-selected';
  const fileA = { workspaceId: 'workspace', relativePath: 'a.md' };
  const fileB = { workspaceId: 'workspace', relativePath: 'b.md' };
  let selected = fileA;

  const selectionGate = deferred();
  const selectingB = finishSelectionAfter(
    coordinator,
    hostToken,
    fileB,
    selectionGate,
    (fileRef) => {
      selected = fileRef;
    }
  );

  assert.equal(
    await deleteAndInvalidateAfterSuccess(coordinator, hostToken, fileA, async () => undefined),
    false
  );
  if (
    selected.workspaceId === fileA.workspaceId &&
    selected.relativePath === fileA.relativePath
  ) {
    selected = null;
  }
  selectionGate.resolve();

  assert.equal(await selectingB, true);
  assert.deepEqual(selected, fileB);
});

test('successful deletion invalidates only the exact pending target intent', async () => {
  const coordinator = new runtime.OnlyPreviewSelectionCoordinator();
  const hostToken = 'host-delete-pending-target';
  const fileA = { workspaceId: 'workspace', relativePath: 'a.md' };
  const generation = coordinator.beginSelection(hostToken, fileA);

  assert.equal(
    await deleteAndInvalidateAfterSuccess(coordinator, hostToken, fileA, async () => undefined),
    true
  );
  assert.equal(coordinator.isCurrent(hostToken, generation), false);
});

test('failed deletion leaves the exact pending target intent current', async () => {
  const coordinator = new runtime.OnlyPreviewSelectionCoordinator();
  const hostToken = 'host-delete-failure';
  const fileA = { workspaceId: 'workspace', relativePath: 'a.md' };
  const generation = coordinator.beginSelection(hostToken, fileA);
  const failure = new Error('delete failed');

  await assert.rejects(
    deleteAndInvalidateAfterSuccess(coordinator, hostToken, fileA, async () => {
      throw failure;
    }),
    failure
  );

  assert.equal(coordinator.isCurrent(hostToken, generation), true);
});
