import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-inventory-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-inventory-build-'));
const uuid = (index) => `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

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

try {
  const desktop = await load(
    'desktop',
    'src/main/eyesOnAgents/claudeDesktopInventory.adapter.ts'
  );
  const transcript = await load(
    'transcript',
    'src/main/eyesOnAgents/claudeTranscriptInventory.adapter.ts'
  );
  const contract = await load(
    'contract',
    'src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts'
  );
  const paths = await load(
    'paths',
    'src/main/eyesOnAgents/claudePath.resolver.ts'
  );
  const bridge = await load(
    'bridge-server',
    'src/main/eyesOnAgents/claudeInventoryBridge.server.ts'
  );
  const agents = await load(
    'agents',
    'src/main/eyesOnAgents/claudeAgents.adapter.ts'
  );
  const command = await load(
    'command',
    'src/main/eyesOnAgents/claudeCommand.runner.ts'
  );
  const observation = await load(
    'observation',
    'src/main/eyesOnAgents/claudeObservation.service.ts'
  );
  const watcherHelperModule = await load(
    'watcher-helper',
    'src/main/eyesOnAgents/claudeDirectoryWatcher.helper.ts'
  );
  const watcherSupervisorModule = await load(
    'watcher-supervisor',
    'src/main/eyesOnAgents/claudeWatcher.supervisor.ts'
  );
  const eyesContract = await load(
    'eyes-contract',
    'src/shared/eyesOnAgents/eyesOnAgents.contract.ts'
  );

  const desktopRoot = join(fixtureRoot, 'desktop');
  const account = uuid(9001);
  const organization = uuid(9002);
  const desktopDir = join(desktopRoot, account, organization);
  mkdirSync(desktopDir, { recursive: true });
  for (let index = 1; index <= 45; index += 1) {
    const id = uuid(index);
    writeFileSync(join(desktopDir, `local_${id}.json`), JSON.stringify({
      sessionId: `local_${id}`,
      cliSessionId: id,
      title: `Claude ${index}`,
      cwd: `/tmp/project-${index}`,
      isArchived: index === 1,
      lastActivityAt: 1_000 + index,
      message: 'SECRET-MUST-NOT-PERSIST'
    }));
  }
  const firstPage = await desktop.scanClaudeDesktopInventory(
    [desktopRoot],
    10_000,
    { offset: 0, limit: 40 }
  );
  assert.equal(firstPage.length, 40, 'one Desktop poll batch must parse at most 40 files');
  assert(!JSON.stringify(firstPage).includes('SECRET-MUST-NOT-PERSIST'));
  writeFileSync(join(desktopDir, `local_${uuid(100)}.json`), Buffer.alloc(1024 * 1024 + 1));
  symlinkSync(join(desktopDir, `local_${uuid(1)}.json`), join(desktopDir, `local_${uuid(101)}.json`));
  const allDesktop = await desktop.scanClaudeDesktopInventory([desktopRoot], 10_000);
  assert.equal(allDesktop.find((row) => row.threadId === uuid(1))?.archiveState, 'archived');
  assert.equal(allDesktop.some((row) => row.threadId === uuid(100)), false);
  assert.equal(allDesktop.some((row) => row.threadId === uuid(101)), false);
  writeFileSync(join(desktopDir, `local_${uuid(102)}.json`), JSON.stringify({
    sessionId: `local_${uuid(102)}`,
    cliSessionId: uuid(1),
    isArchived: false
  }));
  const ambiguousDesktop = desktop.scanClaudeDesktopInventory([desktopRoot], 10_000);
  const mergedAmbiguousDesktop = transcript.mergeClaudeInventory(await ambiguousDesktop, []);
  assert.deepEqual(
    {
      desktopSessionId: mergedAmbiguousDesktop.find((row) => row.threadId === uuid(1))?.desktopSessionId,
      clearDesktopSessionId: mergedAmbiguousDesktop.find((row) => row.threadId === uuid(1))?.clearDesktopSessionId
    },
    { desktopSessionId: null, clearDesktopSessionId: true },
    'duplicate Desktop cliSessionId values must explicitly revoke interactive Open capability'
  );
  const secondAccount = uuid(9101);
  const secondOrganization = uuid(9102);
  const secondDesktopDir = join(desktopRoot, secondAccount, secondOrganization);
  mkdirSync(secondDesktopDir, { recursive: true });
  writeFileSync(join(secondDesktopDir, `local_${uuid(2)}.json`), JSON.stringify({
    sessionId: `local_${uuid(2)}`,
    cliSessionId: uuid(200),
    isArchived: false
  }));
  const reverseCollision = transcript.mergeClaudeInventory(
    await desktop.scanClaudeDesktopInventory([desktopRoot], 10_000),
    []
  );
  assert.equal(
    reverseCollision.find((row) => row.threadId === uuid(2))?.clearDesktopSessionId,
    true,
    'the original CLI identity must fail closed when one Desktop ID maps to another CLI identity'
  );
  assert.equal(
    reverseCollision.find((row) => row.threadId === uuid(200))?.clearDesktopSessionId,
    true,
    'the colliding CLI identity must also fail closed'
  );
  const projectsRoot = join(fixtureRoot, 'projects');
  const projectA = join(projectsRoot, 'project-a');
  mkdirSync(projectA, { recursive: true });
  for (let index = 1; index <= 45; index += 1) {
    writeFileSync(
      join(projectA, `${uuid(index)}.jsonl`),
      `not-json SECRET-PROMPT-${index}\n`
    );
  }
  mkdirSync(join(projectA, 'subagents'), { recursive: true });
  writeFileSync(join(projectA, 'subagents', `${uuid(500)}.jsonl`), 'nested');
  const transcriptPage = await transcript.scanClaudeTranscriptInventory(
    projectsRoot,
    Date.now(),
    { offset: 0, limit: 40 }
  );
  assert.equal(transcriptPage.length, 40, 'one JSONL poll batch must admit at most 40 stat-only rows');
  assert(!JSON.stringify(transcriptPage).includes('SECRET-PROMPT'));
  assert(transcriptPage.every((row) => row.title === null && row.cwd === null));
  assert(transcriptPage.every((row) => typeof row.transcriptActivityAt === 'number'));
  assert.equal(transcriptPage.some((row) => row.threadId === uuid(500)), false);
  const futureTranscriptPath = join(projectA, `${uuid(45)}.jsonl`);
  const futureCandidate = [{
    path: futureTranscriptPath,
    threadId: uuid(45),
    mtimeMs: 30_000
  }];
  for (const currentObservedAt of [20_000, 25_000]) {
    const [futureRow] = await transcript.scanClaudeTranscriptCandidates(
      projectsRoot,
      futureCandidate,
      currentObservedAt
    );
    assert.equal(futureRow.transcriptActivityAt, null,
      'a fixed future JSONL mtime must not advance with each observation clock tick');
    assert.equal(futureRow.lastActivityAt, null);
  }
  const [reachedFutureRow] = await transcript.scanClaudeTranscriptCandidates(
    projectsRoot,
    futureCandidate,
    30_000
  );
  assert.equal(reachedFutureRow.transcriptActivityAt, 30_000,
    'the fixed mtime may become one real heartbeat only after wall clock reaches it');
  assert.throws(() => paths.requireCanonicalClaudeTranscript({
    transcriptPath: join(projectA, `${uuid(2)}.jsonl`),
    projectsRoot,
    expectedThreadId: uuid(1)
  }), /identity does not match/, 'Preview must bind the canonical transcript to its session key');
  const projectB = join(projectsRoot, 'project-b');
  mkdirSync(projectB);
  writeFileSync(join(projectB, `${uuid(1)}.jsonl`), 'ambiguous');
  const duplicateSafe = await transcript.scanClaudeTranscriptInventory(projectsRoot, 20_000);
  assert.deepEqual(
    {
      transcriptPath: duplicateSafe.find((row) => row.threadId === uuid(1))?.transcriptPath,
      clearTranscriptPath: duplicateSafe.find((row) => row.threadId === uuid(1))?.clearTranscriptPath
    },
    { transcriptPath: null, clearTranscriptPath: true },
    'duplicate UUID transcripts across project directories must explicitly revoke Preview capability'
  );

  const endpoint = contract.getClaudeInventoryBridgeEndpoint('/tmp/bitterless-test', 'darwin');
  assert.equal(endpoint.transport, 'unix');
  assert(!endpoint.path.startsWith('http'));
  const args = contract.parseClaudeInventoryWatcherArgs([
    'electron',
    'watcher.js',
    contract.CLAUDE_INVENTORY_WATCHER_ARG,
    contract.CLAUDE_INVENTORY_SOCKET_ARG,
    endpoint.path,
    contract.CLAUDE_INVENTORY_NONCE_ARG,
    'a'.repeat(32),
    contract.CLAUDE_INVENTORY_ROOT_ARG,
    `desktop=${desktopRoot}`
  ], 'darwin');
  assert.equal(args.endpoint.path, endpoint.path);
  assert.throws(() => contract.parseClaudeInventoryInvalidation({
    schemaVersion: 1,
    nonce: 'a'.repeat(32),
    source: 'desktop',
    observedAt: 1,
    path: '/secret'
  }), /fields are invalid/);
  assert.deepEqual(
    contract.parseClaudeInventoryWatcherReady({ schemaVersion: 1, type: 'ready' }),
    { schemaVersion: 1, type: 'ready' }
  );
  assert.throws(() => contract.parseClaudeInventoryWatcherReady({
    schemaVersion: 1,
    type: 'ready',
    path: '/secret'
  }), /ready frame is invalid/);
  assert.equal(
    eyesContract.buildEyesOnAgentsClaudeDesktopDeepLink(`local_${uuid(1)}`),
    `claude://claude.ai/epitaxy/local_${uuid(1)}`
  );

  const socketDirectory = join('/tmp', `bl-claude-${process.pid}-${Date.now()}`);
  mkdirSync(socketDirectory);
  const socketPath = join(socketDirectory, 'watch.sock');
  const bridgeServer = new bridge.ClaudeInventoryBridgeServer();
  let invalidations = 0;
  await bridgeServer.start({
    endpoint: { transport: 'unix', path: socketPath },
    nonce: 'a'.repeat(32),
    consume: () => { invalidations += 1; }
  });
  const sendFrame = async (source) => await new Promise((resolveSend, rejectSend) => {
    const socket = net.createConnection(socketPath);
    socket.once('error', rejectSend);
    socket.once('connect', () => socket.end(`${JSON.stringify({
      schemaVersion: 1,
      nonce: 'a'.repeat(32),
      source,
      observedAt: 30_000
    })}\n`));
    socket.once('close', resolveSend);
  });
  await Promise.all([sendFrame('desktop'), sendFrame('transcripts')]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  assert.equal(invalidations, 1, 'one local socket burst must schedule one coalesced reconciliation');
  await bridgeServer.stop();
  assert.equal(existsSync(socketPath), false, 'stopping the bridge must remove its owned Unix socket');
  rmSync(socketDirectory, { recursive: true, force: true });

  const runnerCalls = [];
  const agentAdapter = new agents.ClaudeAgentsAdapter(
    ['/old/claude', '/current/claude'],
    async (executable, argv) => {
      runnerCalls.push([executable, ...argv]);
      if (argv[1] === '--help') return executable === '/old/claude'
        ? { stdout: 'agents', stderr: '', exitCode: 0 }
        : { stdout: '--json --all', stderr: '', exitCode: 0 };
      return {
        stdout: JSON.stringify([{ sessionId: uuid(1), type: 'interactive' }]),
        stderr: '',
        exitCode: 0
      };
    }
  );
  const agentSnapshot = await agentAdapter.poll(40_000);
  assert.equal(agentSnapshot.completeSnapshot, true);
  assert.equal(agentSnapshot.agents[0].runtimeState, 'unknown');
  assert.deepEqual(runnerCalls[0], ['/old/claude', 'agents', '--help']);
  assert.deepEqual(runnerCalls.at(-1), ['/current/claude', 'agents', '--json', '--all']);
  assert.deepEqual(agents.parseClaudeAgentsJson([
    { sessionId: uuid(2), type: 'background', state: 'working' },
    { sessionId: uuid(2), type: 'background', state: 'done' }
  ], 40_000), [], 'duplicate Agent View rows must fail closed globally');
  assert.equal(agents.parseClaudeAgentsJson([
    { sessionId: uuid(3), type: 'background' },
    { sessionId: uuid(4), type: 'interactive' }
  ], 40_000)[0].runtimeState, 'working');
  assert.equal(agents.parseClaudeAgentsJson([
    { sessionId: uuid(4), type: 'interactive' }
  ], 40_000)[0].runtimeState, 'unknown');
  await assert.rejects(
    command.runClaudeCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], {
      timeoutMs: 1_000,
      maxOutputBytes: 128
    }),
    /size limit/
  );
  const forcedKillStartedAt = Date.now();
  await assert.rejects(
    command.runClaudeCommand(process.execPath, [
      '-e',
      'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'
    ], { timeoutMs: 200, maxOutputBytes: 128 }),
    /timed out/
  );
  assert(
    Date.now() - forcedKillStartedAt >= 900,
    'timeout rejection must wait for the SIGKILL/close fallback instead of orphaning the child'
  );

  assert.equal(observation.isClaudeInventoryScanComplete(20_000), true);
  assert.equal(observation.isClaudeInventoryScanComplete(20_001), false);
  let fallbackUpserts = 0;
  const fallbackObservation = new observation.ClaudeObservationService({
    repository: {
      clearClaudeTranscriptCapabilities: async () => ({ changed: false }),
      upsertClaudeInventory: async () => { fallbackUpserts += 1; return { changed: false }; },
      reconcileClaudeAgentStates: async () => ({ changed: false })
    },
    resolveRoots: () => ({ desktopRoots: [desktopRoot], projectsRoot: null }),
    agents: { poll: async () => null },
    watcher: {
      updateRoots: async () => { throw new Error('socket unavailable'); },
      start: async () => { throw new Error('helper unavailable'); },
      stop: async () => undefined
    }
  });
  await fallbackObservation.start();
  assert(fallbackUpserts > 0, 'watcher failure must not block canonical fallback inventory');
  await fallbackObservation.stop();

  const coalescedBatches = [];
  let releaseAgentPoll = null;
  const coalescedObservation = new observation.ClaudeObservationService({
    repository: {
      clearClaudeTranscriptCapabilities: async () => ({ changed: false }),
      upsertClaudeInventory: async ({ threads }) => {
        coalescedBatches.push(threads);
        return { changed: false };
      },
      reconcileClaudeAgentStates: async () => ({ changed: false })
    },
    resolveRoots: () => ({ desktopRoots: [desktopRoot], projectsRoot: null }),
    agents: {
      poll: async () => releaseAgentPoll === null ? null : await new Promise((resolvePoll) => {
        releaseAgentPoll = () => resolvePoll(null);
      })
    },
    watcher: {
      updateRoots: async () => undefined,
      start: async () => undefined,
      stop: async () => undefined
    }
  });
  await coalescedObservation.start();
  coalescedBatches.length = 0;
  releaseAgentPoll = () => undefined;
  const pollOne = coalescedObservation.refresh('poll');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  const pollTwo = coalescedObservation.refresh('poll');
  const fullUpgrade = coalescedObservation.refresh('full');
  releaseAgentPoll();
  releaseAgentPoll = null;
  await Promise.all([pollOne, pollTwo, fullUpgrade]);
  assert.equal(coalescedBatches.length, 2, 'one in-flight poll must have only one coalesced follow-up');
  assert.equal(
    coalescedBatches[0].some((row) => row.desktopEvidenceComplete === true),
    false
  );
  assert.equal(
    coalescedBatches[1].some((row) => row.desktopEvidenceComplete === true),
    true,
    'a queued full refresh must upgrade the one follow-up scan'
  );
  await coalescedObservation.stop();

  let stopCommitCount = 0;
  let releaseStoppedPoll = null;
  const stoppedObservation = new observation.ClaudeObservationService({
    repository: {
      clearClaudeTranscriptCapabilities: async () => ({ changed: false }),
      upsertClaudeInventory: async () => { stopCommitCount += 1; return { changed: false }; },
      reconcileClaudeAgentStates: async () => ({ changed: false })
    },
    resolveRoots: () => ({ desktopRoots: [desktopRoot], projectsRoot: null }),
    agents: {
      poll: async () => releaseStoppedPoll === null ? null : await new Promise((resolvePoll) => {
        releaseStoppedPoll = () => resolvePoll(null);
      })
    },
    watcher: {
      updateRoots: async () => undefined,
      start: async () => undefined,
      stop: async () => undefined
    }
  });
  await stoppedObservation.start();
  stopCommitCount = 0;
  releaseStoppedPoll = () => undefined;
  const stoppedRefresh = stoppedObservation.refresh('poll');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  const stopOperation = stoppedObservation.stop();
  releaseStoppedPoll();
  await Promise.all([stoppedRefresh, stopOperation]);
  assert.equal(stopCommitCount, 0, 'a stopped observation generation must not commit or broadcast');

  let helperAttempts = 0;
  let deliveredFrame = '';
  const helper = new watcherHelperModule.ClaudeDirectoryWatcherHelper({
    endpoint: { transport: 'unix', path: '/tmp/unused.sock' },
    nonce: 'b'.repeat(32),
    roots: [{ source: 'desktop', path: desktopRoot }]
  }, () => 50_000);
  helper.send = async (frame) => {
    helperAttempts += 1;
    if (helperAttempts === 1) return false;
    deliveredFrame = frame;
    return true;
  };
  helper.invalidate('desktop');
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));
  helper.stop();
  assert(helperAttempts >= 2, 'helper must reconnect after a socket delivery failure');
  assert.deepEqual(Object.keys(JSON.parse(deliveredFrame)).sort(), [
    'nonce', 'observedAt', 'schemaVersion', 'source'
  ]);

  const fakeWatcherEntry = join(fixtureRoot, 'fake-watcher.cjs');
  writeFileSync(fakeWatcherEntry, [
    "process.send?.({ schemaVersion: 1, type: 'ready' });",
    'setInterval(() => undefined, 1000);',
    ''
  ].join('\n'));
  const supervisorProfile = join('/tmp', `blsup-${process.pid}-${Date.now()}`);
  let unexpectedWatcherStops = 0;
  const supervisor = new watcherSupervisorModule.ClaudeWatcherSupervisor({
    userDataPath: supervisorProfile,
    execPath: process.execPath,
    helperEntryPath: fakeWatcherEntry,
    roots: { desktopRoots: [desktopRoot], projectsRoot: null },
    onInvalidation: () => undefined,
    onTerminated: () => { unexpectedWatcherStops += 1; }
  });
  await Promise.all([supervisor.start(), supervisor.start(), supervisor.start()]);
  const firstChildPid = supervisor.child?.pid;
  assert(Number.isInteger(firstChildPid), 'concurrent start must produce one helper child');
  await supervisor.start();
  assert.equal(supervisor.child?.pid, firstChildPid, 'repeated start must reuse the singleton helper');
  supervisor.child.kill();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_300));
  assert.equal(supervisor.child, null,
    'the watcher supervisor must not own an independent delayed restart');
  assert.equal(unexpectedWatcherStops, 1,
    'an unexpected child stop must be delegated to the Main retry owner once');
  await supervisor.start();
  const restartedChildPid = supervisor.child?.pid;
  assert(Number.isInteger(restartedChildPid) && restartedChildPid !== firstChildPid,
    'a Main-owned retry may restart the singleton helper explicitly');
  await supervisor.stop();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_200));
  assert.equal(supervisor.child, null, 'stop must fence pending helper restarts');
  assert.equal(supervisor.server.isListening(), false, 'stop must close the watcher socket');
  rmSync(supervisorProfile, { recursive: true, force: true });

  const watcherSource = await import('node:fs').then((fs) => fs.readFileSync(
    join(projectRoot, 'src/main/eyesOnAgents/claudeWatcher.supervisor.ts'),
    'utf8'
  ));
  assert.match(watcherSource, /ELECTRON_RUN_AS_NODE:\s*'1'/);
  assert.match(watcherSource, /shell:\s*false/);
  assert.doesNotMatch(watcherSource, /createServer\([^)]*https?/i);
  const helperMainSource = await import('node:fs').then((fs) => fs.readFileSync(
    join(projectRoot, 'src/main/eyesOnAgents/claudeDirectoryWatcher.main.ts'),
    'utf8'
  ));
  assert.match(helperMainSource, /process\.ppid\s*===\s*1/);
  assert.match(helperMainSource, /process\.once\('disconnect', stop\)/);
  assert.match(
    helperMainSource,
    /process\.send\(CLAUDE_INVENTORY_WATCHER_READY, \(error\) => \{[\s\S]*helper\?\.stop\(\);[\s\S]*process\.exit\(1\)/
  );
  assert.match(
    helperMainSource,
    /catch \{\s*helper\?\.stop\(\);\s*process\.exit\(1\);\s*\}/,
    'a ready-send failure must close fs.watch handles before the helper exits non-zero'
  );

  const helperMainEntry = join(buildRoot, 'watcher-main.mjs');
  await build({
    entryPoints: [join(projectRoot, 'src/main/eyesOnAgents/claudeDirectoryWatcher.main.ts')],
    outfile: helperMainEntry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  const lifetimeChild = spawn(process.execPath, [
    helperMainEntry,
    contract.CLAUDE_INVENTORY_WATCHER_ARG,
    contract.CLAUDE_INVENTORY_SOCKET_ARG,
    join('/tmp', `unused-${process.pid}.sock`),
    contract.CLAUDE_INVENTORY_NONCE_ARG,
    'c'.repeat(32),
    contract.CLAUDE_INVENTORY_ROOT_ARG,
    `desktop=${desktopRoot}`
  ], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise((resolveSpawn, rejectSpawn) => {
    lifetimeChild.once('spawn', resolveSpawn);
    lifetimeChild.once('error', rejectSpawn);
  });
  const lifetimeExit = new Promise((resolveExit) => lifetimeChild.once('exit', resolveExit));
  lifetimeChild.disconnect();
  await Promise.race([
    lifetimeExit,
    new Promise((_, rejectExit) => setTimeout(
      () => rejectExit(new Error('watcher helper did not exit after parent IPC disconnect')),
      1_500
    ))
  ]);

  console.log('EyesOnAgents Claude inventory tests passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
