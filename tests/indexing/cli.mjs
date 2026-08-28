/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createInterface } from 'node:readline/promises';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  CJK_NEEDLE,
  COMMON_NEEDLE,
  CORPUS_SCALES,
  UNIQUE_NEEDLE,
  createIndexingCorpus,
  clearCorpusPendingChanges,
  dirtyCorpusFilesOnDisk,
  dirtyTokenFor,
  inspectCorpusCandidates,
  readCorpusChangeState,
  removeCorpusFilesOnDisk,
  restoreCorpusOnDisk
} from './corpus.mjs';
import {
  PROJECT_SCOPE,
  createChangeSet,
  createTimeline,
  directoryScope,
  percentile,
  planIndexDir,
  prepareIndexDir,
  readIndexCompleteness
} from './plans/planContract.mjs';
import { loadPlans, resolvePlan } from './plans/registry.mjs';
import { formatEngineFingerprint, readEngineFingerprint } from './engineFingerprint.mjs';

const USAGE = `
yarn indexing <command> [options]

Target (choose one; --scale is the default)
  --scale tiny|small|medium|large   generated deterministic corpus (default: small)
  --root <dir>                      a real directory on disk

Common
  --plan A|B|C|D                    which indexing plan to drive (default: A)
  --limit N                         maximum results per section (default: 50)
  --json                            machine-readable output
  --trace                           print every measured sub-phase

Commands
  plans                             list the plans, their capabilities and tradeoffs
  needles                           print the query strings planted in generated corpora

  corpus create                     build or reuse the corpus, print its shape
  corpus info                       print corpus statistics and a few directory sizes
  corpus dirty --count N            edit N text files, each with its own findable token
  corpus remove --count N           move N text files out of the corpus (reversible)
  corpus state                      which files are currently edited or removed
  corpus restore                    undo every edit and every removal

  index init                        build the index from scratch (deletes any existing one)
  index load                        open the index and report what loading costs
  index status                      what is on disk right now
  index apply                       commit a change set incrementally (the watcher path)
      --changed                     use the change set recorded by corpus dirty / corpus remove
      --paths a/b.ts,c/d.ts         use an explicit change set
      --full                        tell the plan the watcher lost track
      --verify                      afterwards, prove each edit is findable and each removal is gone
  index refresh                     full re-scan reconcile: discover the changes yourself
  index drop                        delete the whole index for this plan

  search <query>                    load, then search; reports load and query separately
      --dir <relativePath>          restrict to one directory instead of the whole project
      --section files|contents|all  which section to print (default: all)
      --repeat N                    run the query N extra times and report p50/p95
      --no-reconcile                plan A only: load the committed index without reconciling
  scope <query>                     compare project-wide against directory-scoped, several sizes
  repl                              keep the index loaded and search interactively

Examples
  yarn indexing corpus create --scale medium
  yarn indexing index init --plan A --scale medium
  yarn indexing index status --plan A --scale medium
  yarn indexing search "handleWorkspaceRequest" --plan A --scale medium
  yarn indexing search "handleWorkspaceRequest" --plan A --scale medium --dir core-0
  yarn indexing scope "handleWorkspaceRequest" --plan A --scale medium
  yarn indexing repl --plan A --scale medium
  yarn indexing corpus dirty --scale medium --count 8
  yarn indexing index apply --plan A --scale medium --changed --verify
  yarn indexing corpus restore --scale medium
`;

const BOOLEAN_FLAGS = new Set([
  'json',
  'trace',
  'quiet',
  'no-reconcile',
  'fresh',
  'help',
  'changed',
  'full',
  'verify'
]);

const parseArgv = (argv) => {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`Flag --${name} needs a value`);
    }
    flags[name] = value;
    index += 1;
  }
  return { positional, flags };
};

const ms = (value) =>
  value === undefined
    ? '-'
    : value >= 1000
      ? `${(value / 1000).toFixed(2)}s`
      : `${value.toFixed(value < 10 ? 2 : 1)}ms`;

const bytes = (value) =>
  value === undefined
    ? '-'
    : value >= 1024 ** 2
      ? `${(value / 1024 ** 2).toFixed(1)}MiB`
      : `${(value / 1024).toFixed(1)}KiB`;

const resolveTarget = async (flags) => {
  if (flags.root) {
    const rootPath = await realpath(resolve(flags.root));
    return { rootPath, corpus: undefined, label: `root:${rootPath}` };
  }
  const scale = flags.scale ?? 'small';
  if (!CORPUS_SCALES[scale]) {
    throw new TypeError(
      `Unknown scale ${scale}. Available: ${Object.keys(CORPUS_SCALES).join(', ')}`
    );
  }
  const corpus = await createIndexingCorpus(scale);
  return { rootPath: corpus.rootPath, corpus, label: scale };
};

const printTimeline = (report, { trace }) => {
  const spans = trace ? report.spans : report.spans.filter((span) => span.ms >= 1);
  for (const span of spans) {
    const detail = span.detail ? `  ${JSON.stringify(span.detail)}` : '';
    console.log(`    ${span.name.padEnd(30)} ${ms(span.ms).padStart(9)}${detail}`);
  }
  console.log(`    ${'TOTAL'.padEnd(30)} ${ms(report.totalMs).padStart(9)}`);
};

const printSearchOutcome = (outcome, { section, limit }) => {
  const show = (label, rows) => {
    console.log(`  ${label} (${rows.length})`);
    for (const row of rows.slice(0, limit)) {
      const suffix = row.snippet
        ? `  ${JSON.stringify(row.snippet.replaceAll('\n', '⏎')).slice(0, 120)}`
        : row.nodeKind === 'directory'
          ? '  [dir]'
          : '';
      console.log(`    ${row.relativePath}${suffix}`);
    }
  };
  if (section !== 'contents') show('files', outcome.files);
  if (section !== 'files') show('contents', outcome.contents);
  const counters = Object.entries(outcome.counters ?? {}).filter(
    ([, value]) => value !== undefined
  );
  if (counters.length > 0) {
    console.log(
      `  counters ${counters
        .map(
          ([key, value]) =>
            `${key}=${key.endsWith('Ms') && typeof value === 'number' ? ms(value) : value}`
        )
        .join(' ')}`
    );
  }
};

const sectionsFor = (section) =>
  section === 'files' ? ['files'] : section === 'contents' ? ['contents'] : ['files', 'contents'];

const searchOptions = (flags, scope) => ({
  scope,
  sections: sectionsFor(flags.section ?? 'all'),
  maxResults: Number(flags.limit ?? 50),
  requestId: `cli-${Date.now().toString(36)}`
});

const withLoadedPlan = async ({ plan, rootPath, flags }, run) => {
  const indexDir = planIndexDir(plan.id, rootPath);
  const timeline = createTimeline('load');
  const loaded = await plan.load({
    rootPath,
    indexDir,
    timeline,
    options: { reconcile: flags['no-reconcile'] ? false : true }
  });
  try {
    return await run({ loaded, timeline, indexDir });
  } finally {
    await loaded.handle.close();
  }
};

const directorySamples = (directories, rootPath) => {
  void rootPath;
  if (directories.length === 0) return [];
  const sorted = [...directories].sort(
    (left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right)
  );
  const picks = new Set();
  for (const fraction of [0, 0.25, 0.5, 0.9]) {
    picks.add(sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]);
  }
  return [...picks].filter(Boolean);
};

const commands = {
  async plans() {
    const plans = await loadPlans();
    for (const plan of plans.values()) {
      console.log(`\n${plan.id}  ${plan.name}`);
      console.log(`  ${plan.summary}`);
      console.log(
        `  capabilities ${Object.entries(plan.capabilities)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ')}`
      );
      console.log(
        `  lifecycle    init=yes load=${plan.capabilities.separateLoad ? 'standalone' : 'rebuilds'}` +
          ` apply=${plan.apply ? 'yes' : 'no'} refresh=yes drop=yes`
      );
      for (const tradeoff of plan.tradeoffs) console.log(`  - ${tradeoff}`);
    }
    const missing = ['A', 'B', 'C', 'D'].filter((id) => !plans.has(id));
    if (missing.length > 0) console.log(`\nnot implemented yet: ${missing.join(', ')}`);
  },

  async needles() {
    console.log(`unique   ${UNIQUE_NEEDLE}   (exactly one file)`);
    console.log(`common   ${COMMON_NEEDLE}   (most text files)`);
    console.log(`cjk      ${CJK_NEEDLE}   (every CJK file)`);
    console.log(`short    an              (2 ASCII characters - takes the instr prefilter branch)`);
    console.log(`short-cn 索引            (2 CJK characters - takes the CJK postings branch)`);
    console.log(`absent   zzz-not-present-anywhere   (worst case: no match)`);
  },

  corpus: {
    async create(_positional, flags) {
      const { corpus, label } = await resolveTarget(flags);
      if (!corpus) throw new TypeError('corpus create needs --scale, not --root');
      console.log(
        `${label}: ${JSON.stringify({ ...corpus, dirtyCandidates: undefined }, null, 2)}`
      );
    },
    async info(_positional, flags) {
      const { rootPath, corpus, label } = await resolveTarget(flags);
      const { createTraversalPolicy, walkWorkspace } = await import('./plans/walker.mjs');
      const { loadOnlyPreviewWorkspaceConfig } =
        await import('../../src/preload/onlypreview/search/core/workspace-config.mjs');
      const policy = createTraversalPolicy(await loadOnlyPreviewWorkspaceConfig(rootPath));
      const perDirectory = new Map();
      let textBytes = 0;
      let textFiles = 0;
      const counters = await walkWorkspace({
        rootPath,
        policy,
        onFile: (file) => {
          if (file.mediaType !== 'text') return;
          textFiles += 1;
          textBytes += file.size;
          const top = file.relativePath.split('/')[0];
          const bucket = perDirectory.get(top) ?? { files: 0, bytes: 0 };
          bucket.files += 1;
          bucket.bytes += file.size;
          perDirectory.set(top, bucket);
        }
      });
      console.log(`${label}`);
      console.log(`  walk ${JSON.stringify(counters)}`);
      console.log(`  text files ${textFiles}, ${bytes(textBytes)}`);
      if (corpus) console.log(`  planted needle in ${corpus.uniqueNeedlePath}`);
      const top = [...perDirectory.entries()]
        .sort((left, right) => right[1].bytes - left[1].bytes)
        .slice(0, 8);
      console.log('  largest top-level entries');
      for (const [name, bucket] of top) {
        console.log(
          `    ${name.padEnd(24)} ${String(bucket.files).padStart(6)} files ${bytes(bucket.bytes).padStart(9)}` +
            ` (${((bucket.bytes / textBytes) * 100).toFixed(1)}% of text)`
        );
      }
    },
    async dirty(_positional, flags) {
      const { corpus } = await resolveTarget(flags);
      if (!corpus) throw new TypeError('corpus dirty only works on a generated corpus');
      const changed = await dirtyCorpusFilesOnDisk(corpus, Number(flags.count ?? 32));
      console.log(`edited ${changed.length} files, each with its own token`);
      for (const path of changed.slice(0, 10)) console.log(`  ${path}  ${dirtyTokenFor(path)}`);
      if (changed.length > 10) console.log(`  ... ${changed.length - 10} more`);
    },
    async remove(_positional, flags) {
      const { corpus } = await resolveTarget(flags);
      if (!corpus) throw new TypeError('corpus remove only works on a generated corpus');
      const removed = await removeCorpusFilesOnDisk(corpus, Number(flags.count ?? 16));
      console.log(`removed ${removed.length} files from the corpus (held for restore)`);
      for (const path of removed.slice(0, 10)) console.log(`  ${path}`);
    },
    async state(_positional, flags) {
      const { corpus } = await resolveTarget(flags);
      if (!corpus) throw new TypeError('corpus state only works on a generated corpus');
      const state = await readCorpusChangeState(corpus);
      const inspected = await inspectCorpusCandidates(corpus);
      console.log(
        `recorded: edited ${state.dirtied.length}, removed ${state.removed.length},` +
          ` pending commit ${state.pending.length}`
      );
      console.log(
        `on disk:  edited ${inspected.edited.length}, pristine ${inspected.pristine.length},` +
          ` missing ${inspected.missing.length} (of ${corpus.dirtyCandidates.length} candidates)`
      );
      for (const path of inspected.sampled.edited) console.log(`  edit    ${path}`);
      for (const path of inspected.sampled.missing) console.log(`  missing ${path}`);
    },
    async restore(_positional, flags) {
      const { corpus } = await resolveTarget(flags);
      if (!corpus) throw new TypeError('corpus restore only works on a generated corpus');
      const restored = await restoreCorpusOnDisk(corpus);
      console.log(
        `restored ${restored.restoredEdits.length} edits and ${restored.restoredRemovals.length} removals`
      );
    }
  },

  index: {
    async init(_positional, flags) {
      const plan = await resolvePlan(flags.plan);
      const { rootPath, label } = await resolveTarget(flags);
      const indexDir = await prepareIndexDir({ planId: plan.id, rootPath, fresh: true });
      const timeline = createTimeline('index init');
      const { stats } = await plan.init({ rootPath, indexDir, timeline, options: flags });
      const report = timeline.report();
      if (flags.json) {
        console.log(JSON.stringify({ plan: plan.id, label, stats, report }, null, 2));
        return;
      }
      console.log(
        `index init  plan=${plan.id}  target=${label}` +
          `  ${formatEngineFingerprint(await readEngineFingerprint())}`
      );
      printTimeline(report, flags);
      console.log(`  stats ${JSON.stringify(stats)}`);
      const status = await plan.status({ rootPath, indexDir });
      console.log(`  on disk ${JSON.stringify({ ...status, bytes: bytes(status.bytes) })}`);
    },

    async load(_positional, flags) {
      const plan = await resolvePlan(flags.plan);
      const { rootPath, label } = await resolveTarget(flags);
      await withLoadedPlan({ plan, rootPath, flags }, async ({ loaded, timeline }) => {
        const report = timeline.report();
        if (flags.json) {
          console.log(
            JSON.stringify({ plan: plan.id, label, stats: loaded.stats, report }, null, 2)
          );
          return;
        }
        console.log(
          `index load  plan=${plan.id}  target=${label}  mode=${loaded.handle.mode ?? 'default'}` +
            `  ${formatEngineFingerprint(await readEngineFingerprint())}`
        );
        printTimeline(report, flags);
        console.log(`  stats ${JSON.stringify(loaded.stats)}`);
      });
    },

    async status(_positional, flags) {
      const plan = await resolvePlan(flags.plan);
      const { rootPath, label } = await resolveTarget(flags);
      const indexDir = planIndexDir(plan.id, rootPath);
      const status = await plan.status({ rootPath, indexDir });
      if (flags.json) {
        console.log(JSON.stringify({ plan: plan.id, label, indexDir, status }, null, 2));
        return;
      }
      console.log(
        `index status  plan=${plan.id}  target=${label}` +
          `  ${formatEngineFingerprint(await readEngineFingerprint())}`
      );
      console.log(`  ${indexDir}`);
      const provenance = await readIndexCompleteness(indexDir);
      console.log(
        `  built by engine=${provenance.builtByEngine ?? 'unknown'}` +
          ` complete=${provenance.complete}` +
          (provenance.engineMatches === false ? '  ENGINE CHANGED SINCE THIS INDEX WAS BUILT' : '')
      );
      if (!status.exists) {
        console.log('  no index yet - run "index init" first');
        return;
      }
      for (const [key, value] of Object.entries(status)) {
        console.log(`    ${key.padEnd(16)} ${key === 'bytes' ? bytes(value) : value}`);
      }
    },

    async apply(_positional, flags) {
      const plan = await resolvePlan(flags.plan);
      const { rootPath, corpus, label } = await resolveTarget(flags);
      if (!plan.apply) {
        throw new TypeError(
          `plan ${plan.id} has no incremental apply; use "index refresh" for a full reconcile`
        );
      }
      let paths = [];
      if (flags.paths) {
        paths = flags.paths
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
      } else if (flags.changed) {
        if (!corpus) throw new TypeError('--changed needs a generated corpus');
        paths = (await readCorpusChangeState(corpus)).pending;
      } else if (!flags.full) {
        throw new TypeError('index apply needs --changed, --paths <list>, or --full');
      }
      const indexDir = planIndexDir(plan.id, rootPath);
      const changes = createChangeSet({ paths, full: flags.full === true });
      const timeline = createTimeline('index apply');
      const { stats } = await plan.apply({
        rootPath,
        indexDir,
        timeline,
        changes,
        options: flags
      });
      if (flags.changed && corpus) await clearCorpusPendingChanges(corpus);
      const report = timeline.report();
      if (flags.json) {
        console.log(JSON.stringify({ plan: plan.id, label, changes, stats, report }, null, 2));
        return;
      }
      console.log(
        `index apply  plan=${plan.id}  target=${label}  paths=${changes.paths.length}` +
          `  full=${changes.full}`
      );
      printTimeline(report, flags);
      console.log(`  stats ${JSON.stringify(stats)}`);
      if (!flags.verify) return;
      if (!corpus) throw new TypeError('--verify needs a generated corpus');
      // Verification reads the current on-disk truth rather than a recorded history: a candidate
      // either carries its marker, or does not, or is gone, and the index must agree with all three.
      const inspected = await inspectCorpusCandidates(corpus, {
        sample: Number(flags['verify-sample'] ?? 8)
      });
      await withLoadedPlan(
        { plan, rootPath, flags: { ...flags, 'no-reconcile': true } },
        async ({ loaded }) => {
          const failures = [];
          const searchFor = async (query, sections, maxResults) =>
            await loaded.handle.search(query, {
              scope: PROJECT_SCOPE,
              sections,
              maxResults,
              requestId: `verify-${query}`
            });
          for (const relativePath of inspected.sampled.edited) {
            const token = dirtyTokenFor(relativePath);
            const outcome = await searchFor(token, ['contents'], 20);
            if (!outcome.contents.some((row) => row.relativePath === relativePath)) {
              failures.push(`edited file is not findable by its token: ${relativePath} (${token})`);
            }
          }
          for (const relativePath of inspected.sampled.pristine) {
            const token = dirtyTokenFor(relativePath);
            const outcome = await searchFor(token, ['contents'], 20);
            if (outcome.contents.length > 0) {
              failures.push(`stale edit still indexed: ${relativePath} (${token})`);
            }
          }
          for (const relativePath of inspected.sampled.missing) {
            const outcome = await searchFor(
              relativePath.split('/').at(-1),
              ['files', 'contents'],
              250
            );
            if (
              [...outcome.files, ...outcome.contents].some(
                (row) => row.relativePath === relativePath
              )
            ) {
              failures.push(`removed file still indexed: ${relativePath}`);
            }
          }
          console.log(
            `  verify ${failures.length === 0 ? 'PASS' : 'FAIL'}` +
              ` (checked ${inspected.sampled.edited.length} edited,` +
              ` ${inspected.sampled.pristine.length} pristine,` +
              ` ${inspected.sampled.missing.length} removed)`
          );
          for (const failure of failures.slice(0, 10)) console.log(`    ${failure}`);
        }
      );
    },

    async refresh(_positional, flags) {
      const plan = await resolvePlan(flags.plan);
      const { rootPath, label } = await resolveTarget(flags);
      const indexDir = planIndexDir(plan.id, rootPath);
      const timeline = createTimeline('index refresh');
      const { stats } = await plan.refresh({ rootPath, indexDir, timeline, options: flags });
      console.log(`index refresh  plan=${plan.id}  target=${label}`);
      printTimeline(timeline.report(), flags);
      console.log(`  stats ${JSON.stringify(stats)}`);
    },

    async drop(_positional, flags) {
      const plan = await resolvePlan(flags.plan);
      const { rootPath, label } = await resolveTarget(flags);
      const indexDir = planIndexDir(plan.id, rootPath);
      await plan.drop({ indexDir });
      const after = await plan.status({ rootPath, indexDir });
      console.log(
        `dropped the whole ${plan.id} index for ${label}` +
          `  (status.exists=${after.exists === true})`
      );
      console.log(`  ${indexDir}`);
    }
  },

  async search(positional, flags) {
    const query = positional[0];
    if (!query) throw new TypeError('search needs a query, e.g. yarn indexing search "needle"');
    const plan = await resolvePlan(flags.plan);
    const { rootPath, label } = await resolveTarget(flags);
    const section = flags.section ?? 'all';
    const limit = Number(flags.limit ?? 50);
    const repeat = Number(flags.repeat ?? 0);
    await withLoadedPlan({ plan, rootPath, flags }, async ({ loaded, timeline }) => {
      const loadReport = timeline.report();
      const scope = flags.dir ? directoryScope(flags.dir) : PROJECT_SCOPE;
      const samples = [];
      let outcome;
      for (let attempt = 0; attempt <= repeat; attempt += 1) {
        const startedAt = performance.now();
        outcome = await loaded.handle.search(query, searchOptions(flags, scope));
        samples.push(performance.now() - startedAt);
      }
      if (flags.json) {
        console.log(
          JSON.stringify(
            { plan: plan.id, label, query, scope, loadReport, samples, outcome },
            null,
            2
          )
        );
        return;
      }
      console.log(
        `search  plan=${plan.id}  target=${label}  mode=${loaded.handle.mode ?? 'default'}` +
          `  scope=${scope.kind === 'project' ? 'project' : scope.relativePath}`
      );
      console.log(`  load ${ms(loadReport.totalMs)}`);
      if (flags.trace) printTimeline(loadReport, flags);
      console.log(
        `  query first=${ms(samples[0])}` +
          (samples.length > 1
            ? ` p50=${ms(percentile(samples.slice(1), 0.5))} p95=${ms(percentile(samples.slice(1), 0.95))} runs=${samples.length}`
            : '')
      );
      printSearchOutcome(outcome, { section, limit });
    });
  },

  async scope(positional, flags) {
    const query = positional[0];
    if (!query) throw new TypeError('scope needs a query');
    const plan = await resolvePlan(flags.plan);
    const { rootPath, label } = await resolveTarget(flags);
    const repeat = Number(flags.repeat ?? 4);
    await withLoadedPlan({ plan, rootPath, flags }, async ({ loaded }) => {
      const directories = loaded.handle.directories?.() ?? [];
      const targets = [
        { name: '(project)', scope: PROJECT_SCOPE },
        ...directorySamples(directories, rootPath).map((relativePath) => ({
          name: relativePath,
          scope: directoryScope(relativePath)
        }))
      ];
      const rows = [];
      for (const target of targets) {
        const samples = [];
        let outcome;
        for (let attempt = 0; attempt <= repeat; attempt += 1) {
          const startedAt = performance.now();
          outcome = await loaded.handle.search(query, searchOptions(flags, target.scope));
          samples.push(performance.now() - startedAt);
        }
        rows.push({
          name: target.name,
          firstMs: samples[0],
          p50Ms: percentile(samples.slice(1), 0.5) ?? samples[0],
          files: outcome.files.length,
          contents: outcome.contents.length,
          counters: outcome.counters
        });
      }
      if (flags.json) {
        console.log(JSON.stringify({ plan: plan.id, label, query, rows }, null, 2));
        return;
      }
      const baseline = rows[0].p50Ms;
      console.log(
        `scope comparison  plan=${plan.id}  target=${label}  query=${JSON.stringify(query)}`
      );
      console.log(`  ${'scope'.padEnd(34)} ${'p50'.padStart(9)} ${'speedup'.padStart(8)}  hits`);
      for (const row of rows) {
        console.log(
          `  ${row.name.padEnd(34)} ${ms(row.p50Ms).padStart(9)} ${(baseline / row.p50Ms)
            .toFixed(2)
            .padStart(7)}x  ${row.files}/${row.contents}`
        );
      }
      console.log(
        '  speedup > 1 means the directory-scoped query is faster than the project-wide one.'
      );
    });
  },

  async repl(_positional, flags) {
    const plan = await resolvePlan(flags.plan);
    const { rootPath, label } = await resolveTarget(flags);
    await withLoadedPlan({ plan, rootPath, flags }, async ({ loaded, timeline }) => {
      console.log(
        `loaded plan ${plan.id} for ${label} in ${ms(timeline.report().totalMs)}` +
          ` (mode=${loaded.handle.mode ?? 'default'})`
      );
      console.log(
        'type a query, or /dir <relativePath>, /global, /limit N, /section files|contents|all, /dirs, /stats, /quit'
      );
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      let scope = PROJECT_SCOPE;
      let section = flags.section ?? 'all';
      let limit = Number(flags.limit ?? 20);
      try {
        while (true) {
          const prompt = `${plan.id} ${scope.kind === 'project' ? '/' : scope.relativePath}> `;
          const line = (await readline.question(prompt)).trim();
          if (!line) continue;
          if (line === '/quit' || line === '/exit') break;
          if (line === '/global') {
            scope = PROJECT_SCOPE;
            continue;
          }
          if (line.startsWith('/dir ')) {
            scope = directoryScope(line.slice(5).trim());
            continue;
          }
          if (line.startsWith('/limit ')) {
            limit = Number(line.slice(7).trim()) || limit;
            continue;
          }
          if (line.startsWith('/section ')) {
            section = line.slice(9).trim();
            continue;
          }
          if (line === '/dirs') {
            const directories = loaded.handle.directories?.() ?? [];
            console.log(`  ${directories.length} directories; first 20:`);
            for (const directory of directories.slice(0, 20)) console.log(`    ${directory}`);
            continue;
          }
          if (line === '/stats') {
            console.log(`  ${JSON.stringify(loaded.stats)}`);
            continue;
          }
          const startedAt = performance.now();
          try {
            const outcome = await loaded.handle.search(line, {
              scope,
              sections: sectionsFor(section),
              maxResults: limit,
              requestId: `repl-${Date.now().toString(36)}`
            });
            console.log(`  ${ms(performance.now() - startedAt)}`);
            printSearchOutcome(outcome, { section, limit });
          } catch (error) {
            console.log(`  failed after ${ms(performance.now() - startedAt)}: ${error.message}`);
          }
        }
      } finally {
        readline.close();
      }
    });
  }
};

const main = async () => {
  const { positional, flags } = parseArgv(process.argv.slice(2));
  const [commandName, ...rest] = positional;
  if (!commandName || flags.help) {
    console.log(USAGE.trim());
    return;
  }
  const command = commands[commandName];
  if (!command)
    throw new TypeError(`Unknown command ${commandName}. Run without arguments for help.`);
  if (typeof command === 'function') {
    await command(rest, flags);
    return;
  }
  const [subName, ...subRest] = rest;
  const sub = subName ? command[subName] : undefined;
  if (!sub) {
    throw new TypeError(`Command ${commandName} needs one of: ${Object.keys(command).join(', ')}`);
  }
  await sub(subRest, flags);
};

await main();
