/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { readEngineFingerprint } from '../engineFingerprint.mjs';
import { performance } from 'node:perf_hooks';

export const INDEX_ROOT = resolve(import.meta.dirname, '../../../tmp/indexing-bench/index');

export const SECTIONS = Object.freeze(['files', 'contents']);

/**
 * The shipped engine caps each section at 250 results (MAX_SECTION_RESULTS in
 * global-search-session.mjs) whatever the caller asks for. A plan that returns more is not "more
 * generous", it is returning rows plan A cannot, which the parity gate reports as extras.
 */
export const SECTION_RESULT_CAP = 250;

export const PROJECT_SCOPE = Object.freeze({ kind: 'project' });

export const directoryScope = (relativePath) => Object.freeze({ kind: 'directory', relativePath });

/**
 * What a filesystem watcher actually hands an indexer: a bounded list of paths that changed in some
 * way, with no statement about which way. `full` is the watcher admitting it lost track.
 */
export const createChangeSet = ({ paths = [], full = false } = {}) =>
  Object.freeze({
    paths: Object.freeze([...new Set(paths.filter((value) => typeof value === 'string' && value))]),
    full: full === true
  });

/**
 * One timeline per CLI stage. `measure` records a span; the callback receives the span so it can
 * hang counters off it, which is how a suspicious stage gets instrumented without new plumbing.
 */
export const createTimeline = (label = '') => {
  const origin = performance.now();
  const spans = [];
  const marks = [];
  const timeline = {
    label,
    origin,
    now: () => performance.now() - origin,
    mark: (name, detail) => {
      marks.push({ name, atMs: performance.now() - origin, ...(detail ? { detail } : {}) });
    },
    measure: async (name, run) => {
      const span = { name, atMs: performance.now() - origin, ms: 0 };
      spans.push(span);
      const startedAt = performance.now();
      try {
        return await run(span);
      } finally {
        span.ms = performance.now() - startedAt;
      }
    },
    measureSync: (name, run) => {
      const span = { name, atMs: performance.now() - origin, ms: 0 };
      spans.push(span);
      const startedAt = performance.now();
      try {
        return run(span);
      } finally {
        span.ms = performance.now() - startedAt;
      }
    },
    /** Records a span whose duration was measured elsewhere, e.g. by the engine's own diagnostics. */
    record: (name, milliseconds, detail) => {
      spans.push({
        name,
        atMs: performance.now() - origin,
        ms: Number.isFinite(milliseconds) ? milliseconds : 0,
        ...(detail ? { detail } : {})
      });
    },
    report: () => ({
      label,
      totalMs: performance.now() - origin,
      spans: spans.map((span) => ({ ...span })),
      marks: [...marks]
    })
  };
  return timeline;
};

export const emptySearchOutcome = () => ({
  files: [],
  contents: [],
  truncated: { files: false, contents: false },
  engine: 'none',
  counters: {}
});

const relativePathList = (values) => values.map(({ relativePath }) => relativePath).sort();

/**
 * Cross-plan comparison only means something if the plans agree on what a query matches, so every
 * benchmark run compares this signature before it compares milliseconds.
 */
export const searchSignature = (outcome) => ({
  files: relativePathList(outcome.files),
  contents: relativePathList(outcome.contents)
});

export const assertSearchOutcome = (outcome, planId) => {
  if (!outcome || typeof outcome !== 'object') {
    throw new TypeError(`Plan ${planId} returned no search outcome`);
  }
  for (const section of SECTIONS) {
    if (!Array.isArray(outcome[section])) {
      throw new TypeError(`Plan ${planId} returned no ${section} array`);
    }
    for (const row of outcome[section]) {
      if (typeof row?.relativePath !== 'string' || !row.relativePath) {
        throw new TypeError(`Plan ${planId} returned a ${section} row without a relative path`);
      }
    }
  }
  return outcome;
};

const REQUIRED_PLAN_KEYS = ['id', 'name', 'summary', 'init', 'load', 'status', 'refresh', 'drop'];

export const definePlan = (plan) => {
  for (const key of REQUIRED_PLAN_KEYS) {
    if (plan[key] === undefined) throw new TypeError(`Plan is missing ${key}`);
  }
  return Object.freeze({
    tradeoffs: [],
    capabilities: Object.freeze({
      separateLoad: true,
      scopedFiles: true,
      scopedContents: true,
      independentSections: true,
      backgroundBuild: false,
      // Whether the plan can commit a known change set without re-walking the workspace, and how
      // many paths it accepts before it gives up and does a full reconcile instead.
      incrementalApply: false,
      maxChangePaths: undefined,
      // Every plan derives "this entry is gone" from the filesystem; none of them expose an explicit
      // delete, because a watcher only ever reports a path.
      entryRemoval: 'derived-from-filesystem'
    }),
    ...plan
  });
};

export const workspaceKey = (rootPath) =>
  createHash('sha256').update(resolve(rootPath)).digest('hex').slice(0, 12);

export const planIndexDir = (planId, rootPath) =>
  join(INDEX_ROOT, planId.toLowerCase(), workspaceKey(rootPath));

export const prepareIndexDir = async ({ planId, rootPath, fresh }) => {
  const indexDir = planIndexDir(planId, rootPath);
  if (fresh) await rm(indexDir, { recursive: true, force: true });
  await mkdir(indexDir, { recursive: true });
  return indexDir;
};

const META_NAME = 'plan-meta.json';

/**
 * The completeness marker, and the engine bytes that produced the index. Plan A wraps a live engine
 * that is under edit, so an index built by one revision and measured under another is a comparison of
 * two different things wearing one name.
 */
export const writeIndexMeta = async (indexDir, meta) => {
  const engine = await readEngineFingerprint();
  await writeFile(
    join(indexDir, META_NAME),
    `${JSON.stringify({ ...meta, engine, builtAtMs: Date.now() }, null, 2)}\n`
  );
};

export const readIndexMeta = async (indexDir) => {
  const source = await readFile(join(indexDir, META_NAME), 'utf8').catch(() => undefined);
  return source ? JSON.parse(source) : undefined;
};

/**
 * On-disk size of an index directory, excluding SQLite `-shm` files. Shared memory appears the first
 * time a database is opened and disappears again, so counting it would make the same index measure
 * two different sizes depending on whether anything had read it yet.
 */
export const directoryBytes = async (directoryPath) => {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (entry.name.endsWith('-shm')) continue;
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else total += (await stat(entryPath).catch(() => undefined))?.size ?? 0;
  }
  return total;
};

/**
 * The completeness marker every plan shares. `writeIndexMeta` is the last thing a successful build
 * does, so an index without it was interrupted - and an interrupted index that reports itself healthy
 * is how a search silently returns half a workspace.
 */
export const readIndexCompleteness = async (indexDir) => {
  const meta = await readIndexMeta(indexDir);
  if (meta === undefined) return { complete: false, meta: undefined, engineMatches: undefined };
  const engine = await readEngineFingerprint();
  return {
    complete: true,
    meta,
    builtByEngine: meta.engine?.hash,
    engineMatches: meta.engine?.hash === undefined ? undefined : meta.engine.hash === engine.hash
  };
};

const validRelativeScopePath = (value) =>
  typeof value === 'string' &&
  value.length <= 16_384 &&
  !value.includes('\0') &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !/^[a-zA-Z]:/u.test(value) &&
  !value
    .split('/')
    .some((segment) => (!segment && value !== '') || segment === '.' || segment === '..');

/**
 * Mirrors `requireOnlyPreviewSearchScope`: a malformed or non-existent directory scope must throw,
 * not quietly become an empty key range. An empty answer that looks authoritative is the worst
 * failure mode a search can have, and every alternative plan hit it before this existed.
 */
export const requirePlanScope = (scope, { hasDirectory = () => false } = {}) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('Invalid search scope');
  }
  if (scope.kind === 'project') {
    if (Object.keys(scope).length !== 1) throw new TypeError('Invalid search scope');
    return PROJECT_SCOPE;
  }
  if (
    scope.kind !== 'directory' ||
    Object.keys(scope).sort().join(',') !== 'kind,relativePath' ||
    !validRelativeScopePath(scope.relativePath)
  ) {
    throw new TypeError('Invalid search scope');
  }
  if (!scope.relativePath) return PROJECT_SCOPE;
  if (!hasDirectory(scope.relativePath)) {
    throw new TypeError('Search directory scope does not exist');
  }
  return directoryScope(scope.relativePath);
};

export const percentile = (values, fraction) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1)
  );
  return sorted[position];
};
