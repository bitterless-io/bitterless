import assert from 'node:assert/strict';
import test from 'node:test';
import { tree } from './onlyPreviewSearchShellTest.helper.mjs';

// 状态栏左侧的面包屑(Ral 2026-09-09:「onlypreview__statusRail 左侧必须显示从 project 目录
// 本身开始的面包屑,选中什么文件或文件夹就一直指到那个文件或文件夹」)。
//
// 这是一个纯路径解析器,所以它的价值全在**边界情况**上,而那些恰好是「坏了不报错、只是面包屑
// 指错地方」的一类:少了第一段就不是「从 project 目录本身开始」;把文件折叠成父目录就不是
// 「指到那个文件」;空段会多出一个空面包屑。逐条钉住。

const workspace = { rootName: 'overmind', displayPath: '/Users/ral/Documents/overmind' };
const crumb = (treeSelected, previewSelected = '') =>
  tree.resolveOnlyPreviewBreadcrumb(workspace, treeSelected, previewSelected);

test('the first segment is always the project directory itself', () => {
  // 「从 project 目录本身开始」—— 所以什么都没选时也不是空面包屑。
  assert.deepEqual(crumb(null, '').segments, ['overmind']);
  // 树选中根目录(`''`)也一样。
  assert.deepEqual(crumb('').segments, ['overmind']);
});

test('a selected FILE is the last segment, not its parent directory', () => {
  // 与 `resolveOnlyPreviewCurrentDirectory` 的关键区别:那个函数回答「当前目录」所以会折叠到
  // 父目录;这里必须指到文件本身。
  assert.deepEqual(crumb('src/main/app.ts').segments, ['overmind', 'src', 'main', 'app.ts']);
});

test('a selected FOLDER is the last segment too — files and folders are treated alike', () => {
  assert.deepEqual(crumb('src/main').segments, ['overmind', 'src', 'main']);
});

test('the tree selection wins over the previewed file', () => {
  // 树里点了一个目录、而预览里还开着别处的文件时,面包屑跟着树 —— 用户刚点的是树。
  assert.deepEqual(crumb('docs', 'src/main/app.ts').segments, ['overmind', 'docs']);
});

test('with no tree selection it falls back to the previewed file', () => {
  // 外部程序触发的预览没有树选中,面包屑仍然要指到那个文件。
  assert.deepEqual(crumb(null, 'README.md').segments, ['overmind', 'README.md']);
});

test('an empty tree selection means the root, and does NOT fall through to the preview', () => {
  // `''` 与 `null` 是两件事:`''` = 明确选中了根目录,`null` = 没有树选中。
  // 混淆两者会让「选中项目根」错误地显示成上一个预览文件的路径。
  assert.deepEqual(crumb('', 'src/main/app.ts').segments, ['overmind']);
});

test('empty path segments never become empty crumbs', () => {
  for (const messy of ['/src//main/', 'src/main//', '//', '/']) {
    const segments = crumb(messy).segments;
    assert.ok(
      segments.every((segment) => segment.length > 0),
      `「${messy}」产出了空段: ${JSON.stringify(segments)}`
    );
    assert.equal(segments[0], 'overmind');
  }
  assert.deepEqual(crumb('/src//main/').segments, ['overmind', 'src', 'main']);
});

test('the title carries the full absolute path, so truncated crumbs stay readable on hover', () => {
  assert.equal(
    crumb('src/main/app.ts').title,
    '/Users/ral/Documents/overmind/src/main/app.ts'
  );
  assert.equal(crumb('').title, '/Users/ral/Documents/overmind');
});

test('no workspace means no breadcrumb at all', () => {
  assert.equal(tree.resolveOnlyPreviewBreadcrumb(null, 'src/main/app.ts', ''), null);
});

test('a workspace with no rootName falls back to its display path rather than an empty crumb', () => {
  const anonymous = { rootName: '', displayPath: '/tmp/x' };
  assert.deepEqual(tree.resolveOnlyPreviewBreadcrumb(anonymous, 'a.ts', '').segments, [
    '/tmp/x',
    'a.ts'
  ]);
});

test('the resolver needs no index, so the breadcrumb is correct before the index is ready', () => {
  // 刻意的:`resolveOnlyPreviewCurrentDirectory` 要查 `nodeKind` 才能分辨文件与目录,
  // 这里两者一视同仁所以不查 —— 于是索引未就绪时面包屑已经是对的,而不是先空着再补上。
  assert.equal(tree.resolveOnlyPreviewBreadcrumb.length, 3, '签名不该多出一个 index 参数');
});

const footer = (previewPresentation, options = {}) => tree.resolveOnlyPreviewStatusBreadcrumb({
  workspace: { ...workspace, workspaceId: 'project-a' },
  treeSelectedRelativePath: 'old-selection.md', selectedRelativePath: 'old-selection.md',
  previewPresentation, ...options
});

test('footer follows internal preview while the independent tree selection stays unchanged', () => {
  assert.equal(footer({ fileRef: { workspaceId: 'project-a', relativePath: 'new.md' } }).title,
    workspace.displayPath + '/new.md');
});

test('footer follows external preview with or without a Project and handles Windows paths', () => {
  for (const currentWorkspace of [null, { ...workspace, workspaceId: 'project-a' }]) {
    const crumb = footer({ fileRef: { workspaceId: 'external', relativePath: 'report.md' },
      fileDisplayPath: '/outside/report.md' }, { workspace: currentWorkspace });
    assert.equal(crumb.title, '/outside/report.md');
    assert.deepEqual(crumb.segments, ['outside', 'report.md']);
  }
  assert.deepEqual(footer({ fileRef: { workspaceId: 'external', relativePath: 'report.md' },
    fileDisplayPath: 'C:\\outside\\report.md' }).segments, ['C:', 'outside', 'report.md']);
});

test('footer uses the presented directory, then falls back to tree selection with an empty preview', () => {
  assert.equal(footer({ fileRef: null, directory: { workspaceId: 'project-a', relativePath: 'docs' } }).title,
    workspace.displayPath + '/docs');
  assert.equal(footer(null).title, workspace.displayPath + '/old-selection.md');
});
