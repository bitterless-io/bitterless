import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import {
  createClaudeDirectoryFixture,
  createRepository,
  createTimerHarness,
  createWatcher,
  drain,
  uuid
} from './claude-directory-runtime.fixture.mjs';

const fixture = await createClaudeDirectoryFixture();
const {
  fixtureRoot,
  observationModule,
  bridgeModule,
  watcherHelperModule,
  watcherSupervisorModule,
  configA,
  configB,
  projectsA,
  projectsB,
  transcriptA,
  transcriptB
} = fixture;

const runtimeConfig = {
  config: { schemaVersion: 1, mode: 'custom', configDirectory: configA },
  hydrate: async () => ({ state: 'valid', config: runtimeConfig.config }),
  getCurrent: () => runtimeConfig.config,
  chooseCustom: async () => runtimeConfig.config,
  useAutomatic: async () => runtimeConfig.config
};

try {
  let selectedConfig = configA;
  let rejectReplacementClear = null;
  let deferReplacementClear = false;
  const replacementTimers = createTimerHarness();
  const replacementWatcher = createWatcher();
  const startReplacementWatcherNow = replacementWatcher.start;
  let deferReplacementWatcherStart = false;
  let releaseReplacementWatcherStart = null;
  replacementWatcher.start = async () => {
    if (!deferReplacementWatcherStart) return await startReplacementWatcherNow();
    await new Promise((resolveStart) => {
      releaseReplacementWatcherStart = resolveStart;
    });
    replacementWatcher.running = true;
  };
  const replacementRepository = createRepository({
    async clearClaudeTranscriptCapabilities() {
      this.clearCalls += 1;
      if (deferReplacementClear) {
        deferReplacementClear = false;
        return await new Promise((_resolve, reject) => {
          rejectReplacementClear = () => reject(new Error('clear failed'));
        });
      }
      return { changed: true };
    }
  });
  const replacementConfig = {
    config: { schemaVersion: 1, mode: 'custom', configDirectory: configA },
    hydrate: async () => ({ state: 'valid', config: replacementConfig.config }),
    getCurrent: () => replacementConfig.config,
    chooseCustom: async () => {
      replacementConfig.config = {
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: selectedConfig
      };
      return replacementConfig.config;
    },
    useAutomatic: async () => replacementConfig.config
  };
  const replacementRuntime = new observationModule.ClaudeObservationService({
    repository: replacementRepository,
    directoryConfig: replacementConfig,
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
    watcher: replacementWatcher,
    setTimer: replacementTimers.setTimer,
    clearTimer: replacementTimers.clearTimer
  });
  await replacementRuntime.start();
  assert.equal(replacementRuntime.getDirectoryStatus().state, 'watching');
  assert.notEqual(replacementRuntime.getDirectoryStatus().lastSuccessfulScanAt, null);
  deferReplacementWatcherStart = true;
  const oldRootRefresh = replacementRuntime.refresh('poll');
  await drain(() => releaseReplacementWatcherStart !== null,
    'the replacement race fixture must pause an old-root watcher start');
  selectedConfig = configB;
  deferReplacementClear = true;
  const replacementOperation = replacementRuntime.changeDirectory();
  await drain(() => replacementWatcher.running === false,
    'replacement must request an initial watcher stop before joining old-root refresh');
  deferReplacementWatcherStart = false;
  releaseReplacementWatcherStart();
  await drain(() => rejectReplacementClear !== null,
    'root replacement must reach the fenced capability-clear phase');
  const pendingReplacementStatus = replacementRuntime.getDirectoryStatus();
  assert.deepEqual({
    effectiveDirectory: pendingReplacementStatus.effectiveDirectory,
    projectsDirectory: pendingReplacementStatus.projectsDirectory,
    state: pendingReplacementStatus.state,
    watching: pendingReplacementStatus.watching,
    lastScanAt: pendingReplacementStatus.lastScanAt,
    lastSuccessfulScanAt: pendingReplacementStatus.lastSuccessfulScanAt,
    nextRetryAt: pendingReplacementStatus.nextRetryAt,
    error: pendingReplacementStatus.error
  }, {
    effectiveDirectory: configB,
    projectsDirectory: projectsB,
    state: 'starting',
    watching: false,
    lastScanAt: null,
    lastSuccessfulScanAt: null,
    nextRetryAt: null,
    error: null
  }, 'a root replacement must atomically clear the prior root status before cleanup/scan');
  assert.equal(replacementWatcher.running, false,
    'replacement must stop a stale watcher start again before capability cleanup');
  rejectReplacementClear();
  await Promise.all([oldRootRefresh, replacementOperation]);
  assert.equal(replacementRuntime.getDirectoryStatus().effectiveDirectory, configB,
    'a persisted replacement must take ownership even when capability cleanup fails');
  assert.equal(replacementRuntime.getDirectoryStatus().state, 'retrying');
  assert.throws(
    () => replacementRuntime.requireCanonicalTranscript(transcriptA, uuid),
    /escaped its projects root/,
    'Preview must validate against the newly applied root during recovery'
  );
  const clearRetry = replacementTimers.active()[0];
  clearRetry.cleared = true;
  clearRetry.callback();
  await drain(() => replacementRuntime.getDirectoryStatus().state === 'watching',
    'cleanup failure must retry under the new persisted intent');
  assert.equal(replacementRepository.clearCalls, 3);
  assert.equal(replacementRuntime.requireCanonicalTranscript(transcriptB, uuid), transcriptB);
  await replacementRuntime.stop();

  const desktopRoot = join(fixtureRoot, 'desktop-root');
  mkdirSync(desktopRoot);
  let failStartupCapabilityClear = true;
  const startupFailureTimers = createTimerHarness();
  const startupFailureWatcher = createWatcher();
  const startupFailureRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository({
      async clearClaudeTranscriptCapabilities() {
        this.clearCalls += 1;
        if (failStartupCapabilityClear) {
          failStartupCapabilityClear = false;
          throw new Error('startup capability clear failed');
        }
        return { changed: true };
      }
    }),
    directoryConfig: runtimeConfig,
    resolveDirectory: () => ({
      roots: { desktopRoots: [desktopRoot], projectsRoot: projectsA },
      effectiveDirectory: configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }),
    agents: { poll: async () => null },
    watcher: startupFailureWatcher,
    setTimer: startupFailureTimers.setTimer,
    clearTimer: startupFailureTimers.clearTimer
  });
  await startupFailureRuntime.start();
  assert.equal(startupFailureRuntime.getDirectoryStatus().desktopDirectoryCount, 1);
  assert.equal(startupFailureRuntime.getDirectoryStatus().state, 'retrying',
    'a pre-watcher capability-clear failure cannot be degraded merely because a source exists');
  assert.equal(startupFailureRuntime.getDirectoryStatus().watching, false);
  assert.equal(startupFailureWatcher.processStarts, 0);
  const startupFailureRetry = startupFailureTimers.active()[0];
  startupFailureRetry.cleared = true;
  startupFailureRetry.callback();
  await drain(() => startupFailureRuntime.getDirectoryStatus().state === 'watching',
    'capability-clear recovery must start the watcher after cleanup succeeds');
  await startupFailureRuntime.stop();

  const terminatedTimers = createTimerHarness();
  const terminatedWatcher = createWatcher();
  const terminatedRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig: runtimeConfig,
    resolveDirectory: () => ({
      roots: { desktopRoots: [desktopRoot], projectsRoot: projectsA },
      effectiveDirectory: configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }),
    agents: { poll: async () => null },
    watcher: terminatedWatcher,
    setTimer: terminatedTimers.setTimer,
    clearTimer: terminatedTimers.clearTimer
  });
  await terminatedRuntime.start();
  terminatedWatcher.running = false;
  await terminatedRuntime.handleWatcherFailure(new Error('watcher child exited'));
  assert.equal(terminatedRuntime.getDirectoryStatus().state, 'retrying');
  assert.equal(terminatedRuntime.getDirectoryStatus().watching, false);
  assert.equal(terminatedTimers.active().length, 1);
  await terminatedRuntime.stop();

  let staleFailureSelection = configA;
  const staleFailureTimers = createTimerHarness();
  const staleFailureWatcher = createWatcher();
  const staleFailureConfig = {
    config: { schemaVersion: 1, mode: 'custom', configDirectory: configA },
    hydrate: async () => ({ state: 'valid', config: staleFailureConfig.config }),
    getCurrent: () => staleFailureConfig.config,
    chooseCustom: async () => {
      staleFailureConfig.config = {
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: staleFailureSelection
      };
      return staleFailureConfig.config;
    },
    useAutomatic: async () => staleFailureConfig.config
  };
  const staleFailureRuntime = new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig: staleFailureConfig,
    resolveDirectory: (config) => config.configDirectory === configA
      ? {
          roots: { desktopRoots: [], projectsRoot: projectsA },
          effectiveDirectory: configA,
          projectsDirectory: projectsA,
          configDirectoryAvailable: true,
          projectsDirectoryAvailable: true
        }
      : {
          roots: { desktopRoots: [], projectsRoot: null },
          effectiveDirectory: configB,
          projectsDirectory: projectsB,
          configDirectoryAvailable: true,
          projectsDirectoryAvailable: false
        },
    agents: { poll: async () => null },
    watcher: staleFailureWatcher,
    setTimer: staleFailureTimers.setTimer,
    clearTimer: staleFailureTimers.clearTimer
  });
  await staleFailureRuntime.start();
  staleFailureSelection = configB;
  const staleReplacement = staleFailureRuntime.changeDirectory();
  const oldGenerationFailure = staleFailureRuntime.handleWatcherFailure(new Error('old A exited'));
  await Promise.all([staleReplacement, oldGenerationFailure]);
  assert.equal(staleFailureRuntime.getDirectoryStatus().state, 'waiting',
    'an old-generation failure queued behind replacement cannot pollute the new root');
  assert.equal(staleFailureRuntime.getDirectoryStatus().error, null);
  assert.equal(staleFailureTimers.active().length, 1);
  await staleFailureRuntime.stop();

  const recoveredFailureTimers = createTimerHarness();
  const recoveredFailureWatcher = createWatcher();
  const recoveredFailureRuntime = new observationModule.ClaudeObservationService({
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
    watcher: recoveredFailureWatcher,
    setTimer: recoveredFailureTimers.setTimer,
    clearTimer: recoveredFailureTimers.clearTimer
  });
  await recoveredFailureRuntime.start();
  recoveredFailureWatcher.running = false;
  const sameGenerationRecovery = recoveredFailureRuntime.retryDirectory();
  const lateSameGenerationFailure = recoveredFailureRuntime.handleWatcherFailure(
    new Error('old helper cleanup finished')
  );
  await Promise.all([sameGenerationRecovery, lateSameGenerationFailure]);
  assert.equal(recoveredFailureRuntime.getDirectoryStatus().state, 'watching',
    'a late same-generation failure cannot undo an already recovered watcher');
  assert.equal(recoveredFailureTimers.active().length, 0);
  await recoveredFailureRuntime.stop();

  const bridgeDirectory = join('/tmp', `blb-${process.pid}-${Date.now()}`);
  mkdirSync(bridgeDirectory);
  const bridgeEndpoint = {
    transport: 'unix',
    path: join(bridgeDirectory, 'bridge.sock')
  };
  const bridgeServer = new bridgeModule.ClaudeInventoryBridgeServer();
  await bridgeServer.start({
    endpoint: bridgeEndpoint,
    nonce: 'a'.repeat(32),
    consume: () => undefined
  });
  const oldNativeServer = bridgeServer.server;
  const closeOldServerNow = oldNativeServer.close.bind(oldNativeServer);
  let releaseOldServerClose = null;
  oldNativeServer.close = (callback) => closeOldServerNow(() => {
    releaseOldServerClose = callback;
  });
  const oldBridgeStop = bridgeServer.stop();
  await drain(() => releaseOldServerClose !== null,
    'old bridge stop must reach its deferred native close');
  await bridgeServer.start({
    endpoint: bridgeEndpoint,
    nonce: 'b'.repeat(32),
    consume: () => undefined
  });
  assert.equal(bridgeServer.isListening(), true);
  releaseOldServerClose();
  await oldBridgeStop;
  await new Promise((resolveConnection, rejectConnection) => {
    const socket = net.createConnection(bridgeEndpoint.path);
    socket.once('connect', () => {
      socket.destroy();
      resolveConnection();
    });
    socket.once('error', rejectConnection);
  });
  assert.equal(bridgeServer.isListening(), true,
    'an old stop must not unlink or clear a newer bridge generation');
  await bridgeServer.stop();
  rmSync(bridgeDirectory, { recursive: true, force: true });

  let helperFatalError = null;
  const failingHelper = new watcherHelperModule.ClaudeDirectoryWatcherHelper({
    endpoint: { transport: 'unix', path: join(fixtureRoot, 'unused-helper.sock') },
    nonce: 'c'.repeat(32),
    roots: [{ source: 'desktop', path: fixtureRoot }]
  }, Date.now, (error) => { helperFatalError = error; });
  failingHelper.start();
  assert.equal(failingHelper.watchers.length, 1);
  failingHelper.watchers[0].emit('error', new Error('filesystem watcher failed'));
  assert.match(helperFatalError.message, /filesystem watcher failed/);
  assert.equal(failingHelper.watchers.length, 0,
    'a filesystem watcher error must close every source watcher');
  assert.equal(failingHelper.stopped, true,
    'a filesystem watcher error must terminate the helper instead of invalidating once');

  const delayedReadyEntry = join(fixtureRoot, 'delayed-ready.cjs');
  writeFileSync(delayedReadyEntry, [
    "setTimeout(() => process.send?.({ schemaVersion: 1, type: 'ready' }), 150);",
    'setInterval(() => undefined, 1000);',
    ''
  ].join('\n'));
  const supervisorProfile = join('/tmp', `bl-supervisor-${process.pid}-${Date.now()}`);
  let supervisorTerminations = 0;
  const supervisor = new watcherSupervisorModule.ClaudeWatcherSupervisor({
    userDataPath: supervisorProfile,
    execPath: process.execPath,
    helperEntryPath: delayedReadyEntry,
    roots: { desktopRoots: [fixtureRoot], projectsRoot: null },
    onInvalidation: () => undefined,
    onTerminated: () => { supervisorTerminations += 1; }
  });
  let delayedStartSettled = false;
  const delayedStart = supervisor.start().then(() => { delayedStartSettled = true; });
  await drain(() => supervisor.child !== null,
    'supervisor must spawn the helper before its ready frame');
  assert.equal(delayedStartSettled, false);
  assert.equal(supervisor.isRunning(), false,
    'spawn alone cannot admit a watcher before every fs.watch is installed');
  await delayedStart;
  assert.equal(supervisor.isRunning(), true);
  const firstReadyChild = supervisor.child;
  const stopSupervisorNow = supervisor.server.stop.bind(supervisor.server);
  let releaseTerminationCleanup = null;
  let deferTerminationCleanup = true;
  supervisor.server.stop = async () => {
    if (deferTerminationCleanup) {
      deferTerminationCleanup = false;
      await new Promise((resolveCleanup) => { releaseTerminationCleanup = resolveCleanup; });
    }
    await stopSupervisorNow();
  };
  const firstReadyChildExit = new Promise((resolveExit) => firstReadyChild.once('exit', resolveExit));
  firstReadyChild.kill();
  await firstReadyChildExit;
  await drain(() => releaseTerminationCleanup !== null,
    'unexpected termination must publish its pending bridge cleanup');
  const restartDuringCleanup = supervisor.start();
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(supervisor.child, null,
    'a replacement helper cannot bind while old bridge cleanup is pending');
  releaseTerminationCleanup();
  await restartDuringCleanup;
  assert.equal(supervisor.isRunning(), true);
  assert.notEqual(supervisor.child.pid, firstReadyChild.pid);
  assert.equal(supervisorTerminations, 1);
  await supervisor.stop();
  rmSync(supervisorProfile, { recursive: true, force: true });

  const epochSupervisor = new watcherSupervisorModule.ClaudeWatcherSupervisor({
    userDataPath: join('/tmp', `bl-epoch-${process.pid}-${Date.now()}`),
    execPath: process.execPath,
    helperEntryPath: delayedReadyEntry,
    roots: { desktopRoots: [fixtureRoot], projectsRoot: null },
    onInvalidation: () => undefined
  });
  const oldChild = new EventEmitter();
  const newChild = new EventEmitter();
  oldChild.exitCode = null;
  oldChild.signalCode = null;
  newChild.exitCode = null;
  newChild.signalCode = null;
  epochSupervisor.child = oldChild;
  epochSupervisor.bindTermination(oldChild);
  let oldReadyAdmitted = false;
  const oldReady = epochSupervisor.waitUntilReady(oldChild);
  void oldReady.then(() => { oldReadyAdmitted = true; }, () => undefined);
  let epochServerStops = 0;
  epochSupervisor.server.stop = async () => { epochServerStops += 1; };
  epochSupervisor.child = newChild;
  epochSupervisor.readyChild = newChild;
  oldChild.emit('message', { schemaVersion: 1, type: 'ready' });
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(oldReadyAdmitted, false, 'an old child ready frame cannot admit a newer epoch');
  const oldReadyRejected = assert.rejects(oldReady, /exited before ready/);
  oldChild.emit('exit', 1, null);
  await oldReadyRejected;
  assert.equal(epochSupervisor.child, newChild,
    'a late old-child exit cannot clear the current helper');
  assert.equal(epochSupervisor.readyChild, newChild);
  assert.equal(epochServerStops, 0,
    'a late old-child exit cannot stop the current bridge generation');

  console.log('EyesOnAgents Claude directory race tests passed');
} finally {
  fixture.cleanup();
}
