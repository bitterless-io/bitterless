/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createRegistries,
  expectOnlyPreviewError,
  registerWorkspace,
  runtime,
  withTempDirectory
} from './onlyPreviewCoreTest.helper.mjs';

const preparedSelection = (workspaceId, relativePath, size = 16) => ({
  runtimeInstanceId: '123e4567-e89b-42d3-a456-426614174000',
  grantId: '223e4567-e89b-42d3-a456-426614174000',
  selectionRevision: 1,
  workspaceId,
  workspaceGeneration: 1,
  relativePath,
  descriptor: {
    workspaceId,
    relativePath,
    name: relativePath.split('/').at(-1),
    extension: '.wav',
    kind: 'audio',
    mimeType: 'audio/wav',
    language: '',
    size,
    modifiedAt: 1
  }
});

test('host capabilities are unique, role-scoped, and revoked independently', () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const standaloneA = hosts.issue('standalone', 'content');
  const standaloneB = hosts.issue('standalone', 'content');
  const settings = hosts.issue('settings', 'settings');
  assert.equal(new Set([standaloneA.hostToken, standaloneB.hostToken, settings.hostToken]).size, 3);
  assert.equal(hosts.require(standaloneA.hostToken, ['content']).hostId, standaloneA.hostId);
  assert.throws(
    () => hosts.require(settings.hostToken, ['content']),
    expectOnlyPreviewError('HOST_ROLE_DENIED')
  );
  assert.throws(
    () => hosts.require(standaloneA.hostToken, ['settings']),
    expectOnlyPreviewError('HOST_ROLE_DENIED')
  );
  assert.equal(hosts.revoke(standaloneA.hostToken), true);
  assert.equal(hosts.isLive(standaloneA.hostToken), false);
  assert.equal(hosts.isLive(standaloneB.hostToken), true);
  assert.throws(
    () => hosts.require(standaloneA.hostToken),
    expectOnlyPreviewError('HOST_NOT_FOUND')
  );
});

test('host isolation and workspace replacement fence authority and issued asset tokens', async () => {
  await withTempDirectory('onlypreview-isolation-', async (root) => {
    const firstRoot = join(root, 'first');
    const secondRoot = join(root, 'second');
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    const { hosts, workspaces, assets } = createRegistries();
    const hostA = hosts.issue('standalone', 'content');
    const hostB = hosts.issue('standalone', 'content');
    const first = registerWorkspace(workspaces, hostB.hostToken, firstRoot);

    assert.throws(
      () =>
        workspaces.getProjectAuthorityItemRef(hostA.hostToken, {
          workspaceId: first.workspaceId,
          relativePath: 'first.txt'
        }),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );

    const assetUrl = assets.issue(
      hostB.hostToken,
      preparedSelection(first.workspaceId, 'tone.wav'),
      'audio/wav',
      { selectionRevision: 1, maxBytes: 1024, lifetime: 'selection' }
    );
    const replacement = registerWorkspace(workspaces, hostB.hostToken, secondRoot);
    assert.notEqual(replacement.workspaceId, first.workspaceId);
    assert.throws(
      () => workspaces.requireWorkspace(hostB.hostToken, first.workspaceId),
      expectOnlyPreviewError('WORKSPACE_NOT_FOUND')
    );
    assert.equal((await assets.respond(new Request(assetUrl))).status, 404);
    assert.equal(workspaces.restore(hostB.hostToken)?.workspaceId, replacement.workspaceId);
  });
});

test('external Preview workspaces preserve the Project, stay host-private, and reject Project APIs', async () => {
  await withTempDirectory('onlypreview-external-workspace-', async (root) => {
    const projectRoot = join(root, 'project');
    const projectDocs = join(projectRoot, 'docs');
    const outsideRoot = join(root, 'outside');
    const replacementRoot = join(root, 'replacement');
    mkdirSync(projectDocs, { recursive: true });
    mkdirSync(outsideRoot);
    mkdirSync(replacementRoot);
    const canonicalProjectRoot = realpathSync(projectRoot);
    const canonicalProjectDocs = realpathSync(projectDocs);
    const canonicalOutsideRoot = realpathSync(outsideRoot);
    const canonicalReplacementRoot = realpathSync(replacementRoot);
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const otherHost = hosts.issue('standalone', 'content');
    const project = registerWorkspace(workspaces, host.hostToken, projectRoot, 'README.md');

    const containedRef = workspaces.resolveProjectFileRef(host.hostToken, {
      rootRealPath: canonicalProjectDocs,
      rootName: 'docs',
      displayPath: canonicalProjectDocs,
      selectedRelativePath: 'report.pdf'
    });
    assert.deepEqual(containedRef, {
      workspaceId: project.workspaceId,
      relativePath: 'docs/report.pdf'
    });
    assert.equal(
      workspaces.resolveProjectFileRef(host.hostToken, {
        rootRealPath: canonicalOutsideRoot,
        rootName: 'outside',
        displayPath: canonicalOutsideRoot,
        selectedRelativePath: 'external.pdf'
      }),
      null
    );

    const externalRef = workspaces.registerExternalPreview(host.hostToken, {
      rootRealPath: canonicalOutsideRoot,
      rootName: 'outside',
      displayPath: canonicalOutsideRoot,
      selectedRelativePath: 'external.pdf'
    });
    assert.equal(workspaces.clearProjectSelection(host.hostToken), true);
    assert.deepEqual(workspaces.restore(host.hostToken), {
      workspaceId: project.workspaceId,
      rootName: 'project',
      displayPath: canonicalProjectRoot
    });
    assert.equal(workspaces.isExternalPreviewFileRef(host.hostToken, externalRef), true);
    assert.equal(
      workspaces.getExternalPreviewNativePath(host.hostToken, externalRef),
      join(canonicalOutsideRoot, 'external.pdf')
    );
    assert.equal(
      workspaces.revalidateExternalPreviewNativePath(host.hostToken, externalRef, {
        rootRealPath: canonicalOutsideRoot,
        rootName: 'outside',
        displayPath: canonicalOutsideRoot,
        selectedRelativePath: 'external.pdf'
      }),
      join(canonicalOutsideRoot, 'external.pdf')
    );
    assert.throws(
      () =>
        workspaces.revalidateExternalPreviewNativePath(host.hostToken, externalRef, {
          rootRealPath: canonicalReplacementRoot,
          rootName: 'replacement',
          displayPath: canonicalReplacementRoot,
          selectedRelativePath: 'external.pdf'
        }),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );
    assert.deepEqual(
      {
        ...workspaces.getPreviewAuthorityItemRef(host.hostToken, externalRef),
        host: undefined,
        workspace: undefined
      },
      {
        host: undefined,
        workspace: undefined,
        workspaceId: externalRef.workspaceId,
        workspaceGeneration: 1,
        relativePath: 'external.pdf',
        rootPath: canonicalOutsideRoot
      }
    );

    for (const operation of [
      () => workspaces.getProjectAuthorityItemRef(host.hostToken, externalRef),
      () => workspaces.getProjectAuthorityRootRef(host.hostToken, externalRef.workspaceId),
      () => workspaces.select(host.hostToken, externalRef)
    ]) {
      assert.throws(operation, expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED'));
    }
    assert.throws(
      () =>
        workspaces.getExternalPreviewNativePath(host.hostToken, {
          ...externalRef,
          relativePath: 'other.pdf'
        }),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );
    for (const operation of [
      () =>
        workspaces.getPreviewAuthorityItemRef(host.hostToken, {
          ...externalRef,
          relativePath: 'other.pdf'
        }),
      () =>
        workspaces.getOfficeReadBootstrap(host.hostToken, {
          ...externalRef,
          relativePath: 'other.docx'
        })
    ]) {
      assert.throws(operation, expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED'));
    }
    assert.throws(
      () => workspaces.getPreviewAuthorityItemRef(otherHost.hostToken, externalRef),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );

    const nextExternalRef = workspaces.registerExternalPreview(host.hostToken, {
      rootRealPath: canonicalOutsideRoot,
      rootName: 'outside',
      displayPath: canonicalOutsideRoot,
      selectedRelativePath: 'next.txt'
    });
    assert.throws(
      () => workspaces.requireWorkspace(host.hostToken, externalRef.workspaceId),
      expectOnlyPreviewError('WORKSPACE_NOT_FOUND')
    );
    assert.equal(workspaces.revokeExternalPreview(host.hostToken), true);
    assert.throws(
      () => workspaces.requireWorkspace(host.hostToken, nextExternalRef.workspaceId),
      expectOnlyPreviewError('WORKSPACE_NOT_FOUND')
    );
    assert.equal(workspaces.restore(host.hostToken)?.workspaceId, project.workspaceId);

    const replacement = registerWorkspace(workspaces, host.hostToken, replacementRoot);
    assert.equal(workspaces.restore(host.hostToken)?.workspaceId, replacement.workspaceId);
    assert.throws(
      () => workspaces.requireWorkspace(host.hostToken, project.workspaceId),
      expectOnlyPreviewError('WORKSPACE_NOT_FOUND')
    );
  });
});

test('an external Preview can exist without a Project and is revoked with its host', async () => {
  await withTempDirectory('onlypreview-external-no-project-', async (root) => {
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const externalRef = workspaces.registerExternalPreview(host.hostToken, {
      rootRealPath: root,
      rootName: 'external-no-project',
      displayPath: root,
      selectedRelativePath: 'standalone.md'
    });

    assert.equal(workspaces.restore(host.hostToken), null);
    assert.equal(workspaces.isExternalPreviewFileRef(host.hostToken, externalRef), true);
    hosts.revoke(host.hostToken);
    assert.throws(
      () => workspaces.requireWorkspace(host.hostToken, externalRef.workspaceId),
      expectOnlyPreviewError('HOST_NOT_FOUND')
    );
  });
});

test('asset requests require the exact opaque canonical capability URL', async () => {
  await withTempDirectory('onlypreview-asset-url-', async (root) => {
    const projectRoot = join(root, 'project');
    mkdirSync(projectRoot);
    const { hosts, workspaces, assets } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = registerWorkspace(workspaces, host.hostToken, projectRoot);
    const assetUrl = assets.issue(
      host.hostToken,
      preparedSelection(workspace.workspaceId, 'tone.wav'),
      'audio/wav',
      { selectionRevision: 1, maxBytes: 1024, lifetime: 'selection' }
    );
    const canonical = new URL(assetUrl);
    const [token, encodedName] = canonical.pathname.slice(1).split('/');
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(encodedName, 'tone.wav');

    const malformedUrls = [
      assetUrl.replace('://asset/', '://ASSET/'),
      assetUrl.replace('://asset/', '://user:password@asset/'),
      assetUrl.replace('://asset/', '://asset:44/'),
      `${assetUrl}?download=1`,
      `${assetUrl}#fragment`,
      `bitterless-preview://asset/${token}`,
      `bitterless-preview://asset/${token}/`,
      `bitterless-preview://asset/${token}//tone.wav`,
      `bitterless-preview://asset/${token}/tone.wav/extra`,
      `bitterless-preview://asset/${token.slice(1)}/tone.wav`,
      `bitterless-preview://asset/${token.toUpperCase()}/tone.wav`,
      `bitterless-preview://asset/${token}/other.wav`,
      `bitterless-preview://asset/${token}/%74one.wav`,
      `bitterless-preview://asset/${token}/tone%2Fwav`
    ];
    for (const url of malformedUrls) {
      const request = url.includes('@') ? { url } : new Request(url);
      assert.equal(
        (await assets.respond(request)).status,
        404,
        `Expected malformed asset URL to be rejected: ${url}`
      );
    }
  });
});

test('permission failures map to the focused PATH_PERMISSION_DENIED envelope', () => {
  for (const code of ['EACCES', 'EPERM']) {
    assert.equal(runtime.isOnlyPreviewPermissionError({ code }), true);
  }
  const permissionError = new runtime.OnlyPreviewContractError(
    'PATH_PERMISSION_DENIED',
    'Bitterless does not have permission to read this file or folder.'
  );
  assert.deepEqual(runtime.onlyPreviewFailure(permissionError), {
    ok: false,
    error: {
      code: 'PATH_PERMISSION_DENIED',
      message: 'Bitterless does not have permission to read this file or folder.'
    }
  });
});

test('classifier keeps extension routing pure and defaults unrecognized small files to text', () => {
  for (const [relativePath, kind] of [
    ['README.md', 'text'],
    ['module.CJS', 'text'],
    ['photo.PNG', 'image'],
    ['movie.webm', 'video'],
    ['workbook.XLSX', 'sheet'],
    ['macros.xlsm', 'sheet'],
    ['document.DOCX', 'document'],
    ['slides.PPTX', 'presentation'],
    ['archive.bin', 'text'],
    ['AGENTS.md.bak', 'text'],
    ['legacy.doc', 'unsupported'],
    ['legacy.xls', 'unsupported'],
    ['legacy.ppt', 'unsupported']
  ]) {
    assert.equal(runtime.classifyOnlyPreviewExtension(relativePath), kind, relativePath);
  }
});
