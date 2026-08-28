/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { CJK_NEEDLE, COMMON_NEEDLE, UNIQUE_NEEDLE } from '../corpus.mjs';

/**
 * One query per retrieval branch the shipped engine can take, plus the two cases a benchmark that
 * only measures happy paths would miss: a name-only match and a query that matches nothing.
 */
export const QUERY_SET = Object.freeze([
  {
    id: 'unique',
    query: UNIQUE_NEEDLE,
    branch: 'fts5-trigram',
    note: 'one content hit in the whole corpus'
  },
  {
    id: 'common',
    query: COMMON_NEEDLE,
    branch: 'fts5-trigram',
    note: 'content hit in most text files, so truncation and early exit both matter'
  },
  {
    id: 'cjk',
    query: CJK_NEEDLE,
    branch: 'fts5-trigram',
    note: 'multi-character CJK content'
  },
  {
    id: 'filename',
    query: 'entry-4',
    branch: 'name-only',
    note: 'matches file names, not content'
  },
  {
    id: 'short-ascii',
    query: 'an',
    branch: 'sqlite-instr-prefilter',
    note: 'two ASCII characters: full chunk scan in plan A'
  },
  {
    id: 'short-cjk',
    query: '索引',
    branch: 'cjk-postings',
    note: 'two CJK characters: posting-list branch in plan A'
  },
  {
    id: 'absent',
    query: 'zzq-absent-from-every-file',
    branch: 'fts5-trigram',
    note: 'worst case: nothing matches, no early exit is possible'
  }
]);

export const queryById = (id) => QUERY_SET.find((entry) => entry.id === id);
