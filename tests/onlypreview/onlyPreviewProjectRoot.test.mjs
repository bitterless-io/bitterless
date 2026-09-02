import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createRegistries,
  expectOnlyPreviewError,
  runtime,
  registerWorkspace,
  source,
  withTempDirectory
} from './onlyPreviewCoreTest.helper.mjs';

test('synthetic root uses a distinct workspace capability while ordinary file refs reject empty paths', async () => {
  await withTempDirectory('onlypreview-project-root-', async (tempRoot) => {
    const projectPath = join(tempRoot, 'project');
    mkdirSync(projectPath);
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = registerWorkspace(workspaces, host.hostToken, projectPath);

    assert.throws(
      () =>
        runtime.parseOnlyPreviewFileRef({
          workspaceId: workspace.workspaceId,
          relativePath: ''
        }),
      expectOnlyPreviewError('INVALID_INPUT')
    );
    assert.deepEqual(runtime.parseOnlyPreviewProjectRootRequest({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId
    }), {
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId
    });
    assert.throws(
      () =>
        runtime.parseOnlyPreviewProjectRootRequest({
          hostToken: host.hostToken,
          workspaceId: workspace.workspaceId,
          relativePath: ''
        }),
      expectOnlyPreviewError('INVALID_INPUT')
    );
    const root = workspaces.getProjectAuthorityRootRef(host.hostToken, workspace.workspaceId);
    assert.equal(root.relativePath, '');
    assert.equal(root.workspaceId, workspace.workspaceId);
    assert.equal(root.workspaceGeneration, 1);
    assert.equal(root.host.hostToken, host.hostToken);
  });
});

test('root relative/name copies are explicit and root menu source has no delete action', async () => {
  const copied = [];
  const service = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin',
    textClipboard: { writeText: (value) => copied.push(value) },
    executeCommand: async () => undefined
  });
  const root = { realPath: '/tmp/bitterless', relativePath: '', name: 'bitterless' };
  await service.copyProjectItem(root, 'relative-path');
  await service.copyProjectItem(root, 'name');
  assert.deepEqual(copied, ['.', 'bitterless']);

  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const nativeActions = source(
    'src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts'
  );
  const rootMenu = handler.slice(
    handler.indexOf('async showProjectRootContextMenu('),
    handler.indexOf('async copyProjectRoot(')
  );
  assert.match(rootMenu, /onlyPreviewProjectNativeActionService\.showProjectRootContextMenu/);
  const rootMenuService = nativeActions.slice(
    nativeActions.indexOf('async showProjectRootContextMenu('),
    nativeActions.indexOf('async copyProjectItemFromUi(')
  );
  assert.match(rootMenuService, /onlypreview-reveal-project-root/);
  assert.match(rootMenuService, /onlypreview-copy-project-root-relative-path/);
  assert.doesNotMatch(rootMenuService, /delete|destructive/i);
});

test('Global Search close accepts only an exact host and surface mode', () => {
  const request = { hostToken: 'host-token-global-focus', mode: 'opener' };
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchCloseRequest(request), request);
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchCloseRequest({ ...request, mode: 'project' }), {
    ...request,
    mode: 'project'
  });
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchCloseRequest({ ...request, mode: 'preview' }), {
    ...request,
    mode: 'preview'
  });
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchCloseRequest({ ...request, mode: 'discard' }), {
    ...request,
    mode: 'discard'
  });
  for (const invalid of [
    { ...request, mode: 'tree' },
    { ...request, mode: '' },
    { ...request, extra: true }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewGlobalSearchCloseRequest(invalid),
      expectOnlyPreviewError('INVALID_INPUT')
    );
  }
});
