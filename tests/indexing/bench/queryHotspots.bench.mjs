/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { searchOnlyPreviewGlobalFiles } from '../../../src/preload/onlypreview/search/core/global-search-files.mjs';
import {
  createPlainTextSnippet,
  normalizeSearchText
} from '../../../src/preload/onlypreview/search/core/normalization.mjs';
import { OnlyPreviewSqliteIndex } from '../../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { CORPUS_SCALES, createIndexingCorpus } from '../corpus.mjs';
import { planIndexDir } from '../plans/planContract.mjs';
import { QUERY_SET, queryById } from './queries.mjs';

const parseArguments = (argv) => {
  const options = { scale: 'small', repeat: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[(index += 1)];
    if (argument === '--scale') options.scale = next();
    else if (argument === '--repeat') options.repeat = Number(next());
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  if (!CORPUS_SCALES[options.scale]) throw new TypeError(`Unknown scale: ${options.scale}`);
  return options;
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const repeatMeasure = async (repeat, run) => {
  const samples = [];
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    const startedAt = performance.now();
    await run();
    samples.push(performance.now() - startedAt);
  }
  return median(samples);
};

const syntheticTreeEntries = (count) =>
  Array.from({ length: count }, (_, index) => ({
    relativePath: `bucket-${index % 97}/entry-${index.toString(36)}.ts`,
    parentRelativePath: `bucket-${index % 97}`,
    name: `entry-${index.toString(36)}.ts`,
    nodeKind: 'file',
    size: 1024,
    modifiedAt: 1,
    previewHint: 'text',
    mediaType: 'text',
    isText: true
  }));

/**
 * Attributes plan A's per-query cost to the three things it actually does: scan every tree entry for
 * the Files section, iterate content candidates out of SQLite, and project a snippet per match. The
 * project-wide table above only reports the sum, and the sum hid that a query with many matches
 * spends most of its time in snippet projection rather than in retrieval.
 */
const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const corpus = await createIndexingCorpus(options.scale);
  const databasePath = join(planIndexDir('A', corpus.rootPath), 'search.sqlite');
  console.log(
    `node ${process.version} ${process.platform}/${process.arch}  scale=${options.scale}` +
      `  files=${corpus.fileCount}  text=${(corpus.textBytes / 1024 ** 2).toFixed(1)}MiB`
  );

  console.log('\n-- Files section: in-memory tree-entry scan (plan A, project scope) ---------');
  console.log(`${'entries'.padStart(9)} ${'p50 ms'.padStart(9)} ${'us/entry'.padStart(10)}   note`);
  for (const count of [1_000, 10_000, 50_000, 130_000]) {
    const entries = syntheticTreeEntries(count);
    const elapsedMs = await repeatMeasure(
      options.repeat,
      async () =>
        await searchOnlyPreviewGlobalFiles({
          entries,
          query: 'entry-4',
          scope: { kind: 'project' },
          maxResults: 250
        })
    );
    console.log(
      `${String(count).padStart(9)} ${elapsedMs.toFixed(2).padStart(9)}` +
        ` ${((elapsedMs * 1000) / count).toFixed(2).padStart(10)}   normalizeSearchText per entry, per query`
    );
  }

  const index = new OnlyPreviewSqliteIndex(databasePath);
  try {
    index.hydrateFilenameTier();
    console.log('\n-- Contents section: retrieval against snippet projection -------------------');
    console.log(
      `${'query'.padEnd(14)} ${'cap=1'.padStart(9)} ${'cap=250'.padStart(9)}` +
        ` ${'hits'.padStart(6)} ${'ms/hit'.padStart(8)}   engine`
    );
    for (const entry of QUERY_SET) {
      if (entry.branch === 'name-only') continue;
      const capped = await repeatMeasure(
        options.repeat,
        async () =>
          await index.searchContents(entry.query, { maxResults: 1, scope: { kind: 'project' } })
      );
      let hits = 0;
      let servedBy = 'unknown';
      const full = await repeatMeasure(options.repeat, async () => {
        const outcome = await index.searchContents(entry.query, {
          maxResults: 250,
          scope: { kind: 'project' }
        });
        hits = outcome.results.length;
        servedBy = outcome.engine ?? 'unknown';
      });
      console.log(
        `${entry.id.padEnd(14)} ${capped.toFixed(2).padStart(9)} ${full.toFixed(2).padStart(9)}` +
          ` ${String(hits).padStart(6)} ${(hits > 0 ? (full - capped) / hits : 0).toFixed(3).padStart(8)}   ${servedBy}`
      );
    }

    console.log('\n-- Snippet projection in isolation -----------------------------------------');
    const chunkRows = index.database
      .prepare(
        `SELECT core_text FROM chunks
         WHERE instr(normalized_searchable, ?) > 0 LIMIT 200`
      )
      .all(normalizeSearchText(queryById('common').query));
    if (chunkRows.length > 0) {
      const query = queryById('common').query;
      const elapsedMs = await repeatMeasure(options.repeat, async () => {
        for (const row of chunkRows) createPlainTextSnippet(row.core_text, query);
      });
      console.log(
        `  createPlainTextSnippet over ${chunkRows.length} real chunks:` +
          ` ${elapsedMs.toFixed(1)}ms total, ${(elapsedMs / chunkRows.length).toFixed(3)}ms per snippet`
      );
      const totalChars = chunkRows.reduce((total, row) => total + row.core_text.length, 0);
      console.log(
        `  ${(totalChars / 1024).toFixed(0)}KiB of chunk text ->` +
          ` ${(totalChars / 1024 / 1024 / (elapsedMs / 1000)).toFixed(1)} MiB/s`
      );
    } else {
      console.log('  no chunk rows matched - has "index init --plan A" been run for this scale?');
    }
  } finally {
    index.close();
  }
};

await main();
