import assert from 'node:assert/strict';
import { mkdirSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createRegistries,
  expectOnlyPreviewError,
  runtime,
  source,
  withTempDirectory
} from './onlyPreviewCoreTest.helper.mjs';

test('synthetic root uses a distinct workspace capability while ordinary file refs reject empty paths', async () => {
  await withTempDirectory('onlypreview-project-root-', async (tempRoot) => {
    const projectPath = join(tempRoot, 'project');
    mkdirSync(projectPath);
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, projectPath);

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
    const root = await workspaces.resolveProjectRoot(host.hostToken, workspace.workspaceId);
    assert.equal(root.relativePath, '');
    assert.equal(root.nodeKind, 'directory');
    assert.equal(root.name, 'project');

    const movedProject = join(tempRoot, 'project-moved');
    renameSync(projectPath, movedProject);
    symlinkSync(movedProject, projectPath, 'dir');
    await assert.rejects(
      () => workspaces.resolveProjectRoot(host.hostToken, workspace.workspaceId),
      expectOnlyPreviewError('PATH_OUTSIDE_WORKSPACE')
    );
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
  const rootMenu = handler.slice(
    handler.indexOf('async showProjectRootContextMenu('),
    handler.indexOf('async copyProjectRoot(')
  );
  assert.match(rootMenu, /onlypreview-reveal-project-root/);
  assert.match(rootMenu, /onlypreview-copy-project-root-relative-path/);
  assert.doesNotMatch(rootMenu, /delete|destructive/i);
});

test('Global Search focus restoration accepts only an exact host and focus mode', () => {
  const request = { hostToken: 'host-token-global-focus', mode: 'opener' };
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchFocusRequest(request), request);
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchFocusRequest({ ...request, mode: 'preview' }), {
    ...request,
    mode: 'preview'
  });
  assert.deepEqual(runtime.parseOnlyPreviewGlobalSearchFocusRequest({ ...request, mode: 'discard' }), {
    ...request,
    mode: 'discard'
  });
  for (const invalid of [
    { ...request, mode: 'tree' },
    { ...request, mode: '' },
    { ...request, extra: true }
  ]) {
    assert.throws(
      () => runtime.parseOnlyPreviewGlobalSearchFocusRequest(invalid),
      expectOnlyPreviewError('INVALID_INPUT')
    );
  }
});
