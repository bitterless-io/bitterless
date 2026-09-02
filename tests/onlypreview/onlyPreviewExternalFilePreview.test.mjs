/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bounds,
  createHarness,
  deferred,
  descriptorFor,
  host,
  source,
  state
} from './onlyPreviewPreviewRegionTest.helper.mjs';

const externalRef = (relativePath) => ({
  workspaceId: 'external-workspace-id',
  relativePath
});

test('every presentation binds its private Project or external reader authority without leaking the root', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const externalTextRef = externalRef('report.md');
  state.describe = async () => ({
    ...descriptorFor(externalTextRef.relativePath, 'text'),
    workspaceId: externalTextRef.workspaceId
  });

  await service.present(host.hostToken, externalTextRef);

  assert.deepEqual(state.previewBinds.at(-1), {
    workspaceId: externalTextRef.workspaceId,
    workspaceGeneration: 1,
    rootPath: '/external/private'
  });
  assert.equal(state.previewPrepares.at(-1).workspaceId, externalTextRef.workspaceId);
  assert.equal(
    JSON.stringify(service.snapshot(host.hostToken)).includes('/external/private'),
    false
  );

  const externalOfficeRef = externalRef('report.docx');
  await service.present(host.hostToken, externalOfficeRef);

  assert.deepEqual(state.officeBinds.at(-1), {
    workspaceId: externalOfficeRef.workspaceId,
    rootPath: '/external/private'
  });
  assert.equal(state.officePrepares.at(-1).workspaceId, externalOfficeRef.workspaceId);
  assert.equal(
    JSON.stringify(service.snapshot(host.hostToken)).includes('/external/private'),
    false
  );
  service.destroy();
});

test('workspace revocation immediately empties an active Office presentation and its broker authority', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const fileRef = externalRef('report.docx');

  await service.present(host.hostToken, fileRef);
  service.handleWorkspaceRevoked(host.hostToken, fileRef.workspaceId);

  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.status, 'empty');
  assert.equal(snapshot.workspaceId, null);
  assert.equal(snapshot.fileRef, null);
  assert.equal(
    state.officeCancels.some((request) => request.grantId === 'office-grant-for-tests'),
    true
  );
  service.destroy();
});

test('workspace revocation fences a pending text preparation before it can publish', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const fileRef = externalRef('pending.md');
  state.describe = async () => ({
    ...descriptorFor(fileRef.relativePath, 'text'),
    workspaceId: fileRef.workspaceId
  });
  const prepare = { started: deferred(), completion: deferred() };
  state.nextPreviewPrepareDeferred = prepare;
  const presentation = service.present(host.hostToken, fileRef);
  const grant = await prepare.started.promise;

  service.handleWorkspaceRevoked(host.hostToken, fileRef.workspaceId);
  prepare.completion.resolve();
  await presentation;

  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.status, 'empty');
  assert.equal(snapshot.fileRef, null);
  assert.equal(
    state.previewCancels.some(
      (request) =>
        request.grantId === grant.grantId && request.selectionRevision === grant.selectionRevision
    ),
    true
  );
  service.destroy();
});

test('external Preview wiring keeps Project state separate and revokes exact reader authority', () => {
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const explicitOpen = source('src/main/onlypreview/onlyPreviewExplicitOpen.service.ts');
  const previewRegion = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const workspaceRegistry = source('src/main/onlypreview/onlyPreviewWorkspace.registry.ts');

  assert.match(
    previewRegion,
    /getPreviewAuthorityItemRef[\s\S]*bindPreviewReadWorkspace\(\{[\s\S]*rootPath: authority\.rootPath/
  );
  assert.match(
    previewRegion,
    /presentOffice[\s\S]*bindOfficeWorkspace\(\{[\s\S]*rootPath: authority\.rootPath/
  );
  assert.match(
    handler,
    /onlyPreviewWorkspaceRegistry\.onRevoke[\s\S]*handleWorkspaceRevoked[\s\S]*revokePreviewReadWorkspace/
  );
  assert.match(
    previewRegion,
    /handleWorkspaceRevoked[\s\S]*this\.clearPresentation\(runtime, null\)/
  );
  assert.match(
    workspaceRegistry,
    /workspace\.kind === 'external-preview'[\s\S]*externalPreviewWorkspaceByHost\.get[\s\S]*workspace\.selectedRelativePath !== fileRef\.relativePath[\s\S]*WORKSPACE_ACCESS_DENIED/
  );

  const explicitOpenBody = explicitOpen.slice(
    explicitOpen.indexOf('const performOpenOnlyPreviewAbsoluteTarget'),
    explicitOpen.indexOf('const serializedOpenOnlyPreviewAbsoluteTarget')
  );
  assert.match(explicitOpenBody, /fileSearchWindowService\.inspectTarget\(target\)/);
  assert.match(
    explicitOpenBody,
    /resolveProjectFileRef[\s\S]*authorizeProjectItem[\s\S]*revokeExternalPreview[\s\S]*\.select\(/
  );
  assert.match(
    explicitOpenBody,
    /registerExternalPreview[\s\S]*clearProjectSelection[\s\S]*onlyPreviewPreviewRegionService\.present\(host\.hostToken, fileRef, trace\.tag\)[\s\S]*ONLY_PREVIEW_SELECTION_CHANGED_EVENT/
  );
  assert.ok(
    explicitOpenBody.indexOf('inspectTarget(target)') <
      explicitOpenBody.indexOf('resolveProjectFileRef'),
    'target inspection must precede Project/external authority selection'
  );
  assert.ok(
    explicitOpenBody.indexOf('resolveProjectFileRef') <
      explicitOpenBody.indexOf('registerExternalPreview'),
    'Project authority must be attempted before issuing an external single-file authority'
  );
  assert.ok(
    explicitOpenBody.indexOf('present(host.hostToken, fileRef, trace.tag)') <
      explicitOpenBody.indexOf("trace.mark({ phase: 'presentation-issued' })"),
    'presentation publication must complete before Main records it as issued'
  );
  assert.ok(
    explicitOpenBody.indexOf('ONLY_PREVIEW_SELECTION_CHANGED_EVENT') <
      explicitOpenBody.indexOf("trace.mark({ phase: 'accepted' })"),
    'selection notification must retain its existing position before accepted terminal feedback'
  );
  const restoreBody = handler.slice(
    handler.indexOf('async restoreWorkspace('),
    handler.indexOf('async selectStandaloneFile(')
  );
  assert.match(
    restoreBody,
    /isExternalPreviewFileRef[\s\S]*hasLiveExternalPresentation[\s\S]*onlyPreviewWorkspaceRegistry\.restore[\s\S]*!hasLiveExternalPresentation/
  );
  const externalActionsBody = handler.slice(
    handler.indexOf('async openExternally('),
    handler.indexOf('async getSettings(')
  );
  assert.match(
    externalActionsBody,
    /getExternalPreviewNativePath[\s\S]*inspectTarget\(externalPath\)[\s\S]*revalidateExternalPreviewNativePath[\s\S]*shell\.openPath\(revalidatedPath\)/
  );
  assert.match(
    externalActionsBody,
    /getExternalPreviewNativePath[\s\S]*inspectTarget\(externalPath\)[\s\S]*revalidateExternalPreviewNativePath[\s\S]*shell\.showItemInFolder\(revalidatedPath\)/
  );
});
