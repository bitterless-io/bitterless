/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { CORPUS_SCALES, createIndexingCorpus } from '../corpus.mjs';
import { planIndexDir } from '../plans/planContract.mjs';

const CANDIDATE_COLUMNS = `
  c.id AS chunk_id, c.file_id, c.ordinal, c.core_text, c.left_context_text,
  c.right_overlap_text, c.normalized_searchable, c.normalized_core_length,
  f.relative_path, f.file_name, f.media_type
`;

const SCOPES = Object.freeze({
  project: { clause: 'f.in_project = 1', params: [] },
  directory: {
    clause: 'f.in_project = 1 AND f.relative_path >= ? AND f.relative_path < ?',
    params: ['core-0/', 'core-00']
  }
});

const STATEMENTS = Object.freeze({
  'fts5-trigram': (clause) => `
    SELECT ${CANDIDATE_COLUMNS} FROM chunk_fts AS x
    JOIN chunks AS c ON c.id = x.rowid JOIN files AS f ON f.id = c.file_id
    WHERE chunk_fts MATCH ? AND ${clause} ORDER BY f.relative_path, c.ordinal
  `,
  'sqlite-instr-prefilter': (clause) => `
    SELECT ${CANDIDATE_COLUMNS} FROM chunks AS c JOIN files AS f ON f.id = c.file_id
    WHERE instr(c.normalized_searchable, ?) > 0 AND ${clause}
    ORDER BY f.relative_path, c.ordinal
  `,
  'cjk-postings': (clause) => `
    SELECT ${CANDIDATE_COLUMNS} FROM cjk_postings AS p
    JOIN chunks AS c ON c.id = p.chunk_id JOIN files AS f ON f.id = c.file_id
    WHERE p.token = ? AND ${clause} ORDER BY f.relative_path, c.ordinal
  `
});

const parseArguments = (argv) => {
  const options = { scale: 'small' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--scale') options.scale = argv[(index += 1)];
    else throw new TypeError(`Unknown argument: ${argv[index]}`);
  }
  if (!CORPUS_SCALES[options.scale]) throw new TypeError(`Unknown scale: ${options.scale}`);
  return options;
};

/**
 * A directory scope only reduces work if SQLite can push the path range into the driving loop. This
 * prints the actual plan for each of plan A's three content statements at both scopes, so "scoping
 * did not help" can be attributed to the query plan instead of guessed at.
 */
const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const corpus = await createIndexingCorpus(options.scale);
  const databasePath = join(planIndexDir('A', corpus.rootPath), 'search.sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rowCount = (table) =>
      Number(database.prepare(`SELECT count(*) AS total FROM ${table}`).get().total);
    console.log(
      `plan A index for ${options.scale}: files=${rowCount('files')} chunks=${rowCount('chunks')}` +
        ` postings=${rowCount('cjk_postings')}`
    );
    for (const [engine, build] of Object.entries(STATEMENTS)) {
      for (const [scopeName, scope] of Object.entries(SCOPES)) {
        const sql = build(scope.clause);
        const probe =
          engine === 'cjk-postings' ? '索' : engine === 'fts5-trigram' ? '"needle"' : 'an';
        const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(probe, ...scope.params);
        console.log(`\n${engine} / ${scopeName}`);
        for (const row of rows) console.log(`  ${row.detail}`);
      }
    }
    console.log('\nfiles table indexes');
    for (const row of database.prepare("PRAGMA index_list('files')").all()) {
      const columns = database
        .prepare(`PRAGMA index_info('${row.name}')`)
        .all()
        .map((info) => info.name)
        .join(', ');
      console.log(`  ${row.name} (${columns}) unique=${row.unique}`);
    }
  } finally {
    database.close();
  }
};

await main();
