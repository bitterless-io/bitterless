import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-delivery-build-'));
const testRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-delivery-'));
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const THREAD_ID = '019f653a-2ef7-7031-8f6b-c770bacffbb2';

const loadTypeScriptModule = async (name, entry) => {
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
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

class FakeSocket extends EventEmitter {
  constructor(response) {
    super();
    this.response = response;
    queueMicrotask(() => this.emit('connect'));
  }

  setEncoding() {}

  write() {
    queueMicrotask(() => this.emit('data', this.response));
  }

  destroy() {}
}

class FakeBridgeServer extends EventEmitter {
  listening = false;

  listen(_path, callback) {
    this.listening = true;
    queueMicrotask(callback);
    return this;
  }

  close(callback) {
    this.listening = false;
    queueMicrotask(callback);
    return this;
  }
}

class LoopbackServerSocket extends EventEmitter {
  destroyed = false;

  constructor(client) {
    super();
    this.client = client;
  }

  setEncoding() {}

  setTimeout() {}

  end(value) {
    queueMicrotask(() => this.client.emit('data', value));
  }

  destroy() {
    this.destroyed = true;
  }
}

class LoopbackClientSocket extends EventEmitter {
  constructor(accept) {
    super();
    this.accept = accept;
    queueMicrotask(() => this.emit('connect'));
  }

  setEncoding() {}

  write(frame) {
    const serverSocket = new LoopbackServerSocket(this);
    this.accept(serverSocket);
    queueMicrotask(() => serverSocket.emit('data', frame));
  }

  destroy() {}
}

try {
  const contract = await loadTypeScriptModule(
    'delivery-contract',
    'src/shared/eyesOnAgents/codexHookBridge.contract.ts'
  );
  const outbox = await loadTypeScriptModule(
    'outbox',
    'src/main/eyesOnAgents/codexHookOutbox.service.ts'
  );
  const helper = await loadTypeScriptModule(
    'helper',
    'src/main/eyesOnAgents/codexHookBridge.helper.ts'
  );
  const { CodexHookBridgeServer } = await loadTypeScriptModule(
    'delivery-server',
    'src/main/eyesOnAgents/codexHookBridge.server.ts'
  );

  const makeDelivery = (occurredAt) => {
    const deliveryId = randomUUID();
    return contract.createCodexHookDelivery({
      deliveryId,
      event: contract.createCodexHookEvent({
        rawInput: {
          session_id: THREAD_ID,
          cwd: '/repo',
          hook_event_name: 'UserPromptSubmit',
          turn_id: 'turn-a'
        },
        installationId: INSTALLATION_ID,
        eventId: deliveryId,
        occurredAt
      })
    });
  };

  const makeLivePromptDelivery = (occurredAt, prompt = 'PROMPT-LIVE-SENTINEL') => {
    const deliveryId = randomUUID();
    return contract.createCodexHookDelivery({
      deliveryId,
      event: contract.createCodexHookEventV2({
        rawInput: {
          session_id: THREAD_ID,
          cwd: '/repo',
          hook_event_name: 'UserPromptSubmit',
          turn_id: 'turn-live',
          prompt
        },
        installationId: INSTALLATION_ID,
        eventId: deliveryId,
        occurredAt,
        captureUserPrompt: true
      })
    });
  };

  const writeCoverageGap = (outboxPath, gap) => {
    mkdirSync(outboxPath, { recursive: true });
    writeFileSync(join(outboxPath, 'coverage-gap.json'), `${JSON.stringify(gap)}\n`);
  };

  const pendingDeliveryIds = (outboxPath) => {
    return readdirSync(join(outboxPath, 'pending'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(outboxPath, 'pending', name), 'utf8')).deliveryId)
      .sort();
  };

  const delivery = makeDelivery(500);
  assert.deepEqual(contract.parseCodexHookDelivery(delivery), delivery);
  assert.deepEqual(
    contract.parseCodexHookDeliveryAck({ status: 'committed' }),
    { status: 'committed' }
  );
  assert.throws(
    () => contract.parseCodexHookDeliveryAck({ status: 'committed', duplicate: true }),
    /Invalid Codex hook delivery acknowledgement/
  );
  assert.throws(
    () => contract.parseCodexHookDelivery({ ...delivery, payload: 'not-allowed' }),
    /Invalid Codex hook delivery envelope/
  );

  const livePromptDelivery = makeLivePromptDelivery(550, 'first line\n第二行🙂');
  assert.equal(livePromptDelivery.event.schemaVersion, 2);
  assert.equal(livePromptDelivery.event.payload.userPromptPreview, 'first line\n第二行🙂');
  assert.equal(livePromptDelivery.event.payload.userPromptTruncated, false);
  assert.deepEqual(contract.parseCodexHookDelivery(livePromptDelivery), livePromptDelivery);

  const oversizedPromptDelivery = makeLivePromptDelivery(551, '🙂'.repeat(3_000));
  assert.equal(oversizedPromptDelivery.event.payload.userPromptTruncated, true);
  assert.ok(
    Buffer.byteLength(oversizedPromptDelivery.event.payload.userPromptPreview, 'utf8') <=
      contract.CODEX_HOOK_USER_PROMPT_MAX_BYTES
  );
  assert.doesNotMatch(oversizedPromptDelivery.event.payload.userPromptPreview, /\ufffd/);

  for (const invalidPrompt of ['', ' \n ', 'contains\0nul', '\ud800']) {
    const invalidDelivery = makeLivePromptDelivery(552, invalidPrompt);
    assert.equal(invalidDelivery.event.schemaVersion, 2);
    assert.equal(
      Object.hasOwn(invalidDelivery.event.payload, 'userPromptPreview'),
      false,
      'invalid prompt input must degrade to metadata-only delivery'
    );
  }

  const promptlessStop = contract.createCodexHookEventV2({
    rawInput: {
      session_id: THREAD_ID,
      cwd: '/repo',
      hook_event_name: 'Stop',
      turn_id: 'turn-live',
      prompt: 'PROMPT-NON-USER-SENTINEL',
      last_assistant_message: 'ASSISTANT-SENTINEL'
    },
    installationId: INSTALLATION_ID,
    eventId: randomUUID(),
    occurredAt: 553,
    captureUserPrompt: true
  });
  assert.doesNotMatch(JSON.stringify(promptlessStop), /PROMPT-NON-USER-SENTINEL|ASSISTANT-SENTINEL/);
  assert.throws(
    () => contract.parseCodexHookEvent({
      ...promptlessStop,
      payload: {
        ...promptlessStop.payload,
        userPromptPreview: 'forbidden',
        userPromptTruncated: false
      }
    }),
    /only allowed for UserPromptSubmit/
  );
  assert.throws(
    () => contract.parseCodexHookEvent({
      ...livePromptDelivery.event,
      payload: {
        ...livePromptDelivery.event.payload,
        userPromptTruncated: undefined
      }
    }),
    /userPromptTruncated must be a boolean/
  );

  const metadataOnlyLivePrompt = contract.toMetadataOnlyCodexHookDelivery(livePromptDelivery);
  assert.equal(metadataOnlyLivePrompt.deliveryId, livePromptDelivery.deliveryId);
  assert.equal(metadataOnlyLivePrompt.event.eventId, livePromptDelivery.event.eventId);
  assert.equal(metadataOnlyLivePrompt.event.schemaVersion, 2);
  assert.doesNotMatch(JSON.stringify(metadataOnlyLivePrompt), /first line|第二行/);
  assert.deepEqual(
    contract.parseCodexHookMetadataOnlyDelivery(metadataOnlyLivePrompt),
    metadataOnlyLivePrompt
  );
  assert.throws(
    () => contract.parseCodexHookMetadataOnlyDelivery(livePromptDelivery),
    /must be metadata-only/
  );

  const bridgeEndpoint = {
    transport: 'win32-named-pipe',
    path: `\\\\.\\pipe\\bitterless-hook-delivery-${process.pid}-${Date.now()}`
  };
  let acceptBridgeConnection = () => undefined;
  const bridgeServer = new CodexHookBridgeServer(
    Date.now,
    (listener) => {
      acceptBridgeConnection = listener;
      return new FakeBridgeServer();
    }
  );
  const bridgeSocketFactory = () => new LoopbackClientSocket(acceptBridgeConnection);
  let releaseRepositoryCommit;
  let markRepositoryCommitStarted;
  const repositoryCommitStarted = new Promise((resolve) => {
    markRepositoryCommitStarted = resolve;
  });
  const repositoryCommitGate = new Promise((resolve) => {
    releaseRepositoryCommit = resolve;
  });
  let rejectRepositoryCommit = false;
  await bridgeServer.start({
    endpoint: bridgeEndpoint,
    installationId: INSTALLATION_ID,
    consume: async () => {
      if (rejectRepositoryCommit) throw new Error('simulated transaction failure');
      markRepositoryCommitStarted();
      await repositoryCommitGate;
      return { duplicate: false };
    }
  });
  let acknowledgementSettled = false;
  const committedAcknowledgement = outbox.sendCodexHookDelivery(
    bridgeEndpoint,
    delivery,
    2_000,
    bridgeSocketFactory
  ).finally(() => {
    acknowledgementSettled = true;
  });
  await repositoryCommitStarted;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    acknowledgementSettled,
    false,
    'the listener must not ACK before the repository transaction commits'
  );
  releaseRepositoryCommit();
  assert.equal(await committedAcknowledgement, 'committed');
  rejectRepositoryCommit = true;
  assert.equal(
    await outbox.sendCodexHookDelivery(
      bridgeEndpoint,
      makeDelivery(501),
      2_000,
      bridgeSocketFactory
    ),
    'unavailable',
    'a failed repository transaction must never produce a committed ACK'
  );
  await bridgeServer.stop();

  let acceptReplayConnection = () => undefined;
  let replayCalls = 0;
  let coverageSignals = 0;
  let replayConsumedDelivery = null;
  const replayServer = new CodexHookBridgeServer(
    Date.now,
    (listener) => {
      acceptReplayConnection = listener;
      return new FakeBridgeServer();
    },
    async ({ onCoverageGap }) => {
      replayCalls += 1;
      if (replayCalls === 1) {
        await onCoverageGap?.({
          schemaVersion: 1,
          reasons: ['outbox_overflow'],
          firstDetectedAt: 1,
          lastDetectedAt: 1,
          occurrences: 1
        });
      }
      return {
        pendingCount: 0,
        quarantinedCount: 0,
        coverageGap: null,
        replayedCount: 0
      };
    }
  );
  await replayServer.start({
    endpoint: {
      transport: 'win32-named-pipe',
      path: `\\\\.\\pipe\\bitterless-hook-replay-${process.pid}-${Date.now()}`
    },
    installationId: INSTALLATION_ID,
    outboxPath: join(testRoot, 'scheduled-replay'),
    consume: async (value) => {
      replayConsumedDelivery = value;
      return { duplicate: false };
    },
    onCoverageGap: async () => {
      coverageSignals += 1;
    }
  });
  for (
    let attempt = 0;
    attempt < 10 && (replayCalls < 1 || coverageSignals < 1);
    attempt += 1
  ) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(replayCalls, 1, 'listener startup must schedule an outbox replay');
  assert.equal(coverageSignals, 1, 'bounded coverage gaps must reach the listener owner');
  const replayEndpoint = {
    transport: 'win32-named-pipe',
    path: 'ignored-by-loopback'
  };
  assert.equal(
    await outbox.sendCodexHookDelivery(
      replayEndpoint,
      makeLivePromptDelivery(502, 'SERVER-LIVE-PROMPT'),
      2_000,
      () => new LoopbackClientSocket(acceptReplayConnection)
    ),
    'committed'
  );
  assert.equal(replayConsumedDelivery.event.schemaVersion, 2);
  assert.equal(replayConsumedDelivery.event.payload.userPromptPreview, 'SERVER-LIVE-PROMPT');
  for (let attempt = 0; attempt < 10 && replayCalls < 2; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(replayCalls, 2, 'each committed intake must schedule another outbox drain');
  await replayServer.stop();

  let drainReplayCalls = 0;
  let markDrainReplayStarted;
  let releaseDrainReplay;
  let recoveryAttempts = 0;
  let recoveryExpectedGap = null;
  const drainRecoveryGap = {
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 10,
    lastDetectedAt: 20,
    occurrences: 2
  };
  const drainReplayStarted = new Promise((resolve) => {
    markDrainReplayStarted = resolve;
  });
  const drainReplayGate = new Promise((resolve) => {
    releaseDrainReplay = resolve;
  });
  const drainServer = new CodexHookBridgeServer(
    Date.now,
    () => new FakeBridgeServer(),
    async () => {
      drainReplayCalls += 1;
      if (drainReplayCalls === 1) {
        markDrainReplayStarted();
        await drainReplayGate;
      }
      return {
        pendingCount: 0,
        quarantinedCount: 0,
        coverageGap: null,
        replayedCount: 0
      };
    },
    ({ expectedGap }) => {
      recoveryAttempts += 1;
      recoveryExpectedGap = expectedGap;
      if (recoveryAttempts === 1) throw new Error('simulated coverage recovery failure');
      return {
        pendingCount: 0,
        quarantinedCount: 0,
        coverageGap: null,
        discardedCount: 0,
        recoveredGap: null
      };
    }
  );
  await drainServer.start({
    endpoint: {
      transport: 'win32-named-pipe',
      path: `\\\\.\\pipe\\bitterless-hook-drain-${process.pid}-${Date.now()}`
    },
    installationId: INSTALLATION_ID,
    outboxPath: join(testRoot, 'explicit-drain'),
    consume: async () => ({ duplicate: false })
  });
  await drainReplayStarted;
  let explicitDrainSettled = false;
  const explicitDrain = drainServer.replayOutbox().finally(() => {
    explicitDrainSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(explicitDrainSettled, false, 'explicit replay must wait for the active drain');
  releaseDrainReplay();
  await explicitDrain;
  assert.equal(
    drainReplayCalls,
    2,
    'explicit replay must await a replay request queued behind the active drain'
  );
  await assert.rejects(
    drainServer.recoverOutboxCoverageGap(drainRecoveryGap),
    /simulated coverage recovery failure/
  );
  assert.equal(drainReplayCalls, 2, 'failed recovery must not start replay implicitly');
  await drainServer.recoverOutboxCoverageGap(drainRecoveryGap);
  assert.equal(recoveryAttempts, 2, 'coverage recovery must remain retryable');
  assert.deepEqual(recoveryExpectedGap, drainRecoveryGap);
  assert.equal(drainReplayCalls, 2, 'successful recovery must perform cutover only');
  await drainServer.replayOutbox();
  assert.equal(drainReplayCalls, 3, 'suffix replay must require an explicit drain request');
  await drainServer.stop();

  const recoveryRacePath = join(testRoot, 'coverage-recovery-race');
  const recoveryRacePrefix = makeDelivery(29);
  const recoveryRaceSuffix = makeDelivery(32);
  for (const value of [recoveryRacePrefix, recoveryRaceSuffix]) {
    assert.equal(outbox.persistCodexHookOutboxDelivery({
      outboxPath: recoveryRacePath,
      delivery: value,
      now: 20
    }), 'stored');
  }
  const recoveryRaceExpectedGap = {
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 30,
    lastDetectedAt: 30,
    occurrences: 1
  };
  const recoveryRaceActualGap = {
    schemaVersion: 1,
    reasons: ['storage_unavailable', 'outbox_overflow'],
    firstDetectedAt: 30,
    lastDetectedAt: 31,
    occurrences: 2
  };
  writeCoverageGap(recoveryRacePath, recoveryRaceExpectedGap);
  const recoveryRaceSignals = [];
  const recoveryRaceServer = new CodexHookBridgeServer(
    Date.now,
    () => new FakeBridgeServer()
  );
  await recoveryRaceServer.start({
    endpoint: {
      transport: 'win32-named-pipe',
      path: `\\\\.\\pipe\\bitterless-hook-recovery-race-${process.pid}-${Date.now()}`
    },
    installationId: INSTALLATION_ID,
    outboxPath: recoveryRacePath,
    consume: async () => ({ duplicate: false }),
    onCoverageGap: async (gap) => {
      recoveryRaceSignals.push(gap);
    }
  });
  for (let attempt = 0; attempt < 10 && recoveryRaceSignals.length < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(recoveryRaceSignals, [recoveryRaceExpectedGap]);
  writeCoverageGap(recoveryRacePath, recoveryRaceActualGap);
  await assert.rejects(
    recoveryRaceServer.recoverOutboxCoverageGap(recoveryRaceExpectedGap),
    /coverage changed during recovery/
  );
  assert.deepEqual(
    recoveryRaceSignals,
    [recoveryRaceExpectedGap, recoveryRaceActualGap],
    'a newer durable marker must be reported before the older recovery rejects'
  );
  const recoveryRaceInspection = outbox.inspectCodexHookOutbox(recoveryRacePath, 40);
  assert.deepEqual(recoveryRaceInspection.coverageGap, recoveryRaceActualGap);
  assert.deepEqual(
    pendingDeliveryIds(recoveryRacePath),
    [recoveryRacePrefix.deliveryId, recoveryRaceSuffix.deliveryId].sort(),
    'a mismatched recovery snapshot must not delete any pending delivery'
  );
  await recoveryRaceServer.stop();

  const helperArgs = {
    endpoint: { transport: 'unix', path: join(testRoot, 'helper.sock') },
    installationId: INSTALLATION_ID,
    outboxPath: join(testRoot, 'helper-outbox')
  };
  const promptMarkerPath = join(testRoot, 'last-user-prompt.enabled');
  assert.equal(
    helper.isCodexHookLastUserPromptCaptureEnabled(helperArgs.outboxPath),
    false
  );
  let idCalls = 0;
  let sentDelivery = null;
  let persistedDelivery = null;
  await helper.runCodexHookHelper(
    ['helper'],
    Readable.from([JSON.stringify({
      session_id: THREAD_ID,
      cwd: '/repo',
      hook_event_name: 'Stop',
      turn_id: 'turn-a',
      prompt: 'PROMPT-SENTINEL'
    })]),
    {
      parseArgs: () => helperArgs,
      idFactory: () => {
        idCalls += 1;
        return '22222222-2222-4222-8222-222222222222';
      },
      now: () => 700,
      send: async (_args, value) => {
        sentDelivery = value;
        return 'committed';
      },
      persist: ({ delivery: value }) => {
        persistedDelivery = value;
        return 'stored';
      }
    }
  );
  assert.equal(idCalls, 1, 'one delivery ID must be created per invocation');
  assert.equal(sentDelivery.deliveryId, sentDelivery.event.eventId);
  assert.equal(sentDelivery.event.schemaVersion, 2, 'the stable helper must emit V2 live events');
  assert.doesNotMatch(JSON.stringify(sentDelivery), /PROMPT-SENTINEL/);
  assert.equal(persistedDelivery, null, 'a committed delivery must not enter the outbox');

  writeFileSync(promptMarkerPath, '');
  assert.equal(
    helper.isCodexHookLastUserPromptCaptureEnabled(helperArgs.outboxPath),
    true,
    'the helper must derive the capability marker as a sibling of the outbox'
  );
  await helper.runCodexHookHelper(
    ['helper'],
    Readable.from([JSON.stringify({
      session_id: THREAD_ID,
      cwd: '/repo',
      hook_event_name: 'UserPromptSubmit',
      turn_id: 'turn-live-helper',
      prompt: 'HELPER-LIVE-PROMPT\n第二行'
    })]),
    {
      parseArgs: () => helperArgs,
      idFactory: () => '33333333-3333-4333-8333-333333333333',
      now: () => 750,
      send: async (_args, value) => {
        sentDelivery = value;
        return 'committed';
      }
    }
  );
  assert.equal(sentDelivery.event.payload.userPromptPreview, 'HELPER-LIVE-PROMPT\n第二行');
  assert.equal(sentDelivery.event.payload.userPromptTruncated, false);

  persistedDelivery = null;
  await helper.runCodexHookHelper(
    ['helper'],
    Readable.from([JSON.stringify({
      session_id: THREAD_ID,
      cwd: '/repo',
      hook_event_name: 'UserPromptSubmit',
      turn_id: 'turn-lost-ack',
      prompt: 'LOST-ACK-PROMPT-SENTINEL'
    })]),
    {
      parseArgs: () => helperArgs,
      idFactory: () => '44444444-4444-4444-8444-444444444444',
      now: () => 800,
      send: async () => {
        throw new Error('lost acknowledgement');
      },
      persist: ({ delivery: value }) => {
        persistedDelivery = value;
        return 'stored';
      }
    }
  );
  assert.equal(
    persistedDelivery.deliveryId,
    '44444444-4444-4444-8444-444444444444',
    'a send failure must persist the same delivery ID'
  );
  assert.equal(persistedDelivery.event.eventId, persistedDelivery.deliveryId);
  assert.equal(persistedDelivery.event.schemaVersion, 2);
  assert.doesNotMatch(
    JSON.stringify(persistedDelivery),
    /LOST-ACK-PROMPT-SENTINEL/,
    'the helper persist seam must receive metadata-only delivery after a lost ACK'
  );

  rmSync(promptMarkerPath);
  let promptReads = 0;
  await helper.runCodexHookHelper(
    ['helper'],
    Readable.from([]),
    {
      parseArgs: () => helperArgs,
      readInput: async () => ({
        session_id: THREAD_ID,
        cwd: '/repo',
        hook_event_name: 'UserPromptSubmit',
        turn_id: 'turn-marker-off',
        get prompt() {
          promptReads += 1;
          return 'MUST-NOT-BE-DERIVED';
        }
      }),
      idFactory: () => '55555555-5555-4555-8555-555555555555',
      now: () => 850,
      send: async (_args, value) => {
        sentDelivery = value;
        return 'committed';
      }
    }
  );
  assert.equal(promptReads, 0, 'marker-off helper flow must not read or derive prompt content');
  assert.doesNotMatch(JSON.stringify(sentDelivery), /MUST-NOT-BE-DERIVED/);

  const liveOutboxPath = join(testRoot, 'live-outbox-strip');
  const liveOutboxDelivery = makeLivePromptDelivery(900, 'OUTBOX-PROMPT-SENTINEL');
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: liveOutboxPath,
    delivery: liveOutboxDelivery,
    now: 900
  }), 'stored');
  const liveOutboxFile = join(
    liveOutboxPath,
    'pending',
    readdirSync(join(liveOutboxPath, 'pending'))[0]
  );
  const liveOutboxText = readFileSync(liveOutboxFile, 'utf8');
  assert.doesNotMatch(liveOutboxText, /OUTBOX-PROMPT-SENTINEL/);
  const storedMetadataOnlyDelivery = JSON.parse(liveOutboxText);
  assert.equal(storedMetadataOnlyDelivery.deliveryId, liveOutboxDelivery.deliveryId);
  assert.equal(storedMetadataOnlyDelivery.event.eventId, liveOutboxDelivery.event.eventId);
  assert.equal(storedMetadataOnlyDelivery.event.schemaVersion, 2);
  assert.equal(
    Object.hasOwn(storedMetadataOnlyDelivery.event.payload, 'userPromptPreview'),
    false
  );

  const replayPath = join(testRoot, 'replay');
  const newest = makeDelivery(2_000);
  const oldest = makeDelivery(1_000);
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: replayPath,
    delivery: newest,
    now: 2_000
  }), 'stored');
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: replayPath,
    delivery: oldest,
    now: 2_001
  }), 'stored');
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: replayPath,
    delivery: oldest,
    now: 2_002
  }), 'already_stored');
  const replayOrder = [];
  const replayResult = await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: replayPath,
    now: () => 3_000,
    send: async (_endpoint, value) => {
      replayOrder.push(value.deliveryId);
      return 'committed';
    }
  });
  assert.deepEqual(replayOrder, [oldest.deliveryId, newest.deliveryId]);
  assert.equal(replayResult.replayedCount, 2);
  assert.equal(replayResult.pendingCount, 0);

  const coverageRecoveryPath = join(testRoot, 'coverage-recovery');
  const recoveryPrefix = makeDelivery(6_000);
  const recoveryCutoff = makeDelivery(7_000);
  const recoverySuffix = makeDelivery(7_001);
  for (const value of [recoverySuffix, recoveryPrefix, recoveryCutoff]) {
    assert.equal(outbox.persistCodexHookOutboxDelivery({
      outboxPath: coverageRecoveryPath,
      delivery: value,
      now: 7_100
    }), 'stored');
  }
  const recoveryGap = {
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 6_500,
    lastDetectedAt: 7_000,
    occurrences: 1
  };
  writeCoverageGap(coverageRecoveryPath, recoveryGap);
  let pausedSendCalls = 0;
  const pausedCoverageSignals = [];
  const pausedReplay = await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: coverageRecoveryPath,
    now: () => 7_200,
    onCoverageGap: async (gap) => {
      pausedCoverageSignals.push(gap);
    },
    send: async () => {
      pausedSendCalls += 1;
      return 'committed';
    }
  });
  assert.equal(pausedSendCalls, 0, 'a coverage marker must pause replay before any send');
  assert.equal(pausedReplay.replayedCount, 0);
  assert.equal(pausedReplay.pendingCount, 3, 'paused replay must preserve the complete pending set');
  assert.deepEqual(pausedCoverageSignals, [recoveryGap]);
  const coverageRecovery = outbox.recoverCodexHookOutboxCoverageGap({
    outboxPath: coverageRecoveryPath,
    expectedGap: recoveryGap,
    now: 7_300
  });
  assert.equal(coverageRecovery.discardedCount, 2);
  assert.deepEqual(coverageRecovery.recoveredGap, recoveryGap);
  assert.deepEqual(pendingDeliveryIds(coverageRecoveryPath), [recoverySuffix.deliveryId]);
  assert.equal(
    existsSync(join(coverageRecoveryPath, 'coverage-gap.json')),
    false,
    'coverage marker must be removed only after the prefix cutover succeeds'
  );
  const recoveryReplayOrder = [];
  const coverageRecoveryReplay = await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: coverageRecoveryPath,
    now: () => 7_400,
    send: async (_endpoint, value) => {
      recoveryReplayOrder.push(value.deliveryId);
      return 'committed';
    }
  });
  assert.deepEqual(recoveryReplayOrder, [recoverySuffix.deliveryId]);
  assert.equal(coverageRecoveryReplay.pendingCount, 0);

  const noGapRecoveryPath = join(testRoot, 'no-gap-recovery');
  const noGapDelivery = makeDelivery(8_000);
  const noGapExpected = {
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 7_900,
    lastDetectedAt: 7_900,
    occurrences: 1
  };
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: noGapRecoveryPath,
    delivery: noGapDelivery,
    now: 8_100
  }), 'stored');
  for (const now of [8_200, 8_300]) {
    const noGapRecovery = outbox.recoverCodexHookOutboxCoverageGap({
      outboxPath: noGapRecoveryPath,
      expectedGap: noGapExpected,
      now
    });
    assert.equal(noGapRecovery.discardedCount, 0);
    assert.equal(noGapRecovery.recoveredGap, null);
    assert.deepEqual(pendingDeliveryIds(noGapRecoveryPath), [noGapDelivery.deliveryId]);
  }

  const markerLastPath = join(testRoot, 'marker-last-retry');
  const alreadyDiscardedPrefix = makeDelivery(9_000);
  const remainingPrefix = makeDelivery(9_500);
  const markerLastSuffix = makeDelivery(10_001);
  for (const value of [alreadyDiscardedPrefix, remainingPrefix, markerLastSuffix]) {
    assert.equal(outbox.persistCodexHookOutboxDelivery({
      outboxPath: markerLastPath,
      delivery: value,
      now: 10_100
    }), 'stored');
  }
  const markerLastGap = {
    schemaVersion: 1,
    reasons: ['outbox_overflow'],
    firstDetectedAt: 10_000,
    lastDetectedAt: 10_000,
    occurrences: 1
  };
  writeCoverageGap(markerLastPath, markerLastGap);
  const alreadyDiscardedFile = readdirSync(join(markerLastPath, 'pending'))
    .find((name) => name.includes(alreadyDiscardedPrefix.deliveryId));
  assert.ok(alreadyDiscardedFile);
  rmSync(join(markerLastPath, 'pending', alreadyDiscardedFile));
  assert.equal(existsSync(join(markerLastPath, 'coverage-gap.json')), true);
  const markerLastRecovery = outbox.recoverCodexHookOutboxCoverageGap({
    outboxPath: markerLastPath,
    expectedGap: markerLastGap,
    now: 10_200
  });
  assert.equal(markerLastRecovery.discardedCount, 1);
  assert.deepEqual(pendingDeliveryIds(markerLastPath), [markerLastSuffix.deliveryId]);
  assert.equal(existsSync(join(markerLastPath, 'coverage-gap.json')), false);

  const failedRecoveryPath = join(testRoot, 'failed-recovery');
  const failedRecoveryPrefix = makeDelivery(100);
  const failedRecoverySuffix = makeDelivery(101);
  for (const value of [failedRecoveryPrefix, failedRecoverySuffix]) {
    assert.equal(outbox.persistCodexHookOutboxDelivery({
      outboxPath: failedRecoveryPath,
      delivery: value,
      now: 150
    }), 'stored');
  }
  const failedRecoveryGap = {
    schemaVersion: 1,
    reasons: ['corrupt_file'],
    firstDetectedAt: 100,
    lastDetectedAt: 100,
    occurrences: 1
  };
  writeCoverageGap(failedRecoveryPath, failedRecoveryGap);
  mkdirSync(join(failedRecoveryPath, '.lock'));
  assert.throws(
    () => outbox.recoverCodexHookOutboxCoverageGap({
      outboxPath: failedRecoveryPath,
      expectedGap: failedRecoveryGap,
      now: 200
    }),
    /coverage recovery is unavailable/
  );
  assert.equal(existsSync(join(failedRecoveryPath, 'coverage-gap.json')), true);
  assert.equal(
    existsSync(join(failedRecoveryPath, 'coverage-gap.emergency')),
    false,
    'recovery lock contention must not create a new delivery coverage cutoff'
  );
  assert.deepEqual(
    pendingDeliveryIds(failedRecoveryPath),
    [failedRecoveryPrefix.deliveryId, failedRecoverySuffix.deliveryId].sort(),
    'failed recovery must retain both the marker and pending set'
  );
  rmSync(join(failedRecoveryPath, '.lock'), { recursive: true });
  const retriedRecovery = outbox.recoverCodexHookOutboxCoverageGap({
    outboxPath: failedRecoveryPath,
    expectedGap: failedRecoveryGap,
    now: 300
  });
  assert.deepEqual(retriedRecovery.recoveredGap, {
    schemaVersion: 1,
    reasons: ['corrupt_file'],
    firstDetectedAt: 100,
    lastDetectedAt: 100,
    occurrences: 1
  });
  assert.deepEqual(pendingDeliveryIds(failedRecoveryPath), [failedRecoverySuffix.deliveryId]);
  const failedRecoveryReplayIds = [];
  await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: failedRecoveryPath,
    now: () => 400,
    send: async (_endpoint, value) => {
      failedRecoveryReplayIds.push(value.deliveryId);
      return 'committed';
    }
  });
  assert.deepEqual(failedRecoveryReplayIds, [failedRecoverySuffix.deliveryId]);

  const emergencyDetectionPath = join(testRoot, 'emergency-detection-time');
  const emergencyPrefix = makeDelivery(19_500);
  const emergencySuffix = makeDelivery(20_001);
  for (const value of [emergencyPrefix, emergencySuffix]) {
    assert.equal(outbox.persistCodexHookOutboxDelivery({
      outboxPath: emergencyDetectionPath,
      delivery: value,
      now: 19_000
    }), 'stored');
  }
  mkdirSync(join(emergencyDetectionPath, '.lock'));
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: emergencyDetectionPath,
    delivery: makeDelivery(20_500),
    now: 20_000
  }), 'unavailable');
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: emergencyDetectionPath,
    delivery: makeDelivery(20_600),
    now: 19_999
  }), 'unavailable');
  rmSync(join(emergencyDetectionPath, '.lock'), { recursive: true });
  const emergencyInspection = outbox.inspectCodexHookOutbox(emergencyDetectionPath, 30_000);
  assert.equal(
    emergencyInspection.coverageGap.lastDetectedAt,
    20_000,
    'delayed emergency consumption must use the latest detection time without regression'
  );
  const emergencyRecovery = outbox.recoverCodexHookOutboxCoverageGap({
    outboxPath: emergencyDetectionPath,
    expectedGap: emergencyInspection.coverageGap,
    now: 30_100
  });
  assert.equal(emergencyRecovery.discardedCount, 1);
  assert.deepEqual(pendingDeliveryIds(emergencyDetectionPath), [emergencySuffix.deliveryId]);

  const markerDuringSendPath = join(testRoot, 'marker-during-send');
  const markerDuringSendDelivery = makeDelivery(14_000);
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: markerDuringSendPath,
    delivery: markerDuringSendDelivery,
    now: 14_100
  }), 'stored');
  const markerDuringSendGap = {
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 13_999,
    lastDetectedAt: 13_999,
    occurrences: 1
  };
  const markerDuringSendSignals = [];
  const markerDuringSendReplay = await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: markerDuringSendPath,
    now: () => 14_200,
    onCoverageGap: async (gap) => {
      markerDuringSendSignals.push(gap);
    },
    send: async () => {
      writeCoverageGap(markerDuringSendPath, markerDuringSendGap);
      return 'committed';
    }
  });
  assert.equal(markerDuringSendReplay.replayedCount, 0);
  assert.equal(markerDuringSendReplay.pendingCount, 1);
  assert.deepEqual(markerDuringSendSignals, [markerDuringSendGap]);
  assert.deepEqual(
    pendingDeliveryIds(markerDuringSendPath),
    [markerDuringSendDelivery.deliveryId],
    'a marker raised during send must prevent post-ACK pending deletion'
  );
  const markerDuringSendRecovery = outbox.recoverCodexHookOutboxCoverageGap({
    outboxPath: markerDuringSendPath,
    expectedGap: markerDuringSendGap,
    now: 14_300
  });
  assert.equal(markerDuringSendRecovery.discardedCount, 0);
  const duplicateReplayIds = [];
  await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: markerDuringSendPath,
    now: () => 14_400,
    send: async (_endpoint, value) => {
      duplicateReplayIds.push(value.deliveryId);
      return 'committed';
    }
  });
  assert.deepEqual(duplicateReplayIds, [markerDuringSendDelivery.deliveryId]);
  assert.equal(outbox.inspectCodexHookOutbox(markerDuringSendPath, 14_500).pendingCount, 0);

  const finalInspectionGapPath = join(testRoot, 'final-inspection-gap');
  const finalInspectionDelivery = makeDelivery(15_000);
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: finalInspectionGapPath,
    delivery: finalInspectionDelivery,
    now: 15_100
  }), 'stored');
  const finalInspectionGap = {
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 15_200,
    lastDetectedAt: 15_200,
    occurrences: 1
  };
  let replayNowCalls = 0;
  const finalInspectionSignals = [];
  const finalInspectionReplay = await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: finalInspectionGapPath,
    now: () => {
      replayNowCalls += 1;
      if (replayNowCalls === 4) writeCoverageGap(finalInspectionGapPath, finalInspectionGap);
      return 15_300 + replayNowCalls;
    },
    onCoverageGap: async (gap) => {
      finalInspectionSignals.push(gap);
    },
    send: async () => 'committed'
  });
  assert.equal(finalInspectionReplay.replayedCount, 1);
  assert.equal(finalInspectionReplay.pendingCount, 0);
  assert.deepEqual(finalInspectionSignals, [finalInspectionGap]);

  const stoppedPath = join(testRoot, 'stopped');
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: stoppedPath,
    delivery,
    now: 4_000
  }), 'stored');
  const stopped = await outbox.replayCodexHookOutbox({
    endpoint: helperArgs.endpoint,
    outboxPath: stoppedPath,
    now: () => 4_001,
    send: async () => 'unavailable'
  });
  assert.equal(stopped.replayedCount, 0);
  assert.equal(stopped.pendingCount, 1, 'unacknowledged delivery must remain durable');

  const recoveredPath = join(testRoot, 'recovered');
  mkdirSync(join(recoveredPath, 'pending'), { recursive: true });
  writeFileSync(join(recoveredPath, 'pending', '.tmp-interrupted'), `${JSON.stringify(delivery)}\n`);
  assert.equal(outbox.inspectCodexHookOutbox(recoveredPath, 5_000).pendingCount, 1);

  const corruptPath = join(testRoot, 'corrupt');
  mkdirSync(join(corruptPath, 'pending'), { recursive: true });
  writeFileSync(join(corruptPath, 'pending', 'bad.json'), 'CORRUPT-PAYLOAD-SENTINEL');
  const corrupt = outbox.inspectCodexHookOutbox(corruptPath, 6_000);
  assert.equal(corrupt.pendingCount, 0);
  assert.equal(corrupt.quarantinedCount, 1);
  assert.ok(corrupt.coverageGap.reasons.includes('corrupt_file'));
  assert.doesNotMatch(
    JSON.stringify(corrupt.coverageGap),
    /CORRUPT-PAYLOAD-SENTINEL/,
    'coverage signals must not include quarantined payloads'
  );
  const corruptMarker = readFileSync(
    join(corruptPath, 'quarantine', readdirSync(join(corruptPath, 'quarantine'))[0]),
    'utf8'
  );
  assert.doesNotMatch(
    corruptMarker,
    /CORRUPT-PAYLOAD-SENTINEL/,
    'quarantine must replace rejected input with a content-free marker'
  );

  const promptBearingOutboxPath = join(testRoot, 'prompt-bearing-corrupt');
  const promptBearingPending = join(promptBearingOutboxPath, 'pending');
  mkdirSync(promptBearingPending, { recursive: true });
  const promptBearingFileName = `${String(livePromptDelivery.event.occurredAt).padStart(16, '0')}-${livePromptDelivery.deliveryId}.json`;
  writeFileSync(
    join(promptBearingPending, promptBearingFileName),
    `${JSON.stringify(livePromptDelivery)}\n`
  );
  const promptBearingInspection = outbox.inspectCodexHookOutbox(promptBearingOutboxPath, 6_100);
  assert.equal(promptBearingInspection.pendingCount, 0);
  assert.equal(promptBearingInspection.quarantinedCount, 1);
  const promptBearingMarker = readFileSync(
    join(
      promptBearingOutboxPath,
      'quarantine',
      readdirSync(join(promptBearingOutboxPath, 'quarantine'))[0]
    ),
    'utf8'
  );
  assert.doesNotMatch(promptBearingMarker, /first line|第二行/);

  const overflowPath = join(testRoot, 'overflow');
  const overflowPending = join(overflowPath, 'pending');
  mkdirSync(overflowPending, { recursive: true });
  for (let index = 0; index < outbox.CODEX_HOOK_OUTBOX_MAX_FILES; index += 1) {
    const value = makeDelivery(10_000 + index);
    const fileName = `${String(value.event.occurredAt).padStart(16, '0')}-${value.deliveryId}.json`;
    writeFileSync(join(overflowPending, fileName), `${JSON.stringify(value)}\n`);
  }
  const overflowDelivery = makeDelivery(20_000);
  assert.equal(outbox.persistCodexHookOutboxDelivery({
    outboxPath: overflowPath,
    delivery: overflowDelivery,
    now: 20_000
  }), 'overflow');
  const overflow = outbox.inspectCodexHookOutbox(overflowPath, 20_001);
  assert.equal(overflow.pendingCount, outbox.CODEX_HOOK_OUTBOX_MAX_FILES);
  assert.ok(overflow.coverageGap.reasons.includes('outbox_overflow'));

  assert.equal(
    await outbox.sendCodexHookDelivery(
      helperArgs.endpoint,
      delivery,
      500,
      () => new FakeSocket('{"status":"committed"}\n')
    ),
    'committed'
  );

  assert.equal(
    await outbox.sendCodexHookDelivery(
      helperArgs.endpoint,
      delivery,
      500,
      () => new FakeSocket('{"status":"committed","extra":true}\n')
    ),
    'unavailable'
  );

  const windowsShim = contract.createCodexHookShim({
    execPath: 'C:\\Program Files\\Bitterless%App\\Bitterless.exe',
    helperPath: 'C:\\Users\\Ral Name\\Bitterless%Data\\bitterless-codex-hook-helper.cjs',
    endpointPath: '\\\\.\\pipe\\bitterless-coding-agent-test',
    installationId: INSTALLATION_ID,
    outboxPath: 'C:\\Users\\Ral Name\\Bitterless%Data\\codex-hook-outbox',
    platform: 'win32'
  });
  assert.match(windowsShim, /set "ELECTRON_RUN_AS_NODE=1"/);
  assert.match(windowsShim, /Bitterless%%App/);
  assert.match(windowsShim, /Bitterless%%Data/);
  assert.doesNotMatch(windowsShim, /app\.main/);

  const helperBuild = await build({
    entryPoints: [join(projectRoot, 'src/main/eyesOnAgents/codexHookHelper.main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
    metafile: true,
    write: false
  });
  assert.equal(
    Object.keys(helperBuild.metafile.inputs).some((path) => path.endsWith('src/main/app.main.ts')),
    false,
    'the hook helper bundle must not import the application entry'
  );
  const helperBundleText = helperBuild.outputFiles.map((file) => file.text).join('\n');
  assert.doesNotMatch(helperBundleText, /BrowserWindow|from\("electron"\)|require\("electron"\)/);
  const appMainSource = readFileSync(join(projectRoot, 'src/main/app.main.ts'), 'utf8');
  assert.doesNotMatch(appMainSource, /CODEX_HOOK_HELPER_ARG|runCodexHookHelper/);
  const viteConfigSource = readFileSync(join(projectRoot, 'electron.vite.config.ts'), 'utf8');
  assert.match(viteConfigSource, /codexHookHelper: resolve\('src\/main\/eyesOnAgents\/codexHookHelper\.main\.ts'\)/);

  console.log('EyesOnAgents durable hook delivery tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(testRoot, { recursive: true, force: true });
}
