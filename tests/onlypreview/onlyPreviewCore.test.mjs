/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { load as loadYaml } from 'js-yaml';
import ts from 'typescript';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-unit-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const withTempDirectory = async (prefix, callback) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const expectOnlyPreviewError = (code) => (error) =>
  error instanceof runtime.OnlyPreviewContractError && error.code === code;

const write = (path, content = '') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};

const createRegistries = () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const assets = new runtime.OnlyPreviewAssetRegistry(hosts, workspaces);
  return { hosts, workspaces, assets };
};

const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

test('strict contracts normalize only relative capabilities and preserve error envelopes', () => {
  const token = 'a'.repeat(64);
  assert.equal(runtime.parseOnlyPreviewHostToken(token), token);
  assert.equal(runtime.normalizeOnlyPreviewRelativePath('folder/file.txt'), 'folder/file.txt');
  assert.equal(runtime.normalizeOnlyPreviewRelativePath('', { allowEmpty: true }), '');
  for (const invalid of [
    '',
    '../secret',
    'folder/../secret',
    './file',
    '/tmp/file',
    'C:/file',
    'a\\b',
    'a//b'
  ]) {
    assert.throws(
      () => runtime.normalizeOnlyPreviewRelativePath(invalid),
      expectOnlyPreviewError('INVALID_INPUT')
    );
  }
  assert.deepEqual(
    runtime.parseOnlyPreviewFileRef({
      workspaceId: 'b'.repeat(64),
      relativePath: 'safe.txt',
      ignoredAbsolutePath: '/tmp/secret'
    }),
    {
      workspaceId: 'b'.repeat(64),
      relativePath: 'safe.txt'
    }
  );

  const success = runtime.onlyPreviewSuccess({ selected: true });
  assert.deepEqual(runtime.unwrapOnlyPreviewResult(success), { selected: true });
  const typed = new runtime.OnlyPreviewContractError('PATH_NOT_FOUND', 'gone');
  assert.deepEqual(runtime.onlyPreviewFailure(typed), {
    ok: false,
    error: { code: 'PATH_NOT_FOUND', message: 'gone' }
  });
  assert.deepEqual(runtime.onlyPreviewFailure(new Error('/private/path leaked')), {
    ok: false,
    error: {
      code: 'OPERATION_FAILED',
      message: 'OnlyPreview could not complete this operation.'
    }
  });
  assert.throws(
    () => runtime.unwrapOnlyPreviewResult(null),
    expectOnlyPreviewError('OPERATION_FAILED')
  );
});

test('settings and preview bounds reject partial, extra, and unsafe values', () => {
  assert.deepEqual(
    runtime.parseOnlyPreviewSettings({
      theme: 'light',
      editorFontSize: 16,
      wordWrap: true,
      showHiddenFiles: false,
      openFilesWithSingleClick: true
    }),
    {
      theme: 'light',
      editorFontSize: 16,
      wordWrap: true,
      showHiddenFiles: false,
      openFilesWithSingleClick: true
    }
  );
  for (const invalid of [
    null,
    {},
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, editorFontSize: 10 },
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, editorFontSize: 25 },
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, theme: 'dark' },
    { ...runtime.DEFAULT_ONLY_PREVIEW_SETTINGS, absolutePath: '/tmp/leak' }
  ]) {
    assert.throws(() => runtime.parseOnlyPreviewSettings(invalid));
  }
  assert.deepEqual(
    runtime.parseOnlyPreviewBounds({ x: 1.4, y: 2.7, width: 300.2, height: 400.8 }),
    {
      x: 1,
      y: 3,
      width: 300,
      height: 401
    }
  );
  assert.throws(() => runtime.parseOnlyPreviewBounds({ x: -1, y: 0, width: 1, height: 1 }));
  assert.throws(() => runtime.parseOnlyPreviewBounds({ x: 0, y: 0, width: Infinity, height: 1 }));
});

test('host capabilities are unique, role-scoped, and revoked independently', () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const standalone = hosts.issue('standalone', 'content');
  const omniA = hosts.issue('omni', 'content');
  const omniB = hosts.issue('omni', 'content');
  const settings = hosts.issue('settings', 'settings');
  assert.equal(
    new Set([standalone.hostToken, omniA.hostToken, omniB.hostToken, settings.hostToken]).size,
    4
  );
  assert.equal(hosts.require(omniA.hostToken, ['content']).hostId, omniA.hostId);
  assert.throws(
    () => hosts.require(settings.hostToken, ['content']),
    expectOnlyPreviewError('HOST_ROLE_DENIED')
  );
  assert.throws(
    () => hosts.require(omniA.hostToken, ['settings']),
    expectOnlyPreviewError('HOST_ROLE_DENIED')
  );
  assert.equal(hosts.revoke(omniA.hostToken), true);
  assert.equal(hosts.isLive(omniA.hostToken), false);
  assert.equal(hosts.isLive(omniB.hostToken), true);
  assert.throws(() => hosts.require(omniA.hostToken), expectOnlyPreviewError('HOST_NOT_FOUND'));
});

test('host A cannot resolve host B workspace and replacement revokes old workspace and asset', async () => {
  await withTempDirectory('onlypreview-isolation-', async (root) => {
    const firstPath = write(join(root, 'first.txt'), 'first workspace');
    const secondPath = write(join(root, 'next', 'second.txt'), 'second workspace');
    const { hosts, workspaces, assets } = createRegistries();
    const hostA = hosts.issue('omni', 'content');
    const hostB = hosts.issue('omni', 'content');
    const workspaceB = await workspaces.createForTarget(hostB.hostToken, firstPath);

    await assert.rejects(
      workspaces.resolveFile(hostA.hostToken, {
        workspaceId: workspaceB.workspaceId,
        relativePath: 'first.txt'
      }),
      expectOnlyPreviewError('WORKSPACE_ACCESS_DENIED')
    );

    const firstFile = await workspaces.resolveFile(hostB.hostToken, {
      workspaceId: workspaceB.workspaceId,
      relativePath: 'first.txt'
    });
    const assetUrl = assets.issue(firstFile, 'text/plain');
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
    const file = await workspaces.resolveFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'tone.wav'
    });
    const assetUrl = assets.issue(file, 'audio/wav');
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
    const file = await workspaces.resolveFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'large.bin'
    });
    const assetUrl = assets.issue(file, 'application/octet-stream');
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

test('classifier combines extension, signature, text heuristics, encoding, and complete-file caps', async () => {
  assert.equal(runtime.classifyOnlyPreviewExtension('README.md'), 'text');
  assert.equal(runtime.classifyOnlyPreviewExtension('photo.PNG'), 'image');
  assert.equal(runtime.classifyOnlyPreviewExtension('movie.webm'), 'video');
  assert.equal(runtime.classifyOnlyPreviewExtension('archive.bin'), 'unsupported');
  assert.equal(runtime.isProbablyOnlyPreviewText(Buffer.from('hello\nworld')), true);
  assert.equal(runtime.isProbablyOnlyPreviewText(Buffer.from([0, 1, 2, 3])), false);

  await withTempDirectory('onlypreview-classifier-', async (root) => {
    const { hosts, workspaces, assets } = createRegistries();
    const service = new runtime.OnlyPreviewClassifierService(assets);
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
    const readText = async (name) =>
      await withOpenedFile(name, async (file) => await service.readText(file));

    write(join(root, 'plain.unknown'), 'readable text');
    const inferred = await describe('plain.unknown');
    assert.equal(inferred.kind, 'text');
    assert.equal(inferred.language, 'plaintext');

    write(join(root, 'fake.png'), 'not a png');
    const mismatch = await describe('fake.png');
    assert.equal(mismatch.kind, 'image');
    assert.equal(mismatch.assetUrl, undefined);
    assert.deepEqual(mismatch.previewError?.code, 'SIGNATURE_MISMATCH');

    write(join(root, 'sample.pdf'), Buffer.from('%PDF-1.7\n%%EOF\n'));
    const pdf = await describe('sample.pdf');
    assert.equal(pdf.kind, 'pdf');
    assert.match(pdf.assetUrl, /^bitterless-preview:\/\/asset\//);

    write(join(root, 'binary.txt'), Buffer.from([0, 1, 2, 3]));
    assert.equal((await describe('binary.txt')).kind, 'unsupported');
    await assert.rejects(readText('binary.txt'), expectOnlyPreviewError('BINARY_TEXT'));

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
    await assert.rejects(readText('bad-utf8.txt'), expectOnlyPreviewError('INVALID_ENCODING'));

    const tooLarge = join(root, 'too-large.txt');
    const descriptor = openSync(tooLarge, 'w');
    closeSync(descriptor);
    truncateSync(tooLarge, runtime.ONLY_PREVIEW_MAX_TEXT_BYTES + 1);
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
        mimeType
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

test('argv routing accepts only absolute user targets and the open queue is ready-gated and serialized', async () => {
  const targetA = resolve('/tmp', 'one.txt');
  const targetB = resolve('/tmp', 'two.txt');
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      [
        '/electron',
        '/app',
        '--inspect=9229',
        '--mcp-helper',
        'relative.txt',
        `--onlypreview-open=${targetA}`,
        `--onlypreview-open=${targetA}`,
        `--onlypreview-open=${targetB}`
      ],
      { packaged: false, platform: process.platform }
    ),
    [targetA, targetB]
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      ['/Applications/Bitterless', '--user-data-dir=/tmp/profile', targetA],
      { packaged: true, platform: 'darwin' }
    ),
    []
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewOpenTargets(
      ['/Program Files/Bitterless/Bitterless.exe', '--user-data-dir', '/profile', 'relative.txt'],
      {
        packaged: true,
        platform: 'win32',
        workingDirectory: '/fixtures'
      }
    ),
    ['/fixtures/relative.txt']
  );

  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolveGate) => {
    releaseFirst = resolveGate;
  });
  const queue = new runtime.OnlyPreviewOpenQueue(async (target) => {
    calls.push(`start:${target}`);
    if (target === targetA) await firstGate;
    calls.push(`end:${target}`);
  });
  queue.enqueue(targetA);
  queue.enqueue(targetB);
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.deepEqual(calls, []);
  queue.markReady();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.deepEqual(calls, [`start:${targetA}`]);
  releaseFirst();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.deepEqual(calls, [
    `start:${targetA}`,
    `end:${targetA}`,
    `start:${targetB}`,
    `end:${targetB}`
  ]);
});

const classMethodNames = (relativePath, className) => {
  const text = source(relativePath);
  const file = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declaration = file.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  assert.ok(declaration, `${className} must exist`);
  return declaration.members
    .filter(ts.isMethodDeclaration)
    .map((member) => member.name.getText(file));
};

test('OnlyPreview XPC prototype exposes the exact renderer allowlist and no internal lifecycle/path channel', () => {
  assert.deepEqual(classMethodNames('src/main/xpc/onlyPreview.handler.ts', 'OnlyPreviewHandler'), [
    'openOnlyPreviewWindow',
    'chooseTarget',
    'restoreWorkspace',
    'buildIndex',
    'describeFile',
    'readText',
    'selectStandaloneFile',
    'updatePreviewBounds',
    'openExternally',
    'revealInFolder',
    'getSettings',
    'saveSettings',
    'openSettings',
    'closeSettings'
  ]);
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const classBody = handler.slice(
    handler.indexOf('class OnlyPreviewHandler'),
    handler.indexOf('export const onlyPreviewHandler')
  );
  assert.doesNotMatch(classBody, /absoluteTarget|destroyOnlyPreview|auth|hostQuit|helperPath/i);
});

test('workspace updates have one authoritative event path and stale index results are discarded', () => {
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const broadcastWorkspaceBody = handler.slice(
    handler.indexOf('const broadcastWorkspace'),
    handler.indexOf('class OnlyPreviewHandler')
  );
  assert.equal(
    (
      broadcastWorkspaceBody.match(/xpcMain\.broadcast\(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT/g) ??
      []
    ).length,
    1
  );
  assert.doesNotMatch(broadcastWorkspaceBody, /ONLY_PREVIEW_SELECTION_CHANGED_EVENT/);

  const selectStandaloneBody = handler.slice(
    handler.indexOf('async selectStandaloneFile('),
    handler.indexOf('async updatePreviewBounds(')
  );
  assert.match(handler, /const selectionGenerationByHost = new Map<string, number>\(\)/);
  assert.match(
    handler,
    /onlyPreviewHostRegistry\.onRevoke[\s\S]*selectionGenerationByHost\.delete/
  );
  assert.match(
    selectStandaloneBody,
    /selectionGenerationByHost\.set\(host\.hostToken, generation\)/
  );
  assert.match(selectStandaloneBody, /await onlyPreviewWorkspaceRegistry\.resolveFile/);
  assert.match(
    selectStandaloneBody,
    /if \(selectionGenerationByHost\.get\(host\.hostToken\) !== generation\) return;[\s\S]*onlyPreviewWorkspaceRegistry\.select[\s\S]*ONLY_PREVIEW_SELECTION_CHANGED_EVENT/
  );

  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const chooseTargetBody = shellStore.slice(
    shellStore.indexOf('private async chooseTarget(kind:'),
    shellStore.indexOf('private async restoreWorkspace()')
  );
  assert.match(chooseTargetBody, /onlyPreviewClient\.chooseTarget/);
  assert.doesNotMatch(chooseTargetBody, /applyWorkspace\(|this\.workspace\s*=/);

  const buildIndexBody = shellStore.slice(
    shellStore.indexOf('private async buildIndex()'),
    shellStore.indexOf('private async includeExplicitSelection')
  );
  assert.match(buildIndexBody, /const workspaceId = workspace\.workspaceId/);
  assert.match(
    buildIndexBody,
    /const selectedRelativePath = workspace\.selectedRelativePath \|\| ''/
  );
  assert.match(buildIndexBody, /const generation = \+\+this\.generation/);
  assert.match(buildIndexBody, /await this\.includeExplicitSelection/);
  assert.match(
    buildIndexBody,
    /generation !== this\.generation[\s\S]*workspaceId !== this\.workspace\?\.workspaceId[\s\S]*selectedRelativePath !== \(this\.workspace\?\.selectedRelativePath \|\| ''\)/
  );

  const selectFileBody = shellStore.slice(
    shellStore.indexOf('private async selectFile('),
    shellStore.indexOf('private expandSelectedParents()')
  );
  assert.match(selectFileBody, /const generation = \+\+this\.selectionGeneration/);
  assert.match(
    selectFileBody,
    /catch \(error\)[\s\S]*if \(generation !== this\.selectionGeneration\) return;[\s\S]*await this\.syncSelection\(\)/
  );
});

test('window sources enforce sandboxed isolated views, exact navigation fences, and host cleanup', () => {
  const standalone = source('src/main/windows/onlyPreviewWindow.helper.ts');
  assert.match(standalone, /new BaseWindow\(/);
  assert.equal((standalone.match(/new WebContentsView\(/g) ?? []).length, 1);
  assert.match(standalone, /sandbox:\s*true/);
  assert.match(standalone, /contextIsolation:\s*true/);
  assert.match(standalone, /nodeIntegration:\s*false/);
  assert.match(standalone, /webSecurity:\s*true/);
  assert.match(standalone, /url === expectedUrl/);
  assert.match(standalone, /setWindowOpenHandler[\s\S]*action:\s*'deny'/);
  assert.match(standalone, /webContents\.on\('will-redirect',\s*fenceNavigation\)/);
  assert.match(standalone, /MIN_SIDEBAR_WIDTH\s*=\s*180/);
  assert.match(standalone, /RESIZE_HANDLE_WIDTH\s*=\s*5/);
  assert.match(standalone, /TOOLBAR_HEIGHT\s*=\s*44/);
  assert.match(standalone, /STATUS_HEIGHT\s*=\s*25/);
  assert.match(standalone, /clampPreviewBounds\(previewView\.getBounds\(\),\s*width,\s*height\)/);
  assert.match(standalone, /onlyPreviewHostRegistry\.revoke\(host\.hostToken\)/);
  assert.match(standalone, /minWidth:\s*MIN_WIDTH/);
  assert.match(standalone, /minHeight:\s*MIN_HEIGHT/);
  assert.doesNotMatch(standalone, /titleBarStyle:\s*'hiddenInset'/);
  assert.doesNotMatch(standalone, /trafficLightPosition/);
  assert.doesNotMatch(standalone, /frame:\s*false/);

  const omni = source('src/main/windows/omniWindow.helper.ts');
  assert.match(omni, /onlyPreviewHostRegistry\.issue\('omni',\s*'content'\)/);
  assert.match(omni, /onlyPreviewHostToken/);
  assert.match(omni, /revokeOnlyPreviewCellHost\(cell\)/);
  assert.match(omni, /render-process-gone/);
  assert.match(omni, /sandbox:\s*Boolean\(onlyPreviewHost\)/);
  assert.match(omni, /content\.webContents\.on\('will-redirect',\s*fenceMiniAppNavigation\)/);
  const firstContentCreationCatch = omni.slice(
    omni.indexOf('let content: WebContentsView;'),
    omni.indexOf('try {\n      this.baseWindow.contentView.addChildView(content);')
  );
  assert.match(firstContentCreationCatch, /this\.disposeWebContentsView\(menubar\)/);

  const closeViewBody = omni.slice(
    omni.indexOf('private closeWebContentsView('),
    omni.indexOf('private detachWebContentsView(')
  );
  assert.match(closeViewBody, /if \(!view\) return/);
  assert.match(closeViewBody, /if \(!view\.webContents\.isDestroyed\(\)\)/);
  assert.match(closeViewBody, /view\.webContents\.close\(\)/);
  assert.doesNotMatch(closeViewBody, /isCrashed\(\)/);

  const detachViewBody = omni.slice(
    omni.indexOf('private detachWebContentsView('),
    omni.indexOf('private disposeWebContentsView(')
  );
  assert.match(detachViewBody, /removeChildView\(view\)/);
  assert.match(detachViewBody, /catch \{/);

  const disposeViewBody = omni.slice(
    omni.indexOf('private disposeWebContentsView('),
    omni.indexOf('private cleanupAllViews(')
  );
  assert.match(
    disposeViewBody,
    /this\.detachWebContentsView\(view\);[\s\S]*this\.closeWebContentsView\(view\);/
  );

  const broadcastLoadStateBody = omni.slice(
    omni.indexOf('private broadcastMiniAppLoadState('),
    omni.indexOf('private replayMiniAppLoadFailures(')
  );
  assert.match(
    broadcastLoadStateBody,
    /miniAppLoadFailures\.(?:set|delete)[\s\S]*try \{[\s\S]*xpcMain\.broadcast/
  );

  const loadMiniAppBody = omni.slice(
    omni.indexOf('private loadMiniAppCellContent('),
    omni.indexOf('private addCell(')
  );
  assert.match(
    loadMiniAppBody,
    /this\.cells = this\.cells\.filter[\s\S]*this\.removeCellViews\(cell\);[\s\S]*this\.reportMiniAppLoadFailure\(/
  );

  const lifecycleBody = omni.slice(
    omni.indexOf('private bindCellContentLifecycle('),
    omni.indexOf('private replaceBrowserCellContentView(')
  );
  assert.match(
    lifecycleBody,
    /render-process-gone[\s\S]*this\.cells = this\.cells\.filter[\s\S]*this\.removeCellViews\(cell\);[\s\S]*this\.reportMiniAppLoadFailure\(/
  );

  const removeCellViewsBody = omni.slice(
    omni.indexOf('private removeCellViews('),
    omni.indexOf('private revokeOnlyPreviewCellHost(')
  );
  assert.match(
    removeCellViewsBody,
    /this\.revokeOnlyPreviewCellHost\(cell\);[\s\S]*this\.disposeWebContentsView\(cell\.menubar\);[\s\S]*this\.disposeWebContentsView\(cell\.content\);/
  );
});

test('Home, Omni, preload, i18n, logging, build, and installer sources include the complete integration gates', () => {
  const homeCard = source('src/renderer/home/src/views/miniApp/miniApps.constant.ts');
  const homeEmitter = source('src/renderer/home/src/emitter/onlyPreview.emitter.ts');
  const homeView = source('src/renderer/home/src/views/miniApp/MiniApp.vue');
  assert.match(homeCard, /onlypreview/);
  assert.match(homeEmitter, /OnlyPreviewHandler/);
  assert.match(homeView, /onlyPreviewEmitter\.openOnlyPreviewWindow\(\)/);

  const omniTypes = source('src/shared/omni/omni.types.ts');
  const omniPane = source('src/renderer/omni/omniControl/src/components/OmniPane.vue');
  assert.match(omniTypes, /onlypreview/);
  assert.match(omniPane, /onlypreview/);

  const preload = source('src/preload/onlypreview/onlypreview.preload.ts');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /hostToken/);
  assert.doesNotMatch(preload, /ipcMain|ipcRenderer/);

  for (const locale of ['en', 'zh']) {
    const i18n = source(`src/renderer/common/i18n/${locale}.ts`);
    assert.match(i18n, /onlypreview/i);
  }
  assert.match(source('src/main/logging/logPolicy.service.ts'), /onlypreview/i);

  const appMain = source('src/main/app.main.ts');
  const configureE2EStart = appMain.indexOf('const configureE2EUserData');
  const configureE2ECall = appMain.indexOf('configureE2EUserData();');
  const guiStartup = appMain.indexOf('app.whenReady()');
  assert.ok(configureE2EStart >= 0 && configureE2ECall > configureE2EStart);
  assert.ok(configureE2ECall < guiStartup);
  const configureE2EBody = appMain.slice(configureE2EStart, configureE2ECall);
  assert.match(configureE2EBody, /if \(app\.isPackaged\)[\s\S]*BITTERLESS_E2E is unavailable/);
  assert.match(
    appMain,
    /handleCoreSqliteReady:[\s\S]*onlyPreviewSettingsService\.hydrateFromStorage\(\)/
  );

  const sqlitePassword = source('src/preload/sqlite/sqliteHelper/sqlitePassword.helper.ts');
  const e2ePasswordGuard = sqlitePassword.indexOf("process.env.BITTERLESS_E2E === '1'");
  const releasePasswordFlow = sqlitePassword.indexOf(
    "console.log('[sqlitePassword] release mode detected"
  );
  assert.ok(e2ePasswordGuard >= 0 && e2ePasswordGuard < releasePasswordFlow);
  assert.match(
    sqlitePassword,
    /process\.env\.BITTERLESS_E2E === '1'[\s\S]*return \{ password: E2E_PASSWORD, isReset: false \}/
  );

  const vite = source('electron.vite.config.ts');
  assert.match(
    vite,
    /onlypreview:\s*resolve\('src\/preload\/onlypreview\/onlypreview\.preload\.ts'\)/
  );
  for (const renderer of ['shell', 'preview', 'settings']) {
    assert.match(vite, new RegExp(`'onlypreview/${renderer}'`));
  }
  assert.match(vite, /vite-plugin-monaco-editor-esm/);
  assert.match(vite, /unpdf/);

  const builder = source('electron-builder.tmp.yml');
  assert.match(builder, /fileAssociations:/);
  assert.match(builder, /rank:\s*Alternate/);
  assert.match(builder, /CFBundleTypeRole:\s*Viewer/);
  assert.match(builder, /public\.data/);
  const classifier = source('src/main/onlypreview/onlyPreviewClassifier.service.ts');
  const supportedExtensions = new Set();
  for (const catalogName of [
    'TEXT_EXTENSIONS',
    'PDF_EXTENSIONS',
    'IMAGE_EXTENSIONS',
    'AUDIO_EXTENSIONS',
    'VIDEO_EXTENSIONS'
  ]) {
    const catalog = classifier.match(
      new RegExp(`const ${catalogName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`)
    )?.[1];
    assert.ok(catalog, `${catalogName} must remain an explicit extension catalog`);
    for (const match of catalog.matchAll(/'\.([^']+)'/g)) supportedExtensions.add(match[1]);
  }
  const builderConfig = loadYaml(builder);
  const associatedExtensions = new Set(
    builderConfig.fileAssociations.flatMap((association) => association.ext)
  );
  assert.deepEqual(
    [...associatedExtensions].sort(),
    [...supportedExtensions].sort(),
    'explicit OS associations must match every extension supported by OnlyPreview'
  );
  const installer = source('build/installer.tmp.nsh');
  assert.match(installer, /Software\\Classes\\\*\\shell\\OnlyPreview/);
  assert.match(installer, /Open in Bitterless/);
  assert.match(installer, /customUnInstall/);
  assert.match(installer, /DeleteRegKey/);
});

test('renderers keep empty state distinct from index failure and PDF/Monaco runtime contracts explicit', () => {
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  assert.match(shellApp, /empty|emptyState|empty-state/i);
  assert.match(shellStore, /error/);
  assert.doesNotMatch(shellApp, />\s*INDEX_FAILED\s*</);
  assert.match(shellApp, /index\.truncated[\s\S]*indexPartial[\s\S]*indexReady/);
  assert.match(
    shellApp,
    /:tabindex="row\.entry\.relativePath === treeFocusRelativePath \? 0 : -1"/
  );
  assert.match(
    shellApp,
    /const treeFocusRelativePath = computed\(\(\) => onlyPreviewShellStore\.treeFocusRelativePath\)/
  );
  assert.match(shellApp, /:data-relative-path="row\.entry\.relativePath"/);
  assert.match(shellApp, /focusProjectTree/);
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.match(shellApp, new RegExp(`event\\.key !== '${key}'`));
  }
  assert.match(shellApp, /event\.key === ' ' \|\| event\.key === 'Enter'/);
  assert.match(shellStore, /get treeFocusRelativePath\(\): string/);
  assert.match(shellStore, /moveTreeFocus\(/);
  assert.match(shellStore, /handleTreeClick\(entry:[\s\S]*if \(clickCount > 1\) return/);
  assert.match(shellStore, /activateEntry\(entry, clickCount === 0\)/);
  assert.match(
    shellStore,
    /handleTreeDoubleClick[\s\S]*entry\.nodeKind !== 'file'[\s\S]*openFilesWithSingleClick/
  );
  assert.match(shellStore, /if \(entry\.nodeKind !== 'file'\) return/);
  assert.match(shellApp, /:aria-label="onlyPreviewI18n\.project\.clearSearch"/);
  assert.match(
    shellApp,
    /searchQuery\.trim\(\)[\s\S]*project\.noResults[\s\S]*project\.emptyProject/
  );
  assert.match(shellApp, /role="status"[\s\S]*aria-live="polite"/);

  const settingsApp = source('src/renderer/onlypreview/settings/src/App.vue');
  assert.match(
    settingsApp,
    /@change="\(value\) => onlyPreviewSettingsStore\.setWordWrap\(value\)"/
  );
  assert.match(settingsApp, /window\.addEventListener\('keydown', handleWindowKeydown\)/);
  assert.match(settingsApp, /event\.key !== 'Escape'/);
  const settingsStyle = source('src/renderer/onlypreview/settings/src/App.less');
  assert.match(settingsStyle, /html,[\s\S]*#app[\s\S]*height:\s*100%/);
  assert.match(settingsStyle, /\.onlypreview-settings[\s\S]*min-height:\s*0/);

  const onlyPreviewI18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.match(onlyPreviewI18n, /indexPartial:\s*'Index partial'/);
  assert.match(onlyPreviewI18n, /indexPartial:\s*'索引不完整'/);

  const monaco = source(
    'src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue'
  );
  assert.match(monaco, /readOnly:\s*true/);
  assert.match(monaco, /domReadOnly:\s*true/);
  assert.match(monaco, /editor\.create/);

  const pdf = source('src/renderer/onlypreview/preview/src/components/PdfPreview/PdfPreview.vue');
  assert.match(pdf, /AnnotationMode\.DISABLE/);
  assert.match(pdf, /intent:\s*'print'/);
  assert.match(pdf, /new TextLayer/);
  assert.match(pdf, /canvas/);
});
