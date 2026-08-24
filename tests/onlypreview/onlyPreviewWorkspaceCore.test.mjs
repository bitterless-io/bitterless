/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createRegistries,
  expectOnlyPreviewError,
  runtime,
  withTempDirectory,
  write
} from './onlyPreviewCoreTest.helper.mjs';

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

test('host A cannot resolve host B workspace and replacement revokes old workspace and asset', async () => {
  await withTempDirectory('onlypreview-isolation-', async (root) => {
    const firstPath = write(join(root, 'first.txt'), 'first workspace');
    const secondPath = write(join(root, 'next', 'second.txt'), 'second workspace');
    const { hosts, workspaces, assets } = createRegistries();
    const hostA = hosts.issue('standalone', 'content');
    const hostB = hosts.issue('standalone', 'content');
    const workspaceB = await workspaces.createForTarget(hostB.hostToken, firstPath);

    await assert.rejects(
      workspaces.resolveFile(hostA.hostToken, {
        workspaceId: workspaceB.workspaceId,
        relativePath: 'first.txt'
      }),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );

    const firstFile = await workspaces.openFile(hostB.hostToken, {
      workspaceId: workspaceB.workspaceId,
      relativePath: 'first.txt'
    });
    const assetUrl = assets.issue(firstFile, 'text/plain', {
      selectionRevision: 1,
      maxBytes: 1024
    });
    await firstFile.fileHandle.close();
    const liveResponse = await assets.respond(new Request(assetUrl));
    assert.equal(liveResponse.status, 200);
    assert.equal(await liveResponse.text(), 'first workspace');

    const replacement = await workspaces.createForTarget(hostB.hostToken, secondPath);
    assert.notEqual(replacement.workspaceId, workspaceB.workspaceId);
    assert.throws(
      () => workspaces.requireWorkspace(hostB.hostToken, workspaceB.workspaceId),
      expectOnlyPreviewError('WORKSPACE_NOT_FOUND')
    );
    assert.equal((await assets.respond(new Request(assetUrl))).status, 404);
    assert.equal(workspaces.restore(hostB.hostToken)?.workspaceId, replacement.workspaceId);
  });
});

test('asset requests require the exact canonical capability URL', async () => {
  await withTempDirectory('onlypreview-asset-url-', async (root) => {
    const filePath = write(join(root, 'tone.wav'), 'canonical asset');
    const { hosts, workspaces, assets } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, filePath);
    const file = await workspaces.openFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'tone.wav'
    });
    const assetUrl = assets.issue(file, 'audio/wav', {
      selectionRevision: 1,
      maxBytes: 1024
    });
    await file.fileHandle.close();
    const canonical = new URL(assetUrl);
    const [token, encodedName] = canonical.pathname.slice(1).split('/');
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(encodedName, 'tone.wav');
    const canonicalResponse = await assets.respond(new Request(assetUrl));
    assert.equal(canonicalResponse.status, 200);
    assert.equal(await canonicalResponse.text(), 'canonical asset');

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

test('revoking a host terminates an already-active asset stream', async () => {
  await withTempDirectory('onlypreview-stream-revoke-', async (root) => {
    const filePath = join(root, 'large.bin');
    write(filePath);
    truncateSync(filePath, 64 * 1024 * 1024);
    const { hosts, workspaces, assets } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, filePath);
    const file = await workspaces.openFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'large.bin'
    });
    const assetUrl = assets.issue(file, 'application/octet-stream', {
      selectionRevision: 1,
      maxBytes: 64 * 1024 * 1024
    });
    await file.fileHandle.close();
    const response = await assets.respond(new Request(assetUrl));
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.ok(first.value?.byteLength);

    hosts.revoke(host.hostToken);
    let terminated = false;
    let bytesRead = first.value?.byteLength ?? 0;
    for (let attempt = 0; attempt < 8 && !terminated; attempt += 1) {
      try {
        const next = await Promise.race([
          reader.read(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('revoked stream did not terminate')), 2_000)
          )
        ]);
        if (next.done) {
          terminated = true;
        } else {
          bytesRead += next.value?.byteLength ?? 0;
        }
      } catch {
        terminated = true;
      }
    }
    assert.equal(terminated, true);
    assert.ok(bytesRead < file.size);
    assert.equal((await assets.respond(new Request(assetUrl))).status, 404);
  });
});

test('workspace resolution rejects traversal, directories, and escaping symbolic links', async () => {
  await withTempDirectory('onlypreview-containment-', async (root) => {
    const workspaceRoot = join(root, 'workspace');
    const outsidePath = write(join(root, 'outside.txt'), 'secret');
    write(join(workspaceRoot, 'safe.txt'), 'safe');
    mkdirSync(join(workspaceRoot, 'folder'), { recursive: true });
    symlinkSync(outsidePath, join(workspaceRoot, 'escape.txt'));
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, workspaceRoot);

    assert.equal(
      (
        await workspaces.resolveProjectItem(host.hostToken, {
          workspaceId: workspace.workspaceId,
          relativePath: 'safe.txt'
        })
      ).nodeKind,
      'file'
    );
    assert.equal(
      (
        await workspaces.resolveProjectItem(host.hostToken, {
          workspaceId: workspace.workspaceId,
          relativePath: 'folder'
        })
      ).nodeKind,
      'directory'
    );

    await assert.rejects(
      workspaces.resolveFile(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: '../outside.txt'
      }),
      expectOnlyPreviewError('INVALID_INPUT')
    );
    await assert.rejects(
      workspaces.resolveFile(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: 'escape.txt'
      }),
      expectOnlyPreviewError('PATH_OUTSIDE_WORKSPACE')
    );
    await assert.rejects(
      workspaces.resolveFile(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: 'folder'
      }),
      expectOnlyPreviewError('PATH_NOT_REGULAR_FILE')
    );
    await assert.rejects(
      workspaces.resolveProjectItem(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: ''
      }),
      expectOnlyPreviewError('INVALID_INPUT')
    );
  });
});

test('workspace deletion removes one large regular file without materializing its body', async () => {
  await withTempDirectory('onlypreview-delete-large-', async (root) => {
    const targetPath = write(join(root, 'large.vue'));
    truncateSync(targetPath, 1024 * 1024 * 1024);
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, targetPath);
    const opened = await workspaces.openFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'large.vue'
    });
    assert.equal(
      (
        await workspaces.resolveProjectItem(host.hostToken, {
          workspaceId: workspace.workspaceId,
          relativePath: 'large.vue'
        })
      ).nodeKind,
      'file'
    );

    const deleted = await workspaces.deleteOpenedFile(opened);

    assert.equal(deleted.relativePath, 'large.vue');
    assert.equal(deleted.size, 1024 * 1024 * 1024);
    assert.equal(existsSync(targetPath), false);
    assert.equal(
      workspaces.clearSelection(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: 'large.vue'
      }),
      true
    );
    assert.equal(workspaces.restore(host.hostToken)?.selectedRelativePath, undefined);
  });
});

test('workspace deletion rejects a replaced path and leaves the replacement untouched', async () => {
  await withTempDirectory('onlypreview-delete-replaced-', async (root) => {
    const targetPath = write(join(root, 'target.txt'), 'original');
    const retiredPath = join(root, 'retired.txt');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, targetPath);
    const opened = await workspaces.openFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'target.txt'
    });
    renameSync(targetPath, retiredPath);
    write(targetPath, 'replacement');

    await assert.rejects(
      workspaces.deleteOpenedFile(opened),
      expectOnlyPreviewError('PATH_NOT_FOUND')
    );
    assert.equal(existsSync(targetPath), true);
    assert.equal(existsSync(retiredPath), true);
    assert.equal(workspaces.restore(host.hostToken)?.selectedRelativePath, 'target.txt');
  });
});

test('workspace deletion rejects traversal, directories, and lexical symbolic links', async () => {
  await withTempDirectory('onlypreview-delete-containment-', async (root) => {
    const workspaceRoot = join(root, 'workspace');
    const outsidePath = write(join(root, 'outside.txt'), 'outside');
    const insidePath = write(join(workspaceRoot, 'inside.txt'), 'inside');
    mkdirSync(join(workspaceRoot, 'folder'), { recursive: true });
    symlinkSync(outsidePath, join(workspaceRoot, 'escape.txt'));
    symlinkSync(insidePath, join(workspaceRoot, 'inside-link.txt'));
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, workspaceRoot);

    for (const [relativePath, code] of [
      ['../outside.txt', 'INVALID_INPUT'],
      ['folder', 'PATH_NOT_REGULAR_FILE'],
      ['escape.txt', 'PATH_OUTSIDE_WORKSPACE']
    ]) {
      await assert.rejects(
        workspaces.openFile(host.hostToken, {
          workspaceId: workspace.workspaceId,
          relativePath
        }),
        expectOnlyPreviewError(code)
      );
    }

    await assert.rejects(
      workspaces.resolveProjectItem(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: 'inside-link.txt'
      }),
      expectOnlyPreviewError('PATH_NOT_REGULAR_FILE')
    );
    assert.equal(existsSync(insidePath), true);
    assert.equal(existsSync(join(workspaceRoot, 'inside-link.txt')), true);
    assert.equal(existsSync(outsidePath), true);
  });
});

test('index rejects a workspace root replaced by an outside symbolic link', async () => {
  await withTempDirectory('onlypreview-root-replacement-', async (root) => {
    const workspaceRoot = join(root, 'workspace');
    const movedRoot = join(root, 'workspace-original');
    const outsideRoot = join(root, 'outside');
    write(join(workspaceRoot, 'safe.txt'), 'safe');
    write(join(outsideRoot, 'secret.txt'), 'secret');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, workspaceRoot);

    renameSync(workspaceRoot, movedRoot);
    symlinkSync(outsideRoot, workspaceRoot, 'dir');
    await assert.rejects(
      new runtime.OnlyPreviewIndexService(workspaces).build({
        hostToken: host.hostToken,
        workspaceId: workspace.workspaceId,
        showHiddenFiles: true
      }),
      expectOnlyPreviewError('PATH_OUTSIDE_WORKSPACE')
    );
  });
});

test('index is directory-first, naturally sorted, ignores heavy folders, and keeps an explicit hidden file', async () => {
  await withTempDirectory('onlypreview-index-', async (root) => {
    write(join(root, 'z10.txt'), 'ten');
    write(join(root, 'z2.txt'), 'two');
    write(join(root, '.hidden.txt'), 'hidden');
    write(join(root, '.env'), 'VISIBLE=explicit');
    write(join(root, 'Folder10', 'item.txt'), 'item');
    write(join(root, 'Folder2', 'item.txt'), 'item');
    write(join(root, 'node_modules', 'ignored.js'), 'ignored');
    write(join(root, '.git', 'ignored'), 'ignored');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const selected = await workspaces.createForTarget(host.hostToken, join(root, '.env'));
    const index = await new runtime.OnlyPreviewIndexService(workspaces).build({
      hostToken: host.hostToken,
      workspaceId: selected.workspaceId,
      showHiddenFiles: false
    });
    assert.deepEqual(
      index.entries.slice(0, 4).map(({ relativePath }) => relativePath),
      ['Folder2', 'Folder2/item.txt', 'Folder10', 'Folder10/item.txt']
    );
    assert.deepEqual(
      index.entries
        .filter(({ parentRelativePath }) => parentRelativePath === '')
        .map(({ name }) => name),
      ['Folder2', 'Folder10', '.env', 'z2.txt', 'z10.txt']
    );
    assert.equal(
      index.entries.some(({ relativePath }) => relativePath === '.hidden.txt'),
      false
    );
    assert.equal(
      index.entries.some(({ relativePath }) => /node_modules|\.git/.test(relativePath)),
      false
    );
    assert.deepEqual(
      index.entries
        .filter(({ relativePath }) => relativePath === 'Folder2' || relativePath === '.env')
        .map(({ relativePath, mediaType, isText }) => ({ relativePath, mediaType, isText })),
      [
        { relativePath: 'Folder2', mediaType: 'unknown', isText: false },
        { relativePath: '.env', mediaType: 'text', isText: true }
      ]
    );
    assert.equal(index.truncated, false);
  });
});

test('index enforces the 20k entry and depth-32 limits with explicit truncation', async () => {
  await withTempDirectory('onlypreview-index-limit-', async (root) => {
    for (let index = 0; index < runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES + 1; index += 1) {
      writeFileSync(join(root, `file-${String(index).padStart(5, '0')}.txt`), 'x');
    }
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const index = await new runtime.OnlyPreviewIndexService(workspaces).build({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      showHiddenFiles: true
    });
    assert.equal(index.entries.length, runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES);
    assert.equal(index.truncated, true);
  });

  await withTempDirectory('onlypreview-index-depth-', async (root) => {
    let current = root;
    for (let depth = 1; depth <= runtime.ONLY_PREVIEW_MAX_INDEX_DEPTH + 1; depth += 1) {
      current = join(current, `level-${String(depth).padStart(2, '0')}`);
      mkdirSync(current);
    }
    write(join(current, 'too-deep.txt'), 'deep');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const index = await new runtime.OnlyPreviewIndexService(workspaces).build({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      showHiddenFiles: true
    });
    assert.equal(index.truncated, true);
    assert.equal(
      index.entries.some(({ name }) => name === 'too-deep.txt'),
      false
    );
    assert.equal(
      Math.max(...index.entries.map(({ relativePath }) => relativePath.split('/').length)),
      runtime.ONLY_PREVIEW_MAX_INDEX_DEPTH
    );
  });
});

test('permission failures map to the focused PATH_PERMISSION_DENIED envelope', async () => {
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

  if (process.platform === 'win32') return;
  await withTempDirectory('onlypreview-permission-', async (root) => {
    const lockedDirectory = join(root, 'locked');
    write(join(lockedDirectory, 'file.txt'), 'unreadable');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, lockedDirectory);
    chmodSync(lockedDirectory, 0);
    try {
      await assert.rejects(
        new runtime.OnlyPreviewIndexService(workspaces).build({
          hostToken: host.hostToken,
          workspaceId: workspace.workspaceId,
          showHiddenFiles: true
        }),
        expectOnlyPreviewError('PATH_PERMISSION_DENIED')
      );
    } finally {
      chmodSync(lockedDirectory, 0o700);
    }
  });
});

test('classifier uses exact extension routing, tolerant text decoding, signatures, and byte caps', async () => {
  assert.equal(runtime.classifyOnlyPreviewExtension('README.md'), 'text');
  assert.equal(runtime.classifyOnlyPreviewExtension('photo.PNG'), 'image');
  assert.equal(runtime.classifyOnlyPreviewExtension('movie.webm'), 'video');
  assert.equal(runtime.classifyOnlyPreviewExtension('workbook.XLSX'), 'sheet');
  assert.equal(runtime.classifyOnlyPreviewExtension('macros.xlsm'), 'sheet');
  assert.equal(runtime.classifyOnlyPreviewExtension('document.DOCX'), 'document');
  assert.equal(runtime.classifyOnlyPreviewExtension('archive.bin'), 'unsupported');

  await withTempDirectory('onlypreview-classifier-', async (root) => {
    const { hosts, workspaces } = createRegistries();
    const service = new runtime.OnlyPreviewClassifierService(workspaces);
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const withOpenedFile = async (name, operation) => {
      const file = await workspaces.openFile(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath: name
      });
      try {
        return await operation(file);
      } finally {
        await file.fileHandle.close().catch(() => undefined);
      }
    };
    const describe = async (name) =>
      await withOpenedFile(name, async (file) => await service.describe(file));
    const readText = async (name, adapterId = 'monaco') =>
      await withOpenedFile(name, async (file) => await service.readText(file, adapterId));

    write(join(root, 'plain.unknown'), 'readable text');
    const inferred = await describe('plain.unknown');
    assert.equal(inferred.kind, 'unsupported');

    write(join(root, 'notes.markdown'), 'source markdown');
    const markdownSource = await describe('notes.markdown');
    assert.equal(markdownSource.kind, 'text');
    assert.equal(markdownSource.language, 'markdown');

    write(join(root, 'fake.png'), 'not a png');
    const mismatch = await describe('fake.png');
    assert.equal(mismatch.kind, 'image');
    assert.equal(mismatch.assetUrl, undefined);
    assert.deepEqual(mismatch.previewError?.code, 'SIGNATURE_MISMATCH');

    write(join(root, 'sample.pdf'), Buffer.from('%PDF-1.7\n%%EOF\n'));
    const pdf = await describe('sample.pdf');
    assert.equal(pdf.kind, 'pdf');
    assert.equal(pdf.assetUrl, undefined);

    write(join(root, 'workbook.xlsx'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const workbook = await describe('workbook.xlsx');
    assert.equal(workbook.kind, 'sheet');
    assert.equal(workbook.previewError, undefined);

    write(
      join(root, 'protected.xlsx'),
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );
    assert.equal((await describe('protected.xlsx')).previewError.code, 'OOXML_ENCRYPTED');

    write(join(root, 'renamed.xlsx'), Buffer.from('not an OOXML workbook'));
    assert.equal((await describe('renamed.xlsx')).previewError.code, 'SIGNATURE_MISMATCH');

    write(join(root, 'document.docx'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    assert.equal((await describe('document.docx')).previewError, undefined);

    write(
      join(root, 'protected.docx'),
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );
    assert.equal((await describe('protected.docx')).previewError.code, 'OOXML_ENCRYPTED');

    write(join(root, 'binary.txt'), Buffer.from([0, 1, 2, 3]));
    assert.equal((await describe('binary.txt')).kind, 'text');
    assert.equal((await readText('binary.txt')).text, '\u0000\u0001\u0002\u0003');

    write(join(root, 'utf8.txt'), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('hello')]));
    assert.deepEqual(await readText('utf8.txt'), {
      workspaceId: workspace.workspaceId,
      relativePath: 'utf8.txt',
      text: 'hello',
      encoding: 'utf-8',
      size: 8
    });
    write(join(root, 'utf16.txt'), Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]));
    assert.equal((await readText('utf16.txt')).text, 'hi');
    write(join(root, 'bad-utf8.txt'), Buffer.from([0xc3, 0x28]));
    assert.equal((await readText('bad-utf8.txt')).text, '\uFFFD(');

    const tooLarge = join(root, 'too-large.txt');
    const descriptor = openSync(tooLarge, 'w');
    closeSync(descriptor);
    truncateSync(tooLarge, runtime.ONLY_PREVIEW_MAX_TEXT_BYTES + 1);
    assert.equal((await describe('too-large.txt')).previewError.code, 'TEXT_TOO_LARGE');
    await assert.rejects(readText('too-large.txt'), expectOnlyPreviewError('TEXT_TOO_LARGE'));
  });
});

test('custom media responses implement full, bounded range, HEAD, and unsatisfiable semantics', async () => {
  await withTempDirectory('onlypreview-range-', async (root) => {
    const filePath = write(join(root, 'bytes.bin'), Buffer.from('0123456789'));
    const respond = async (request, mimeType) => {
      const fileHandle = await open(filePath, 'r');
      const fileStat = await fileHandle.stat();
      return await runtime.createOnlyPreviewFileResponse({
        request,
        fileHandle,
        fileSize: fileStat.size,
        mimeType,
        maxBytes: fileStat.size
      });
    };
    const full = await respond(
      new Request('bitterless-preview://asset/token/file.bin'),
      'application/octet-stream'
    );
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-length'), '10');
    assert.equal(await full.text(), '0123456789');

    const partial = await respond(
      new Request('bitterless-preview://asset/token/file.bin', {
        headers: { Range: 'bytes=2-5' }
      }),
      'video/mp4'
    );
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(partial.headers.get('content-length'), '4');
    assert.equal(await partial.text(), '2345');

    const suffix = runtime.parseOnlyPreviewRange('bytes=-3', 10);
    assert.deepEqual(suffix, { kind: 'range', range: { start: 7, end: 9 } });
    assert.deepEqual(runtime.parseOnlyPreviewRange('bytes=7-', 10), {
      kind: 'range',
      range: { start: 7, end: 9 }
    });

    const head = await respond(
      new Request('bitterless-preview://asset/token/file.bin', {
        method: 'HEAD',
        headers: { Range: 'bytes=0-1' }
      }),
      'audio/mpeg'
    );
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-range'), 'bytes 0-1/10');
    assert.equal(head.headers.get('content-length'), '2');
    assert.equal(await head.text(), '');

    const invalid = await respond(
      new Request('bitterless-preview://asset/token/file.bin', {
        headers: { Range: 'bytes=10-20' }
      }),
      'application/octet-stream'
    );
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), 'bytes */10');
    assert.equal(invalid.headers.get('content-length'), '0');
  });
});
