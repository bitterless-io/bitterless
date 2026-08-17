import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createClaudeDirectoryFixture,
  createRepository,
  createTimerHarness,
  createWatcher,
  drain,
  storedValue,
  uuid
} from './claude-directory-runtime.fixture.mjs';

const fixture = await createClaudeDirectoryFixture();
const {
  fixtureRoot,
  configModule,
  observationModule,
  configA,
  configB,
  projectsA,
  projectsB,
  transcriptA,
  transcriptB
} = fixture;

try {

  assert.deepEqual(observationModule.CLAUDE_DIRECTORY_RETRY_DELAYS_MS,
    [1_000, 5_000, 15_000, 30_000, 60_000]);

  const startupCapabilityOrder = [];
  const startupCapabilityRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository({
      async clearClaudeTranscriptCapabilities() {
        this.clearCalls += 1;
        startupCapabilityOrder.push('capability:clear');
        return { changed: true };
      },
      async upsertClaudeInventory() {
        startupCapabilityOrder.push('inventory:upsert');
        return { changed: false };
      }
    }),
    directoryConfig: {
      async hydrate() {
        return {
          state: 'valid',
          config: { schemaVersion: 1, mode: 'custom', configDirectory: configA }
        };
      },
      getCurrent() { return null; },
      async chooseCustom() { return null; },
      async useAutomatic() {
        return { schemaVersion: 1, mode: 'automatic', configDirectory: null };
      }
    },
    resolveDirectory: () => ({
      roots: { desktopRoots: [], projectsRoot: projectsA },
      effectiveDirectory: configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }),
    agents: { poll: async () => null },
    watcher: createWatcher()
  });
  await startupCapabilityRuntime.start();
  assert.deepEqual(
    startupCapabilityOrder.slice(0, 2),
    ['capability:clear', 'inventory:upsert'],
    'a fresh runtime must clear pre-existing transcript capability before inventory is admitted'
  );
  await startupCapabilityRuntime.stop();

  let releaseStartupCapabilityClear = null;
  let clearFirstUpserts = 0;
  const clearFirstWatcher = createWatcher();
  const clearFirstRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository({
      async clearClaudeTranscriptCapabilities() {
        this.clearCalls += 1;
        return await new Promise((resolveClear) => {
          releaseStartupCapabilityClear = () => resolveClear({ changed: false });
        });
      },
      async upsertClaudeInventory() {
        clearFirstUpserts += 1;
        return { changed: false };
      }
    }),
    directoryConfig: {
      async hydrate() {
        return {
          state: 'valid',
          config: { schemaVersion: 1, mode: 'custom', configDirectory: configA }
        };
      },
      getCurrent() { return null; },
      async chooseCustom() { return null; },
      async useAutomatic() {
        return { schemaVersion: 1, mode: 'automatic', configDirectory: null };
      }
    },
    resolveDirectory: () => ({
      roots: { desktopRoots: [], projectsRoot: projectsA },
      effectiveDirectory: configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }),
    agents: { poll: async () => null },
    watcher: clearFirstWatcher
  });
  const clearFirstStart = clearFirstRuntime.start();
  await drain(() => releaseStartupCapabilityClear !== null,
    'valid hydrate must enter capability cleanup before inventory');
  assert.deepEqual(await clearFirstRuntime.refresh('poll'), { changed: false });
  assert.equal(clearFirstWatcher.processStarts, 0,
    'an external refresh cannot start the watcher while capability cleanup is pending');
  assert.equal(clearFirstUpserts, 0,
    'an external refresh cannot admit inventory while capability cleanup is pending');
  releaseStartupCapabilityClear();
  await clearFirstStart;
  assert.equal(clearFirstWatcher.processStarts, 1);
  assert.equal(clearFirstUpserts, 1,
    'successful capability cleanup must be followed by exactly one full inventory scan');
  await clearFirstRuntime.stop();

  let deferResumeHydrate = false;
  let releaseResumeHydrate = null;
  let resumeHydrateConfig = {
    schemaVersion: 1,
    mode: 'custom',
    configDirectory: configA
  };
  let resumeHydrateUpserts = 0;
  const resumeHydrateWatcher = createWatcher();
  const resumeHydrateRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository({
      async upsertClaudeInventory() {
        resumeHydrateUpserts += 1;
        return { changed: false };
      }
    }),
    directoryConfig: {
      async hydrate() {
        const config = { ...resumeHydrateConfig };
        if (!deferResumeHydrate) return { state: 'valid', config };
        return await new Promise((resolveHydrate) => {
          releaseResumeHydrate = () => resolveHydrate({ state: 'valid', config });
        });
      },
      getCurrent() { return resumeHydrateConfig; },
      async chooseCustom() { return resumeHydrateConfig; },
      async useAutomatic() { return resumeHydrateConfig; }
    },
    resolveDirectory: (config) => {
      const projects = config.configDirectory === configA ? projectsA : projectsB;
      return {
        roots: { desktopRoots: [], projectsRoot: projects },
        effectiveDirectory: config.configDirectory,
        projectsDirectory: projects,
        configDirectoryAvailable: true,
        projectsDirectoryAvailable: true
      };
    },
    agents: { poll: async () => null },
    watcher: resumeHydrateWatcher
  });
  await resumeHydrateRuntime.start();
  assert.equal(resumeHydrateWatcher.roots.projectsRoot, projectsA);
  await resumeHydrateRuntime.stop();
  const upsertsBeforeResume = resumeHydrateUpserts;
  const startsBeforeResume = resumeHydrateWatcher.processStarts;
  resumeHydrateConfig = {
    schemaVersion: 1,
    mode: 'custom',
    configDirectory: configB
  };
  deferResumeHydrate = true;
  const deferredResume = resumeHydrateRuntime.start();
  await drain(() => releaseResumeHydrate !== null,
    'auth resume must wait for the persisted directory hydrate');
  assert.deepEqual(await resumeHydrateRuntime.refresh('poll'), { changed: false });
  assert.equal(resumeHydrateRuntime.getDirectoryStatus().effectiveDirectory, null);
  assert.equal(resumeHydrateWatcher.running, false);
  assert.equal(resumeHydrateWatcher.processStarts, startsBeforeResume,
    'a resume tail refresh cannot restart the previously applied root');
  assert.equal(resumeHydrateUpserts, upsertsBeforeResume,
    'a resume tail refresh cannot scan the previously applied root');
  deferResumeHydrate = false;
  releaseResumeHydrate();
  await deferredResume;
  assert.equal(resumeHydrateRuntime.getDirectoryStatus().effectiveDirectory, configB);
  assert.equal(resumeHydrateWatcher.roots.projectsRoot, projectsB);
  assert.equal(resumeHydrateWatcher.processStarts, startsBeforeResume + 1);
  assert.equal(resumeHydrateUpserts, upsertsBeforeResume + 1);
  await resumeHydrateRuntime.stop();

  let recoverableStoredConfig = storedValue({
    schemaVersion: 1,
    mode: 'custom',
    configDirectory: configA
  });
  const recoverableWrites = [];
  const recoverableConfig = new configModule.ClaudeDirectoryConfigService({
    settings: {
      async getStored() { return recoverableStoredConfig; },
      async upsert({ value }) {
        recoverableWrites.push(value);
        recoverableStoredConfig = storedValue(value);
        return 'ok';
      }
    },
    pickDirectory: async () => null
  });
  const recoverableWatcher = createWatcher();
  const recoverableRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig: recoverableConfig,
    resolveDirectory: (config) => ({
      roots: { desktopRoots: [], projectsRoot: projectsA },
      effectiveDirectory: config.mode === 'custom' ? config.configDirectory : configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }),
    agents: { poll: async () => null },
    watcher: recoverableWatcher
  });
  await recoverableRuntime.start();
  assert.equal(recoverableRuntime.getDirectoryStatus().state, 'watching');
  await recoverableRuntime.stop();
  recoverableStoredConfig = storedValue({
    schemaVersion: 2,
    mode: 'automatic',
    configDirectory: null
  });
  await recoverableRuntime.start();
  const invalidResumeStatus = recoverableRuntime.getDirectoryStatus();
  assert.deepEqual({
    mode: invalidResumeStatus.mode,
    configuredDirectory: invalidResumeStatus.configuredDirectory,
    effectiveDirectory: invalidResumeStatus.effectiveDirectory,
    projectsDirectory: invalidResumeStatus.projectsDirectory,
    desktopDirectoryCount: invalidResumeStatus.desktopDirectoryCount,
    state: invalidResumeStatus.state,
    watching: invalidResumeStatus.watching,
    lastScanAt: invalidResumeStatus.lastScanAt,
    lastSuccessfulScanAt: invalidResumeStatus.lastSuccessfulScanAt,
    nextRetryAt: invalidResumeStatus.nextRetryAt
  }, {
    mode: 'automatic',
    configuredDirectory: null,
    effectiveDirectory: null,
    projectsDirectory: null,
    desktopDirectoryCount: 0,
    state: 'error',
    watching: false,
    lastScanAt: null,
    lastSuccessfulScanAt: null,
    nextRetryAt: null
  }, 'an invalid auth-resume hydrate must not expose status from the previous custom root');
  await recoverableRuntime.useAutomaticDirectory();
  assert.equal(recoverableRuntime.getDirectoryStatus().state, 'watching',
    'Use automatic must recover a runtime whose saved setting is malformed');
  assert.deepEqual(recoverableWrites.at(-1), {
    schemaVersion: 1,
    mode: 'automatic',
    configDirectory: null
  });
  await recoverableRuntime.stop();

  const order = [];
  let directoryAvailable = false;
  const timers = createTimerHarness();
  const watcher = createWatcher(order);
  const repository = createRepository();
  const runtimeConfig = {
    config: { schemaVersion: 1, mode: 'custom', configDirectory: configA },
    async hydrate() { order.push('config:hydrate'); return { state: 'valid', config: this.config }; },
    getCurrent() { return this.config; },
    async chooseCustom() { return this.config; },
    async useAutomatic() { return this.config; }
  };
  const resolveDynamic = () => ({
    roots: { desktopRoots: [], projectsRoot: directoryAvailable ? projectsA : null },
    effectiveDirectory: configA,
    projectsDirectory: projectsA,
    configDirectoryAvailable: true,
    projectsDirectoryAvailable: directoryAvailable
  });
  const runtime = new observationModule.ClaudeObservationService({
    repository,
    directoryConfig: runtimeConfig,
    resolveDirectory: resolveDynamic,
    agents: { poll: async () => null },
    watcher,
    now: () => 100_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  await runtime.start();
  assert.equal(order[0], 'config:hydrate', 'directory intent must hydrate before watcher startup');
  assert.equal(runtime.getDirectoryStatus().state, 'waiting');
  assert.equal(timers.active().length, 1, 'one unhealthy runtime must own exactly one retry timer');
  assert.equal(timers.active()[0].delay, 1_000);
  assert.equal(timers.active()[0].unrefCalled, true);
  await runtime.refresh('full');
  assert.equal(timers.active().length, 1, 'manual/provider refresh must not duplicate the retry timer');
  directoryAvailable = true;
  const recoveryTimer = timers.active()[0];
  recoveryTimer.cleared = true;
  recoveryTimer.callback();
  await drain(() => runtime.getDirectoryStatus().state === 'watching',
    'Main retry must recover a directory created while no renderer exists');
  assert.equal(watcher.processStarts, 1);
  assert.equal(timers.active().length, 0, 'healthy watching must have no second steady-state timer');
  await runtime.refresh('poll');
  assert.equal(watcher.processStarts, 1, 'reconciliation must reuse one watcher process');
  await runtime.stop();
  assert.equal(runtime.getDirectoryStatus().state, 'stopped');
  await runtime.start();
  assert.equal(runtime.getDirectoryStatus().state, 'watching', 'authenticated resume must rehydrate and restart');
  await runtime.stop();

  const stoppedTimers = createTimerHarness();
  const stoppedWatcher = createWatcher();
  directoryAvailable = false;
  const stoppedRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig: runtimeConfig,
    resolveDirectory: resolveDynamic,
    agents: { poll: async () => null },
    watcher: stoppedWatcher,
    setTimer: stoppedTimers.setTimer,
    clearTimer: stoppedTimers.clearTimer
  });
  await stoppedRuntime.start();
  const firstStoppedRetry = stoppedTimers.active()[0];
  firstStoppedRetry.cleared = true;
  firstStoppedRetry.callback();
  await drain(() => stoppedTimers.active().some((handle) => handle.delay === 5_000),
    'an unsuccessful retry must advance to the bounded five-second delay');
  const delayedRetry = stoppedTimers.active().find((handle) => handle.delay === 5_000);
  await stoppedRuntime.stop();
  delayedRetry.callback();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(stoppedWatcher.processStarts, 0, 'a delayed callback must not respawn after stop');
  await stoppedRuntime.start();
  assert.equal(stoppedTimers.active().length, 1);
  assert.equal(stoppedTimers.active()[0].delay, 1_000,
    'a valid resume hydrate must restart retry backoff at one second');
  await stoppedRuntime.stop();

  const stopRaceTimers = createTimerHarness();
  const stopRaceWatcher = createWatcher();
  const startWithoutDelay = stopRaceWatcher.start.bind(stopRaceWatcher);
  let deferWatcherStart = false;
  let releaseDeferredStart = null;
  stopRaceWatcher.start = async () => {
    if (!deferWatcherStart) return await startWithoutDelay();
    await new Promise((resolveStart) => {
      releaseDeferredStart = resolveStart;
    });
    stopRaceWatcher.running = true;
  };
  const stopRaceRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig: runtimeConfig,
    resolveDirectory: () => ({
      roots: { desktopRoots: [], projectsRoot: projectsA },
      effectiveDirectory: configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }),
    agents: { poll: async () => null },
    watcher: stopRaceWatcher,
    setTimer: stopRaceTimers.setTimer,
    clearTimer: stopRaceTimers.clearTimer
  });
  await stopRaceRuntime.start();
  deferWatcherStart = true;
  const refreshAcrossStop = stopRaceRuntime.refresh('poll');
  await drain(() => releaseDeferredStart !== null,
    'the stop race fixture must pause an in-flight watcher start');
  const stopAcrossRefresh = stopRaceRuntime.stop();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  const refreshWhileStopping = stopRaceRuntime.refresh('full');
  deferWatcherStart = false;
  releaseDeferredStart();
  assert.deepEqual(await refreshWhileStopping, { changed: false });
  await Promise.all([refreshAcrossStop, stopAcrossRefresh]);
  assert.equal(stopRaceRuntime.getDirectoryStatus().state, 'stopped');
  assert.equal(stopRaceWatcher.running, false,
    'stop must perform its final watcher shutdown after joining an in-flight refresh');
  assert.equal(stopRaceTimers.active().length, 0);
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(stopRaceWatcher.running, false, 'a stale watcher start must not respawn after stop');
  const startsAfterStop = stopRaceWatcher.processStarts;
  assert.deepEqual(await stopRaceRuntime.refresh('full'), { changed: false });
  assert.equal(stopRaceRuntime.getDirectoryStatus().state, 'stopped',
    'a renderer tail refresh must not reverse the stopped lifecycle intent');
  assert.equal(stopRaceWatcher.processStarts, startsAfterStop,
    'a refresh after stop must not start a new watcher');

  let stoppedActionSelection = configA;
  let stoppedActionUpserts = 0;
  const stoppedActionTimers = createTimerHarness();
  const stoppedActionWatcher = createWatcher();
  const stoppedActionRepository = createRepository({
    async upsertClaudeInventory() {
      stoppedActionUpserts += 1;
      return { changed: false };
    }
  });
  const stoppedActionConfig = {
    config: { schemaVersion: 1, mode: 'custom', configDirectory: configA },
    async hydrate() { return { state: 'valid', config: this.config }; },
    getCurrent() { return this.config; },
    async chooseCustom() {
      this.config = {
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: stoppedActionSelection
      };
      return this.config;
    },
    async useAutomatic() { return this.config; }
  };
  const stoppedActionRuntime = new observationModule.ClaudeObservationService({
    repository: stoppedActionRepository,
    directoryConfig: stoppedActionConfig,
    resolveDirectory: (config) => {
      const projects = config.configDirectory === configA ? projectsA : projectsB;
      return {
        roots: { desktopRoots: [], projectsRoot: projects },
        effectiveDirectory: config.configDirectory,
        projectsDirectory: projects,
        configDirectoryAvailable: true,
        projectsDirectoryAvailable: true
      };
    },
    agents: { poll: async () => null },
    watcher: stoppedActionWatcher,
    setTimer: stoppedActionTimers.setTimer,
    clearTimer: stoppedActionTimers.clearTimer
  });
  await stoppedActionRuntime.start();
  await stoppedActionRuntime.stop();
  const startsBeforeStoppedAction = stoppedActionWatcher.processStarts;
  const upsertsBeforeStoppedAction = stoppedActionUpserts;
  const clearsBeforeStoppedAction = stoppedActionRepository.clearCalls;
  stoppedActionSelection = configB;
  await stoppedActionRuntime.changeDirectory();
  const stoppedActionStatus = stoppedActionRuntime.getDirectoryStatus();
  assert.equal(stoppedActionStatus.state, 'stopped');
  assert.equal(stoppedActionStatus.watching, false);
  assert.equal(stoppedActionStatus.effectiveDirectory, configB);
  assert.equal(stoppedActionStatus.projectsDirectory, projectsB);
  assert.equal(stoppedActionWatcher.running, false);
  assert.equal(stoppedActionWatcher.processStarts, startsBeforeStoppedAction,
    'a directory action after stop must not start the watcher');
  assert.equal(stoppedActionUpserts, upsertsBeforeStoppedAction,
    'a directory action after stop must not scan inventory');
  assert.equal(stoppedActionRepository.clearCalls, clearsBeforeStoppedAction,
    'a stopped directory action defers capability cleanup to the next explicit start');
  assert.equal(stoppedActionTimers.active().length, 0);

  let retryResetSelection = configA;
  const retryResetTimers = createTimerHarness();
  const retryResetConfig = {
    config: { schemaVersion: 1, mode: 'custom', configDirectory: configA },
    async hydrate() { return { state: 'valid', config: this.config }; },
    getCurrent() { return this.config; },
    async chooseCustom() {
      this.config = {
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: retryResetSelection
      };
      return this.config;
    },
    async useAutomatic() { return this.config; }
  };
  const retryResetRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig: retryResetConfig,
    resolveDirectory: (config) => ({
      roots: { desktopRoots: [], projectsRoot: null },
      effectiveDirectory: config.configDirectory,
      projectsDirectory: join(config.configDirectory, 'projects'),
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: false
    }),
    agents: { poll: async () => null },
    watcher: createWatcher(),
    setTimer: retryResetTimers.setTimer,
    clearTimer: retryResetTimers.clearTimer
  });
  await retryResetRuntime.start();
  for (const expectedDelay of [1_000, 5_000]) {
    const retry = retryResetTimers.active().find((handle) => handle.delay === expectedDelay);
    assert.ok(retry);
    retry.cleared = true;
    retry.callback();
    await drain(
      () => retryResetTimers.active().some((handle) => handle.delay > expectedDelay),
      `retry backoff must advance beyond ${expectedDelay}ms`
    );
  }
  assert.equal(retryResetTimers.active()[0].delay, 15_000);
  retryResetSelection = configB;
  await retryResetRuntime.changeDirectory();
  assert.equal(retryResetTimers.active().length, 1);
  assert.equal(retryResetTimers.active()[0].delay, 1_000,
    'a persisted config replacement must restart retry backoff at one second');
  await retryResetRuntime.stop();

  let hydrationAttempts = 0;
  const hydrationTimers = createTimerHarness();
  const hydrationWatcher = createWatcher();
  const hydrationRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig: {
      async hydrate() {
        hydrationAttempts += 1;
        if (hydrationAttempts === 1) throw new Error('setting unavailable');
        return {
          state: 'valid',
          config: { schemaVersion: 1, mode: 'custom', configDirectory: configA }
        };
      },
      getCurrent() { return null; },
      async chooseCustom() { return null; },
      async useAutomatic() {
        return { schemaVersion: 1, mode: 'automatic', configDirectory: null };
      }
    },
    resolveDirectory: () => ({
      roots: { desktopRoots: [], projectsRoot: projectsA },
      effectiveDirectory: configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }),
    agents: { poll: async () => null },
    watcher: hydrationWatcher,
    setTimer: hydrationTimers.setTimer,
    clearTimer: hydrationTimers.clearTimer
  });
  await hydrationRuntime.start();
  assert.equal(hydrationRuntime.getDirectoryStatus().state, 'retrying');
  const hydrationRetry = hydrationTimers.active()[0];
  hydrationRetry.cleared = true;
  hydrationRetry.callback();
  await drain(() => hydrationRuntime.getDirectoryStatus().state === 'watching',
    'a thrown getStored/hydrate must remain recoverable instead of poisoning started state');
  await hydrationRuntime.stop();

  console.log('EyesOnAgents Claude directory runtime tests passed');
} finally {
  fixture.cleanup();
}
