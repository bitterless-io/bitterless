/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  CORPUS_SCALES,
  UNIQUE_NEEDLE,
  createIndexingCorpus,
  createPrivateCorpusCopy,
  removeCorpusFiles
} from '../corpus.mjs';
import {
  PROJECT_SCOPE,
  createChangeSet,
  createTimeline,
  prepareIndexDir
} from '../plans/planContract.mjs';
import { loadPlans } from '../plans/registry.mjs';
import { formatEngineFingerprint, readEngineFingerprint } from '../engineFingerprint.mjs';
import {
  createGateRecorder,
  runCompletenessGates,
  runDirectoryChangeGates,
  runDriftGate,
  runEditGates,
  runNewFileGates,
  runNewFileInKnownDirectoryGates,
  runRevertGates,
  runScopeGates,
  runTruncationGates
} from './lifecycleGates.mjs';

const parseArguments = (argv) => {
  const options = {
    plans: ['A', 'B', 'C', 'D'],
    scale: 'small',
    sizes: [1, 8, 64, 512, 600],
    removals: 32,
    reclaim: false,
    copy: undefined,
    json: undefined
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[(index += 1)];
    if (argument === '--plans') options.plans = next().split(',').filter(Boolean);
    else if (argument === '--scale') options.scale = next();
    else if (argument === '--sizes') options.sizes = next().split(',').map(Number).filter(Boolean);
    else if (argument === '--removals') options.removals = Number(next());
    else if (argument === '--reclaim') options.reclaim = true;
    else if (argument === '--copy') options.copy = next();
    else if (argument === '--json') options.json = next();
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  if (!CORPUS_SCALES[options.scale]) throw new TypeError(`Unknown scale: ${options.scale}`);
  return options;
};

const ms = (value) =>
  value === undefined || value === null
    ? '-'
    : value >= 1000
      ? `${(value / 1000).toFixed(2)}s`
      : `${value.toFixed(value < 10 ? 2 : 1)}`;

const mib = (value) => (value === undefined ? '-' : (value / 1024 ** 2).toFixed(2));

const timed = async (run) => {
  const startedAt = performance.now();
  const value = await run();
  return { ms: performance.now() - startedAt, value };
};

const runPlan = async ({ plan, corpus, options, mutatingGates }) => {
  const rootPath = corpus.rootPath;
  const { gates, gate } = createGateRecorder();
  const record = {
    plan: plan.id,
    name: plan.name,
    capabilities: plan.capabilities,
    steps: [],
    gates
  };
  const step = (name, milliseconds, detail, bytes) =>
    record.steps.push({ step: name, ms: milliseconds, detail, bytes });

  const indexDir = await prepareIndexDir({ planId: plan.id, rootPath, fresh: true });
  const init = await timed(
    async () => await plan.init({ rootPath, indexDir, timeline: createTimeline('init') })
  );
  const statusAfterInit = await plan.status({ rootPath, indexDir });
  step('init', init.ms, init.value.stats, statusAfterInit.bytes);
  gate('init produces a complete index', statusAfterInit.complete !== false, {
    complete: statusAfterInit.complete
  });

  const loaded = await timed(
    async () => await plan.load({ rootPath, indexDir, timeline: createTimeline('load') })
  );
  const handle = loaded.value.handle;
  step('load', loaded.ms, loaded.value.stats);

  const applyChange = async (paths, label) => {
    const applied = await timed(async () => await handle.apply(createChangeSet({ paths })));
    step(label, applied.ms, applied.value);
    return applied.value;
  };

  try {
    const baseline = await timed(
      async () =>
        await handle.search(UNIQUE_NEEDLE, {
          scope: PROJECT_SCOPE,
          sections: ['files', 'contents'],
          maxResults: 50,
          requestId: 'lifecycle-baseline'
        })
    );
    gate(
      'baseline query finds the planted needle exactly once',
      baseline.value.contents.length === 1,
      {
        contents: baseline.value.contents.length
      }
    );
    step('query baseline', baseline.ms);

    await runScopeGates({ handle, gate });
    await runTruncationGates({ handle, gate });
    await runDriftGate({ handle, corpus, gate, label: 'init' });

    if (!handle.apply) {
      step('apply', undefined, 'not supported by this plan');
    } else {
      for (const size of options.sizes) {
        if (size > corpus.dirtyCandidates.length) {
          step(
            `apply edit x${size}`,
            undefined,
            `corpus offers only ${corpus.dirtyCandidates.length} editable candidates`
          );
          continue;
        }
        await runEditGates({ handle, corpus, size, gate, applyChange });
        await runRevertGates({
          handle,
          corpus,
          paths: corpus.dirtyCandidates.slice(0, size),
          gate,
          applyChange
        });
        await runDriftGate({ handle, corpus, gate, label: `edit/revert x${size}` });
      }

      if (mutatingGates) {
        await runNewFileInKnownDirectoryGates({ handle, corpus, gate, applyChange });
        await runDriftGate({ handle, corpus, gate, label: 'new file in a known directory' });
        await runNewFileGates({ handle, corpus, gate, applyChange });
        await runDriftGate({ handle, corpus, gate, label: 'new file in a new directory' });
        await runDirectoryChangeGates({ handle, corpus, gate, applyChange });
        await runDriftGate({ handle, corpus, gate, label: 'directory change' });
      }

      if (options.removals > 0) {
        const removed = await removeCorpusFiles(corpus, options.removals);
        const probePath = removed.removedPaths[0];
        try {
          await applyChange(removed.removedPaths, `apply removal x${removed.removedPaths.length}`);
          const stale = probePath
            ? await handle.search(probePath.split('/').at(-1), {
                scope: PROJECT_SCOPE,
                sections: ['files', 'contents'],
                maxResults: 250,
                requestId: 'lifecycle-removed'
              })
            : undefined;
          gate(
            `removal x${removed.removedPaths.length} leaves no stale row`,
            stale === undefined ||
              ![...stale.files, ...stale.contents].some((row) => row.relativePath === probePath),
            { probePath }
          );
        } finally {
          await removed.restore();
        }
        await applyChange(removed.removedPaths, `apply restore x${removed.removedPaths.length}`);
        const back = probePath
          ? await handle.search(probePath.split('/').at(-1), {
              scope: PROJECT_SCOPE,
              sections: ['files', 'contents'],
              maxResults: 250,
              requestId: 'lifecycle-restored'
            })
          : undefined;
        gate(
          'restoring a removed file re-indexes it',
          back !== undefined &&
            [...back.files, ...back.contents].some((row) => row.relativePath === probePath),
          { probePath }
        );
        await runDriftGate({ handle, corpus, gate, label: 'removal/restore' });
      }
    }
  } finally {
    await handle.close();
  }

  const refreshed = await timed(
    async () => await plan.refresh({ rootPath, indexDir, timeline: createTimeline('refresh') })
  );
  const statusAfterRefresh = await plan.status({ rootPath, indexDir });
  step('refresh (nothing changed)', refreshed.ms, refreshed.value.stats, statusAfterRefresh.bytes);

  await runCompletenessGates({ plan, rootPath, indexDir, gate });

  if (options.reclaim) {
    const removed = await removeCorpusFiles(corpus, corpus.dirtyCandidates.length);
    try {
      const applied = await timed(
        async () => await plan.refresh({ rootPath, indexDir, timeline: createTimeline('reclaim') })
      );
      const statusAfterRemoval = await plan.status({ rootPath, indexDir });
      step(
        `reclaim: refresh after removing ${removed.removedPaths.length} files`,
        applied.ms,
        {
          bytesBefore: statusAfterRefresh.bytes,
          bytesAfter: statusAfterRemoval.bytes,
          reclaimedRatio:
            statusAfterRefresh.bytes > 0
              ? Number(
                  (
                    (statusAfterRefresh.bytes - statusAfterRemoval.bytes) /
                    statusAfterRefresh.bytes
                  ).toFixed(3)
                )
              : 0
        },
        statusAfterRemoval.bytes
      );
    } finally {
      await removed.restore();
      await plan.refresh({ rootPath, indexDir, timeline: createTimeline('reclaim-restore') });
    }
  }

  const dropped = await timed(async () => await plan.drop({ indexDir }));
  const statusAfterDrop = await plan.status({ rootPath, indexDir });
  gate('drop removes the whole index', statusAfterDrop.exists !== true, statusAfterDrop);
  step('drop', dropped.ms, { exists: statusAfterDrop.exists });

  return record;
};

const printRecord = (record) => {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`${record.plan}  ${record.name}`);
  console.log(
    `  incrementalApply=${record.capabilities.incrementalApply}` +
      ` maxChangePaths=${record.capabilities.maxChangePaths ?? 'unbounded'}` +
      ` entryRemoval=${record.capabilities.entryRemoval}`
  );
  console.log(`\n  ${'step'.padEnd(34)} ${'ms'.padStart(9)} ${'index'.padStart(8)}  detail`);
  for (const step of record.steps) {
    const detail =
      typeof step.detail === 'string'
        ? step.detail
        : step.detail
          ? JSON.stringify(step.detail)
          : '';
    console.log(
      `  ${step.step.padEnd(34)} ${ms(step.ms).padStart(9)}` +
        ` ${(step.bytes === undefined ? '-' : `${mib(step.bytes)}MiB`).padStart(8)}  ${detail.slice(0, 140)}`
    );
  }
  const failed = record.gates.filter((entry) => !entry.passed);
  const skipped = record.gates.filter((entry) => entry.detail?.skipped === true);
  console.log(
    `\n  correctness gates: ${record.gates.length - failed.length}/${record.gates.length} passed` +
      (skipped.length > 0 ? `, ${skipped.length} skipped` : '')
  );
  for (const entry of failed) {
    console.log(`    FAIL ${entry.name}`);
    if (entry.detail !== undefined) {
      console.log(`         ${JSON.stringify(entry.detail).slice(0, 320)}`);
    }
  }
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const engine = await readEngineFingerprint();
  console.log(formatEngineFingerprint(engine));
  const plans = await loadPlans();
  // Two of the gate groups create and delete files inside the corpus, so they only run against a
  // private clone. On the shared corpus they are skipped rather than silently corrupting it.
  const corpus = options.copy
    ? await createPrivateCorpusCopy(options.scale, options.copy)
    : await createIndexingCorpus(options.scale);
  const mutatingGates = Boolean(options.copy);
  console.log(
    `node ${process.version} ${process.platform}/${process.arch}  scale=${options.scale}` +
      (options.copy ? `  copy=${options.copy}` : '  (shared corpus)') +
      `  files=${corpus.fileCount}  editable=${corpus.dirtyCandidates.length}` +
      `  sizes=${options.sizes.join(',')}  removals=${options.removals}` +
      `  mutatingGates=${mutatingGates}`
  );
  if (!mutatingGates) {
    console.log(
      '  note: pass --copy <label> to enable the new-file and directory-removal gates, which write' +
        ' into the corpus.'
    );
  }
  const records = [];
  for (const planId of options.plans) {
    const plan = plans.get(planId.toUpperCase());
    if (!plan) {
      console.log(`skipping ${planId}: not implemented`);
      continue;
    }
    const record = await runPlan({ plan, corpus, options, mutatingGates });
    printRecord(record);
    records.push(record);
  }
  const failures = records.flatMap((record) =>
    record.gates.filter((entry) => !entry.passed).map((entry) => `${record.plan}: ${entry.name}`)
  );
  console.log(`\n${'='.repeat(100)}`);
  console.log(failures.length === 0 ? 'all correctness gates passed' : 'GATE FAILURES:');
  for (const failure of failures) console.log(`  ${failure}`);
  console.log(
    '\nnote: the final lifecycle step drops each plan index. Run "index init" before using the CLI.'
  );
  if (options.json) {
    const target = resolve(options.json);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ engine, records }, null, 2)}\n`);
    console.log(`wrote ${target}`);
  }
};

await main();
