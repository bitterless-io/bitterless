import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-filter-'));

const thread = (threadId, project, domainId = 1) => ({
  threadId,
  domainId,
  title: threadId,
  cwd: null,
  projectKey: project?.key ?? null,
  projectRoot: project?.root ?? null,
  projectName: project?.name ?? null,
  runtimeState: 'idle',
  activeFlags: [],
  activeTurnId: null,
  lastCompletedTurnId: null,
  lastCompletedAt: null,
  lastOpenedTurnId: null,
  lastOpenedAt: null,
  statusSource: 'discovery',
  statusObservedAt: null,
  lastActivityAt: null,
  isUnread: false,
  isFocused: false,
});

try {
  const outfile = join(buildRoot, 'project-filter.mjs');
  await build({
    entryPoints: [join(projectRoot, 'src/renderer/eyesOnAgents/src/services/projectFilter.service.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.web.json'),
  });
  const filter = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  const threads = [
    thread('plain', null, 1),
    thread('overmind-1', { key: '/work/overmind', root: '/work/overmind', name: 'overmind' }, 2),
    thread('overmind-2', { key: '/work/overmind', root: '/work/overmind', name: 'overmind' }, 3),
    thread('same-a', { key: '/a/app', root: '/a/app', name: 'app' }, 2),
    thread('same-b', { key: '/b/app', root: '/b/app', name: 'app' }, 4),
  ];

  let options = filter.buildEyesOnAgentsProjectFilterOptions(threads, { type: 'all' });
  assert.equal(options[0].count, 5);
  assert.equal(options[1].count, 1);
  assert.equal(options.find((option) => option.projectKey === '/work/overmind').count, 2);
  const duplicateNames = options.filter((option) => option.projectName === 'app');
  assert.equal(duplicateNames.length, 2);
  assert.ok(duplicateNames.every((option) => option.duplicateName && option.shortRoot));
  assert.deepEqual(
    filter.filterEyesOnAgentsThreadsByProject(threads, { type: 'all' }).map((item) => item.threadId),
    threads.map((item) => item.threadId),
  );
  assert.deepEqual(
    filter.filterEyesOnAgentsThreadsByProject(threads, { type: 'none' }).map((item) => item.threadId),
    ['plain'],
  );
  assert.deepEqual(
    filter.filterEyesOnAgentsThreadsByProject(threads, {
      type: 'project',
      projectKey: '/work/overmind',
      projectRoot: '/work/overmind',
      projectName: 'overmind',
    }).map((item) => item.threadId),
    ['overmind-1', 'overmind-2'],
  );

  const selectedMissing = {
    type: 'project',
    projectKey: '/gone/project',
    projectRoot: '/gone/project',
    projectName: 'project',
  };
  options = filter.buildEyesOnAgentsProjectFilterOptions(threads, selectedMissing);
  assert.equal(options.find((option) => option.projectKey === '/gone/project').count, 0);
  assert.deepEqual(filter.filterEyesOnAgentsThreadsByProject(threads, selectedMissing), []);
  console.log('EyesOnAgents Project filter tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
