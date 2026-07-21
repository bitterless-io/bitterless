import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
