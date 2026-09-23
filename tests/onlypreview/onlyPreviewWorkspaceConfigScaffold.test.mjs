/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Ral 2026-09-23:「打开 workspace 需要 ensure .bitterless 或 .micromeet」。
 *
 * 落盘而不是"没有就用默认":配置是人要编辑的东西,而一个不存在的文件没有可发现性 ——
 * 人得先知道目录叫什么、文件叫什么、schema 长什么样。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const projectRoot = resolvePath(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = await mkdtemp(join(tmpdir(), 'onlypreview-scaffold-build-'));
const bundlePath = join(buildRoot, 'scaffold.mjs');
await build({
  stdin: {
    contents: `export { ensureOnlyPreviewWorkspaceConfig } from './src/main/miniapps/onlypreview/onlyPreviewWorkspaceConfigScaffold.service';`,
    resolveDir: projectRoot,
    sourcefile: 'scaffold.entry.ts',
    loader: 'ts'
  },
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});
const { ensureOnlyPreviewWorkspaceConfig } = await import(pathToFileURL(bundlePath).href);

const withRoot = async (run) => {
  const root = await mkdtemp(join(tmpdir(), 'onlypreview-scaffold-'));
  try {
    await run(root);
  } finally {
    await chmod(root, 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
};

test('a first open materialises the config directory and a self-documenting default', async () => {
  await withRoot(async (root) => {
    const result = await ensureOnlyPreviewWorkspaceConfig(root);
    assert.equal(result.created, true);
    const text = await readFile(join(root, result.relativePath), 'utf8');
    // 空的 exclude:落这份文件不该改变任何工作区的索引行为,只是让它可被编辑。
    assert.match(text, /^version: 1$/mu);
    assert.match(text, /^exclude: \[\]$/mu);
    // 注释要把 schema 说清楚,否则落一个空文件等于没落。
    assert.match(text, /!.*重新纳入/u);
    assert.ok((await stat(join(root, dirname(result.relativePath)))).isDirectory());
  });
});

test('an existing config is never touched, not even read-modified', async () => {
  await withRoot(async (root) => {
    const { relativePath } = await ensureOnlyPreviewWorkspaceConfig(root);
    await writeFile(join(root, relativePath), 'version: 1\nexclude:\n  - "mine/**"\n');
    const second = await ensureOnlyPreviewWorkspaceConfig(root);
    assert.equal(second.created, false, '第二次不该再创建');
    assert.match(await readFile(join(root, relativePath), 'utf8'), /mine/u, '人写的内容必须原样保留');
  });
});

test('a directory that already exists but has no config still gets one', async () => {
  await withRoot(async (root) => {
    const { relativePath } = await ensureOnlyPreviewWorkspaceConfig(root);
    await rm(join(root, relativePath));
    const again = await ensureOnlyPreviewWorkspaceConfig(root);
    assert.equal(again.created, true);
  });
});

/**
 * 三条"建不成"的路都只能是静默失败 —— 打不开 workspace 比没有配置文件严重得多。
 */
test('an unwritable workspace never blocks opening', async () => {
  await withRoot(async (root) => {
    await chmod(root, 0o500);
    const result = await ensureOnlyPreviewWorkspaceConfig(root);
    assert.equal(result.created, false);
    assert.equal(typeof result.relativePath, 'string');
  });
});

test('a plain file sitting where the config directory belongs is not an error', async () => {
  await withRoot(async (root) => {
    const { relativePath } = await ensureOnlyPreviewWorkspaceConfig(root);
    const directoryName = dirname(relativePath);
    await rm(join(root, directoryName), { recursive: true, force: true });
    await writeFile(join(root, directoryName), 'not a directory');
    const result = await ensureOnlyPreviewWorkspaceConfig(root);
    assert.equal(result.created, false);
  });
});

test('a relative or empty root is refused without touching the filesystem', async () => {
  for (const root of ['', 'relative/path']) {
    const result = await ensureOnlyPreviewWorkspaceConfig(root);
    assert.equal(result.created, false);
  }
});

test('the scaffold and the reader agree on where the config lives', async () => {
  const location = await import(
    pathToFileURL(join(projectRoot, 'src/preload/onlypreview/search/core/workspace-config-location.mjs')).href
  );
  await withRoot(async (root) => {
    const { relativePath } = await ensureOnlyPreviewWorkspaceConfig(root);
    assert.equal(relativePath, location.WORKSPACE_CONFIG_RELATIVE_PATH,
      '写的位置必须就是读的位置 —— 两处各写一份常量正是这条守卫要挡的');
  });
});

test('the workspace bind path ensures the config before it binds', () => {
  const handler = readFileSync(join(projectRoot, 'src/main/xpc/onlyPreview.handler.ts'), 'utf8');
  const body = handler.slice(handler.indexOf('bindWorkspace: async (hostToken, workspace)'));
  assert.ok(
    body.indexOf('ensureOnlyPreviewWorkspaceConfig') <
      body.indexOf('fileSearchWindowService.bindProjectWorkspace'),
    'ensure 必须在绑定之前 —— 绑定之后索引就开始按配置走了'
  );
});
