import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const uuid = '11111111-1111-4111-8111-111111111111';

export const createClaudeDirectoryFixture = async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-directory-'));
  const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-directory-build-'));
  const load = async (name, entry) => {
    const outfile = join(buildRoot, `${name}.mjs`);
    await build({
      entryPoints: [join(projectRoot, entry)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      tsconfig: join(projectRoot, 'tsconfig.node.json')
    });
    return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  };
  const [
    configModule,
    pathModule,
    observationModule,
    bridgeModule,
    watcherHelperModule,
    watcherSupervisorModule
  ] = await Promise.all([
    load('config', 'src/main/eyesOnAgents/claudeDirectoryConfig.service.ts'),
    load('paths', 'src/main/eyesOnAgents/claudePath.resolver.ts'),
    load('observation', 'src/main/eyesOnAgents/claudeObservation.service.ts'),
    load('bridge', 'src/main/eyesOnAgents/claudeInventoryBridge.server.ts'),
    load('watcher-helper', 'src/main/eyesOnAgents/claudeDirectoryWatcher.helper.ts'),
    load('watcher-supervisor', 'src/main/eyesOnAgents/claudeWatcher.supervisor.ts')
  ]);
  const configAPath = join(fixtureRoot, 'config-a');
  const configBPath = join(fixtureRoot, 'config-b');
  mkdirSync(join(configAPath, 'projects'), { recursive: true });
  mkdirSync(join(configBPath, 'projects'), { recursive: true });
  const configA = realpathSync.native(configAPath);
  const configB = realpathSync.native(configBPath);
  const projectsA = join(configA, 'projects');
  const projectsB = join(configB, 'projects');
  mkdirSync(join(projectsA, 'project-a'));
  mkdirSync(join(projectsB, 'project-b'));
  const transcriptA = join(projectsA, 'project-a', `${uuid}.jsonl`);
  const transcriptB = join(projectsB, 'project-b', `${uuid}.jsonl`);
  writeFileSync(transcriptA, 'old');
  writeFileSync(transcriptB, 'new');
  return {
    fixtureRoot,
    configModule,
    pathModule,
    observationModule,
    bridgeModule,
    watcherHelperModule,
    watcherSupervisorModule,
    configA,
    configB,
    projectsA,
    projectsB,
    transcriptA,
    transcriptB,
    cleanup: () => {
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(buildRoot, { recursive: true, force: true });
    }
  };
};

export const storedValue = (value) => ({
  exists: true,
  valid: true,
  value,
  serializedValue: JSON.stringify(value)
});

export const drain = async (predicate, message) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  assert.fail(message);
};

export const createTimerHarness = () => {
  const handles = [];
  const setTimer = (callback, delay) => {
    const handle = {
      callback,
      delay,
      cleared: false,
      unrefCalled: false,
      unref() { this.unrefCalled = true; }
    };
    handles.push(handle);
    return handle;
  };
  return {
    handles,
    setTimer,
    clearTimer: (handle) => { handle.cleared = true; },
    active: () => handles.filter((handle) => !handle.cleared)
  };
};

export const createWatcher = (order = []) => {
  const watcher = {
    running: false,
    roots: null,
    processStarts: 0,
    stops: 0,
    updateRoots: async (roots) => {
      order.push('watcher:update');
      watcher.roots = roots;
    },
    start: async () => {
      order.push('watcher:start');
      if (!watcher.running) watcher.processStarts += 1;
      watcher.running = true;
    },
    stop: async () => {
      order.push('watcher:stop');
      watcher.stops += 1;
      watcher.running = false;
    },
    isRunning: () => watcher.running
  };
  return watcher;
};

export const createRepository = (overrides = {}) => {
  const repository = {
    clearCalls: 0,
    clearClaudeTranscriptCapabilities: async () => {
      repository.clearCalls += 1;
      return { changed: true };
    },
    upsertClaudeInventory: async () => ({ changed: false }),
    reconcileClaudeAgentStates: async () => ({ changed: false })
  };
  return Object.assign(repository, overrides);
};
