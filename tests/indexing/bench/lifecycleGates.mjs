/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadOnlyPreviewWorkspaceConfig } from '../../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { COMMON_NEEDLE, UNIQUE_NEEDLE, dirtyCorpusFiles, dirtyTokenFor } from '../corpus.mjs';
import {
  PROJECT_SCOPE,
  SECTION_RESULT_CAP,
  createTimeline,
  directoryScope
} from '../plans/planContract.mjs';
import { createTraversalPolicy, walkWorkspace } from '../plans/walker.mjs';

/**
 * A gate battery is only worth its count if it fails when the plan is broken. An independent review
 * mutation-tested the first version of these gates - replacing `handle.apply` with a no-op still
 * passed six of seven - so every gate here is paired with the mutant it is meant to kill.
 */
export const createGateRecorder = () => {
  const gates = [];
  return {
    gates,
    gate: (name, passed, detail) => {
      gates.push({ name, passed: passed === true, detail });
      return passed === true;
    }
  };
};

const search = async (handle, { query, scope = PROJECT_SCOPE, sections, maxResults = 250 }) =>
  await handle.search(query, {
    scope,
    sections: sections ?? ['files', 'contents'],
    maxResults,
    requestId: `gate-${Math.trunc(performance.now())}-${query.slice(0, 8)}`
  });

const hasPath = (outcome, relativePath) =>
  [...outcome.files, ...outcome.contents].some((row) => row.relativePath === relativePath);

/**
 * A plan that reads candidate files when the query arrives is always fresh, so "the edit must not be
 * visible before apply" is not a defect for it - it is the whole premise. The distinction is read off
 * the answer itself rather than assumed from the plan id.
 */
const servedByScan = (outcome) =>
  String(outcome.engine ?? '').includes('scan') ||
  String(outcome.counters?.servedBy ?? '').includes('scan');

const throws = async (run) => {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
};

/**
 * Kills the no-op mutant: an edit is only proof that apply worked if the token was NOT findable
 * before apply ran. Without the negative half, an index that happened to be fresh passes.
 */
export const runEditGates = async ({ handle, corpus, size, gate, applyChange }) => {
  const dirty = await dirtyCorpusFiles(corpus, size);
  const probePath = dirty.changedPaths.at(-1);
  const token = dirtyTokenFor(probePath);
  try {
    const before = await search(handle, { query: token, sections: ['contents'] });
    if (servedByScan(before)) {
      gate(
        `edit x${size}: token absent before apply (not applicable: answered by a live scan)`,
        true,
        { skipped: true, servedBy: before.counters?.servedBy ?? before.engine }
      );
    } else {
      // Without this negative half an index that happened to be fresh passes, which is how a no-op
      // apply survived the first version of these gates.
      gate(`edit x${size}: token is absent before apply`, before.contents.length === 0, {
        probePath,
        found: before.contents.length
      });
    }
    const applied = await applyChange(dirty.changedPaths, `apply edit x${size}`);
    const after = await search(handle, { query: token, sections: ['contents'] });
    gate(
      `edit x${size}: token is findable in exactly the edited file after apply`,
      after.contents.length === 1 && after.contents[0].relativePath === probePath,
      { probePath, matches: after.contents.map((row) => row.relativePath) }
    );
    return applied;
  } finally {
    await dirty.restore();
  }
};

export const runRevertGates = async ({ handle, corpus, paths, gate, applyChange }) => {
  const probePath = paths.at(-1);
  const token = dirtyTokenFor(probePath);
  const applied = await applyChange(paths, `apply revert x${paths.length}`);
  const after = await search(handle, { query: token, sections: ['contents'] });
  gate(`revert x${paths.length}: stale content is gone`, after.contents.length === 0, {
    probePath,
    matches: after.contents.map((row) => row.relativePath)
  });
  void corpus;
  return applied;
};

/**
 * The case plan D's apply is load-bearing for and the first gate battery never touched: a file in a
 * directory the index has never seen. It must become findable AND its directory must become a legal
 * scope, because an unknown directory makes `requirePlanScope` reject every query under it.
 */
export const runNewFileGates = async ({ handle, corpus, gate, applyChange }) => {
  const directoryPath = 'gate-brand-new/deeper';
  const relativePath = `${directoryPath}/introduced.ts`;
  const token = 'gate-token-introduced-file';
  const absolutePath = join(corpus.rootPath, ...relativePath.split('/'));
  await mkdir(join(corpus.rootPath, ...directoryPath.split('/')), { recursive: true });
  await writeFile(absolutePath, `export const introduced = '${token}';\n`);
  try {
    const applied = await applyChange([relativePath], 'apply new file');
    const found = await search(handle, { query: token, sections: ['contents'] });
    gate(
      'new file in a never-seen directory becomes findable',
      found.contents.some((row) => row.relativePath === relativePath),
      { relativePath, matches: found.contents.map((row) => row.relativePath), applied }
    );
    const scoped = await throws(
      async () =>
        await search(handle, {
          query: token,
          scope: directoryScope(directoryPath),
          sections: ['contents']
        })
    );
    gate('the new directory is a legal search scope', !scoped, { directoryPath });
    if (!scoped) {
      const inScope = await search(handle, {
        query: token,
        scope: directoryScope(directoryPath),
        sections: ['contents']
      });
      gate(
        'the new file is findable under its own directory scope',
        inScope.contents.some((row) => row.relativePath === relativePath),
        { directoryPath, matches: inScope.contents.map((row) => row.relativePath) }
      );
    }
  } finally {
    await rm(join(corpus.rootPath, 'gate-brand-new'), { recursive: true, force: true });
  }
  await applyChange([relativePath], 'apply new-file removal');
  const afterRemoval = await search(handle, { query: token, sections: ['files', 'contents'] });
  gate('removing the new file removes it from the index', !hasPath(afterRemoval, relativePath), {
    relativePath
  });
};

/**
 * The common editing action, separated from the rare one: a file added to a directory the index
 * already knows. The shipped engine's escalation test is about the shape of the tree, not about
 * novelty, so this case should stay incremental where a brand-new directory does not - but that is a
 * claim about behaviour, so it gets its own gate and its own timing rather than an assumption.
 */
export const runNewFileInKnownDirectoryGates = async ({ handle, corpus, gate, applyChange }) => {
  const directories = handle.directories?.() ?? [];
  const directoryPath = directories.find((value) => value && !value.startsWith('gate-'));
  if (!directoryPath) {
    gate('new file in a known directory (skipped: no directory available)', true, {
      skipped: true
    });
    return;
  }
  const relativePath = `${directoryPath}/gate-introduced-known.ts`;
  const token = 'gate-token-known-directory-file';
  const absolutePath = join(corpus.rootPath, ...relativePath.split('/'));
  await writeFile(absolutePath, `export const introducedKnown = '${token}';\n`);
  try {
    const applied = await applyChange([relativePath], 'apply new file (known directory)');
    const found = await search(handle, { query: token, sections: ['contents'] });
    gate(
      'a new file in a directory the index already knows becomes findable',
      found.contents.some((row) => row.relativePath === relativePath),
      { relativePath, applied, matches: found.contents.map((row) => row.relativePath) }
    );
  } finally {
    await rm(absolutePath, { force: true });
  }
  await applyChange([relativePath], 'apply new-file removal (known directory)');
  const afterRemoval = await search(handle, { query: token, sections: ['files', 'contents'] });
  gate('removing that file removes it from the index', !hasPath(afterRemoval, relativePath), {
    relativePath
  });
};

/**
 * A watcher reports a path, not a kind. When that path is a directory that has just been deleted,
 * every row beneath it has to go. The shipped engine escalates to a full reconcile for exactly this
 * case; a plan that only looks at the path itself leaves the whole subtree indexed and keeps reading
 * dead files on every query.
 */
export const runDirectoryChangeGates = async ({ handle, corpus, gate, applyChange }) => {
  const directoryPath = 'gate-doomed-tree';
  const inner = `${directoryPath}/inner`;
  const files = [`${inner}/alpha.ts`, `${directoryPath}/beta.ts`];
  const token = 'gate-token-doomed-subtree';
  await mkdir(join(corpus.rootPath, ...inner.split('/')), { recursive: true });
  for (const relativePath of files) {
    await writeFile(
      join(corpus.rootPath, ...relativePath.split('/')),
      `export const doomed = '${token}';\n`
    );
  }

  // A watcher on macOS routinely reports the containing directory rather than each new file, so a
  // change path that is an existing directory has to pull in what is underneath it. The shipped
  // engine escalates to a full reconcile for exactly this case.
  const seededByDirectory = await applyChange([directoryPath], 'apply directory add');
  const seeded = await search(handle, { query: token, sections: ['contents'] });
  gate(
    'new files reported only as their containing directory get indexed',
    seeded.contents.length === files.length,
    {
      directoryPath,
      applied: seededByDirectory,
      matches: seeded.contents.map((row) => row.relativePath)
    }
  );
  if (seeded.contents.length !== files.length) {
    await applyChange(files, 'apply directory add (repair by file path)');
  }

  await rm(join(corpus.rootPath, directoryPath), { recursive: true, force: true });
  const applied = await applyChange([directoryPath], 'apply directory removal');
  const byContent = await search(handle, { query: token, sections: ['files', 'contents'] });
  gate(
    'deleting a directory, reported as the directory path, removes its content rows',
    byContent.contents.length === 0,
    { directoryPath, applied, remaining: byContent.contents.map((row) => row.relativePath) }
  );
  // Checked by name too: a scan-served plan finds no content simply because the bytes are gone, so a
  // content-only check cannot tell a cleaned index from one still carrying dead rows.
  const byName = await search(handle, { query: 'alpha.ts', sections: ['files', 'contents'] });
  gate(
    'deleting a directory removes the name rows beneath it',
    !byName.files.some((row) => row.relativePath === files[0]) &&
      !byName.contents.some((row) => row.relativePath === files[0]),
    { probePath: files[0], matches: byName.files.map((row) => row.relativePath) }
  );
  const rejected = await throws(
    async () =>
      await search(handle, {
        query: token,
        scope: directoryScope(directoryPath),
        sections: ['contents']
      })
  );
  gate('the deleted directory is no longer a legal search scope', rejected, { directoryPath });
};

export const runScopeGates = async ({ handle, gate }) => {
  const directories = handle.directories?.() ?? [];
  const existing = directories.find((value) => value.includes('/')) ?? directories[0];
  for (const malformed of [
    `${existing}/`,
    `./${existing}`,
    `/${existing}`,
    `${existing}/.`,
    'gate-does-not-exist'
  ]) {
    if (!existing) break;
    const rejected = await throws(
      async () =>
        await search(handle, {
          query: COMMON_NEEDLE,
          scope: directoryScope(malformed),
          sections: ['contents']
        })
    );
    gate(`scope ${JSON.stringify(malformed)} is rejected, not answered with zero`, rejected);
  }
  if (existing) {
    const accepted = await throws(
      async () =>
        await search(handle, {
          query: COMMON_NEEDLE,
          scope: directoryScope(existing),
          sections: ['contents']
        })
    );
    gate(`a real directory scope is accepted (${existing})`, !accepted);
  }
};

export const runTruncationGates = async ({ handle, gate }) => {
  const capped = await search(handle, {
    query: COMMON_NEEDLE,
    sections: ['contents'],
    maxResults: 3
  });
  gate('a capped answer reports truncated', capped.truncated.contents === true, {
    returned: capped.contents.length
  });
  const complete = await search(handle, {
    query: COMMON_NEEDLE,
    sections: ['contents'],
    maxResults: SECTION_RESULT_CAP
  });
  gate(
    'a complete answer does not report truncated',
    complete.contents.length < SECTION_RESULT_CAP ? complete.truncated.contents === false : true,
    { returned: complete.contents.length }
  );
  const single = await search(handle, {
    query: UNIQUE_NEEDLE,
    sections: ['contents'],
    maxResults: 1
  });
  gate(
    'a single-match answer at cap 1 does not report truncated',
    single.contents.length === 1 && single.truncated.contents === false,
    { returned: single.contents.length, truncated: single.truncated.contents }
  );
};

/**
 * The strongest single gate: compare the plan's own view of what it has indexed against a fresh walk
 * of the workspace. Requires the optional `handle.indexedFiles()`; skipped, and reported as skipped,
 * when a plan does not expose it.
 */
export const runDriftGate = async ({ handle, corpus, gate, label }) => {
  if (typeof handle.indexedFiles !== 'function') {
    gate(`drift oracle after ${label} (skipped: handle.indexedFiles absent)`, true, {
      skipped: true
    });
    return;
  }
  const policy = createTraversalPolicy(await loadOnlyPreviewWorkspaceConfig(corpus.rootPath));
  const truth = new Set();
  await walkWorkspace({
    rootPath: corpus.rootPath,
    policy,
    onFile: (file) => truth.add(file.relativePath)
  });
  const indexed = new Set(await handle.indexedFiles());
  const missing = [...truth].filter((value) => !indexed.has(value));
  const stale = [...indexed].filter((value) => !truth.has(value));
  gate(`drift oracle after ${label}`, missing.length === 0 && stale.length === 0, {
    truth: truth.size,
    indexed: indexed.size,
    missing: missing.slice(0, 5),
    stale: stale.slice(0, 5)
  });
};

/**
 * An interrupted build must be distinguishable from a complete one. Performed on a copy so the live
 * index survives.
 */
export const runCompletenessGates = async ({ plan, rootPath, indexDir, gate }) => {
  const copyDir = `${indexDir}-completeness-probe`;
  await rm(copyDir, { recursive: true, force: true });
  await cp(indexDir, copyDir, { recursive: true });
  try {
    await rm(join(copyDir, 'plan-meta.json'), { force: true });
    const status = await plan.status({ rootPath, indexDir: copyDir });
    gate(
      'status reports an index without its completeness marker as incomplete',
      status.complete === false,
      {
        status: { exists: status.exists, complete: status.complete }
      }
    );
    // A plan whose load rebuilds from the filesystem cannot return half a workspace, so refusing is
    // only required of a plan whose load is a genuine open.
    if (plan.capabilities.separateLoad !== true) {
      gate('load refuses an index without its completeness marker (skipped: load rebuilds)', true, {
        skipped: true
      });
      return;
    }
    const refused = await throws(async () => {
      const loaded = await plan.load({
        rootPath,
        indexDir: copyDir,
        timeline: createTimeline('completeness-probe')
      });
      await loaded.handle.close();
    });
    gate('load refuses an index without its completeness marker', refused);
  } finally {
    await rm(copyDir, { recursive: true, force: true });
  }
};

export const corpusIsPristine = async (corpus) => {
  const entries = await readdir(corpus.rootPath, { withFileTypes: true }).catch(() => []);
  return !entries.some((entry) => entry.name.startsWith('gate-'));
};
