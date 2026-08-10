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
  assert.equal(runtime.parseOnlyPreviewIndexRevision('index-revision-1'), 'index-revision-1');
  for (const invalidRevision of [null, '', 'x'.repeat(129)]) {
    assert.throws(
      () => runtime.parseOnlyPreviewIndexRevision(invalidRevision),
      expectOnlyPreviewError('INVALID_INPUT')
    );
  }
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
  assert.equal(runtime.DEFAULT_ONLY_PREVIEW_SETTINGS.showHiddenFiles, true);
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

test('Settings bounds constrain oversized persisted dimensions to the current parent display', () => {
  assert.deepEqual(
    runtime.resolveOnlyPreviewSettingsBounds({
      parentBounds: { x: 1920, y: 34, width: 1000, height: 700 },
      workArea: { x: 1920, y: 0, width: 1024, height: 768 },
      width: 1600,
      height: 1000,
      minWidth: 800,
      minHeight: 600
    }),
    { x: 1920, y: 0, width: 1024, height: 768 }
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewSettingsBounds({
      parentBounds: { x: 40, y: 30, width: 620, height: 440 },
      workArea: { x: 0, y: 0, width: 640, height: 480 },
      width: 1600,
      height: 1000,
      minWidth: 800,
      minHeight: 600
    }),
    // Full containment is impossible below the app minimum, so use the minimum at the origin.
    { x: 0, y: 0, width: 800, height: 600 }
  );
  assert.deepEqual(
    runtime.resolveOnlyPreviewSettingsBounds({
      parentBounds: { x: 100, y: 80, width: 1000, height: 700 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
      width: 800,
      height: 600,
      minWidth: 800,
      minHeight: 600
    }),
    { x: 200, y: 130, width: 800, height: 600 }
  );
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
    await assert.rejects(
      new runtime.OnlyPreviewIndexService(workspaces).listDirectory({
        hostToken: host.hostToken,
        workspaceId: workspace.workspaceId,
        relativePath: 'escape.txt',
        showHiddenFiles: true
      }),
      expectOnlyPreviewError('PATH_OUTSIDE_WORKSPACE')
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
    await assert.rejects(
      new runtime.OnlyPreviewIndexService(workspaces).listDirectory({
        hostToken: host.hostToken,
        workspaceId: workspace.workspaceId,
        relativePath: '',
        showHiddenFiles: true
      }),
      expectOnlyPreviewError('PATH_OUTSIDE_WORKSPACE')
    );
  });
});

test('directory listings and the breadth-first index share natural visibility rules', async () => {
  await withTempDirectory('onlypreview-index-', async (root) => {
    write(join(root, 'z10.txt'), 'ten');
    write(join(root, 'z2.txt'), 'two');
    write(join(root, '.hidden.txt'), 'hidden');
    write(join(root, '.env'), 'VISIBLE=explicit');
    write(join(root, 'Folder10', 'item.txt'), 'item');
    write(join(root, 'Folder2', 'item.txt'), 'item');
    symlinkSync(join(root, 'Folder2'), join(root, 'folder-link'), 'dir');
    write(join(root, 'node_modules', 'ignored.js'), 'ignored');
    write(join(root, '.git', 'ignored'), 'ignored');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const selected = await workspaces.createForTarget(host.hostToken, join(root, '.env'));
    const service = new runtime.OnlyPreviewIndexService(workspaces);
    const listing = await service.listDirectory({
      hostToken: host.hostToken,
      workspaceId: selected.workspaceId,
      relativePath: '',
      showHiddenFiles: false
    });
    assert.deepEqual(
      listing.entries.map(({ name }) => name),
      ['Folder2', 'Folder10', '.env', 'folder-link', 'z2.txt', 'z10.txt']
    );
    const index = await service.build({
      hostToken: host.hostToken,
      workspaceId: selected.workspaceId,
      showHiddenFiles: false
    });
    assert.deepEqual(
      index.entries.map(({ relativePath }) => relativePath),
      [
        'Folder2',
        'Folder10',
        '.env',
        'folder-link',
        'z2.txt',
        'z10.txt',
        'Folder2/item.txt',
        'Folder10/item.txt'
      ]
    );
    assert.deepEqual(
      index.entries
        .filter(({ parentRelativePath }) => parentRelativePath === '')
        .map(({ name }) => name),
      ['Folder2', 'Folder10', '.env', 'folder-link', 'z2.txt', 'z10.txt']
    );
    assert.equal(
      index.entries.some(({ relativePath }) => relativePath === '.hidden.txt'),
      false
    );
    assert.equal(
      index.entries.some(({ relativePath }) => /node_modules|\.git/.test(relativePath)),
      false
    );
    assert.equal(
      index.entries.some(({ relativePath }) => relativePath === 'folder-link/item.txt'),
      false
    );
    assert.equal(index.truncated, false);
  });
});

test('index is strict breadth-first across three levels', async () => {
  await withTempDirectory('onlypreview-index-bfs-', async (root) => {
    write(join(root, 'alpha', 'alpha-child', 'level-three.txt'), 'deep');
    write(join(root, 'alpha', 'level-two.txt'), 'two');
    write(join(root, 'beta', 'level-two.txt'), 'two');
    write(join(root, 'root.txt'), 'one');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const index = await new runtime.OnlyPreviewIndexService(workspaces).build({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      showHiddenFiles: true
    });
    assert.deepEqual(
      index.entries.map(({ relativePath }) => relativePath),
      [
        'alpha',
        'beta',
        'root.txt',
        'alpha/alpha-child',
        'alpha/level-two.txt',
        'beta/level-two.txt',
        'alpha/alpha-child/level-three.txt'
      ]
    );
    assert.equal(index.truncated, false);
  });
});

test('index progress uses a real counting pass before throttled breadth-first generation', async () => {
  await withTempDirectory('onlypreview-index-progress-', async (root) => {
    const branch = join(root, 'branch');
    mkdirSync(branch);
    write(join(root, 'root.txt'), 'root');
    for (let index = 0; index < 300; index += 1) {
      writeFileSync(join(branch, `file-${String(index).padStart(3, '0')}.txt`), 'x');
    }
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const progress = [];
    let changedBetweenPasses = false;
    const index = await new runtime.OnlyPreviewIndexService(workspaces).build({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      showHiddenFiles: true,
      onProgress: (event) => {
        progress.push(event);
        if (
          !changedBetweenPasses &&
          event.phase === 'indexing' &&
          event.completed === 0
        ) {
          changedBetweenPasses = true;
          rmSync(join(branch, 'file-299.txt'));
        }
      }
    });

    assert.equal(changedBetweenPasses, true);
    assert.equal(index.entries.length, 301);
    assert.deepEqual(progress[0], { phase: 'counting' });
    assert.deepEqual(progress[1], { phase: 'indexing', completed: 0, total: 302 });
    assert.deepEqual(
      progress.slice(2),
      [
        { phase: 'indexing', completed: 256, total: 302 },
        { phase: 'indexing', completed: 301, total: 302 }
      ]
    );
    const indexingProgress = progress.filter(({ phase }) => phase === 'indexing');
    for (let offset = 1; offset < indexingProgress.length; offset += 1) {
      assert.ok(indexingProgress[offset].completed >= indexingProgress[offset - 1].completed);
      assert.ok(indexingProgress[offset].completed <= indexingProgress[offset].total);
    }
  });
});

test('empty index emits counting and one settled zero-total indexing event', async () => {
  await withTempDirectory('onlypreview-index-progress-empty-', async (root) => {
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const progress = [];
    const index = await new runtime.OnlyPreviewIndexService(workspaces).build({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      showHiddenFiles: true,
      onProgress: (event) => progress.push(event)
    });
    assert.deepEqual(index.entries, []);
    assert.deepEqual(progress, [
      { phase: 'counting' },
      { phase: 'indexing', completed: 0, total: 0 }
    ]);
  });
});

test('100k search truncation never bounds complete demand-loaded directory listings', async () => {
  await withTempDirectory('onlypreview-index-limit-', async (root) => {
    const saturatedBranch = join(root, 'a-saturated');
    const completeBranch = join(root, 'z-complete');
    mkdirSync(saturatedBranch);
    mkdirSync(completeBranch);
    for (let index = 0; index < runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES; index += 1) {
      writeFileSync(join(saturatedBranch, `file-${String(index).padStart(6, '0')}.txt`), 'x');
    }
    write(join(completeBranch, 'still-browsable.txt'), 'visible');
    write(join(root, 'root-file.txt'), 'root');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const service = new runtime.OnlyPreviewIndexService(workspaces);
    const progress = [];
    const rootListing = await service.listDirectory({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      relativePath: '',
      showHiddenFiles: true
    });
    assert.deepEqual(
      rootListing.entries.map(({ relativePath }) => relativePath),
      ['a-saturated', 'z-complete', 'root-file.txt']
    );
    const index = await service.build({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      showHiddenFiles: true,
      onProgress: (event) => progress.push(event)
    });
    assert.equal(index.entries.length, runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES);
    assert.equal(index.truncated, true);
    assert.deepEqual(progress[0], { phase: 'counting' });
    assert.deepEqual(progress[1], {
      phase: 'indexing',
      completed: 0,
      total: runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES
    });
    assert.equal(progress.at(-1).completed, runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES);
    assert.equal(progress.at(-1).total, runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES);
    assert.ok(progress.length <= Math.ceil(runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES / 256) + 3);
    assert.equal(
      index.entries.some(({ relativePath }) => relativePath === 'z-complete/still-browsable.txt'),
      false
    );
    const completeListing = await service.listDirectory({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      relativePath: 'z-complete',
      showHiddenFiles: true
    });
    assert.deepEqual(
      completeListing.entries.map(({ relativePath }) => relativePath),
      ['z-complete/still-browsable.txt']
    );
  });
});

test('search silently stops at depth 20 while directory browsing continues deeper', async () => {
  await withTempDirectory('onlypreview-index-depth-', async (root) => {
    let current = root;
    const segments = [];
    for (let depth = 1; depth <= runtime.ONLY_PREVIEW_MAX_INDEX_DEPTH + 1; depth += 1) {
      const segment = `level-${String(depth).padStart(2, '0')}`;
      segments.push(segment);
      current = join(current, segment);
      mkdirSync(current);
    }
    write(join(current, 'too-deep.txt'), 'deep');
    const { hosts, workspaces } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const service = new runtime.OnlyPreviewIndexService(workspaces);
    const index = await service.build({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      showHiddenFiles: true
    });
    assert.equal(index.truncated, false);
    assert.equal(
      index.entries.some(({ name }) => name === 'too-deep.txt'),
      false
    );
    assert.equal(
      index.entries.some(({ name }) => name === 'level-21'),
      false
    );
    assert.equal(
      Math.max(...index.entries.map(({ relativePath }) => relativePath.split('/').length)),
      runtime.ONLY_PREVIEW_MAX_INDEX_DEPTH
    );
    const levelTwentyListing = await service.listDirectory({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      relativePath: segments.slice(0, runtime.ONLY_PREVIEW_MAX_INDEX_DEPTH).join('/'),
      showHiddenFiles: true
    });
    assert.deepEqual(levelTwentyListing.entries.map(({ name }) => name), ['level-21']);
    const levelTwentyOneListing = await service.listDirectory({
      hostToken: host.hostToken,
      workspaceId: workspace.workspaceId,
      relativePath: segments.join('/'),
      showHiddenFiles: true
    });
    assert.deepEqual(levelTwentyOneListing.entries.map(({ name }) => name), ['too-deep.txt']);
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
      await assert.rejects(
        new runtime.OnlyPreviewIndexService(workspaces).listDirectory({
          hostToken: host.hostToken,
          workspaceId: workspace.workspaceId,
          relativePath: '',
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

test('full-app E2E launchers require shared mock-Keychain isolation before Main readiness', () => {
  const launchArgs = source('tests/e2e/electronLaunchArgs.ts');
  const maestroFixture = source('tests/maestro/fixtures/bitterlessApp.fixture.ts');
  const onlyPreviewFixture = source('tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts');
  const appMain = source('src/main/app.main.ts');

  assert.doesNotMatch(launchArgs, /from ['"](?:electron|@playwright)/);
  assert.match(
    launchArgs,
    /platform === 'darwin' \? \['--use-mock-keychain'\] : \[\][\s\S]*applicationPath[\s\S]*\.\.\.applicationArguments/
  );

  for (const fixture of [maestroFixture, onlyPreviewFixture]) {
    assert.match(
      fixture,
      /import \{ buildBitterlessE2ELaunchArgs \} from '\.\.\/\.\.\/e2e\/electronLaunchArgs'/
    );
    const launchStart = fixture.indexOf('app = await electron.launch({');
    assert.ok(launchStart >= 0);
    const launchBody = fixture.slice(launchStart, fixture.indexOf('})', launchStart) + 2);
    assert.match(launchBody, /args: buildBitterlessE2ELaunchArgs\(\{/);
    assert.match(launchBody, /platform: process\.platform/);
    assert.match(launchBody, /applicationPath: projectRoot/);
    assert.doesNotMatch(launchBody, /args:\s*\[projectRoot/);
  }

  const guardStart = appMain.indexOf('const assertE2EKeychainIsolation');
  const guardCall = appMain.indexOf('assertE2EKeychainIsolation();');
  const configureE2ECall = appMain.indexOf('configureE2EUserData();');
  const firstWhenReady = appMain.indexOf('app.whenReady()');
  assert.ok(guardStart >= 0 && guardCall > guardStart);
  assert.ok(guardCall < configureE2ECall && guardCall < firstWhenReady);
  const guardBody = appMain.slice(guardStart, guardCall);
  assert.match(
    guardBody,
    /isHelperMode \|\| !isE2E \|\| app\.isPackaged \|\| process\.platform !== 'darwin'/
  );
  assert.match(guardBody, /app\.commandLine\.hasSwitch\('use-mock-keychain'\)/);
  assert.match(guardBody, /throw new Error\('BITTERLESS_E2E on macOS requires --use-mock-keychain'\)/);
});

test('recent-directory wiring stays Main-owned, value-free, and renderer-contract neutral', () => {
  const service = source('src/main/onlypreview/onlyPreviewRecentDirectory.service.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const appMain = source('src/main/app.main.ts');
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');

  assert.match(service, /Pick<[\s\S]*SettingDao[\s\S]*'getStored' \| 'insertIfAbsent' \| 'compareAndSet'/);
  assert.match(service, /RECENT_DIRECTORY_KEY = 'onlypreview_workspace'/);
  assert.match(service, /RECENT_DIRECTORY_SUB_KEY = 'last_directory'/);
  assert.doesNotMatch(service, /storage\.get\(|\.upsert\(/);
  assert.doesNotMatch(service, /console\.(?:log|info|warn|error)/);
  assert.match(service, /private readonly restoreFlights = new Map/);
  assert.match(service, /hosts\.onRevoke\(\(host\) => this\.revokeHost\(host\.hostToken\)\)/);
  assert.match(service, /expectedSerializedValue: stored\.serializedValue[\s\S]*value: null/);
  assert.match(service, /!workspace\.selectedRelativePath && workspace\.displayPath === candidate/);

  const absoluteOpen = handler.slice(
    handler.indexOf('export const openOnlyPreviewAbsoluteTarget'),
    handler.indexOf('export const destroyOnlyPreviewForAuth')
  );
  assert.ok(
    absoluteOpen.indexOf('beginExplicitTarget()') <
      absoluteOpen.indexOf('ensureStandalone()'),
    'OS targets must suppress restore before mounting standalone renderers'
  );
  assert.match(handler, /restoreWorkspace\(params\?\.hostToken\)/);
  assert.match(handler, /createXpcMainEmitter<OnlyPreviewRecentDirectoryStorage>\('SettingDao'\)/);
  assert.match(
    appMain,
    /handleCoreSqliteReady:[\s\S]*onlyPreviewRecentDirectoryService\.markStorageReady\(\)/
  );
  assert.match(
    appMain,
    /handleCoreSqliteFailure:[\s\S]*onlyPreviewRecentDirectoryService\.markStorageFailed\(\)/
  );
  assert.doesNotMatch(types, /recentDirectory|directoryPath|last_directory/i);
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
    'chooseFolder',
    'restoreWorkspace',
    'listDirectory',
    'buildIndex',
    'describeFile',
    'readText',
    'selectStandaloneFile',
    'updatePreviewBounds',
    'minimizeWindow',
    'toggleMaximizeWindow',
    'closeWindow',
    'showFileContextMenu',
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

test('OnlyPreview window commands stay host-capability scoped and Shell-owned', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');

  for (const method of ['minimizeWindow', 'toggleMaximizeWindow', 'closeWindow']) {
    assert.match(
      types,
      new RegExp(`${method}\\(params: OnlyPreviewHostRequest\\): Promise<OnlyPreviewResult<void>>`)
    );
    assert.match(handler, new RegExp(`params: ApiParams<'${method}'>`));
    assert.match(shellStore, new RegExp(`onlyPreviewClient\\.${method}\\(\\{ hostToken \\}\\)`));
  }

  assert.match(shellApp, /name="onlypreview__menuBar"/);
  assert.match(shellApp, /name="onlypreview__identity"/);
  assert.match(shellApp, /name="onlypreview__menuActions"/);
  assert.match(shellApp, /name="onlypreview__openFolder"[\s\S]*topbar\.openFolder/);
  assert.doesNotMatch(shellApp, /name="onlypreview__(?:openFile|refresh)"/);
  assert.match(
    shellApp,
    /name="onlypreview__settings"[\s\S]*:title="onlyPreviewI18n\.topbar\.settings"/
  );
  for (const control of ['minimize', 'maximize', 'close']) {
    assert.match(shellApp, new RegExp(`name="onlypreview__${control}"`));
    assert.match(i18n, new RegExp(`${control}: '.*OnlyPreview`));
  }
  assert.match(shellApp, /const isMac = onlyPreviewEnv\.platform === 'darwin'/);
  assert.match(shellApp, /const isWindows = onlyPreviewEnv\.platform === 'win32'/);
  assert.match(shellApp, /@dblclick="handleMenuBarDoubleClick"/);
  assert.match(
    shellApp,
    /closest\('\.onlypreview-shell__menu-actions'\)[\s\S]*toggleMaximizeWindow\(\)/
  );
  assert.doesNotMatch(shellApp, /eyesOnAgents|EyesOnAgents/);
  assert.doesNotMatch(shellStore, /eyesOnAgents|EyesOnAgents/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-bar \{[\s\S]*height:\s*32px/);
  assert.match(shellStyle, /background:\s*var\(--onlypreview-royal\)/);
  assert.match(shellStyle, /border-bottom:\s*1px solid #3d4666/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-bar--mac \{[\s\S]*padding-left:\s*78px/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-actions[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(shellStyle, /\.onlypreview-shell__menu-actions \.arco-btn \{[\s\S]*height:\s*27px/);
  assert.match(shellStyle, /\.arco-btn:focus-visible[\s\S]*outline:\s*2px solid/);
});

test('workspace updates have one authoritative event path and stale browse/index results are discarded', () => {
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
  const chooseFolderBody = shellStore.slice(
    shellStore.indexOf('async chooseFolder()'),
    shellStore.indexOf('async refresh()')
  );
  assert.match(chooseFolderBody, /onlyPreviewClient\.chooseFolder/);
  assert.doesNotMatch(chooseFolderBody, /applyWorkspace\(|this\.workspace\s*=/);

  const projectionBody = shellStore.slice(
    shellStore.indexOf('private async reloadWorkspaceProjection()'),
    shellStore.indexOf('private async loadDirectory(')
  );
  assert.match(projectionBody, /const workspaceId = workspace\.workspaceId/);
  assert.match(projectionBody, /const generation = \+\+this\.projectionGeneration/);
  assert.match(projectionBody, /this\.directoryListings\.clear\(\)/);
  assert.match(projectionBody, /this\.expandedPaths\.clear\(\)/);
  assert.match(projectionBody, /await this\.loadDirectory\('', generation\)/);
  assert.match(projectionBody, /await this\.loadSelectedParentListings\(generation\)/);
  assert.ok(
    projectionBody.indexOf("await this.loadDirectory('', generation)") <
      projectionBody.indexOf('await onlyPreviewClient.buildIndex'),
    'the complete root listing must resolve before the search index starts'
  );
  assert.match(
    projectionBody,
    /generation !== this\.projectionGeneration[\s\S]*workspaceId !== this\.workspace\?\.workspaceId/
  );

  const listingBody = shellStore.slice(
    shellStore.indexOf('private async loadDirectory('),
    shellStore.indexOf('private async refreshSettings()')
  );
  assert.match(listingBody, /onlyPreviewClient\.listDirectory/);
  assert.match(
    listingBody,
    /generation !== this\.projectionGeneration[\s\S]*workspaceId !== this\.workspace\?\.workspaceId[\s\S]*listing\.workspaceId !== workspaceId[\s\S]*listing\.relativePath !== relativePath/
  );
  assert.match(listingBody, /this\.directoryListings\.set\(relativePath, listing\.entries\)/);

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

test('Shell keeps complete browse listings separate from the bounded breadth-first search projection', () => {
  assert.equal(runtime.ONLY_PREVIEW_MAX_INDEX_ENTRIES, 100_000);
  assert.equal(runtime.ONLY_PREVIEW_MAX_INDEX_DEPTH, 20);
  const service = source('src/main/onlypreview/onlyPreviewIndex.service.ts');
  const listDirectoryBody = service.slice(
    service.indexOf('async listDirectory('),
    service.indexOf('async build(')
  );
  assert.match(listDirectoryBody, /readDirectoryEntries/);
  assert.doesNotMatch(listDirectoryBody, /ONLY_PREVIEW_MAX_INDEX_ENTRIES/);
  const buildBody = service.slice(
    service.indexOf('async build('),
    service.indexOf('private async readDirectoryEntries(')
  );
  assert.match(buildBody, /directories: Array<\{ relativePath: string; depth: number \}>/);
  assert.match(buildBody, /for \(let directoryIndex = 0; directoryIndex < directories\.length/);
  assert.match(buildBody, /directories\.push\(\{ relativePath: child\.relativePath, depth: childDepth \}\)/);

  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const visibleRows = shellStore.slice(
    shellStore.indexOf('get visibleRows()'),
    shellStore.indexOf('private get browseRows')
  );
  assert.match(visibleRows, /if \(!query\) return this\.browseRows/);
  assert.match(visibleRows, /this\.index\.entries/);
  const browseRows = shellStore.slice(
    shellStore.indexOf('private get browseRows'),
    shellStore.indexOf('get projectionReady()')
  );
  assert.match(browseRows, /this\.directoryListings\.get\(parentRelativePath\)/);
  assert.doesNotMatch(browseRows, /this\.index/);
  assert.match(shellStore, /async toggleDirectory[\s\S]*await this\.loadDirectory\(relativePath\)/);

  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.doesNotMatch(i18n, /Search covers the first|搜索覆盖按层级排列的前/);
  assert.doesNotMatch(i18n, /Narrow the folder|缩小文件夹范围/);
});

test('index progress stays exact, host-revision scoped, and visually copy-free', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const contract = source('src/shared/onlypreview/onlyPreview.contract.ts');
  const service = source('src/main/onlypreview/onlyPreviewIndex.service.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');

  assert.equal(runtime.ONLY_PREVIEW_INDEX_PROGRESS_EVENT, 'onlypreview/indexProgress');
  assert.match(
    types,
    /buildIndex\(\s*params: OnlyPreviewHostRequest & \{ workspaceId: string; indexRevision: string \}/
  );
  const progressType = types.slice(
    types.indexOf('export type OnlyPreviewIndexProgressEvent'),
    types.indexOf('export interface OnlyPreviewCharacterCountEvent')
  );
  assert.match(progressType, /hostId: string/);
  assert.match(progressType, /indexRevision: string/);
  assert.match(progressType, /phase: 'counting'/);
  assert.match(progressType, /phase: 'indexing'/);
  assert.match(progressType, /completed: number/);
  assert.match(progressType, /total: number/);
  assert.doesNotMatch(
    progressType,
    /relativePath|absolutePath|displayPath|filename|content|settings/
  );
  assert.match(
    contract,
    /parseOnlyPreviewIndexRevision[\s\S]*value\.length === 0[\s\S]*value\.length > 128/
  );

  const buildBody = service.slice(
    service.indexOf('async build('),
    service.indexOf('private async readDirectoryEntries(')
  );
  assert.ok(buildBody.indexOf("phase: 'counting'") < buildBody.indexOf('const counted ='));
  assert.ok(buildBody.indexOf('const counted =') < buildBody.indexOf("phase: 'indexing'"));
  assert.ok(buildBody.indexOf("phase: 'indexing'") < buildBody.indexOf('const generated ='));
  assert.match(buildBody, /completed % 256 !== 0/);
  assert.match(buildBody, /maximumEntries: ONLY_PREVIEW_MAX_INDEX_ENTRIES/);
  assert.match(buildBody, /maximumEntries: total/);

  const handlerBuild = handler.slice(
    handler.indexOf('async buildIndex('),
    handler.indexOf('async describeFile(')
  );
  assert.match(handlerBuild, /parseOnlyPreviewIndexRevision\(params\?\.indexRevision\)/);
  assert.match(
    handlerBuild,
    /ONLY_PREVIEW_INDEX_PROGRESS_EVENT[\s\S]*hostId: host\.hostId,[\s\S]*indexRevision,[\s\S]*\.\.\.progress/
  );
  const broadcastPayload = handlerBuild.slice(
    handlerBuild.indexOf('xpcMain.broadcast(ONLY_PREVIEW_INDEX_PROGRESS_EVENT'),
    handlerBuild.indexOf('...progress') + '...progress'.length
  );
  assert.doesNotMatch(broadcastPayload, /relativePath|absolutePath|displayPath|content|settings/);

  assert.match(shellStore, /Object\.keys\(event\)\.length === 3/);
  assert.match(shellStore, /Object\.keys\(event\)\.length === 5/);
  assert.match(shellStore, /event\.total as number\) <= ONLY_PREVIEW_MAX_INDEX_ENTRIES/);
  assert.match(
    shellStore,
    /payload\.params\.hostId !== onlyPreviewEnv\.hostId[\s\S]*payload\.params\.indexRevision !== this\.currentIndexRevision/
  );
  assert.match(
    shellStore,
    /payload\.params\.completed < previous\.completed[\s\S]*return;/
  );
  const projectionBody = shellStore.slice(
    shellStore.indexOf('private async reloadWorkspaceProjection()'),
    shellStore.indexOf('private async loadDirectory(')
  );
  assert.match(
    projectionBody,
    /const indexRevision = crypto\.randomUUID\(\)[\s\S]*this\.currentIndexRevision = indexRevision[\s\S]*indexRevision/
  );
  assert.match(
    projectionBody,
    /indexRevision === this\.currentIndexRevision[\s\S]*this\.currentIndexRevision = ''[\s\S]*this\.indexProgress = null/
  );

  assert.match(shellApp, /name="onlypreview__indexProgress"/);
  assert.match(shellApp, /onlypreview-shell__index-progress--\$\{onlyPreviewShellStore\.indexProgress\.phase\}/);
  assert.match(shellApp, /:aria-label="onlyPreviewI18n\.project\.indexProgressLabel"/);
  assert.match(
    shellStyle,
    /\.onlypreview-shell__index-progress \{[\s\S]*height:\s*2px[\s\S]*flex:\s*0 0 2px[\s\S]*margin-top:\s*auto/,
    'the active rail must remain at the Project bottom when no body branch is rendered'
  );
  const zeroRowProjection = shellApp.slice(
    shellApp.indexOf('v-else-if="onlyPreviewShellStore.projectionReady'),
    shellApp.indexOf('name="onlypreview__indexProgress"')
  );
  assert.match(zeroRowProjection, /!onlyPreviewShellStore\.indexLoading/);
  assert.match(
    zeroRowProjection,
    /onlyPreviewShellStore\.searchQuery\.trim\(\)[\s\S]*project\.noResults[\s\S]*project\.emptyProject/,
    'the same bottom anchor must cover active empty-folder and active search-no-result states'
  );
  assert.match(shellStyle, /onlypreview-index-counting[\s\S]*infinite/);
  assert.match(
    shellStyle,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*index-progress--counting[\s\S]*animation:\s*none/
  );
  assert.doesNotMatch(shellApp, /onlypreview__truncated|index-state|indexStatus|truncatedMessage/);
  assert.doesNotMatch(
    i18n,
    /indexPartial|indexReady|indexFailed|readyToOpen|Search covers the first|搜索覆盖按层级排列的前/
  );
  assert.match(i18n, /indexProgressLabel:\s*'Building project search index'/);
  assert.match(i18n, /indexProgressLabel:\s*'正在建立项目搜索索引'/);
});

test('OnlyPreview folder-first chrome, current-file locator, and native file menu stay capability scoped', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const previewSurface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  const previewStyle = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.less'
  );
  const onlyPreviewI18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  const nativeEnglish = source('src/renderer/common/i18n/en.ts');
  const nativeChinese = source('src/renderer/common/i18n/zh.ts');

  assert.match(
    types,
    /chooseFolder\(\s*params: OnlyPreviewHostRequest\s*\): Promise<OnlyPreviewResult<OnlyPreviewWorkspace \| null>>/
  );
  assert.match(
    types,
    /listDirectory\(\s*params: OnlyPreviewHostRequest & \{ workspaceId: string; relativePath: string \}\s*\): Promise<OnlyPreviewResult<OnlyPreviewDirectoryListing>>/
  );
  assert.match(
    types,
    /showFileContextMenu\(\s*params: OnlyPreviewHostRequest & OnlyPreviewFileRef\s*\): Promise<OnlyPreviewResult<void>>/
  );
  assert.doesNotMatch(types, /OnlyPreviewTargetKind|chooseTarget/);
  assert.doesNotMatch(handler, /parseTargetKind|chooseTarget/);
  assert.doesNotMatch(shellStore, /chooseTarget|chooseFile/);
  const listDirectoryBody = handler.slice(
    handler.indexOf('async listDirectory('),
    handler.indexOf('async buildIndex(')
  );
  assert.match(
    listDirectoryBody,
    /hostToken: params\?\.hostToken[\s\S]*workspaceId: params\?\.workspaceId[\s\S]*relativePath: params\?\.relativePath/
  );
  assert.doesNotMatch(listDirectoryBody, /absolutePath|displayPath|limit|depth/);
  assert.match(handler, /properties:\s*\['openDirectory'\]/);
  assert.match(windowHelper, /if \(key === 'o'\) return 'choose-folder'/);
  assert.match(
    handler,
    /openOnlyPreviewAbsoluteTarget[\s\S]*openExplicitTarget\([\s\S]*host\.hostToken,[\s\S]*target,[\s\S]*generation/
  );

  assert.match(shellApp, /name="onlypreview__openFolder"/);
  assert.doesNotMatch(shellApp, /name="onlypreview__(?:openFile|refresh)"/);
  assert.doesNotMatch(shellApp, /index\.entries\.length|project-count|preview\.readOnly/);
  assert.doesNotMatch(onlyPreviewI18n, /itemCount|openFile:\s*|refresh:\s*/);
  assert.doesNotMatch(previewSurface, /IconLock|badge--read-only|preview\.readOnly/);
  assert.doesNotMatch(previewStyle, /badge--read-only/);

  assert.match(shellApp, /IconCrosshair/);
  assert.match(shellApp, /name="onlypreview__locateCurrentFile"/);
  assert.match(shellApp, /:disabled="!onlyPreviewShellStore\.selectedEntry"/);
  assert.match(
    shellStore,
    /async locateSelectedFile\(\): Promise<string> \{[\s\S]*this\.searchQuery = ''[\s\S]*this\.expandSelectedParents\(\)[\s\S]*await this\.loadSelectedParentListings\(\)[\s\S]*this\.focusedRelativePath = this\.selectedEntry\.relativePath/
  );
  assert.match(
    shellStore,
    /private findEntry[\s\S]*this\.directoryListings\.values\(\)[\s\S]*this\.index\?\.entries/
  );
  assert.match(shellApp, /scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(shellApp, /item\.focus\(center \? \{ preventScroll: true \} : undefined\)/);
  assert.match(shellStyle, /\.onlypreview-shell__project-action\.arco-btn \{[\s\S]*height:\s*27px/);
  assert.match(shellStyle, /\.onlypreview-shell__project-action\.arco-btn:focus-visible/);

  assert.match(shellApp, /@contextmenu\.prevent\.stop="onlyPreviewShellStore\.showFileContextMenu\(row\.entry\)"/);
  assert.match(
    shellStore,
    /showFileContextMenu\(entry: OnlyPreviewIndexEntry\)[\s\S]*entry\.nodeKind !== 'file'[\s\S]*onlyPreviewClient\.showFileContextMenu/
  );
  assert.doesNotMatch(shellStore, /clipboard|absolutePath/);
  const menuBody = handler.slice(
    handler.indexOf('async showFileContextMenu('),
    handler.indexOf('async openExternally(')
  );
  assert.match(
    menuBody,
    /getStandaloneWindow\(params\?\.hostToken\)[\s\S]*await onlyPreviewWorkspaceRegistry\.resolveFile/
  );
  assert.match(menuBody, /i18nHelper\.getMessages\(\)\.app\.onlyPreviewFileMenu/);
  for (const id of [
    'onlypreview-preview',
    'onlypreview-open-externally',
    'onlypreview-reveal-in-folder'
  ]) {
    assert.match(menuBody, new RegExp(`id: '${id}'`));
  }
  assert.match(menuBody, /click: \(\) => void this\.selectStandaloneFile\(request\)/);
  assert.match(menuBody, /click: \(\) => void this\.openExternally\(request\)/);
  assert.match(menuBody, /click: \(\) => void this\.revealInFolder\(request\)/);
  assert.match(menuBody, /Menu\.buildFromTemplate\([\s\S]*\.popup\(\{ window \}\)/);
  assert.doesNotMatch(menuBody, /realPath/);
  for (const catalog of [nativeEnglish, nativeChinese]) {
    assert.match(catalog, /onlyPreviewFileMenu:[\s\S]*preview:[\s\S]*openExternally:[\s\S]*revealInFolder:/);
  }
});

test('OnlyPreview Settings restores size but derives parented work-area bounds on every open', () => {
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const boundsService = source(
    'src/main/onlypreview/onlyPreviewWindowBounds.service.ts'
  );
  const positioning = windowHelper.slice(
    windowHelper.indexOf('const settingsBoundsForParent'),
    windowHelper.indexOf('export class OnlyPreviewWindowHelper')
  );
  const openSettings = windowHelper.slice(
    windowHelper.indexOf('async openSettings('),
    windowHelper.indexOf('closeSettings(')
  );

  assert.match(positioning, /screen\.getDisplayMatching\(parentBounds\)\.workArea/);
  assert.match(positioning, /resolveOnlyPreviewSettingsBounds\(\{/);
  assert.match(positioning, /minWidth: MIN_WIDTH[\s\S]*minHeight: MIN_HEIGHT/);
  assert.match(boundsService, /Math\.min\(Math\.round\(request\.width\), Math\.max\(workArea\.width, minWidth\)\)/);
  assert.match(boundsService, /Math\.min\(Math\.round\(request\.height\), Math\.max\(workArea\.height, minHeight\)\)/);
  assert.match(boundsService, /Math\.min\(maxX, Math\.max\(workArea\.x, centeredX\)\)/);
  assert.match(boundsService, /Math\.min\(maxY, Math\.max\(workArea\.y, centeredY\)\)/);
  assert.match(openSettings, /const parentWindow = this\.requireStandaloneWindow\(sourceHostToken\)/);
  assert.match(openSettings, /restored\?\.bounds\.width[\s\S]*restored\?\.bounds\.height/);
  assert.doesNotMatch(openSettings, /restored\.bounds\.(?:x|y)/);
  assert.match(openSettings, /parent: parentWindow/);
  assert.match(openSettings, /settingsBoundsForParent\(parentWindow\.getBounds\(\)/);
  assert.match(openSettings, /window\.show\(\);[\s\S]*window\.focus\(\)/);
  assert.doesNotMatch(openSettings, /settingsWindowState\?\.show\(\)/);
});

test('window sources enforce standalone isolation and generic Omni renderer cleanup', () => {
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
  assert.match(standalone, /MENU_BAR_HEIGHT\s*=\s*32/);
  assert.match(standalone, /STATUS_HEIGHT\s*=\s*25/);
  assert.match(standalone, /clampPreviewBounds\(previewView\.getBounds\(\),\s*width,\s*height\)/);
  assert.match(standalone, /onlyPreviewHostRegistry\.revoke\(host\.hostToken\)/);
  assert.match(standalone, /minWidth:\s*MIN_WIDTH/);
  assert.match(standalone, /minHeight:\s*MIN_HEIGHT/);
  assert.match(standalone, /autoHideMenuBar:\s*true/);
  assert.match(standalone, /titleBarStyle:\s*'hidden'/);
  assert.match(
    standalone,
    /process\.platform === 'darwin'[\s\S]*trafficLightPosition:\s*\{\s*x:\s*12,\s*y:\s*8\s*\}/
  );
  assert.doesNotMatch(standalone, /titleBarStyle:\s*'hiddenInset'/);
  assert.doesNotMatch(standalone, /frame:\s*false/);
  assert.doesNotMatch(standalone, /`--mode=\$\{hostKind\}`/);
  assert.match(
    standalone,
    /minimizeWindow\(hostToken: string\): void \{[\s\S]*this\.requireStandaloneWindow\(hostToken\)\.minimize\(\)/
  );
  assert.match(
    standalone,
    /toggleMaximizeWindow\(hostToken: string\): void \{[\s\S]*this\.requireStandaloneWindow\(hostToken\)[\s\S]*isMaximized\(\)[\s\S]*unmaximize\(\)[\s\S]*maximize\(\)/
  );
  assert.match(
    standalone,
    /closeWindow\(hostToken: string\): void \{[\s\S]*this\.requireStandaloneWindow\(hostToken\)\.close\(\)/
  );
  assert.match(
    standalone,
    /private requireStandaloneWindow\(hostToken: string\): BaseWindow \{[\s\S]*this\.requireStandaloneHost\(hostToken\)/
  );

  const devToolsGuard = standalone.slice(
    standalone.indexOf('const isOnlyPreviewDevToolsEnabled'),
    standalone.indexOf('const isOnlyPreviewDevToolsShortcut')
  );
  assert.match(devToolsGuard, /import\.meta\.env\.VITE_MODE === 'debug'/);
  assert.match(
    devToolsGuard,
    /process\.env\.BITTERLESS_E2E === '1' && !app\.isPackaged/
  );
  const devToolsShortcut = standalone.slice(
    standalone.indexOf('const isOnlyPreviewDevToolsShortcut'),
    standalone.indexOf('const bindOnlyPreviewDevToolsShortcut')
  );
  assert.match(
    devToolsShortcut,
    /input\.type !== 'keyDown' \|\| input\.isAutoRepeat[\s\S]*key === 'f12'/
  );
  assert.match(
    devToolsShortcut,
    /if \(key === 'f12'\) return !input\.shift && !input\.control && !input\.alt && !input\.meta/
  );
  assert.match(devToolsShortcut, /if \(key !== 'i'\) return false/);
  assert.match(
    devToolsShortcut,
    /process\.platform === 'darwin'[\s\S]*input\.meta && input\.alt && !input\.control && !input\.shift/
  );
  assert.match(
    devToolsShortcut,
    /process\.platform === 'win32'[\s\S]*input\.control && input\.shift && !input\.meta && !input\.alt/
  );
  const bindDevToolsShortcut = standalone.slice(
    standalone.indexOf('const bindOnlyPreviewDevToolsShortcut'),
    standalone.indexOf('const clampPreviewBounds')
  );
  assert.match(
    bindDevToolsShortcut,
    /if \(!isOnlyPreviewDevToolsEnabled\(\)\) return;[\s\S]*webContents\.on\('before-input-event'/
  );
  assert.match(
    bindDevToolsShortcut,
    /event\.preventDefault\(\);[\s\S]*webContents\.isDevToolsOpened\(\)[\s\S]*webContents\.closeDevTools\(\)[\s\S]*webContents\.openDevTools\(\{ mode: 'detach' \}\)/
  );
  const createViewBody = standalone.slice(
    standalone.indexOf('private createView('),
    standalone.indexOf('private async loadView(')
  );
  assert.match(
    createViewBody,
    /this\.bindNativeShortcuts\(view\.webContents, host\);[\s\S]*bindOnlyPreviewDevToolsShortcut\(view\.webContents\)/
  );
  assert.equal((standalone.match(/openDevTools\(/g) ?? []).length, 1);

  const omni = source('src/main/windows/omniWindow.helper.ts');
  assert.doesNotMatch(omni, /onlypreview/i);
  assert.match(omni, /render-process-gone/);
  assert.match(omni, /additionalArguments:\s*\['--mode=omni'\]/);
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
    omni.indexOf('private notifyCellUrl(')
  );
  assert.match(
    removeCellViewsBody,
    /this\.disposeWebContentsView\(cell\.menubar\);[\s\S]*this\.disposeWebContentsView\(cell\.content\);/
  );
  assert.doesNotMatch(removeCellViewsBody, /host|revoke/i);
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
  const omniRuntime = source('src/main/windows/omniWindow.helper.ts');
  assert.doesNotMatch(omniTypes, /onlypreview/i);
  assert.doesNotMatch(omniPane, /onlypreview/i);
  assert.doesNotMatch(omniRuntime, /onlypreview/i);

  const onlyPreviewTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  assert.match(onlyPreviewTypes, /OnlyPreviewHostKind = 'standalone' \| 'settings'/);
  assert.doesNotMatch(onlyPreviewTypes, /OnlyPreviewHostKind[^;]*omni/i);

  const preload = source('src/preload/onlypreview/onlypreview.preload.ts');
  const preloadTypes = source('src/preload/onlypreview/onlypreview.preload.type.ts');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /hostToken/);
  assert.doesNotMatch(preload, /ipcMain|ipcRenderer/);
  assert.doesNotMatch(preload, /containerMode|--mode=/);
  assert.doesNotMatch(preloadTypes, /containerMode|ContainerMode|omni/i);

  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  assert.doesNotMatch(shellApp, /PreviewSurface|isOmni|--omni/);
  assert.doesNotMatch(shellStore, /onlyPreviewPreviewStore|containerMode|isOmni/);
  assert.match(shellApp, /new ResizeObserver\(reportPreviewBounds\)/);

  const previewApp = source('src/renderer/onlypreview/preview/src/App.vue');
  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(previewApp, /onlyPreviewPreviewStore\.initialize\(\)/);
  assert.match(previewStore, /async initialize\(\): Promise<void>/);
  assert.doesNotMatch(previewStore, /initialize\(restore/);

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
  assert.doesNotMatch(shellApp, /index\.truncated|indexPartial|indexReady/);
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
  assert.doesNotMatch(onlyPreviewI18n, /indexPartial|indexReady/);

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

test('Markdown rendering and selection counts stay renderer-only, inert, and host-scoped', () => {
  const packageJson = JSON.parse(source('package.json'));
  assert.equal(packageJson.dependencies.marked, '18.0.7');
  assert.equal(packageJson.dependencies.dompurify, '3.4.12');

  const classifier = source('src/main/onlypreview/onlyPreviewClassifier.service.ts');
  assert.match(classifier, /TEXT_EXTENSIONS[\s\S]*'\.md'[\s\S]*'\.mdx'/);
  assert.match(classifier, /'\.md':\s*'markdown'/);
  assert.match(classifier, /'\.mdx':\s*'markdown'/);
  assert.doesNotMatch(classifier, /'\.markdown'/);

  const surface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  const markdownBranch = surface.indexOf('<MarkdownPreview');
  const monacoBranch = surface.indexOf('<MonacoTextPreview');
  assert.ok(markdownBranch >= 0 && markdownBranch < monacoBranch);
  assert.match(surface, /descriptor\.extension === '\.md'/);
  assert.doesNotMatch(surface, /descriptor\.extension === '\.mdx'/);
  assert.doesNotMatch(surface, /descriptor\.extension === '\.markdown'/);

  const markdownService = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts'
  );
  assert.match(markdownService, /from 'marked'/);
  assert.match(markdownService, /from 'dompurify'/);
  assert.match(markdownService, /ONLY_PREVIEW_MAX_MARKDOWN_BYTES/);
  assert.match(markdownService, /class OnlyPreviewMarkdownRenderer extends Renderer/);
  assert.match(markdownService, /html\(\{ text \}[\s\S]*escapeHtml\(text\)/);
  assert.match(markdownService, /image\(\{ text \}[\s\S]*\[Image:/);
  assert.match(markdownService, /purifier\.sanitize\(parsed/);
  assert.match(markdownService, /ALLOWED_ATTR:\s*\[\]/);
  assert.match(markdownService, /ALLOW_ARIA_ATTR:\s*false/);
  assert.match(markdownService, /ALLOW_DATA_ATTR:\s*false/);
  assert.match(markdownService, /ALLOWED_NAMESPACES:\s*\['http:\/\/www\.w3\.org\/1999\/xhtml'\]/);

  const markdownComponent = source(
    'src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue'
  );
  assert.match(markdownComponent, /v-html="renderResult\.html"/);
  assert.match(markdownComponent, /countOnlyPreviewDomSelection\(documentRef\.value/);
  assert.match(markdownComponent, /document\.addEventListener\('selectionchange'/);
  assert.match(markdownComponent, /document\.removeEventListener\('selectionchange'/);
  assert.match(markdownComponent, /reportCharacterCount\(0, props\.reportingRevision\)/);
  assert.match(markdownComponent, /armCharacterCountReporting\(props\.reportingRevision\)/);

  const markdownStyle = source(
    'src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.less'
  );
  assert.match(markdownStyle, /width:\s*min\(860px, 100%\)/);
  assert.match(markdownStyle, /overflow:\s*auto/);
  assert.match(markdownStyle, /--onlypreview-royal/);
  assert.match(markdownStyle, /border-collapse:\s*collapse/);
  assert.doesNotMatch(markdownStyle, /animation|transition/);

  const characterService = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewCharacterCount.service.ts'
  );
  assert.match(characterService, /new Intl\.Segmenter\(undefined, \{ granularity: 'grapheme' \}\)/);
  assert.match(characterService, /Array\.from\(value\)\.length/);
  assert.match(characterService, /root\.contains\(selection\.anchorNode\)/);
  assert.match(characterService, /root\.contains\(selection\.focusNode\)/);

  const monaco = source(
    'src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue'
  );
  assert.match(monaco, /onDidChangeCursorSelection/);
  assert.match(monaco, /getSelections\(\)/);
  assert.match(monaco, /filter\(\(selection\) => !selection\.isEmpty\(\)\)/);
  assert.match(monaco, /getValueInRange\(selection\)/);
  assert.match(monaco, /selectionDisposable\?\.dispose\(\)/);
  assert.match(monaco, /reportCharacterCount\(0, props\.reportingRevision\)/);
  assert.match(monaco, /armCharacterCountReporting\(props\.reportingRevision\)/);

  const pdf = source('src/renderer/onlypreview/preview/src/components/PdfPreview/PdfPreview.vue');
  assert.match(pdf, /countOnlyPreviewDomSelection\(pagesRef\.value/);
  assert.match(pdf, /document\.addEventListener\('selectionchange'/);
  assert.match(pdf, /document\.removeEventListener\('selectionchange'/);
  assert.match(pdf, /reportCharacterCount\(0, props\.reportingRevision\)/);
  assert.match(pdf, /armCharacterCountReporting\(props\.reportingRevision\)/);

  const characterCountGate = source(
    'src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts'
  );
  assert.match(characterCountGate, /class OnlyPreviewCharacterCountSourceGate/);
  assert.match(characterCountGate, /revision === this\.currentRevision/);
  assert.match(characterCountGate, /this\.armedRevision === revision/);
  assert.match(characterCountGate, /class OnlyPreviewCharacterCountHostGate/);
  assert.match(characterCountGate, /this\.readyRevision === this\.currentRevision/);
  assert.match(characterCountGate, /canBufferCount\(characterCount: number\)/);
  assert.match(characterCountGate, /isSuspended\(\): boolean/);
  assert.match(characterCountGate, /revisionForSync\(\): string/);

  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(
    previewStore,
    /xpcRenderer\.broadcast\(ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT, \{\s*hostId,\s*characterCount\s*\}\);/
  );
  assert.match(
    previewStore,
    /ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT, \{[\s\S]*?hostId: onlyPreviewEnv\.hostId[\s\S]*?\}/
  );
  assert.match(
    previewStore,
    /ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT[\s\S]*restoreSelection\(payload\.params\.revision\)/
  );
  assert.match(
    previewStore,
    /ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT, \{[\s\S]*?hostId,[\s\S]*?revision: reportingRevision[\s\S]*?\}/
  );
  assert.match(previewStore, /characterCountGate\.canReport\(reportingRevision, normalizedCount\)/);
  assert.doesNotMatch(previewStore, /xpcRenderer\.subscribe\(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT/);
  assert.doesNotMatch(previewStore, /xpcRenderer\.subscribe\(ONLY_PREVIEW_SELECTION_CHANGED_EVENT/);
  assert.doesNotMatch(previewStore, /xpcRenderer\.subscribe\(ONLY_PREVIEW_REFRESH_EVENT/);
  assert.doesNotMatch(previewStore, /selectedText|selectionText|text:\s*character/);

  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  assert.match(shellStore, /keys\.length === 2/);
  assert.match(shellStore, /Number\.isSafeInteger\(event\.characterCount\)/);
  assert.match(
    shellStore,
    /isCharacterCountEvent\(payload\.params\)[\s\S]*payload\.params\.hostId === onlyPreviewEnv\.hostId/
  );
  assert.match(shellStore, /characterCountGate\.canAcceptCount\(payload\.params\.characterCount\)/);
  assert.match(shellStore, /characterCountGate\.canBufferCount\(payload\.params\.characterCount\)/);
  assert.match(shellStore, /ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT/);
  assert.match(shellStore, /characterCountGate\.acceptReady\(payload\.params\.revision\)/);
  assert.match(shellStore, /ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT/);
  assert.match(
    shellStore,
    /syncCharacterCountTransition\(\)[\s\S]*!this\.characterCountGate\.isSuspended\(\)[\s\S]*beginCharacterCountTransition\(\)/
  );
  assert.match(shellStore, /const revision = crypto\.randomUUID\(\)/);
  assert.match(
    shellStore,
    /ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT[\s\S]*beginCharacterCountTransition\(\)[\s\S]*restoreWorkspace\(\)/
  );
  assert.match(
    shellStore,
    /ONLY_PREVIEW_SELECTION_CHANGED_EVENT[\s\S]*beginCharacterCountTransition\(\)[\s\S]*syncSelection\(\)/
  );
  const selectFile = shellStore.slice(
    shellStore.indexOf('private async selectFile('),
    shellStore.indexOf('private expandSelectedParents()')
  );
  assert.match(
    selectFile,
    /private async selectFile[\s\S]*this\.restoreGeneration \+= 1;[\s\S]*rotateCharacterCountRevision\(\)[\s\S]*this\.selectedRelativePath = relativePath/
  );
  assert.match(
    selectFile,
    /catch \(error\)[\s\S]*if \(generation !== this\.selectionGeneration\) return;[\s\S]*await this\.syncSelection\(\);[\s\S]*if \(generation !== this\.selectionGeneration\) return;[\s\S]*const recoveryRevision = this\.beginCharacterCountTransition\(\);[\s\S]*resumeCharacterCountReporting\(recoveryRevision\)/
  );
  const pendingRevision = shellStore.slice(
    shellStore.indexOf('private rotateCharacterCountRevision()'),
    shellStore.indexOf('private resumeCharacterCountReporting(')
  );
  assert.match(pendingRevision, /characterCountGate\.beginTransition\(revision\)/);
  assert.doesNotMatch(pendingRevision, /broadcast\(/);

  const directRefresh = shellStore.slice(
    shellStore.indexOf('async refresh()'),
    shellStore.indexOf('async openSettings()')
  );
  assert.match(directRefresh, /beginCharacterCountTransition\(\)/);
  assert.match(directRefresh, /await this\.reloadWorkspaceProjection\(\)/);
  assert.ok(
    directRefresh.indexOf('beginCharacterCountTransition()') <
      directRefresh.indexOf('await this.reloadWorkspaceProjection()')
  );
  assert.match(directRefresh, /finally[\s\S]*resumeCharacterCountReporting/);
  assert.doesNotMatch(directRefresh, /broadcast\(ONLY_PREVIEW_REFRESH_EVENT/);

  const nativeRefresh = shellStore.slice(
    shellStore.indexOf('xpcRenderer.subscribe(ONLY_PREVIEW_REFRESH_EVENT'),
    shellStore.indexOf('xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT')
  );
  assert.match(nativeRefresh, /beginCharacterCountTransition\(\)/);
  assert.match(nativeRefresh, /this\.reloadWorkspaceProjection\(\)/);
  assert.ok(
    nativeRefresh.indexOf('beginCharacterCountTransition()') <
      nativeRefresh.indexOf('this.reloadWorkspaceProjection()')
  );
  assert.match(nativeRefresh, /finally[\s\S]*resumeCharacterCountReporting/);
  assert.ok((shellStore.match(/this\.selectedCharacterCount = 0/g) || []).length >= 6);

  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.ok(
    shellApp.indexOf('selectedCharacterStatus') < shellApp.indexOf('{{ selectedFileType }}'),
    'selected count must appear before type and size'
  );
  assert.match(shellApp, /selectedCharacterCount > 0/);
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  assert.match(shellStyle, /\.onlypreview-shell__status-rail[\s\S]*height:\s*25px/);
  assert.match(shellStyle, /flex:\s*0 0 25px/);

  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.match(i18n, /selectedCharacters:\s*'Selected \{count\} characters'/);
  assert.match(i18n, /selectedCharacters:\s*'已选择 \{count\} 个字符'/);
  assert.match(i18n, /markdownLimit:\s*'Markdown rendering is limited to 1 MB\.'/);

  const sharedTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  const api = sharedTypes.match(/export interface OnlyPreviewApi \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(api);
  assert.doesNotMatch(api, /characterCount|reportingRevision|selectedText|selectionText/);
  for (const mainBoundary of [
    'src/main/xpc/onlyPreview.handler.ts',
    'src/preload/onlypreview/onlypreview.preload.ts'
  ]) {
    assert.doesNotMatch(source(mainBoundary), /CHARACTER_COUNT_|characterCount/);
  }
});
