/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { CORPUS_SCALES, createIndexingCorpus, dirtyCorpusFiles } from '../corpus.mjs';
import {
  PROJECT_SCOPE,
  createTimeline,
  directoryScope,
  percentile,
  planIndexDir,
  prepareIndexDir
} from '../plans/planContract.mjs';
import { loadPlans } from '../plans/registry.mjs';
import { formatEngineFingerprint, readEngineFingerprint } from '../engineFingerprint.mjs';
import { QUERY_SET } from './queries.mjs';
import { compareOutcome, expectedFilesDivergence, summarizeParity } from './parity.mjs';
import { pickScopeSamples } from './scopeSamples.mjs';

const DEFAULT_VARIANTS = ['A', 'A:seed', 'B', 'C', 'C:all', 'D'];

const parseArguments = (argv) => {
  const options = {
    variants: DEFAULT_VARIANTS,
    scales: ['small'],
    repeat: 6,
    dirty: 64,
    maxResults: 250,
    json: undefined,
    skipInit: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[(index += 1)];
    if (argument === '--plans') options.variants = next().split(',').filter(Boolean);
    else if (argument === '--scales') options.scales = next().split(',').filter(Boolean);
    else if (argument === '--repeat') options.repeat = Number(next());
    else if (argument === '--dirty') options.dirty = Number(next());
    else if (argument === '--limit') options.maxResults = Number(next());
    else if (argument === '--json') options.json = next();
    else if (argument === '--skip-init') options.skipInit = true;
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  for (const scale of options.scales) {
    if (!CORPUS_SCALES[scale]) throw new TypeError(`Unknown scale: ${scale}`);
  }
  return options;
};

const parseVariant = (token) => {
  const [planToken, mode] = token.split(':');
  const planId = planToken.toUpperCase();
  const variant = {
    key: token,
    planId,
    mode,
    initOptions: {},
    loadOptions: {},
    sharesIndexWith: undefined,
    label: token
  };
  if (planId === 'A' && mode === 'seed') {
    variant.loadOptions.reconcile = false;
    variant.sharesIndexWith = 'A';
    variant.label = 'A(seed-only load)';
  }
  if (mode === 'all') {
    variant.initOptions.content = 'all';
    variant.label = `${planId}(content=all)`;
  }
  if (mode && /^pool\d+$/u.test(mode)) {
    variant.loadOptions.poolSize = Number(mode.slice(4));
    variant.label = `${planId}(pool=${variant.loadOptions.poolSize})`;
  }
  return variant;
};

const ms = (value) =>
  value === undefined || value === null
    ? '-'
    : value >= 1000
      ? `${(value / 1000).toFixed(2)}s`
      : `${value.toFixed(value < 10 ? 2 : 1)}`;

const mib = (value) => (value === undefined ? '-' : `${(value / 1024 ** 2).toFixed(1)}`);

const createRssSampler = () => {
  let peak = process.memoryUsage.rss();
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 25);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      return Math.max(peak, process.memoryUsage.rss());
    }
  };
};

const settle = async () => {
  globalThis.gc?.();
  await new Promise((resolveSettle) => setTimeout(resolveSettle, 250));
};

const timeQuery = async ({ handle, query, scope, sections, maxResults, repeat }) => {
  const samples = [];
  let outcome;
  for (let attempt = 0; attempt <= repeat; attempt += 1) {
    const startedAt = performance.now();
    outcome = await handle.search(query, {
      scope,
      sections,
      maxResults,
      requestId: `bench-${attempt}-${Date.now().toString(36)}`
    });
    samples.push(performance.now() - startedAt);
  }
  const warm = samples.slice(1);
  return {
    firstMs: samples[0],
    p50Ms: percentile(warm, 0.5) ?? samples[0],
    p95Ms: percentile(warm, 0.95) ?? samples[0],
    runs: samples.length,
    files: outcome.files.length,
    contents: outcome.contents.length,
    truncated: outcome.truncated,
    engine: outcome.engine,
    counters: outcome.counters,
    outcome
  };
};

const runVariant = async ({ variant, plan, corpus, scopeTargets, options, reference }) => {
  const rootPath = corpus.rootPath;
  const record = {
    variant: variant.label,
    key: variant.key,
    planId: plan.id,
    capabilities: plan.capabilities,
    init: undefined,
    status: undefined,
    load: undefined,
    queries: [],
    scopeCurve: [],
    refresh: undefined,
    parity: undefined
  };

  if (!variant.sharesIndexWith && !options.skipInit) {
    await settle();
    const indexDir = await prepareIndexDir({ planId: plan.id, rootPath, fresh: true });
    const timeline = createTimeline('init');
    const rss = createRssSampler();
    const { stats } = await plan.init({
      rootPath,
      indexDir,
      timeline,
      options: variant.initOptions
    });
    record.init = {
      totalMs: timeline.report().totalMs,
      spans: timeline.report().spans,
      stats,
      peakRssBytes: rss.stop()
    };
  }

  const indexDir = planIndexDir(plan.id, rootPath);
  record.status = await plan.status({ rootPath, indexDir });

  await settle();
  const loadTimeline = createTimeline('load');
  const loaded = await plan.load({
    rootPath,
    indexDir,
    timeline: loadTimeline,
    options: variant.loadOptions
  });
  record.load = {
    totalMs: loadTimeline.report().totalMs,
    spans: loadTimeline.report().spans,
    stats: loaded.stats,
    mode: loaded.handle.mode ?? 'default'
  };

  const parityRows = [];
  try {
    for (const entry of QUERY_SET) {
      const measurement = await timeQuery({
        handle: loaded.handle,
        query: entry.query,
        scope: PROJECT_SCOPE,
        sections: ['files', 'contents'],
        maxResults: options.maxResults,
        repeat: options.repeat
      });
      const { outcome, ...reported } = measurement;
      record.queries.push({ id: entry.id, branch: entry.branch, scope: 'project', ...reported });
      if (reference) {
        const referenceEntry = reference.byQuery.get(`project|${entry.id}`);
        if (referenceEntry) {
          for (const section of ['files', 'contents']) {
            const expected = expectedFilesDivergence({
              referencePlan: reference.plan,
              candidatePlan: plan,
              scope: PROJECT_SCOPE
            });
            const comparison = compareOutcome({
              reference: referenceEntry.outcome,
              candidate: outcome,
              section,
              truncated: referenceEntry.outcome.truncated[section]
            });
            parityRows.push({
              query: entry.id,
              scope: 'project',
              ...comparison,
              status: expected && section === 'files' ? 'expected' : comparison.status
            });
          }
        }
      } else {
        record.byQuery ??= new Map();
        record.byQuery.set(`project|${entry.id}`, { outcome });
      }
    }

    const curveQueries = ['unique', 'common', 'filename', 'short-ascii'];
    for (const queryId of curveQueries) {
      const entry = QUERY_SET.find((candidate) => candidate.id === queryId);
      const row = { id: entry.id, points: [] };
      for (const target of [{ relativePath: undefined, share: 1 }, ...scopeTargets]) {
        const scope = target.relativePath ? directoryScope(target.relativePath) : PROJECT_SCOPE;
        const measurement = await timeQuery({
          handle: loaded.handle,
          query: entry.query,
          scope,
          sections: ['files', 'contents'],
          maxResults: options.maxResults,
          repeat: options.repeat
        });
        const { outcome, ...reported } = measurement;
        row.points.push({
          scope: target.relativePath ?? '(project)',
          share: target.share,
          textFiles: target.textFiles,
          textBytes: target.textBytes,
          ...reported
        });
        if (reference) {
          const referenceEntry = reference.byQuery.get(
            `${target.relativePath ?? 'project'}|${entry.id}`
          );
          if (referenceEntry) {
            for (const section of ['files', 'contents']) {
              const expected = expectedFilesDivergence({
                referencePlan: reference.plan,
                candidatePlan: plan,
                scope
              });
              const comparison = compareOutcome({
                reference: referenceEntry.outcome,
                candidate: outcome,
                section,
                truncated: referenceEntry.outcome.truncated[section]
              });
              parityRows.push({
                query: entry.id,
                scope: target.relativePath ?? 'project',
                ...comparison,
                status: expected && section === 'files' ? 'expected' : comparison.status
              });
            }
          }
        } else {
          record.byQuery ??= new Map();
          record.byQuery.set(`${target.relativePath ?? 'project'}|${entry.id}`, { outcome });
        }
      }
      record.scopeCurve.push(row);
    }
  } finally {
    await loaded.handle.close();
  }

  if (parityRows.length > 0) record.parity = summarizeParity(parityRows);

  if (options.dirty > 0) {
    const dirty = await dirtyCorpusFiles(corpus, options.dirty);
    try {
      await settle();
      const refreshTimeline = createTimeline('refresh');
      const { stats } = await plan.refresh({
        rootPath,
        indexDir,
        timeline: refreshTimeline,
        options: variant.loadOptions
      });
      record.refresh = {
        changedFiles: dirty.changedPaths.length,
        totalMs: refreshTimeline.report().totalMs,
        spans: refreshTimeline.report().spans,
        stats
      };
    } catch (error) {
      record.refresh = { changedFiles: dirty.changedPaths.length, error: error.message };
    } finally {
      await dirty.restore();
    }
  }

  return record;
};

const printScale = (scaleReport) => {
  const { scale, corpus, scopeTargets, records } = scaleReport;
  console.log(`\n${'='.repeat(96)}`);
  console.log(
    `${scale}: ${corpus.fileCount} files, ${corpus.textFileCount} text, ` +
      `${mib(corpus.textBytes)}MiB text, ${corpus.directoryCount} directories`
  );
  console.log(
    `scope targets: ${scopeTargets
      .map(
        (target) =>
          `${target.relativePath} (${(target.share * 100).toFixed(1)}% of text, ${target.textFiles} files)`
      )
      .join(' | ')}`
  );

  console.log(`\n-- build and load ${'-'.repeat(74)}`);
  console.log(
    `${'plan'.padEnd(20)} ${'init'.padStart(9)} ${'load'.padStart(9)} ${'index'.padStart(8)}` +
      ` ${'initRSS'.padStart(8)} ${'refresh'.padStart(9)}  stats`
  );
  for (const record of records) {
    console.log(
      `${record.variant.padEnd(20)} ${ms(record.init?.totalMs).padStart(9)}` +
        ` ${ms(record.load?.totalMs).padStart(9)}` +
        ` ${mib(record.status?.bytes).padStart(6)}MiB` +
        ` ${mib(record.init?.peakRssBytes).padStart(6)}MiB` +
        ` ${ms(record.refresh?.totalMs).padStart(9)}  ${JSON.stringify(record.load?.stats ?? {})}`
    );
  }

  console.log(`\n-- project-wide query p50 in ms ${'-'.repeat(62)}`);
  const header = QUERY_SET.map((entry) => entry.id.padStart(12)).join('');
  console.log(`${'plan'.padEnd(20)}${header}`);
  for (const record of records) {
    const cells = QUERY_SET.map((entry) => {
      const found = record.queries.find((query) => query.id === entry.id);
      return ms(found?.p50Ms).padStart(12);
    }).join('');
    console.log(`${record.variant.padEnd(20)}${cells}`);
  }
  console.log(`\n   hits (files/contents), project scope`);
  for (const record of records) {
    const cells = QUERY_SET.map((entry) => {
      const found = record.queries.find((query) => query.id === entry.id);
      return `${found?.files ?? '-'}/${found?.contents ?? '-'}`.padStart(12);
    }).join('');
    console.log(`${record.variant.padEnd(20)}${cells}`);
  }

  console.log(`\n-- directory scope speedup (p50 project / p50 scoped) ${'-'.repeat(40)}`);
  for (const record of records) {
    console.log(`  ${record.variant}`);
    for (const row of record.scopeCurve) {
      const baseline = row.points[0]?.p50Ms;
      const cells = row.points
        .map(
          (point) =>
            `${point.scope === '(project)' ? 'project' : `${(point.share * 100).toFixed(0)}%`}=` +
            `${ms(point.p50Ms)}ms/${(baseline / point.p50Ms).toFixed(1)}x`
        )
        .join('  ');
      console.log(`    ${row.id.padEnd(14)} ${cells}`);
    }
  }

  const withParity = records.filter((record) => record.parity);
  if (withParity.length > 0) {
    console.log(`\n-- result parity against plan A ${'-'.repeat(62)}`);
    for (const record of withParity) {
      const { counts, ok, mismatches } = record.parity;
      console.log(
        `  ${record.variant.padEnd(20)} ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(counts)}`
      );
      for (const mismatch of mismatches.slice(0, 6)) {
        console.log(
          `      ${mismatch.query}/${mismatch.scope}/${mismatch.section}: ${mismatch.status}` +
            ` reference=${mismatch.referenceCount} candidate=${mismatch.candidateCount}` +
            ` missing=${JSON.stringify(mismatch.missing ?? [])} extra=${JSON.stringify(mismatch.extra ?? [])}`
        );
      }
    }
  }
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const plans = await loadPlans();
  const variants = options.variants.map(parseVariant).filter((variant) => {
    if (plans.has(variant.planId)) return true;
    console.log(`skipping ${variant.key}: plan ${variant.planId} is not implemented`);
    return false;
  });
  const engine = await readEngineFingerprint();
  console.log(formatEngineFingerprint(engine));
  console.log(
    `node ${process.version} ${process.platform}/${process.arch}  variants=${variants
      .map((variant) => variant.key)
      .join(',')}  repeat=${options.repeat}  maxResults=${options.maxResults}`
  );
  const report = [];
  for (const scale of options.scales) {
    const corpus = await createIndexingCorpus(scale);
    const { samples } = await pickScopeSamples({ rootPath: corpus.rootPath });
    const records = [];
    let reference;
    for (const variant of variants) {
      const plan = plans.get(variant.planId);
      const record = await runVariant({
        variant,
        plan,
        corpus,
        scopeTargets: samples,
        options,
        reference
      });
      if (!reference && record.byQuery) {
        reference = { plan, byQuery: record.byQuery };
      }
      delete record.byQuery;
      records.push(record);
    }
    const scaleReport = {
      scale,
      corpus: { ...corpus, dirtyCandidates: undefined },
      scopeTargets: samples,
      records
    };
    printScale(scaleReport);
    report.push(scaleReport);
  }
  if (options.json) {
    const target = resolve(options.json);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ engine, scales: report }, null, 2)}\n`);
    console.log(`\nwrote ${target}`);
  }
};

await main();
