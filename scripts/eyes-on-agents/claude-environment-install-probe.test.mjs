import assert from 'node:assert/strict';
import {
  createClaudeDirectoryFixture,
  createRepository,
  createTimerHarness,
  createWatcherFactory,
  drain
} from './claude-directory-runtime.fixture.mjs';

// Task 090: ClaudeObservationService caches a read-only per-environment plugin-presence verdict and
// stamps it onto each getDirectoryStatus() entry. These tests pin the four properties that make the
// cache safe: getDirectoryStatus() never probes, overlapping probes for one id share a single call,
// two environments stay isolated (including when one throws), and a removed environment's verdict
// is dropped rather than inherited by a re-added id.

const fixture = await createClaudeDirectoryFixture();
const { observationModule, configA, configB, projectsA, projectsB } = fixture;

const ENV_A = { id: 'env-a', label: 'Default', mode: 'automatic', configDirectory: null, enabled: true };
const ENV_B = { id: 'env-b', label: 'claude2', mode: 'custom', configDirectory: configB, enabled: true };

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

const createDirectoryConfig = (initial) => ({
  environments: initial,
  async hydrate() {
    return { state: 'valid', config: { schemaVersion: 2, environments: this.environments } };
  },
  listEnvironments() { return this.environments; },
  async chooseCustomDirectory() { return null; },
  async useAutomatic() { return this.environments[0]; }
});

// Records every configDirectory the probe was asked about, so a test can assert both the count and
// that each environment was probed against its OWN directory.
const createProbe = (respond) => {
  const calls = [];
  return {
    calls,
    probe: async (configDirectory) => {
      calls.push(configDirectory);
      return await respond(configDirectory, calls.length);
    }
  };
};

const createRuntime = (directoryConfig, probe, extra = {}) => {
  const { factory } = createWatcherFactory([]);
  const timers = createTimerHarness();
  return new observationModule.ClaudeObservationService({
    repository: createRepository(),
    directoryConfig,
    resolveDirectory: resolveByEnvironment,
    agents: { poll: async () => null },
    createWatcher: factory,
    now: () => 100_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...(probe ? { probePluginPresence: probe } : {}),
    ...extra
  });
};

try {
  // ---- Scenario 1: each environment is probed against its own directory, and the verdict lands ----
  {
    const { calls, probe } = createProbe(async (configDirectory) => (
      configDirectory === configB ? 'installed' : 'not_installed'
    ));
    const runtime = createRuntime(createDirectoryConfig([ENV_A, ENV_B]), probe);

    await runtime.start();

    // Reconcile-time probing is intentionally NOT awaited by start() (it would let a hung `claude`
    // stall startup), so settle on the verdict rather than depending on microtask ordering.
    await drain(() => statusOf(runtime, 'env-b').pluginPresence === 'installed',
      'env-b must eventually report its probed presence');
    assert.equal(statusOf(runtime, 'env-a').pluginPresence, 'not_installed');
    assert.notEqual(statusOf(runtime, 'env-b').pluginProbedAt, null);
    assert.equal(statusOf(runtime, 'env-b').pluginProbedAt, new Date(100_000).toISOString());
    // The automatic environment has no configured directory, so it must be probed with `undefined`
    // (ambient CLAUDE_CONFIG_DIR) rather than with a fabricated path.
    assert.deepEqual([...calls].sort(), [configB, undefined].sort());

    await runtime.stop();
  }

  // ---- Scenario 2: getDirectoryStatus() must never spawn a probe ----
  {
    const { calls, probe } = createProbe(async () => 'installed');
    const runtime = createRuntime(createDirectoryConfig([ENV_A, ENV_B]), probe);

    await runtime.start();
    await drain(() => calls.length === 2, 'start must probe each environment exactly once');
    const afterStart = calls.length;

    // Assembling the status array is the hot path the renderer hits on every snapshot; it must read
    // the cache only. Two `claude` child processes per environment per snapshot would be a serious
    // regression, so this is asserted rather than assumed.
    for (let index = 0; index < 25; index += 1) runtime.getDirectoryStatus();
    assert.equal(calls.length, afterStart,
      'getDirectoryStatus() must never trigger a plugin-presence probe');

    await runtime.stop();
  }

  // ---- Scenario 3: overlapping refreshes for one id share a single probe ----
  {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { calls, probe } = createProbe(async (_configDirectory, callNumber) => {
      // Only the very first call blocks, so the coalescing window is deterministic.
      if (callNumber > 2) await gate;
      return 'installed';
    });
    const runtime = createRuntime(createDirectoryConfig([ENV_A, ENV_B]), probe);
    await runtime.start();
    await drain(() => calls.length === 2, 'start must probe both environments');
    const afterStart = calls.length;

    const first = runtime.refreshPluginPresence('env-b');
    const second = runtime.refreshPluginPresence('env-b');
    const third = runtime.refreshPluginPresence('env-b');
    release();
    await Promise.all([first, second, third]);

    assert.equal(calls.length - afterStart, 1,
      'three overlapping refreshes for one environment must share one probe');
    assert.equal(statusOf(runtime, 'env-b').pluginPresence, 'installed');

    await runtime.stop();
  }

  // ---- Scenario 4: a throwing probe yields 'unknown' and never touches the sibling ----
  {
    const { probe } = createProbe(async (configDirectory) => {
      if (configDirectory === configB) throw new Error('claude executable is unusable');
      return 'installed';
    });
    const runtime = createRuntime(createDirectoryConfig([ENV_A, ENV_B]), probe);

    await runtime.start();
    await drain(() => statusOf(runtime, 'env-a').pluginPresence === 'installed',
      'the healthy environment must still report its verdict');

    // The probe contract maps every failure to 'unknown'; here the dependency itself throws, which
    // must be contained rather than rejecting refreshPluginPresence or poisoning the sibling.
    assert.equal(statusOf(runtime, 'env-b').pluginPresence, 'unknown');
    assert.equal(statusOf(runtime, 'env-b').pluginProbedAt, null,
      'a probe that could not answer must not stamp a probedAt timestamp');
    assert.equal(statusOf(runtime, 'env-a').pluginPresence, 'installed',
      'one environment\'s probe failure must never affect a sibling\'s verdict');

    // Explicitly refreshing the failing environment must also not reject.
    await runtime.refreshPluginPresence('env-b');
    assert.equal(statusOf(runtime, 'env-b').pluginPresence, 'unknown');

    await runtime.stop();
  }

  // ---- Scenario 5: 'unknown' is never silently promoted to 'not_installed' ----
  {
    const { probe } = createProbe(async () => 'unknown');
    const runtime = createRuntime(createDirectoryConfig([ENV_A]), probe);
    await runtime.start();
    await runtime.refreshPluginPresence('env-a');
    assert.equal(statusOf(runtime, 'env-a').pluginPresence, 'unknown',
      '"we could not check" must stay distinct from "we checked and it is absent"');
    await runtime.stop();
  }

  // ---- Scenario 6: a removed id's verdict is dropped, not inherited by a re-added id ----
  {
    let verdict = 'installed';
    const { probe } = createProbe(async () => verdict);
    const directoryConfig = createDirectoryConfig([ENV_A, ENV_B]);
    const runtime = createRuntime(directoryConfig, probe);

    await runtime.start();
    await drain(() => statusOf(runtime, 'env-b').pluginPresence === 'installed',
      'env-b must report installed before it is removed');

    directoryConfig.environments = [ENV_A];
    await runtime.applyEnvironments();
    assert.equal(statusOf(runtime, 'env-b'), undefined);

    // Re-adding the same id against a directory that no longer has the plugin must re-probe rather
    // than resurrect the stale 'installed' verdict.
    verdict = 'not_installed';
    directoryConfig.environments = [ENV_A, ENV_B];
    await runtime.applyEnvironments();
    await drain(() => statusOf(runtime, 'env-b').pluginPresence === 'not_installed',
      'a re-added environment must not inherit the removed environment\'s cached verdict');

    await runtime.stop();
  }

  // ---- Scenario 7: a config-directory change re-probes; a rename does not ----
  {
    const { calls, probe } = createProbe(async () => 'installed');
    const directoryConfig = createDirectoryConfig([ENV_A, ENV_B]);
    const runtime = createRuntime(directoryConfig, probe);

    await runtime.start();
    await drain(() => calls.length === 2, 'start must probe both environments');
    const afterStart = calls.length;

    // A rename changes nothing the probe inspects, so it must not spend two CLI calls.
    directoryConfig.environments = [ENV_A, { ...ENV_B, label: 'claude-work' }];
    await runtime.applyEnvironments();
    assert.equal(calls.length, afterStart, 'renaming an environment must not re-probe it');

    // Repointing it at another directory invalidates the verdict, so it must re-probe.
    directoryConfig.environments = [ENV_A, { ...ENV_B, configDirectory: configA }];
    await runtime.applyEnvironments();
    await drain(() => calls.length === afterStart + 1,
      'changing an environment\'s config directory must re-probe that environment');
    assert.equal(calls.at(-1), configA, 'the re-probe must use the NEW config directory');

    await runtime.stop();
  }

  // ---- Scenario 8: without the probe dependency, behavior is exactly pre-090 ----
  {
    const runtime = createRuntime(createDirectoryConfig([ENV_A, ENV_B]), null);
    await runtime.start();
    assert.equal(statusOf(runtime, 'env-a').pluginPresence, 'unknown');
    assert.equal(statusOf(runtime, 'env-a').pluginProbedAt, null);
    // Must be a no-op rather than a throw, so every pre-090 caller keeps working.
    await runtime.refreshPluginPresence();
    await runtime.refreshPluginPresence('env-a');
    assert.equal(statusOf(runtime, 'env-a').pluginPresence, 'unknown');
    await runtime.stop();
  }

  // ---- Scenario 9: refreshing an unknown id is a no-op, not a throw ----
  {
    const { calls, probe } = createProbe(async () => 'installed');
    const runtime = createRuntime(createDirectoryConfig([ENV_A]), probe);
    await runtime.start();
    const afterStart = calls.length;
    await runtime.refreshPluginPresence('env-does-not-exist');
    assert.equal(calls.length, afterStart,
      'refreshing an unconfigured environment id must not probe anything');
    await runtime.stop();
  }

  // ---- Scenario 10: a hung probe must never block start(), stop(), or environment CRUD ----
  // Review 1 (B2) caught the original implementation awaiting the probe inside the observation
  // lifecycle queue, which start()/stop()/every CRUD round-trip await. A `claude` invocation has a
  // 30s timeout, so that made a slow or hung CLI stall app startup, app shutdown, and the "Add
  // environment" click. Presence is a status readout, not part of an environment's lifecycle.
  {
    // Never resolves: if any lifecycle call awaits the probe, this scenario hangs instead of failing.
    const { probe } = createProbe(() => new Promise(() => {}));
    const directoryConfig = createDirectoryConfig([ENV_A, ENV_B]);
    const runtime = createRuntime(directoryConfig, probe);

    // The timer is deliberately NOT unref'd: it must keep the loop alive so a regression fails
    // loudly with this message instead of the process quietly hanging on an unsettled await.
    const guard = async (label, operation) => {
      let timer = null;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} blocked on a hung plugin-presence probe`)),
          2_000
        );
      });
      try {
        await Promise.race([operation(), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    await guard('start()', () => runtime.start());
    // Status stays readable and simply reports the never-answered verdict.
    assert.equal(statusOf(runtime, 'env-a').pluginPresence, 'unknown');
    assert.equal(statusOf(runtime, 'env-a').pluginProbedAt, null);

    directoryConfig.environments = [ENV_A, ENV_B, {
      id: 'env-c', label: 'claude3', mode: 'custom', configDirectory: configB, enabled: true
    }];
    await guard('applyEnvironments()', () => runtime.applyEnvironments());
    await guard('stop()', () => runtime.stop());
  }

  console.log('EyesOnAgents Claude environment install-probe tests passed');
} finally {
  fixture.cleanup();
}
