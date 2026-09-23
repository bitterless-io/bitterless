import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  CORE_EXCLUDED_DIRECTORY_NAMES,
  CORE_EXCLUDED_DIRECTORY_SEQUENCES,
  CORE_EXCLUDED_DIRECTORY_SUFFIXES,
  SEARCH_SCHEMA_VERSION
} from '../../src/preload/onlypreview/search/core/constants.mjs';
import {
  ARCHIVE_EXTENSIONS,
  BINARY_EXTENSIONS,
  classifySearchMediaType
} from '../../src/preload/onlypreview/search/core/classification.mjs';
import { SEARCH_ENGINE_IDENTITY } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import {
  countWorkspaceSearchEntries,
  createTraversalPolicy,
  createWorkspaceTraversal
} from '../../src/preload/onlypreview/search/core/traversal.mjs';
import { parseOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const names = [
  '__pycache__',
  '__pypackages__',
  'venv',
  'site-packages',
  'htmlcov',
  'vendor',
  'go-build',
  // Rust/Cargo(以及 Maven)的产物目录 —— Ral 2026-09-18 要求两仓默认不索引。
  'target'
];
const excludedDirectories = [
  ...names,
  'package.egg-info',
  'package.dist-info',
  'pkg/mod',
  'pkg/sumdb'
];
const entry = (isDirectory) => ({ isDirectory: () => isDirectory });

test('the hard dependency policy matches directory components, inherits and normalizes separators', () => {
  const policy = createTraversalPolicy();
  for (const directory of excludedDirectories) {
    for (const prefix of ['', 'nested/source/']) {
      const path = prefix + directory;
      for (const value of [path, path.replaceAll('/', '\\')]) {
        assert.equal(policy.isExcludedDirectoryPath(value), true, value);
        assert.equal(policy.isExcluded(value, entry(true)), true, value);
        assert.equal(policy.isExcludedFilePath(value + '/nested/source.py'), true, value);
        assert.equal(policy.isExcludedDirectoryPath(value + '/nested'), true, value);
        assert.equal(policy.canTraverseExcludedDirectoryPath(value), false, value);
      }
    }
  }
});

test('same-named regular files, source directories and substrings remain eligible', () => {
  const policy = createTraversalPolicy();
  for (const file of excludedDirectories) {
    assert.equal(policy.isExcludedFilePath(file), false, file);
    assert.equal(policy.isExcluded(file, entry(false)), false, file);
    assert.equal(policy.isExcludedFilePath('source/' + file), false, file);
  }
  for (const directory of [
    'pkg',
    'src',
    'bin',
    'env',
    'mod',
    'sumdb',
    'pkg/src',
    'pkg/bin',
    'pkg/module',
    'pkg/other/mod',
    'pkg/other/sumdb',
    'pkg-other/mod',
    'vendor-source',
    'myvenv',
    'venv-source',
    'go-builders',
    'package.egg-info.backup',
    'package.dist-info.txt'
  ]) {
    assert.equal(policy.isExcludedDirectoryPath(directory), false, directory);
    assert.equal(policy.isExcludedFilePath(directory + '/source.py'), false, directory);
  }
});

test('workspace negations cannot undo hard exclusions and hidden directories remain covered', () => {
  const config = parseOnlyPreviewWorkspaceConfig('version: 1\nexclude:\n  - "!**"\n');
  const policy = createTraversalPolicy(config);
  for (const directory of [
    ...excludedDirectories,
    '.venv',
    '.tox',
    '.nox',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache'
  ]) {
    assert.equal(policy.isExcludedDirectoryPath(directory), true, directory);
    assert.equal(policy.isExcludedFilePath(directory + '/source.py'), true, directory);
    assert.equal(policy.canTraverseExcludedDirectoryPath(directory), false, directory);
  }
  assert.equal(policy.isExcludedFilePath('src/main.py'), false);
  assert.equal(policy.isExcludedFilePath('.env.example'), false);
});

test('engine identity deterministically includes the hard policy without a schema bump', () => {
  const policy = JSON.parse(SEARCH_ENGINE_IDENTITY.slice(SEARCH_ENGINE_IDENTITY.indexOf('{')));
  assert.deepEqual(policy, {
    hiddenDirectories: true,
    directoryNames: [...CORE_EXCLUDED_DIRECTORY_NAMES].sort(),
    directorySuffixes: [...CORE_EXCLUDED_DIRECTORY_SUFFIXES].sort(),
    directorySequences: CORE_EXCLUDED_DIRECTORY_SEQUENCES.map((parts) => parts.join('/')).sort(),
    // 内容分类的表也在身份里(Ral 2026-09-23:「所有的压缩包类型、二进制类型的文件后缀都应该被
    // 排除索引」)。不放进来的话,改了「哪些扩展名不读内容」,已经建好的索引不会察觉 ——
    // 旧的二进制垃圾会一直留到下一次因为别的原因重建为止。身份正是"不动 schema 版本也能让旧索引
    // 失效"的那个机制,这类策略变更本来就该走它。
    archiveExtensions: [...ARCHIVE_EXTENSIONS].sort(),
    binaryExtensions: [...BINARY_EXTENSIONS].sort()
  });
  assert.equal(SEARCH_SCHEMA_VERSION, 8);
});

/**
 * Ral 2026-09-23:「帮我检查一下 RAR 文件是否被排除索引。所有的压缩包类型、二进制类型的文件
 * 后缀都应该被排除索引。」
 *
 * 检查的结果是:原来**没有**被排除。`classifySearchMediaType` 的兜底是 `return 'text'`,
 * 而 `decodeSearchText` 不做二进制嗅探 —— 所以一个 1 MiB 以内的 .rar 会被整份读进来、解码成
 * 一串 U+FFFD、再切块送进 trigram 与中日韩倒排。只有超过 MAX_TEXT_BYTES 的才因为体积躲掉。
 */
test('archives and binaries are metadata-only, while text-ish formats keep their content indexed', () => {
  for (const name of [
    'a.rar', 'a.zip', 'a.7z', 'a.tar', 'a.tgz', 'a.gz', 'a.xz', 'a.zst',
    'a.jar', 'a.apk', 'a.dmg', 'a.iso', 'a.deb', 'a.whl', 'a.asar'
  ]) {
    assert.equal(classifySearchMediaType(name), 'unknown', `${name} 必须只进元数据`);
  }
  for (const name of [
    'a.exe', 'a.dll', 'a.so', 'a.dylib', 'a.o', 'a.bin', 'a.node', 'a.wasm',
    'a.class', 'a.pyc', 'a.sqlite', 'a.db', 'a.ttf', 'a.woff2', 'a.psd', 'a.img'
  ]) {
    assert.equal(classifySearchMediaType(name), 'unknown', `${name} 必须只进元数据`);
  }
  // 看着像二进制、其实是文本的,一个都不许误伤 —— 错杀一个文本扩展名就是让它从此搜不到。
  assert.equal(classifySearchMediaType('scene.gltf'), 'text', '.gltf 是 JSON');
  assert.equal(classifySearchMediaType('notes.md'), 'text');
  assert.equal(classifySearchMediaType('main.rs'), 'text');
  // 兜底仍然是 text:没列进表的源码扩展名不该因为这次改动而丢掉内容索引。
  assert.equal(classifySearchMediaType('main.somenewlang'), 'text');
});

/**
 * Ral 2026-09-23:「tmp/ Temp 需要排除被索引」。
 *
 * 原来只有 per-workspace 配置里的 `tmp/**` 挡着它 —— 也就是说**没有那份配置的工作区不受保护**。
 * 现在进了硬策略,且按小写比对:`Temp` / `TMP` 与 `tmp` 是同一个目录意图,而 macOS 的卷默认
 * 大小写不敏感,只认小写等于漏掉一半写法。
 */
test('tmp and Temp are excluded by the hard policy, in any casing', () => {
  const policy = createTraversalPolicy({});
  for (const path of [
    'tmp/scratch.txt', 'Temp/scratch.txt', 'TMP/scratch.txt', 'tEmP/scratch.txt',
    'nested/tmp/scratch.txt', 'nested/Temp/deep/scratch.txt'
  ]) {
    assert.equal(policy.isExcludedFilePath(path), true, `${path} 必须被硬策略排除`);
  }
  // 名字里含 tmp 但不是 tmp 目录的,不许误伤。
  assert.equal(policy.isExcludedFilePath('tmpfile.txt'), false);
  assert.equal(policy.isExcludedFilePath('src/tmpl/index.ts'), false);
  assert.equal(policy.isExcludedFilePath('templates/index.ts'), false);
});

test('traversal and counting prune dependency bodies while retaining ordinary source and same-named files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'onlypreview-python-go-'));
  try {
    const includedPaths = [
      ...excludedDirectories.map((name) => 'regular-files/' + name),
      'pkg/main.go',
      'pkg/src/main.go',
      'src/main.py',
      'bin/tool.py',
      'env/config.py',
      'mod/main.go',
      'sumdb/main.go',
      'pkg/other/mod/main.go',
      'vendor-source/main.go'
    ];
    const excludedPaths = excludedDirectories.map(
      (name) => 'dependencies/' + name + '/deep/source.txt'
    );
    for (const path of [...includedPaths, ...excludedPaths]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), 'searchable fixture');
    }
    const config = parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []\n');
    const reads = [];
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config,
      shouldReadContent: ({ relativePath }) => {
        reads.push(relativePath);
      }
    });
    const files = [];
    for await (const file of traversal.entries) files.push(file.relativePath);
    assert.deepEqual(files.sort(), [...includedPaths].sort());
    assert.deepEqual(reads.sort(), [...includedPaths].sort());
    assert.equal(
      await countWorkspaceSearchEntries({ rootPath: root, config }),
      includedPaths.length
    );
    const policy = createTraversalPolicy(config);
    assert.equal(
      traversal.treeEntries.some((item) =>
        policy.isExcluded(item.relativePath, entry(item.nodeKind === 'directory'))
      ),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Cargo 的真实布局 —— 上面那几条是按名字表泛化验的,这一条验实际工程长什么样。
 *
 * 为什么它值得单独一条:`target/` 通常是一个 Rust 仓里**最大**的一棵树(debug + release +
 * build script 产物 + 增量编译缓存),而它以前完全进索引 —— 索引体积、每轮 reconcile 的复制
 * 时间、8G 机器上的 page cache 压力都由它主导。
 */
test('Cargo artifacts are pruned by default while Rust sources stay indexed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'onlypreview-rust-'));
  try {
    const includedPaths = [
      'Cargo.toml',
      'Cargo.lock',
      'src/main.rs',
      'src/lib.rs',
      'crates/inner/Cargo.toml',
      'crates/inner/src/lib.rs',
      // `target` 只作为路径的一部分出现时不受影响 —— 排除判据按**目录分量**匹配,不是子串。
      'src/target_helpers.rs',
      'docs/target-audience.md'
    ];
    const excludedPaths = [
      'target/debug/demo',
      'target/debug/.fingerprint/demo/lib-demo.json',
      'target/release/build/demo-1a2b/out/generated.rs',
      'target/.rustc_info.json',
      // 工作区里每个 crate 各自的 target 也要剪掉,不只是根上那一个。
      'crates/inner/target/debug/inner'
    ];
    for (const path of [...includedPaths, ...excludedPaths]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), 'searchable fixture');
    }
    const config = parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []\n');
    const traversal = await createWorkspaceTraversal({ rootPath: root, config });
    const files = [];
    for await (const file of traversal.entries) files.push(file.relativePath);
    assert.deepEqual(files.sort(), [...includedPaths].sort());
    assert.equal(
      await countWorkspaceSearchEntries({ rootPath: root, config }),
      includedPaths.length
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
