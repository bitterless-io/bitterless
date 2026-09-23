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
  const explicitOpen = source('src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service.ts');
  const previewRegion = source('src/main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const workspaceRegistry = source('src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry.ts');

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

  // Two regions now, because the file-preview half was extracted into
  // `presentOnlyPreviewExplicitFile`. Slicing only `performOpenOnlyPreviewAbsoluteTarget` left this
  // guard matching a region that no longer holds any of the calls it names — it went red without
  // any behaviour changing, and it would have gone SILENT if the assertions had been looser.
  //
  // A related trap this one walked into: a source-shape assertion can be satisfied by a COMMENT.
  // While the slice was wrong, a prose mention of `resolveProjectFileRef` elsewhere in the file was
  // enough to make one of the four symbols "present". Keep each assertion anchored to the region
  // that actually contains the code it describes.
  const openBody = explicitOpen.slice(
    explicitOpen.indexOf('const performOpenOnlyPreviewAbsoluteTarget'),
    explicitOpen.indexOf('const serializedOpenOnlyPreviewAbsoluteTarget')
  );
  const explicitOpenBody = explicitOpen.slice(
    explicitOpen.indexOf('export const presentOnlyPreviewExplicitFile'),
    explicitOpen.indexOf('const performOpenOnlyPreviewAbsoluteTarget')
  );
  assert.match(openBody, /fileSearchWindowService\.inspectTarget\(target\)/);
  // Re-opening the directory that is already the active project must short-circuit BEFORE
  // `openExplicitTarget` — a re-bind mints a new authority generation and is what produced
  // WORKSPACE_ACCESS_DENIED (docs/issues/onlypreview-reopening-same-workspace-reloads.md).
  assert.ok(
    openBody.indexOf('isActiveProjectRoot') > -1 &&
      openBody.indexOf('isActiveProjectRoot') <
        openBody.indexOf('onlyPreviewRecentDirectoryService.openExplicitTarget'),
    're-opening the active project root must short-circuit before openExplicitTarget'
  );
  assert.match(
    explicitOpenBody,
    /classifyProjectTarget[\s\S]*authorizeProjectItem[\s\S]*revokeExternalPreview[\s\S]*\.select\(/
  );
  assert.match(
    explicitOpenBody,
    /registerExternalPreview[\s\S]*resolveOnlyPreviewPreviewRegion\(host\.hostToken\)\s*\.present\(host\.hostToken, fileRef, trace\?\.tag[\s\S]*ONLY_PREVIEW_SELECTION_CHANGED_EVENT/
  );
  // Now a cross-function ordering: the caller inspects, then hands the validated target to the
  // extracted presenter. Comparing indexes across two slices would compare unrelated offsets.
  assert.ok(
    openBody.indexOf('inspectTarget(target)') <
      openBody.indexOf('presentOnlyPreviewExplicitFile('),
    'target inspection must precede Project/external authority selection'
  );
  // 契约又往前走了一步:**外部预览一句 `clearProjectSelection` 都不再调**。
  //
  // 原来是「只在 `'outside'` 时清」(那一版修的是"项目内的文件被误判成外部"),后来连 `'outside'`
  // 也不清了 —— 一个外部文件的预览与"项目里选中了哪一项"是两件独立的事,住在两个不同的 map 里。
  // 守卫因此反过来写:出现 `clearProjectSelection` 就是回归。
  assert.doesNotMatch(
    explicitOpenBody,
    /clearProjectSelection/
  );
  assert.ok(
    explicitOpenBody.indexOf('classifyProjectTarget') <
      explicitOpenBody.indexOf('registerExternalPreview'),
    'Project authority must be attempted before issuing an external single-file authority'
  );
  assert.ok(
    explicitOpenBody.indexOf('present(host.hostToken, fileRef, trace?.tag)') <
      explicitOpenBody.indexOf("trace?.mark({ phase: 'presentation-issued' })"),
    'presentation publication must complete before Main records it as issued'
  );
  assert.ok(
    explicitOpenBody.indexOf('ONLY_PREVIEW_SELECTION_CHANGED_EVENT') <
      explicitOpenBody.indexOf("trace?.mark({ phase: 'accepted' })"),
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

/**
 * Ral 2026-09-22:「重启 app,启动 onlypreview 时,读取上次打开的文件的操作 读了两次」。
 *
 * 根因是快照取早了一步。`onlyPreviewRecentDirectoryService.restoreWorkspace` 内部
 * `presentRestoredSelection` 缺省为 true —— 它自己已经把记住的文件呈现过一次。而 handler 随后
 * 拿**恢复之前**取的 `current` 去比对恢复之后的 `workspace.selectedRelativePath`,条件必然成立,
 * 于是同一个文件再呈现一遍:预览视图挂上、拆掉、再挂上,日志里两条 `preview-focus-claimed`,
 * 背后是两次真实的文件读取与渲染。
 *
 * 不能改成让 service 别呈现:它那一次带着 `authorizeProjectItem` 授权与 `workspaceRegistry.select`,
 * handler 这次没有。所以保留 service 那条路,只把比对换成看得见它的快照。
 *
 * 单独成一个用例(而不是并进上面那条),因为这个文件里先跑的断言目前是红的,
 * 挂在它后面等于永远不执行。
 */
test('the restored selection is presented once — the comparison uses a post-restore snapshot', () => {
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const restoreBody = handler.slice(
    handler.indexOf('async restoreWorkspace('),
    handler.indexOf('async selectStandaloneFile(')
  );
  assert.ok(restoreBody.length > 0, 'restoreWorkspace 的函数体必须能被切出来');
  assert.ok(
    restoreBody.indexOf('onlyPreviewRecentDirectoryService.restoreWorkspace') <
      restoreBody.indexOf('const presented ='),
    '比对用的快照必须在恢复之后取,否则看不见 service 刚刚做的那次呈现'
  );
  assert.ok(
    restoreBody.indexOf('const current =') < restoreBody.indexOf('const hasLiveExternalPresentation'),
    'hasLiveExternalPresentation 必须用恢复之前的快照 —— 它决定的是要不要恢复'
  );
  assert.doesNotMatch(
    restoreBody.slice(restoreBody.indexOf('const presented =')),
    /current\.fileRef/u,
    '恢复之后就不该再读旧快照的 fileRef'
  );
});
