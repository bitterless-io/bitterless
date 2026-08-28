import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
  canOrderedGlobReincludeDescendant,
  compileOrderedGlobRules,
  isExcludedByOrderedGlobs
} from '../../src/preload/onlypreview/search/core/glob-config.mjs';
import { createWorkspaceTraversal } from '../../src/preload/onlypreview/search/core/traversal.mjs';
import { parseOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const execFileAsync = promisify(execFile);

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-containment-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const descendantsThroughDepth = (segments, maximumDepth) => {
  const descendants = [];
  let frontier = [''];
  for (let depth = 1; depth <= maximumDepth; depth += 1) {
    frontier = frontier.flatMap((parent) =>
      segments.map((segment) => (parent ? `${parent}/${segment}` : segment))
    );
    descendants.push(...frontier);
  }
  return descendants;
};

const maximumCoveredUnionPatterns = () => [
  '*',
  '!**/??*',
  '**/??',
  '**/???*',
  ...Array.from(
    { length: 1_020 },
    (_, value) =>
      `${Array.from({ length: 10 }, (_, bit) => (value & (1 << bit) ? '**/' : '*/')).join('')}????`
  )
];

test('later strict supersets and exclude unions cancel descendant reincludes exactly', () => {
  const descendants = descendantsThroughDepth(['a', 'aa', 'aaa', '\n', '\naa'], 3);
  const canceledConfigurations = [
    ['*', '!**/*/??', '**/*/?*'],
    ['*', '!**/??*', '**/??', '**/???*']
  ];
  for (const patterns of canceledConfigurations) {
    const rules = compileOrderedGlobRules(patterns);
    assert.equal(canOrderedGlobReincludeDescendant('a', rules), false);
    assert.equal(
      descendants.some((suffix) => !isExcludedByOrderedGlobs(`a/${suffix}`, rules)),
      false
    );
  }
  const rootUnion = compileOrderedGlobRules(canceledConfigurations[1]);
  assert.equal(isExcludedByOrderedGlobs('', rootUnion), true);
  assert.equal(canOrderedGlobReincludeDescendant('', rootUnion), false);

  const partialCoverage = compileOrderedGlobRules(['*', '!**/??*', '**/??']);
  assert.equal(canOrderedGlobReincludeDescendant('a', partialCoverage), true);
  assert.equal(isExcludedByOrderedGlobs('a/aaa', partialCoverage), false);

  const reverseLineOrder = compileOrderedGlobRules(['*', '!**/*/??', '*/**/??']);
  assert.equal(canOrderedGlobReincludeDescendant('a', reverseLineOrder), true);
  assert.equal(isExcludedByOrderedGlobs('a/\n/bb', reverseLineOrder), false);
});

test('large covered unions exhaust the fixed budget and conservatively fail open', () => {
  const patterns = maximumCoveredUnionPatterns();
  assert.equal(patterns.length, 1_024);
  const rules = compileOrderedGlobRules(patterns);
  assert.equal(canOrderedGlobReincludeDescendant('a', rules), true);
  const descendants = descendantsThroughDepth(['aa', 'aaa', '\naa'], 2);
  assert.equal(
    descendants.some((suffix) => !isExcludedByOrderedGlobs(`a/${suffix}`, rules)),
    false
  );
});

test('strict and union-covered reincludes prune before descendant filesystem I/O', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const excludedDirectory = join(root, 'a');
    await write(join(excludedDirectory, 'x/bb'), 'must not be read');
    await write(join(excludedDirectory, 'aaa'), 'must not be read');

    const traverse = async (patterns) => {
      const contentReadCandidates = [];
      const config = parseOnlyPreviewWorkspaceConfig(
        [
          'version: 1',
          'exclude:',
          ...patterns.map((pattern) => `  - ${JSON.stringify(pattern)}`),
          ''
        ].join('\n')
      );
      const traversal = await createWorkspaceTraversal({
        rootPath: root,
        config,
        shouldReadContent: ({ relativePath }) => {
          contentReadCandidates.push(relativePath);
          return undefined;
        }
      });
      const paths = [];
      for await (const entry of traversal.entries) paths.push(entry.relativePath);
      return { contentReadCandidates, paths, statistics: { ...traversal.statistics } };
    };

    if (process.platform !== 'win32') await chmod(excludedDirectory, 0o000);
    try {
      const baseline = await traverse(['*']);
      for (const patterns of [
        ['*', '!**/*/??', '**/*/?*'],
        ['*', '!**/??*', '**/??', '**/???*']
      ]) {
        assert.deepEqual(await traverse(patterns), baseline);
      }
      assert.deepEqual(baseline.contentReadCandidates, []);
      assert.deepEqual(baseline.paths, []);
      assert.equal(baseline.statistics.excludedEntryCount, 1);
      assert.equal(baseline.statistics.unreadableEntryCount, 0);
    } finally {
      if (process.platform !== 'win32') await chmod(excludedDirectory, 0o700);
    }
  });
});

test('maximum later-exclude union fails open inside a bounded child probe', async () => {
  const moduleUrl = new URL(
    '../../src/preload/onlypreview/search/core/glob-config.mjs',
    import.meta.url
  ).href;
  const script = [
    `import { canOrderedGlobReincludeDescendant, compileOrderedGlobRules } from ${JSON.stringify(moduleUrl)};`,
    `const excludes = Array.from({ length: 1020 }, (_, value) => \`${'${'}Array.from({ length: 10 }, (_, bit) => value & (1 << bit) ? '**/' : '*/').join('')}????\`);`,
    `const rules = compileOrderedGlobRules(['*', '!**/??*', '**/??', '**/???*', ...excludes]);`,
    `for (let index = 0; index < 2000; index += 1) canOrderedGlobReincludeDescendant('a', rules);`,
    `process.stdout.write(String(canOrderedGlobReincludeDescendant('a', rules)));`
  ].join('\n');
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      timeout: 2_000
    }
  );
  assert.equal(stdout, 'true');
});
