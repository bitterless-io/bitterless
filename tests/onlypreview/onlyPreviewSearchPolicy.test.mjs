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
import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  createWorkspaceTraversal,
  readSingleWorkspaceFile
} from '../../src/preload/onlypreview/search/core/traversal.mjs';
import { parseOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const execFileAsync = promisify(execFile);

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-policy-'));
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

const search = async (engine, query, requestId = query) => {
  const response = await engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId,
    query,
    maxResults: 500,
    scope: { kind: 'project' },
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  });
  return [...response.files, ...response.contents];
};

const indexedPaths = (engine) =>
  engine.index.database
    .prepare('SELECT relative_path FROM files ORDER BY relative_path')
    .all()
    .map(({ relative_path: relativePath }) => relativePath);

const applyWatch = async (engine, change) =>
  await engine.enqueue(async () => await engine.applyWatchChangesInternal(change));

const legacyOrderedGlobState = (relativePathValue, rules) => {
  const relativePath = String(relativePathValue)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '')
    .replace(/\/$/u, '');
  const candidates = [relativePath];
  let separator = relativePath.lastIndexOf('/');
  while (separator >= 0) {
    candidates.push(relativePath.slice(0, separator));
    separator = relativePath.lastIndexOf('/', separator - 1);
  }
  let excluded = false;
  for (const rule of rules) {
    if (candidates.some((candidate) => rule.regex.test(candidate))) excluded = !rule.include;
  }
  return excluded;
};

const smallPathSegments = ['a', 'b', 'aa', 'ab', 'ba', 'bb'];

const pathsThroughDepth = (maximumDepth) => {
  const paths = [];
  let frontier = [''];
  for (let depth = 1; depth <= maximumDepth; depth += 1) {
    frontier = frontier.flatMap((parent) =>
      smallPathSegments.map((segment) => (parent ? `${parent}/${segment}` : segment))
    );
    paths.push(...frontier);
  }
  return paths;
};

const binaryFullSegmentPatterns = (suffix) =>
  Array.from({ length: 1_024 }, (_, value) => {
    const segments = Array.from({ length: 10 }, (_, bit) => (value & (1 << bit) ? '**/' : '*/'));
    return `${segments.join('')}${suffix}`;
  });

test('descendant-aware ordered glob matching is equivalent without rules-by-depth work', () => {
  const rules = compileOrderedGlobRules([
    'excluded',
    '!excluded/keep/**',
    'excluded/keep/private/**',
    'generated/**',
    '!generated/?afe/**',
    '**/cache',
    '!**/cache/keep/**',
    '/root-name',
    './relative-name'
  ]);
  const paths = [
    'excluded',
    'excluded/drop/file.txt',
    'excluded/weird\nname/file.txt',
    'excluded/keep/file.txt',
    'excluded/keep/private/secret.txt',
    'generated',
    'generated/safe/file.txt',
    'generated/cafe/file.txt',
    'cache',
    'nested/cache/file.txt',
    'nested/cache/keep/file.txt',
    'root-name/deep/file.txt',
    'relative-name/deep/file.txt',
    'visible/file.txt'
  ];
  for (const relativePath of paths) {
    assert.equal(
      isExcludedByOrderedGlobs(relativePath, rules),
      legacyOrderedGlobState(relativePath, rules),
      relativePath
    );
  }
  const reincludeRules = compileOrderedGlobRules([
    'excluded',
    '!excluded/keep/**',
    'excluded/keep/private/**'
  ]);
  assert.equal(canOrderedGlobReincludeDescendant('excluded', reincludeRules), true);
  assert.equal(canOrderedGlobReincludeDescendant('excluded/drop', reincludeRules), false);
});

test('ordered glob evaluation runs each candidate matcher at most once per path', () => {
  const rules = compileOrderedGlobRules(Array.from({ length: 1_024 }, (_, index) => `*-${index}`));
  let matcherCalls = 0;
  for (const rule of rules) {
    const matcher = rule.matchesPathOrAncestor;
    rule.matchesPathOrAncestor = (value) => {
      matcherCalls += 1;
      return matcher(value);
    };
  }
  assert.equal(isExcludedByOrderedGlobs('one/two/three/file.txt', rules), false);
  assert.equal(matcherCalls, 0);

  const prefixedRules = compileOrderedGlobRules([
    'excluded',
    ...Array.from({ length: 1_023 }, (_, index) => `unrelated-${index}/**`)
  ]);
  let targetCalls = 0;
  let unrelatedCalls = 0;
  for (const [index, rule] of prefixedRules.entries()) {
    const matcher = rule.matchesPathOrAncestor;
    rule.matchesPathOrAncestor = (value) => {
      if (index === 0) targetCalls += 1;
      else unrelatedCalls += 1;
      return matcher(value);
    };
  }
  assert.equal(isExcludedByOrderedGlobs('excluded/deep/file.txt', prefixedRules), true);
  assert.equal(targetCalls, 1);
  assert.equal(unrelatedCalls, 0);
});

test('mandatory anchors reject maximum rule sets before invoking bounded matchers', () => {
  const path = 'src/a/b/c/d/e/f/g/file.txt';
  const patternSets = [
    Array.from({ length: 1_024 }, (_, index) => `**/never-${index}`),
    Array.from({ length: 900 }, (_, index) => `${'**/'.repeat(20)}never-${index}`)
  ];
  for (const patterns of patternSets) {
    const rules = compileOrderedGlobRules(patterns);
    let matcherCalls = 0;
    for (const rule of rules) {
      const matcher = rule.matchesPathOrAncestor;
      rule.matchesPathOrAncestor = (value) => {
        matcherCalls += 1;
        return matcher(value);
      };
    }
    assert.equal(rules.length, patterns.length);
    assert.equal(isExcludedByOrderedGlobs(path, rules), false);
    assert.equal(matcherCalls, 0);
  }
});

test('terminal segment constraints reject the legal maximum wildcard-only family', () => {
  const patterns = binaryFullSegmentPatterns('??');
  assert.equal(
    patterns.reduce((total, pattern) => total + pattern.length, 0),
    27_648
  );
  const rules = compileOrderedGlobRules(patterns);
  let matcherCalls = 0;
  for (const rule of rules) {
    const matcher = rule.matchesPathOrAncestor;
    rule.matchesPathOrAncestor = (value) => {
      matcherCalls += 1;
      return matcher(value);
    };
  }
  const relativePath = Array.from({ length: 30 }, () => 'a').join('/');
  assert.equal(rules.length, 1_024);
  assert.equal(isExcludedByOrderedGlobs(relativePath, rules), false);
  assert.equal(matcherCalls, 0);

  const matchingPath = `${relativePath}/bb`;
  const semanticRules = compileOrderedGlobRules(patterns);
  assert.equal(
    isExcludedByOrderedGlobs(matchingPath, semanticRules),
    legacyOrderedGlobState(matchingPath, semanticRules)
  );
});

test('shared full-segment dispatch rejects a maximum topology nonmatch without automata', () => {
  const patterns = binaryFullSegmentPatterns('???/??');
  const rules = compileOrderedGlobRules(patterns);
  let matcherCalls = 0;
  for (const rule of rules) {
    const matcher = rule.matchesPathOrAncestor;
    rule.matchesPathOrAncestor = (value) => {
      matcherCalls += 1;
      return matcher(value);
    };
  }
  const relativePath = Array.from({ length: 30 }, () => 'aa').join('/');
  assert.equal(isExcludedByOrderedGlobs(relativePath, rules), false);
  const lineTerminatorPath = [...Array.from({ length: 29 }, () => 'aa'), '\n', 'aaa'].join('/');
  assert.equal(isExcludedByOrderedGlobs(lineTerminatorPath, rules), false);
  assert.equal(matcherCalls, 0);

  const maximumLineRules = compileOrderedGlobRules(
    binaryFullSegmentPatterns(`${'*/'.repeat(21)}??`)
  );
  const maximumLinePath = [...Array.from({ length: 31 }, () => '\n'), 'aa'].join('/');
  assert.equal(isExcludedByOrderedGlobs(maximumLinePath, maximumLineRules), true);
});

test('full-segment dispatch preserves globstar and line-terminator operator order', () => {
  const fixtures = [
    ['*/**/??', '\n/a/xx', true],
    ['**/*/??', '\n/a/xx', false],
    ['*/**/??', 'a/\n/xx', false],
    ['**/*/??', 'a/\n/xx', true],
    ['*/**/keep', '\n/a/keep', true],
    ['**/*/keep', '\n/a/keep', false],
    ['*/**/keep', 'a/\n/keep', false],
    ['**/*/keep', 'a/\n/keep', true]
  ];
  for (const [pattern, relativePath, expected] of fixtures) {
    const rules = compileOrderedGlobRules([pattern]);
    assert.equal(isExcludedByOrderedGlobs(relativePath, rules), expected);
    assert.equal(
      isExcludedByOrderedGlobs(relativePath, rules),
      legacyOrderedGlobState(relativePath, rules)
    );
  }
  const descendantFixtures = [
    ['*/**/??', '\n/a', true],
    ['**/*/??', '\n/a', false],
    ['*/**/??', 'a/\n', false],
    ['**/*/??', 'a/\n', true]
  ];
  for (const [pattern, relativePath, expected] of descendantFixtures) {
    const rules = compileOrderedGlobRules(['*', `!${pattern}`]);
    assert.equal(canOrderedGlobReincludeDescendant(relativePath, rules), expected);
    assert.equal(rules[1].couldMatchDescendant(relativePath), expected);
  }
  const rootRules = compileOrderedGlobRules(['**', '!?']);
  assert.equal(canOrderedGlobReincludeDescendant('', rootRules), true);
  assert.equal(rootRules[1].couldMatchDescendant(''), true);
});

test('anchorless embedded wildcard fallback has a fixed aggregate state budget', () => {
  const patterns = Array.from({ length: 16 }, (_, value) => {
    const bits = Array.from({ length: 8 }, (_, bit) => (value & (1 << bit) ? '?' : '*'));
    return `${bits.join('')}?**?`;
  });
  const source = [
    'version: 1',
    'exclude:',
    ...patterns.map((pattern) => `  - ${JSON.stringify(pattern)}`),
    ''
  ].join('\n');
  assert.throws(() => parseOnlyPreviewWorkspaceConfig(source), {
    name: 'TypeError',
    message: 'Anchorless exclusion globs are too complex'
  });
});

test('identical normalized rules collapse to last-wins without hiding partial reincludes', () => {
  const normalizedDuplicates = compileOrderedGlobRules(['foo', '!./foo', '/foo']);
  assert.equal(normalizedDuplicates.length, 1);
  assert.equal(normalizedDuplicates[0].include, false);
  assert.equal(isExcludedByOrderedGlobs('foo/deep/file.txt', normalizedDuplicates), true);

  const canceled = compileOrderedGlobRules(['foo', '!foo/**/keep/**', 'foo/**/keep/**']);
  assert.equal(canceled.length, 2);
  assert.equal(canOrderedGlobReincludeDescendant('foo', canceled), false);
  assert.equal(canOrderedGlobReincludeDescendant('foo/a', canceled), false);
  assert.equal(isExcludedByOrderedGlobs('foo/a/b/c/file.txt', canceled), true);

  const partialReexclude = compileOrderedGlobRules([
    'foo',
    '!foo/**/keep/**',
    'foo/**/keep/private/**'
  ]);
  assert.equal(canOrderedGlobReincludeDescendant('foo', partialReexclude), true);
  assert.equal(isExcludedByOrderedGlobs('foo/a/keep/file.txt', partialReexclude), false);
  assert.equal(isExcludedByOrderedGlobs('foo/a/keep/private/file.txt', partialReexclude), true);

  const probes = ['a/bb', 'a/x/bb', 'a/x/y/bb', 'a/\n/bb', 'a/\nX'];
  for (const patterns of [
    ['*', '!**/**/??', '**/??'],
    ['*', '!*/**/??', '**/*/??']
  ]) {
    const rules = compileOrderedGlobRules(patterns);
    assert.equal(canOrderedGlobReincludeDescendant('a', rules), false);
    assert.equal(
      probes.every((path) => isExcludedByOrderedGlobs(path, rules)),
      true
    );
  }
  const reverseLineOrder = compileOrderedGlobRules(['*', '!**/*/??', '*/**/??']);
  assert.equal(canOrderedGlobReincludeDescendant('a', reverseLineOrder), true);
  assert.equal(isExcludedByOrderedGlobs('a/\n/bb', reverseLineOrder), false);
});

test('identical later re-exclude prunes a subtree before descendant traversal I/O', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const excludedDirectory = join(root, 'foo');
    await write(join(excludedDirectory, 'a/b/c/file.txt'), 'must not be read');

    const traverse = async (excludeLines) => {
      const contentReadCandidates = [];
      const traversal = await createWorkspaceTraversal({
        rootPath: root,
        config: parseOnlyPreviewWorkspaceConfig(
          ['version: 1', 'exclude:', ...excludeLines.map((line) => `  - ${line}`), ''].join('\n')
        ),
        shouldReadContent: ({ relativePath }) => {
          contentReadCandidates.push(relativePath);
          return undefined;
        }
      });
      const paths = [];
      for await (const entry of traversal.entries) paths.push(entry.relativePath);
      return {
        contentReadCandidates,
        paths,
        statistics: { ...traversal.statistics }
      };
    };

    if (process.platform !== 'win32') await chmod(excludedDirectory, 0o000);
    try {
      const baseline = await traverse(['foo']);
      const canceledConfigs = [
        ['foo', "'!foo/**/keep/**'", 'foo/**/keep/**'],
        ["'*'", "'!**/**/??'", "'**/??'"],
        ["'*'", "'!*/**/??'", "'**/*/??'"]
      ];
      for (const config of canceledConfigs) assert.deepEqual(await traverse(config), baseline);
      assert.deepEqual(baseline.contentReadCandidates, []);
      assert.deepEqual(baseline.paths, []);
      assert.equal(baseline.statistics.excludedEntryCount, 1);
      assert.equal(baseline.statistics.unreadableEntryCount, 0);
      assert.equal(baseline.statistics.directoryCount, 0);
      assert.equal(baseline.statistics.fileCount, 0);
    } finally {
      if (process.platform !== 'win32') await chmod(excludedDirectory, 0o700);
    }
  });
});

test('repeated globstars stay within the finite matcher state-operation bound', () => {
  const rules = compileOrderedGlobRules([`${'**/'.repeat(12)}needle/z`]);
  const relativePath = `${'a/'.repeat(30)}needle/x`;
  assert.equal(isExcludedByOrderedGlobs(relativePath, rules), false);
  const { operationCount, stateCount } = rules[0].matcherDiagnostics();
  const pathCharacters = [...relativePath].length;
  assert.equal(operationCount > 0, true);
  assert.equal(operationCount <= stateCount * (2 * pathCharacters + 1), true);
});

test('adversarial repeated globstars are isolated by a short child timeout', async () => {
  const moduleUrl = new URL(
    '../../src/preload/onlypreview/search/core/glob-config.mjs',
    import.meta.url
  ).href;
  const script = [
    `import { compileOrderedGlobRules, isExcludedByOrderedGlobs } from ${JSON.stringify(moduleUrl)};`,
    `const rules = compileOrderedGlobRules([\`${'**/'.repeat(12)}needle/z\`]);`,
    `process.stdout.write(String(isExcludedByOrderedGlobs(\`${'a/'.repeat(30)}needle/x\`, rules)));`
  ].join('\n');
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { timeout: 2_000 }
  );
  assert.equal(stdout, 'false');
});

test('depth-32 line-terminator maximum stays inside a bounded child probe', async () => {
  const moduleUrl = new URL(
    '../../src/preload/onlypreview/search/core/glob-config.mjs',
    import.meta.url
  ).href;
  const script = [
    `import { compileOrderedGlobRules, isExcludedByOrderedGlobs } from ${JSON.stringify(moduleUrl)};`,
    `const rules = compileOrderedGlobRules(Array.from({ length: 1024 }, (_, value) => \`${'${'}Array.from({ length: 10 }, (_, bit) => value & (1 << bit) ? '**/' : '*/').join('')}${'${'}'*/'.repeat(21)}??\`));`,
    `const path = [...Array.from({ length: 31 }, () => '\\n'), 'aa'].join('/');`,
    `for (let index = 0; index < 2000; index += 1) isExcludedByOrderedGlobs(path, rules);`,
    `process.stdout.write(String(isExcludedByOrderedGlobs(path, rules)));`
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

test('wildcard reinclude reachability agrees with a bounded exact descendant oracle', () => {
  const directories = ['', ...pathsThroughDepth(2)];
  const descendantSuffixes = pathsThroughDepth(3);
  const includePatterns = [
    'a/*',
    'a/?',
    'a/**',
    'a/**/b',
    'a/**/',
    '*/a/**',
    '?/*/b',
    'a*b/??',
    '**/a',
    '**/a/**',
    '*a*/b/**',
    'a/*/b/**',
    'a/**b',
    'a**/b',
    '**a?/**/b'
  ];
  for (const includePattern of includePatterns) {
    const exclusionRules = compileOrderedGlobRules([includePattern]);
    for (const relativePath of ['', ...descendantSuffixes]) {
      assert.equal(
        isExcludedByOrderedGlobs(relativePath, exclusionRules),
        legacyOrderedGlobState(relativePath, exclusionRules),
        `${includePattern} matching ${relativePath}`
      );
    }
    const rules = compileOrderedGlobRules(['**', `!${includePattern}`]);
    const includeRule = rules[1];
    for (const directory of directories) {
      const expected =
        isExcludedByOrderedGlobs(directory, rules) &&
        descendantSuffixes.some((suffix) =>
          includeRule.regex.test(directory ? `${directory}/${suffix}` : suffix)
        );
      assert.equal(
        canOrderedGlobReincludeDescendant(directory, rules),
        expected,
        `${includePattern} below ${directory}`
      );
    }
  }
});

test('wildcard reincludes are exact for siblings and later re-excludes', () => {
  const directRules = compileOrderedGlobRules(['foo', '!f*/keep/**']);
  assert.equal(canOrderedGlobReincludeDescendant('foo', directRules), true);
  assert.equal(canOrderedGlobReincludeDescendant('foo/drop', directRules), false);

  const nestedRules = compileOrderedGlobRules(['foo', '!foo/*/keep/**', 'foo/bar/keep/private/**']);
  assert.equal(canOrderedGlobReincludeDescendant('foo', nestedRules), true);
  assert.equal(canOrderedGlobReincludeDescendant('foo/bar', nestedRules), true);
  assert.equal(canOrderedGlobReincludeDescendant('foo/bar/drop', nestedRules), false);
  assert.equal(isExcludedByOrderedGlobs('foo/bar/keep/file.txt', nestedRules), false);
  assert.equal(isExcludedByOrderedGlobs('foo/bar/keep/private/file.txt', nestedRules), true);

  const unrelatedRules = compileOrderedGlobRules(['foo', '!bar*/keep/**']);
  let descendantChecks = 0;
  const descendantMatcher = unrelatedRules[1].couldMatchDescendant;
  unrelatedRules[1].couldMatchDescendant = (relativePath) => {
    descendantChecks += 1;
    return descendantMatcher(relativePath);
  };
  assert.equal(canOrderedGlobReincludeDescendant('foo', unrelatedRules), false);
  assert.equal(descendantChecks, 0);
});

test('traversal watch and Browse retain wildcard-reincluded branches only', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const directPath = 'foo/keep/direct.txt';
    const nestedPath = 'foo/bar/keep/nested.txt';
    const dropPath = 'foo/drop/hidden.txt';
    const nestedDropPath = 'foo/bar/drop/hidden.txt';
    const privatePath = 'foo/bar/keep/private/secret.txt';
    const configSource = [
      'version: 1',
      'exclude:',
      '  - foo',
      "  - '!f*/keep/**'",
      "  - '!foo/*/keep/**'",
      '  - foo/bar/keep/private/**',
      ''
    ].join('\n');
    await write(join(root, '.bitterless/preview-config.yml'), configSource);
    for (const relativePath of [directPath, nestedPath, dropPath, nestedDropPath, privatePath]) {
      await write(join(root, relativePath), `initial ${relativePath}`);
    }

    const traversalReads = [];
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config: parseOnlyPreviewWorkspaceConfig(configSource),
      shouldReadContent: ({ relativePath }) => {
        traversalReads.push(relativePath);
        return undefined;
      }
    });
    const traversedPaths = [];
    for await (const entry of traversal.entries) traversedPaths.push(entry.relativePath);
    assert.deepEqual(traversalReads.sort(), [directPath, nestedPath].sort());
    assert.equal(traversedPaths.includes(directPath), true);
    assert.equal(traversedPaths.includes(nestedPath), true);
    assert.equal(traversedPaths.includes(dropPath), false);
    assert.equal(traversedPaths.includes(nestedDropPath), false);
    assert.equal(traversedPaths.includes(privatePath), false);

    const watchReads = [];
    const commits = [];
    const browseListings = [];
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async (params) => {
        watchReads.push(params.relativePath);
        return await readSingleWorkspaceFile(params);
      },
      onWatchCommit: (commit) => commits.push(commit),
      onBrowseListing: (listing) => browseListings.push(listing)
    });
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: root,
        databasePath: join(temp, 'cache', 'search.sqlite')
      });
      assert.deepEqual(
        indexedPaths(engine).filter((relativePath) => relativePath.startsWith('foo/')),
        [nestedPath, directPath].sort()
      );
      const fooRoot = browseListings[0].entries.find(({ relativePath }) => relativePath === 'foo');
      assert.equal(fooRoot.searchExcluded, true);
      const fooListing = await engine.browseDirectory({
        workspaceId: 'workspace',
        generation: 1,
        directoryToken: fooRoot.directoryToken
      });
      assert.deepEqual(
        Object.fromEntries(
          fooListing.entries.map(({ relativePath, searchExcluded }) => [
            relativePath,
            searchExcluded
          ])
        ),
        {
          'foo/bar': true,
          'foo/drop': true,
          'foo/keep': false
        }
      );
      const barDirectory = fooListing.entries.find(
        ({ relativePath }) => relativePath === 'foo/bar'
      );
      const barListing = await engine.browseDirectory({
        workspaceId: 'workspace',
        generation: 1,
        directoryToken: barDirectory.directoryToken
      });
      assert.deepEqual(
        Object.fromEntries(
          barListing.entries.map(({ relativePath, searchExcluded }) => [
            relativePath,
            searchExcluded
          ])
        ),
        {
          'foo/bar/drop': true,
          'foo/bar/keep': false
        }
      );

      await engine.watchController.close({ drain: false });
      engine.watchController = undefined;
      engine.watchRevision += 1;
      watchReads.length = 0;
      commits.length = 0;
      for (const relativePath of [directPath, nestedPath, dropPath, nestedDropPath, privatePath]) {
        await write(join(root, relativePath), `updated ${relativePath}`);
      }
      await applyWatch(engine, {
        full: false,
        paths: [directPath, nestedPath, dropPath, nestedDropPath, privatePath]
      });
      assert.deepEqual(watchReads.sort(), [directPath, nestedPath].sort());
      assert.equal(
        commits.every(({ full }) => full === false),
        true
      );
      assert.equal(indexedPaths(engine).includes(dropPath), false);
      assert.equal(indexedPaths(engine).includes(nestedDropPath), false);
      assert.equal(indexedPaths(engine).includes(privatePath), false);
      assert.deepEqual(
        (await search(engine, 'updated', 'wildcard-reinclude')).map(
          ({ relativePath }) => relativePath
        ),
        [nestedPath, directPath].sort()
      );
    } finally {
      await engine.shutdown();
    }
  });
});

test('watch recognizes exact excluded ancestors without hiding ordered reincluded descendants', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const relativePath = 'excluded/deep/file.txt';
    await write(
      join(root, '.bitterless/preview-config.yml'),
      'version: 1\nexclude:\n  - excluded\n'
    );
    await write(join(root, relativePath), 'excluded initial body');
    const watchReads = [];
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async (params) => {
        watchReads.push(params.relativePath);
        return await readSingleWorkspaceFile(params);
      },
      onWatchCommit: (commit) => commits.push(commit)
    });
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: root,
        databasePath: join(temp, 'cache', 'search.sqlite')
      });
      await engine.watchController.close({ drain: false });
      engine.watchController = undefined;
      engine.watchRevision += 1;
      commits.length = 0;
      await write(join(root, relativePath), 'excluded changed body');
      await applyWatch(engine, { full: false, paths: [relativePath] });
      assert.deepEqual(watchReads, []);
      assert.deepEqual(
        commits.map(({ full, changedRelativePaths }) => ({ full, changedRelativePaths })),
        [{ full: false, changedRelativePaths: [relativePath] }]
      );
      assert.equal(indexedPaths(engine).includes(relativePath), false);
    } finally {
      await engine.shutdown();
    }
  });

  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const dropRelativePath = 'excluded/drop/file.txt';
    const keepRelativePath = 'excluded/keep/file.txt';
    const configSource = "version: 1\nexclude:\n  - excluded\n  - '!excluded/keep/**'\n";
    await write(join(root, '.bitterless/preview-config.yml'), configSource);
    await write(join(root, dropRelativePath), 'drop initial body');
    await write(join(root, keepRelativePath), 'reincluded initial body');
    const traversalReadCandidates = [];
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config: parseOnlyPreviewWorkspaceConfig(configSource),
      shouldReadContent: ({ relativePath }) => {
        traversalReadCandidates.push(relativePath);
        return undefined;
      }
    });
    const traversedPaths = [];
    for await (const entry of traversal.entries) traversedPaths.push(entry.relativePath);
    assert.equal(traversalReadCandidates.includes(dropRelativePath), false);
    assert.equal(traversalReadCandidates.includes(keepRelativePath), true);
    assert.equal(traversedPaths.includes(dropRelativePath), false);
    assert.equal(traversedPaths.includes(keepRelativePath), true);
    const watchReads = [];
    const commits = [];
    const browseListings = [];
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async (params) => {
        watchReads.push(params.relativePath);
        return await readSingleWorkspaceFile(params);
      },
      onWatchCommit: (commit) => commits.push(commit),
      onBrowseListing: (listing) => browseListings.push(listing)
    });
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: root,
        databasePath: join(temp, 'cache', 'search.sqlite')
      });
      assert.equal(indexedPaths(engine).includes(dropRelativePath), false);
      assert.equal(indexedPaths(engine).includes(keepRelativePath), true);
      const excludedRoot = browseListings[0].entries.find(
        ({ relativePath }) => relativePath === 'excluded'
      );
      assert.equal(excludedRoot.searchExcluded, true);
      const excludedListing = await engine.browseDirectory({
        workspaceId: 'workspace',
        generation: 1,
        directoryToken: excludedRoot.directoryToken
      });
      assert.deepEqual(
        excludedListing.entries.map(({ relativePath, searchExcluded }) => [
          relativePath,
          searchExcluded
        ]),
        [
          ['excluded/drop', true],
          ['excluded/keep', false]
        ]
      );
      await engine.watchController.close({ drain: false });
      engine.watchController = undefined;
      engine.watchRevision += 1;
      commits.length = 0;
      await write(join(root, dropRelativePath), 'drop updated body');
      await write(join(root, keepRelativePath), 'reincluded updated body');
      await applyWatch(engine, {
        full: false,
        paths: [dropRelativePath, keepRelativePath]
      });
      assert.deepEqual(watchReads, [keepRelativePath]);
      assert.equal(
        commits.every(({ full }) => full === false),
        true
      );
      assert.deepEqual(
        commits.flatMap(({ changedRelativePaths }) => changedRelativePaths),
        [dropRelativePath, keepRelativePath]
      );
      assert.equal(indexedPaths(engine).includes(dropRelativePath), false);
      assert.equal(indexedPaths(engine).includes(keepRelativePath), true);
      assert.deepEqual(
        (await search(engine, 'reincluded updated body', 'reincluded-watch')).map(
          ({ relativePath: resultPath }) => resultPath
        ),
        [keepRelativePath]
      );
      assert.equal((await search(engine, 'drop updated body', 'drop-watch')).length, 0);
    } finally {
      await engine.shutdown();
    }
  });
});
