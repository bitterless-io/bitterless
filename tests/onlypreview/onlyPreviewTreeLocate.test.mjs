/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 根目录被收起时,「在目录列表中定位」必须仍然能把文件揭示出来。
//
// 背景见 `docs/issues/onlypreview-locate-does-nothing-when-the-root-is-collapsed.md`:
// 项目根的路径是空串,而 `expandSelectedParents` 的 `while (current)` 在到达根之前就退出,
// 于是根永远不进 `expandedPaths`;而树是靠 `expandedPaths.has('')` 决定根下子节点渲不渲染的。
//
// 断言落在**可见的行**上,不只是集合内容 —— 用户看到的是行,不是 Set。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '../..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-tree-locate-'));
const bundlePath = join(buildRoot, 'treeLocate.mjs');

await build({
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  stdin: {
    contents: [
      "export { OnlyPreviewTreeExpansionStore } from '@shell/onlyPreviewTreeExpansion.store';",
      "export { buildOnlyPreviewRootedTreeRows } from '@shell/onlyPreviewTree.service';"
    ].join('\n'),
    resolveDir: join(projectRoot, 'src/renderer/onlypreview/shell/src'),
    loader: 'ts',
    sourcefile: 'entry.ts'
  },
  alias: { '@shell': join(projectRoot, 'src/renderer/onlypreview/shell/src') }
});

const { OnlyPreviewTreeExpansionStore, buildOnlyPreviewRootedTreeRows } = await import(
  pathToFileURL(bundlePath).href
);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const entry = (relativePath, nodeKind) => ({
  relativePath,
  parentRelativePath: relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/'))
    : '',
  name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
  nodeKind,
  size: 0,
  modifiedAt: 0,
  previewHint: 'unsupported',
  mediaType: 'unknown',
  isText: nodeKind === 'file'
});

const index = {
  entries: [
    entry('root-level.txt', 'file'),
    entry('nested', 'directory'),
    entry('nested/deep', 'directory'),
    entry('nested/deep/leaf.txt', 'file')
  ]
};

// 只造 `expandSelectedParents` / `locate` 真正碰到的那几个字段。
const collapsedRootOwner = (selectedRelativePath) => ({
  expandedPaths: new Set(),
  selectedRelativePath,
  selectedEntry: index.entries.find((item) => item.relativePath === selectedRelativePath),
  treeSelectedRelativePath: '',
  focusedRelativePath: '',
  collapseTreeSelection: () => undefined
});

const visiblePaths = (owner) =>
  buildOnlyPreviewRootedTreeRows(index, 'project', owner.expandedPaths).map(
    (row) => row.entry.relativePath
  );

test('locate reveals a nested file even with the project root collapsed', async () => {
  const store = new OnlyPreviewTreeExpansionStore();
  const owner = collapsedRootOwner('nested/deep/leaf.txt');
  // 根被收起:此刻只有根那一行。
  assert.deepEqual(visiblePaths(owner), ['']);

  const focused = await store.locate(owner, async () => undefined);

  assert.equal(focused, 'nested/deep/leaf.txt');
  assert.deepEqual(
    visiblePaths(owner),
    ['', 'root-level.txt', 'nested', 'nested/deep', 'nested/deep/leaf.txt'],
    'the located file must actually be a visible row'
  );
});

test('locate reveals a root-level file even with the project root collapsed', async () => {
  // 这一格比嵌套那格更彻底:第一个父路径就是空串,旧实现的循环体一次都不执行。
  const store = new OnlyPreviewTreeExpansionStore();
  const owner = collapsedRootOwner('root-level.txt');

  const focused = await store.locate(owner, async () => undefined);

  assert.equal(focused, 'root-level.txt');
  assert.ok(visiblePaths(owner).includes('root-level.txt'));
});

test('an implicit expansion leaves a deliberately collapsed root collapsed', async () => {
  // 后台后果(watch commit 继承选中、投影刷新)不该推翻用户自己收起根的选择:它们只要把
  // 展开集合留成正确的,等用户重新打开根时自然生效。
  const store = new OnlyPreviewTreeExpansionStore();
  const owner = collapsedRootOwner('nested/deep/leaf.txt');

  store.expandSelectedParents(owner);

  assert.equal(owner.expandedPaths.has(''), false, 'an implicit call must not force the root open');
  assert.deepEqual(visiblePaths(owner), ['']);
  // 但祖先确实被记下了 —— 用户一打开根就直接看到目标。
  assert.ok(owner.expandedPaths.has('nested'));
  assert.ok(owner.expandedPaths.has('nested/deep'));
});
