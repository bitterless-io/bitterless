/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(new URL('../..', import.meta.url).pathname);
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-office-reader-build-'));
const bundlePath = join(buildRoot, 'reader.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/preload/fileSearch/fileSearchOfficeReader.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { FileSearchOfficeReader } = await import(pathToFileURL(bundlePath).href);
after(() => rmSync(buildRoot, { recursive: true, force: true }));

const withRoot = async (run) => {
  const root = mkdtempSync(join(tmpdir(), 'bitterless-office-reader-'));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const grant = (revision, relativePath = 'book.xlsx') => ({
  grantId: `grant-${revision}`,
  runtimeId: 'runtime-id',
  selectionRevision: revision,
  kind: 'xlsx',
  workspaceId: 'workspace-id',
  relativePath,
  maxBytes: 25 * 1024 * 1024
});

test('hidden Office reader pulls sequential bounded frames and consumes a grant once', async () => {
  await withRoot(async (root) => {
    const source = Buffer.alloc(700_000, 7);
    writeFileSync(join(root, 'book.xlsx'), source);
    const reader = new FileSearchOfficeReader();
    await reader.bindWorkspace('workspace-id', root);
    await reader.prepare(grant(1));
    const opened = await reader.open('grant-1', 'runtime-id', 1);
    assert.equal(opened.totalBytes, source.length);
    const first = await reader.readNext('grant-1', 'runtime-id', 1, 0);
    assert.equal(first.bytes.byteLength, 512 * 1024);
    assert.equal(first.eof, false);
    const second = await reader.readNext('grant-1', 'runtime-id', 1, first.bytes.byteLength);
    assert.equal(second.eof, true);
    assert.equal(first.bytes.byteLength + second.bytes.byteLength, source.length);
    await assert.rejects(() => reader.open('grant-1', 'runtime-id', 1));
    await reader.dispose();
  });
});

test('workspace and file symlinks or post-bind root replacement are rejected', async () => {
  await withRoot(async (root) => {
    const realRoot = join(root, 'real');
    const linkRoot = join(root, 'link');
    writeFileSync(join(root, 'outside.xlsx'), Buffer.from('outside'));
    await import('node:fs/promises').then(({ mkdir }) => mkdir(realRoot));
    symlinkSync(realRoot, linkRoot);
    const reader = new FileSearchOfficeReader();
    await assert.rejects(() => reader.bindWorkspace('workspace-id', linkRoot));

    writeFileSync(join(realRoot, 'book.xlsx'), Buffer.from('book'));
    await reader.bindWorkspace('workspace-id', realRoot);
    renameSync(realRoot, `${realRoot}-old`);
    await import('node:fs/promises').then(({ mkdir }) => mkdir(realRoot));
    writeFileSync(join(realRoot, 'book.xlsx'), Buffer.from('replacement'));
    await assert.rejects(() => reader.prepare(grant(1)));
    await reader.dispose();
  });
});

test('new prepare/bind/cancel authority supersedes stale async work without clobbering the winner', async () => {
  await withRoot(async (root) => {
    writeFileSync(join(root, 'book.xlsx'), Buffer.alloc(16));
    const reader = new FileSearchOfficeReader();
    await reader.bindWorkspace('workspace-id', root);
    const older = reader.prepare(grant(1));
    const newer = reader.prepare(grant(2));
    const [oldResult, newResult] = await Promise.allSettled([older, newer]);
    assert.equal(oldResult.status, 'rejected');
    assert.equal(newResult.status, 'fulfilled');

    const next = reader.prepare(grant(3));
    await reader.cancel('grant-2', 'runtime-id', 2);
    assert.equal((await next).selectionRevision, 3);

    const stale = assert.rejects(() => reader.prepare(grant(4)));
    await reader.bindWorkspace('workspace-next', root);
    await stale;
    await reader.dispose();
  });
});

test('open rejects a same-path inode replacement made after prepare', async () => {
  await withRoot(async (root) => {
    const path = join(root, 'book.xlsx');
    writeFileSync(path, Buffer.alloc(32, 1));
    const reader = new FileSearchOfficeReader();
    await reader.bindWorkspace('workspace-id', root);
    await reader.prepare(grant(1));
    renameSync(path, `${path}.old`);
    writeFileSync(path, Buffer.alloc(32, 2));
    await assert.rejects(() => reader.open('grant-1', 'runtime-id', 1));
    await reader.dispose();
  });
});

test('scoped transition cancel fences an in-flight open and EOF rejects same-path inode replacement', async () => {
  await withRoot(async (root) => {
    const path = join(root, 'book.xlsx');
    writeFileSync(path, Buffer.alloc(700_000, 1));
    const reader = new FileSearchOfficeReader();
    await reader.bindWorkspace('workspace-id', root);
    await reader.prepare(grant(1));
    const opening = reader.open('grant-1', 'runtime-id', 1);
    await reader.cancel('grant-1', 'runtime-id', 1);
    await assert.rejects(() => opening);

    await reader.prepare(grant(2));
    await reader.open('grant-2', 'runtime-id', 2);
    const first = await reader.readNext('grant-2', 'runtime-id', 2, 0);
    renameSync(path, `${path}.old`);
    writeFileSync(path, Buffer.alloc(700_000, 2));
    await assert.rejects(() => reader.readNext('grant-2', 'runtime-id', 2, first.bytes.byteLength));
    await reader.dispose();
  });
});
