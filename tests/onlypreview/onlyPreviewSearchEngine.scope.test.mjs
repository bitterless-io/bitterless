import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-scope-'));
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

const search = async (
  engine,
  generation,
  requestId,
  query,
  maxResults = 500,
  scope = { kind: 'project' }
) =>
  await engine.search({
    workspaceId: 'workspace',
    generation,
    requestId,
    query,
    maxResults,
    scope,
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  });

test('browsed hidden directories remain valid empty Search scopes outside the Search projection', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const longQuery = 'q'.repeat(70);
    const searchable = `yz 界 searchword 日本語 한국어 ${longQuery}`;
    await mkdir(root);
    await write(join(root, 'visible/content.txt'), searchable);
    await write(join(root, 'other/content.txt'), searchable);
    await write(join(root, '.root-content.txt'), searchable);
    await write(join(root, '.hidden/content.txt'), searchable);
    await write(join(root, 'docs/.hidden/content.txt'), searchable);
    await write(join(root, 'visible/title-scope-hit.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, 'visible/中文标题.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, 'visible/한국제목.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, '.title-scope-hit.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, '.hidden/title-scope-hit.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, '.hidden/隐藏标题.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, 'docs/.hidden/title-scope-hit.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, 'visible/scope-hit-folder/neutral.txt'), 'neutral');

    const browseListings = [];
    const engine = createOnlyPreviewSearchEngine({
      onBrowseListing: (listing) => browseListings.push(listing)
    });
    const snapshot = await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    assert.equal(browseListings.length, 1);
    const rootListing = browseListings[0];
    const rootEntry = (name) => rootListing.entries.find((entry) => entry.name === name);
    assert.equal(rootEntry('.hidden').nodeKind, 'directory');
    assert.equal(rootEntry('docs').nodeKind, 'directory');
    const docsListing = await engine.browseDirectory({
      workspaceId: 'workspace',
      generation: 1,
      directoryToken: rootEntry('docs').directoryToken
    });
    assert.equal(
      docsListing.entries.some(
        ({ relativePath, nodeKind }) => relativePath === 'docs/.hidden' && nodeKind === 'directory'
      ),
      true
    );
    assert.equal(
      snapshot.index.entries.some(({ relativePath }) => relativePath === '.hidden'),
      false
    );
    assert.equal(
      snapshot.index.entries.some(({ relativePath }) => relativePath === 'docs/.hidden'),
      false
    );

    const inProject = new Map(
      engine.index.database
        .prepare('SELECT relative_path, in_project FROM files ORDER BY relative_path')
        .all()
        .map((row) => [row.relative_path, row.in_project])
    );
    assert.equal(inProject.get('.root-content.txt'), 1);
    assert.equal(inProject.has('.hidden/content.txt'), false);
    assert.equal(inProject.has('docs/.hidden/content.txt'), false);
    assert.equal(
      engine.index.database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'files_project_path'"
        )
        .get().count,
      1
    );

    const cases = [
      ['yz', 'sqlite-instr-prefilter'],
      ['界', 'cjk-postings'],
      ['searchword', 'fts5-trigram'],
      [longQuery, 'exact-file-fallback']
    ];
    for (const [query, expectedEngine] of cases) {
      const project = await engine.index.search(query, { scope: { kind: 'project' } });
      assert.equal(project.engine, expectedEngine);
      assert.deepEqual(project.results.map(({ relativePath }) => relativePath).sort(), [
        '.root-content.txt',
        'other/content.txt',
        'visible/content.txt'
      ]);

      const rootDirectory = await engine.index.search(query, {
        scope: { kind: 'directory', relativePath: '' }
      });
      assert.deepEqual(rootDirectory.results, project.results);

      const visible = await engine.index.search(query, {
        scope: { kind: 'directory', relativePath: 'visible' }
      });
      assert.deepEqual(
        visible.results.map(({ relativePath }) => relativePath),
        ['visible/content.txt']
      );

      const rootHidden = await engine.index.search(query, {
        scope: { kind: 'directory', relativePath: '.hidden' }
      });
      assert.deepEqual(rootHidden.results, []);

      const nestedHidden = await engine.index.search(query, {
        scope: { kind: 'directory', relativePath: 'docs/.hidden' }
      });
      assert.deepEqual(nestedHidden.results, []);
    }

    const projectTitles = await search(engine, 1, 'titles', 'scope-hit');
    assert.deepEqual(projectTitles.results.map(({ relativePath }) => relativePath).sort(), [
      '.title-scope-hit.pdf',
      'visible/title-scope-hit.pdf'
    ]);
    const hiddenTitles = await search(engine, 1, 'hidden-titles', 'scope-hit', 500, {
      kind: 'directory',
      relativePath: '.hidden'
    });
    assert.deepEqual(hiddenTitles.results, []);
    assert.equal(
      projectTitles.results.some(({ relativePath }) => relativePath === 'visible/scope-hit-folder'),
      false
    );

    assert.equal((await search(engine, 1, 'japanese', '日本')).results.length > 0, true);
    assert.equal((await search(engine, 1, 'korean', '한국')).results.length > 0, true);
    assert.deepEqual(
      (await search(engine, 1, 'chinese-title', '中文')).results.map(
        ({ relativePath }) => relativePath
      ),
      ['visible/中文标题.pdf']
    );
    assert.deepEqual(
      (await search(engine, 1, 'korean-title', '한국제목')).results.map(
        ({ relativePath }) => relativePath
      ),
      ['visible/한국제목.pdf']
    );
    assert.deepEqual(
      (
        await search(engine, 1, 'hidden-chinese-title', '隐藏', 500, {
          kind: 'directory',
          relativePath: '.hidden'
        })
      ).results,
      []
    );
    await assert.rejects(
      search(engine, 1, 'missing-directory', 'searchword', 500, {
        kind: 'directory',
        relativePath: 'missing'
      }),
      /does not exist/u
    );
    await assert.rejects(
      search(engine, 1, 'backslash-directory', 'searchword', 500, {
        kind: 'directory',
        relativePath: 'docs\\.hidden'
      }),
      /Invalid search scope/u
    );
    await engine.shutdown();
  });
});

test('directory scopes fail closed for legacy hidden rows outside Project Search', async () => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  const identity = {
    workspaceHash: 'workspace',
    configHash: 'config',
    engineHash: SEARCH_ENGINE_IDENTITY
  };
  await index.rebuild(
    [
      {
        relativePath: '.legacy/legacytitle.txt',
        mediaType: 'text',
        contentIndexed: true,
        originalContent: 'legacybody',
        size: 10,
        modifiedMs: 1
      }
    ],
    identity
  );
  assert.equal(
    index.database
      .prepare("SELECT in_project FROM files WHERE relative_path = '.legacy/legacytitle.txt'")
      .get().in_project,
    0
  );

  for (const query of ['legacytitle', 'legacybody']) {
    const outcome = await index.search(query, {
      scope: { kind: 'directory', relativePath: '.legacy' }
    });
    assert.deepEqual(outcome.results, []);
  }
  index.close();
});

test('title-cap targeting skips non-text scans and enriches selected text in all content engines', async () => {
  const identity = {
    workspaceHash: 'workspace',
    configHash: 'config',
    engineHash: SEARCH_ENGINE_IDENTITY
  };
  const cases = [
    ['yz', 'sqlite-instr-prefilter'],
    ['界', 'cjk-postings'],
    ['mixedcap', 'fts5-trigram'],
    ['q'.repeat(70), 'exact-file-fallback']
  ];
  for (const [query, expectedEngine] of cases) {
    for (const selectedTextTitle of [false, true]) {
      for (const hasOutsideContentMatch of [false, true]) {
        const index = new OnlyPreviewSqliteIndex(':memory:');
        const selectedTextPath = `000-${query}-text.txt`;
        const entries = Array.from({ length: 500 }, (_, item) => ({
          relativePath:
            item === 0 && selectedTextTitle
              ? selectedTextPath
              : `100-${query}-${String(item).padStart(3, '0')}.bin`,
          mediaType: item === 0 && selectedTextTitle ? 'text' : 'unknown',
          contentIndexed: item === 0 && selectedTextTitle,
          originalContent: item === 0 && selectedTextTitle ? `before ${query} after` : '',
          size: item === 0 && selectedTextTitle ? query.length + 14 : 0,
          modifiedMs: item + 1
        }));
        const outsidePath = `neutral-${expectedEngine}.txt`;
        if (hasOutsideContentMatch) {
          entries.push({
            relativePath: outsidePath,
            mediaType: 'text',
            contentIndexed: true,
            originalContent: query,
            size: query.length,
            modifiedMs: 1_000
          });
        }
        await index.rebuild(entries, identity);
        const outcome = await index.search(query, {
          maxResults: 500,
          scope: { kind: 'project' }
        });

        assert.equal(outcome.engine, expectedEngine);
        assert.equal(
          outcome.contentPlan,
          selectedTextTitle ? 'selected-text-title-files' : 'skip-title-cap-no-content'
        );
        assert.equal(outcome.titleMatchCount, 500);
        assert.equal(outcome.selectedTextTitleCount, selectedTextTitle ? 1 : 0);
        assert.equal(outcome.results.length, 500);
        assert.equal(outcome.truncated, hasOutsideContentMatch);
        assert.equal(
          outcome.results.some(({ relativePath }) => relativePath === outsidePath),
          false
        );
        if (selectedTextTitle) {
          const selectedText = outcome.results.find(
            ({ relativePath }) => relativePath === selectedTextPath
          );
          assert.ok(selectedText);
          assert.notEqual(selectedText.contentMatch, null);
        }
        index.close();
      }
    }
  }

  const cancelledIndex = new OnlyPreviewSqliteIndex(':memory:');
  const cancelledQuery = 'cancelcap';
  const cancelledEntries = Array.from({ length: 500 }, (_, item) => ({
    relativePath: `${cancelledQuery}-${String(item).padStart(3, '0')}.bin`,
    mediaType: 'unknown',
    contentIndexed: false,
    originalContent: '',
    size: 0,
    modifiedMs: item
  }));
  cancelledEntries.push({
    relativePath: 'neutral-cancel.txt',
    mediaType: 'text',
    contentIndexed: true,
    originalContent: cancelledQuery,
    size: cancelledQuery.length,
    modifiedMs: 1_000
  });
  await cancelledIndex.rebuild(cancelledEntries, identity);
  let cancellationChecks = 0;
  const cancelled = await cancelledIndex.search(cancelledQuery, {
    maxResults: 500,
    scope: { kind: 'project' },
    isCancelled: () => ++cancellationChecks > cancelledEntries.length
  });
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancelled.results, []);
  cancelledIndex.close();
});
