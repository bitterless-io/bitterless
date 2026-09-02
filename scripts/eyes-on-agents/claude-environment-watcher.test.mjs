import assert from 'node:assert/strict';
import {
  createClaudeDirectoryFixture,
  createRepository,
  createTimerHarness,
  createWatcherFactory,
  drain
} from './claude-directory-runtime.fixture.mjs';

// Task 085: ClaudeObservationService moved from one appliedConfig/generation/watcher-supervisor to
// a map keyed by environment id, each with its own independent generation fence, watcher, and
// bounded retry timer. These tests configure two environments at once and assert that starting,
// retrying, disabling, and removing one never touches the other's state/nextRetryAt/error, and
// that shutdown stops every environment, not just the first.

const fixture = await createClaudeDirectoryFixture();
const { observationModule, configA, configB, projectsA, projectsB } = fixture;

const ENV_A = { id: 'env-a', label: 'Default', mode: 'automatic', configDirectory: null, enabled: true };
const ENV_B = { id: 'env-b', label: 'claude2', mode: 'custom', configDirectory: configB, enabled: true };

// Finds one environment's status entry from the array getDirectoryStatus() now returns.
const statusOf = (runtime, id) => runtime.getDirectoryStatus().find((entry) => entry.id === id);

const resolveByEnvironment = (config) => (config.id === ENV_A.id
  ? {
      roots: { desktopRoots: [], projectsRoot: projectsA },
      effectiveDirectory: configA,
      projectsDirectory: projectsA,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    }
  : {
      roots: { desktopRoots: [], projectsRoot: projectsB },
      effectiveDirectory: configB,
      projectsDirectory: projectsB,
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: true
    });

// A minimal directoryConfig double whose listEnvironments()/hydrate() both read one mutable list —
// mutating `directoryConfig.environments` and calling service.applyEnvironments() mirrors exactly
// what the real XPC handler does after each CRUD mutation (task 084's add/remove/setEnvironmentEnabled).
const createDirectoryConfig = (initial) => ({
  environments: initial,
  async hydrate() {
    return { state: 'valid', config: { schemaVersion: 2, environments: this.environments } };
  },
  listEnvironments() { return this.environments; },
  async chooseCustomDirectory() { return null; },
  async useAutomatic() { return this.environments[0]; }
});

try {
  // ---- Scenario 1: independent lifecycles — one environment's retry never touches the other ----
  {
    const order = [];
    const { factory, watchers } = createWatcherFactory(order);
    const timers = createTimerHarness();
    const directoryConfig = createDirectoryConfig([ENV_A, ENV_B]);
    const runtime = new observationModule.ClaudeObservationService({
      repository: createRepository(),
      directoryConfig,
      resolveDirectory: resolveByEnvironment,
      agents: { poll: async () => null },
      createWatcher: factory,
      now: () => 100_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });

    await runtime.start();
    assert.equal(statusOf(runtime, 'env-a').state, 'watching');
    assert.equal(statusOf(runtime, 'env-b').state, 'watching');
    assert.equal(statusOf(runtime, 'env-a').effectiveDirectory, configA);
    assert.equal(statusOf(runtime, 'env-b').effectiveDirectory, configB);
    assert.equal(watchers.get('env-a').processStarts, 1);
    assert.equal(watchers.get('env-b').processStarts, 1);

    const bStatusBeforeFailure = { ...statusOf(runtime, 'env-b') };

    // Force only env-a's watcher to fail (simulating its child process having actually exited);
    // env-b must observe nothing.
    watchers.get('env-a').running = false;
    await runtime.handleWatcherFailure('env-a', new Error('env-a watcher crashed'));
    assert.equal(statusOf(runtime, 'env-a').state, 'retrying');
    assert.equal(statusOf(runtime, 'env-a').watching, false);
    assert.notEqual(statusOf(runtime, 'env-a').nextRetryAt, null);
    assert.deepEqual(statusOf(runtime, 'env-b'), bStatusBeforeFailure,
      'a Claude environment watcher failure must never change a sibling environment\'s status');
    assert.equal(timers.active().length, 1, 'only the failed environment may own a retry timer');

    // Recover env-a; env-b must still be untouched throughout.
    const retryTimer = timers.active()[0];
    retryTimer.cleared = true;
    retryTimer.callback();
    await drain(() => statusOf(runtime, 'env-a').state === 'watching',
      'env-a must recover independently of env-b');
    assert.deepEqual(statusOf(runtime, 'env-b'), bStatusBeforeFailure,
      'env-b must remain unaffected after env-a recovers');
    assert.equal(watchers.get('env-b').processStarts, 1,
      'env-a\'s retry must never restart env-b\'s watcher process');

    await runtime.stop();
  }

  // ---- Scenario 2: disabling an environment reports "stopped" without entering retry ----
  {
    const order = [];
    const { factory, watchers } = createWatcherFactory(order);
    const timers = createTimerHarness();
    const directoryConfig = createDirectoryConfig([ENV_A, { ...ENV_B }]);
    const runtime = new observationModule.ClaudeObservationService({
      repository: createRepository(),
      directoryConfig,
      resolveDirectory: resolveByEnvironment,
      agents: { poll: async () => null },
      createWatcher: factory,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });
    await runtime.start();
    assert.equal(statusOf(runtime, 'env-b').state, 'watching');

    directoryConfig.environments = [
      ENV_A,
      { ...ENV_B, enabled: false }
    ];
    await runtime.applyEnvironments();

    assert.equal(statusOf(runtime, 'env-b').state, 'stopped');
    assert.equal(statusOf(runtime, 'env-b').watching, false);
    assert.equal(statusOf(runtime, 'env-b').enabled, false);
    assert.equal(watchers.get('env-b').running, false, 'disabling must join that environment\'s supervisor');
    assert.equal(timers.active().length, 0, 'a deliberately disabled environment must never enter the retry ladder');
    assert.equal(statusOf(runtime, 'env-a').state, 'watching',
      'disabling env-b must never change env-a\'s status');

    // Re-enabling must start its own supervisor again, independent of env-a.
    directoryConfig.environments = [ENV_A, { ...ENV_B, enabled: true }];
    await runtime.applyEnvironments();
    assert.equal(statusOf(runtime, 'env-b').state, 'watching');
    assert.equal(watchers.get('env-b').processStarts, 2);
    assert.equal(watchers.get('env-a').processStarts, 1,
      'restarting env-b must never restart env-a\'s watcher process');

    await runtime.stop();
  }

  // ---- Scenario 3: removing an environment joins its supervisor cleanly ----
  {
    const order = [];
    const { factory, watchers } = createWatcherFactory(order);
    const directoryConfig = createDirectoryConfig([ENV_A, { ...ENV_B }]);
    const runtime = new observationModule.ClaudeObservationService({
      repository: createRepository(),
      directoryConfig,
      resolveDirectory: resolveByEnvironment,
      agents: { poll: async () => null },
      createWatcher: factory
    });
    await runtime.start();
    assert.equal(runtime.getDirectoryStatus().length, 2);

    directoryConfig.environments = [ENV_A];
    await runtime.applyEnvironments();

    assert.equal(runtime.getDirectoryStatus().length, 1,
      'a removed environment must no longer appear in the status list');
    assert.equal(statusOf(runtime, 'env-a').state, 'watching',
      'removing env-b must never change env-a\'s status');
    assert.equal(watchers.get('env-b').running, false, 'removal must join the removed supervisor');
    assert.equal(watchers.get('env-b').stops > 0, true);

    await runtime.stop();
  }

  // ---- Scenario 4: shutdown stops every environment's supervisor, not just the first ----
  {
    const { factory, watchers } = createWatcherFactory();
    const directoryConfig = createDirectoryConfig([ENV_A, { ...ENV_B }]);
    const runtime = new observationModule.ClaudeObservationService({
      repository: createRepository(),
      directoryConfig,
      resolveDirectory: resolveByEnvironment,
      agents: { poll: async () => null },
      createWatcher: factory
    });
    await runtime.start();
    assert.equal(watchers.get('env-a').running, true);
    assert.equal(watchers.get('env-b').running, true);

    await runtime.stop();

    assert.equal(watchers.get('env-a').running, false, 'stop() must join env-a\'s supervisor');
    assert.equal(watchers.get('env-b').running, false, 'stop() must join env-b\'s supervisor too, not only env-a\'s');
    assert.equal(statusOf(runtime, 'env-a').state, 'stopped');
    assert.equal(statusOf(runtime, 'env-b').state, 'stopped');
  }

  // ---- Scenario 5: logging never leaks another environment's id or any configDirectory value ----
  {
    const logCalls = [];
    const logger = { info: (message) => logCalls.push(message) };
    const { factory, watchers } = createWatcherFactory();
    const timers = createTimerHarness();
    const directoryConfig = createDirectoryConfig([ENV_A, { ...ENV_B }]);
    const runtime = new observationModule.ClaudeObservationService({
      repository: createRepository(),
      directoryConfig,
      resolveDirectory: resolveByEnvironment,
      agents: { poll: async () => null },
      createWatcher: factory,
      logger,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });
    await runtime.start();
    watchers.get('env-a').running = false;
    await runtime.handleWatcherFailure('env-a', new Error('env-a watcher crashed again'));
    assert.equal(timers.active().length, 1);
    timers.active()[0].callback();
    await drain(() => statusOf(runtime, 'env-a').state === 'watching', 'env-a must recover for the log assertions below');
    await runtime.stop();

    assert(logCalls.length > 0, 'the fatal/retry/start lifecycle must produce at least one log line');
    for (const line of logCalls) {
      assert.equal(line.includes(configA), false, 'a watcher log line must never contain a configDirectory value');
      assert.equal(line.includes(configB), false, 'a watcher log line must never contain a configDirectory value');
      // A log line naming env-a must never also name env-b, and vice versa.
      if (line.includes('id=env-a')) {
        assert.equal(line.includes('id=env-b'), false, 'one environment\'s log line must never carry another\'s id');
      }
      if (line.includes('id=env-b')) {
        assert.equal(line.includes('id=env-a'), false, 'one environment\'s log line must never carry another\'s id');
      }
    }
    assert(logCalls.some((line) => line.includes('id=env-a')), 'env-a\'s lifecycle must be identifiable in the log');
  }

  console.log('EyesOnAgents Claude multi-environment watcher tests passed');
} finally {
  fixture.cleanup();
}
