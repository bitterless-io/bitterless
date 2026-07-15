/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse as parseJsonc } from 'jsonc-parser';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-coding-agent-bridge-build-'));
const tempRoots = [buildRoot];

const tempRoot = (name) => {
  const path = mkdtempSync(join(tmpdir(), `bitterless-${name}-`));
  tempRoots.push(path);
  return path;
};

const loadTypeScriptModule = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    mainFields: ['module', 'main'],
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const INSTALLATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_INSTALLATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MANAGED_SESSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_1 = '11111111-1111-4111-8111-111111111111';
const EVENT_2 = '22222222-2222-4222-8222-222222222222';
const EVENT_3 = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise(value) };
};

const exchangeFrame = (path, frame, timeoutMs = 2500) => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    socket.setEncoding('utf8');
    let response = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for bridge ACK'));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      socket.destroy();
      try {
        resolve(JSON.parse(response.trim()));
      } catch (error) {
        reject(error);
      }
    };
    socket.once('connect', () => socket.write(frame));
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.includes('\n')) finish();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

const waitForSocketClose = (path, partialFrame) => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Partial bridge client was not timed out'));
    }, 1800);
    socket.once('connect', () => socket.write(partialFrame));
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

const hookArgs = (contract, endpointPath, provider = 'codex') => [
  '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
  contract.CODING_AGENT_HOOK_HELPER_ARG,
  contract.CODING_AGENT_BRIDGE_PATH_ARG,
  endpointPath,
  contract.CODING_AGENT_PROVIDER_ARG,
  provider,
  contract.CODING_AGENT_INSTALLATION_ID_ARG,
  INSTALLATION_ID
];

const makeHookEvent = (contract, overrides = {}) => {
  const { rawInput = {}, ...envelopeOverrides } = overrides;
  return contract.createCodingAgentHookEvent({
    rawInput: {
      session_id: SESSION_ID,
      cwd: projectRoot,
      hook_event_name: 'UserPromptSubmit',
      turn_id: 'turn-1',
      ...rawInput
    },
    provider: 'codex',
    installationId: INSTALLATION_ID,
    eventId: EVENT_1,
    occurredAt: 2000,
    ...envelopeOverrides
  });
};

const makeStatusService = (statusModule, name, overrides = {}) => {
  const root = tempRoot(name);
  const homePath = join(root, 'home');
  const userDataPath = overrides.userDataPath ?? join(root, 'user-data');
  mkdirSync(homePath, { recursive: true });
  mkdirSync(userDataPath, { recursive: true });
  const service = new statusModule.CodingAgentStatusBridgeService({
    homePath,
    userDataPath,
    execPath: overrides.execPath ?? '/Applications/Bitterless App.app/Contents/MacOS/Bitterless',
    appPath: overrides.appPath === undefined ? '/Applications/Bitterless App.app' : overrides.appPath,
    platform: overrides.platform ?? 'darwin',
    idFactory: () => INSTALLATION_ID,
    bridgeStatus: overrides.bridgeStatus,
    installCheckpoint: overrides.installCheckpoint
  });
  return { root, homePath, userDataPath, service };
};

try {
  const contract = await loadTypeScriptModule(
    'bridge-contract',
    'src/shared/codingAgent/codingAgentHookBridge.contract.ts'
  );
  const helper = await loadTypeScriptModule(
    'hook-helper',
    'src/main/codingAgent/agentSessionHook.helper.ts'
  );
  const serverModule = await loadTypeScriptModule(
    'event-bridge-server',
    'src/main/codingAgent/agentSessionEventBridge.server.ts'
  );
  const statusModule = await loadTypeScriptModule(
    'status-bridge-service',
    'src/main/codingAgent/codingAgentStatusBridge.service.ts'
  );
  const sessionModule = await loadTypeScriptModule(
    'session-service',
    'src/main/codingAgent/codingAgentSession.service.ts'
  );

  // Endpoint identity and strict helper argv parsing.
  const profileA = '/tmp/Bitterless A';
  const profileB = '/tmp/Bitterless B';
  const unixEndpoint = contract.getCodingAgentBridgeEndpoint(profileA, 'darwin');
  const windowsEndpoint = contract.getCodingAgentBridgeEndpoint(profileA, 'win32');
  assert.deepEqual(unixEndpoint, {
    transport: 'unix',
    path: join(profileA, 'coding-agent', 'bridge.sock')
  });
  assert.equal(windowsEndpoint.transport, 'win32-named-pipe');
  assert.match(windowsEndpoint.path, /^\\\\\.\\pipe\\bitterless-coding-agent-[a-f0-9]{12}$/);
  assert.notEqual(
    windowsEndpoint.path,
    contract.getCodingAgentBridgeEndpoint(profileB, 'win32').path,
    'profiles must derive different named pipes'
  );
  assert.ok(!unixEndpoint.path.includes('mcp'), 'coding-agent ingress must not reuse Todo MCP');

  const parsedArgs = contract.parseCodingAgentHookHelperArgs(
    hookArgs(contract, unixEndpoint.path),
    'darwin'
  );
  assert.equal(parsedArgs.endpoint.path, unixEndpoint.path);
  assert.equal(parsedArgs.provider, 'codex');
  assert.equal(parsedArgs.installationId, INSTALLATION_ID);
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs(hookArgs(contract, unixEndpoint.path).slice(0, 1)),
    /must be provided exactly once/
  );
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs([
      ...hookArgs(contract, unixEndpoint.path),
      contract.CODING_AGENT_HOOK_HELPER_ARG
    ]),
    /exactly once/
  );
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs([
      ...hookArgs(contract, unixEndpoint.path),
      '--unknown-bridge-option'
    ]),
    /Unknown coding-agent helper argument/
  );
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs([
      ...hookArgs(contract, unixEndpoint.path),
      contract.CODING_AGENT_PROVIDER_ARG,
      'claude'
    ]),
    /only once/
  );
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs([
      ...hookArgs(contract, unixEndpoint.path).slice(0, -1)
    ]),
    /requires a value/
  );
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs(
      hookArgs(contract, 'relative.sock'),
      'darwin'
    ),
    /absolute Unix socket/
  );
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs(
      hookArgs(contract, 'C:\\temp\\bridge.pipe'),
      'win32'
    ),
    /local Windows named pipe/
  );
  const equalsArgs = hookArgs(contract, unixEndpoint.path);
  equalsArgs[2] = `${contract.CODING_AGENT_BRIDGE_PATH_ARG}=${unixEndpoint.path}`;
  assert.throws(
    () => contract.parseCodingAgentHookHelperArgs(equalsArgs, 'darwin'),
    /separate argument/
  );

  // Privacy-minimal envelope and provider mappings.
  const secretSentinel = 'SECRET_PROMPT_TRANSCRIPT_TOOL_OUTPUT';
  const redactedEvent = makeHookEvent(contract, {
    rawInput: {
      prompt: secretSentinel,
      transcript_path: `/tmp/${secretSentinel}.jsonl`,
      tool_input: { password: secretSentinel },
      tool_output: secretSentinel,
      model_response: secretSentinel
    }
  });
  assert.ok(!JSON.stringify(redactedEvent).includes(secretSentinel));
  assert.deepEqual(Object.keys(redactedEvent.payload).sort(), [
    'cwd',
    'hookEventName',
    'notificationType',
    'sessionId',
    'turnId'
  ]);
  const claudeEvent = makeHookEvent(contract, {
    provider: 'claude',
    rawInput: {
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
      turn_id: secretSentinel
    }
  });
  assert.equal(claudeEvent.payload.turnId, null, 'Claude turn IDs are not reliable evidence');
  assert.deepEqual(
    contract.normalizeCodingAgentHookEvent(claudeEvent),
    {
      provider: 'claude',
      externalSessionId: SESSION_ID,
      cwd: projectRoot,
      state: 'idle',
      lastTurnState: 'completed',
      providerState: 'hook:Notification:idle_prompt',
      statusSource: 'claude-hook',
      observedAt: 2000
    }
  );
  const mappingCases = [
    ['UserPromptSubmit', undefined, 'working', 'in_progress'],
    ['PermissionRequest', undefined, 'waiting_approval', 'in_progress'],
    ['Stop', undefined, 'idle', 'completed'],
    ['StopFailure', undefined, 'failed', 'failed'],
    ['SessionEnd', undefined, 'ended', null],
    ['Notification', 'permission_prompt', 'waiting_approval', 'in_progress'],
    ['Notification', 'idle_prompt', 'idle', 'completed']
  ];
  for (const [eventName, notificationType, state, lastTurnState] of mappingCases) {
    const provider = ['StopFailure', 'SessionEnd', 'Notification'].includes(eventName)
      ? 'claude'
      : 'codex';
    const event = makeHookEvent(contract, {
      provider,
      rawInput: {
        hook_event_name: eventName,
        ...(notificationType ? { notification_type: notificationType } : {})
      }
    });
    const normalized = contract.normalizeCodingAgentHookEvent(event);
    assert.equal(normalized.state, state);
    assert.equal(normalized.lastTurnState, lastTurnState);
  }
  assert.throws(
    () => contract.parseCodingAgentHookEvent({ ...redactedEvent, prompt: secretSentinel }),
    /unsupported fields/
  );
  assert.throws(
    () => contract.parseCodingAgentHookEvent({ ...redactedEvent, eventId: 'invalid' }),
    /UUID/
  );
  assert.throws(
    () => makeHookEvent(contract, {
      provider: 'claude',
      rawInput: {
        hook_event_name: 'Notification',
        notification_type: 'agent_completed'
      }
    }),
    /Unsupported Claude notification type/,
    'Agent View background notifications must not create foreground hook evidence'
  );

  // Generated shims pin every argument and never forward provider argv.
  const posixShim = contract.createPosixCodingAgentHookShim({
    execPath: "/Applications/Bitterless O'Clock.app/Contents/MacOS/Bitterless",
    appPath: "/Applications/Bitterless O'Clock.app",
    endpointPath: "/tmp/Profile O'Clock/coding-agent/bridge.sock",
    provider: 'codex',
    installationId: INSTALLATION_ID
  });
  assert.match(posixShim, /^#!\/bin\/sh\n/);
  assert.ok(posixShim.includes("'\\''"), 'single quotes must use POSIX-safe quoting');
  assert.ok(!posixShim.includes('$@'));
  assert.ok(posixShim.includes('>/dev/null 2>/dev/null || true'));
  const windowsShim = contract.createWindowsCodingAgentHookShim({
    execPath: 'C:\\Program Files\\Bitterless % Build&^\\Bitterless.exe',
    appPath: null,
    endpointPath: '\\\\.\\pipe\\bitterless-coding-agent-aabbccddeeff',
    provider: 'claude',
    installationId: INSTALLATION_ID
  });
  assert.ok(windowsShim.includes('Bitterless %% Build&^'));
  assert.ok(windowsShim.includes('DisableDelayedExpansion'));
  assert.ok(!windowsShim.includes('%*'));
  assert.ok(windowsShim.endsWith('exit /b 0\r\n'));
  assert.throws(
    () => contract.createWindowsCodingAgentHookShim({
      execPath: 'C:\\Bad"Path\\Bitterless.exe',
      appPath: null,
      endpointPath: windowsEndpoint.path,
      provider: 'codex',
      installationId: INSTALLATION_ID
    }),
    /double quotes/
  );

  // Helper failures are silent, successful, and bounded when the GUI/socket is unavailable.
  let stdout = '';
  let stderr = '';
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk) => {
    stdout += String(chunk);
    return true;
  });
  process.stderr.write = ((chunk) => {
    stderr += String(chunk);
    return true;
  });
  const unavailableRoot = tempRoot('hook-unavailable');
  const unavailablePath = join(unavailableRoot, 'missing', 'bridge.sock');
  const helperStartedAt = Date.now();
  try {
    await helper.runAgentSessionHookHelper(
      hookArgs(contract, unavailablePath),
      Readable.from([JSON.stringify({
        session_id: SESSION_ID,
        cwd: projectRoot,
        hook_event_name: 'Stop'
      })])
    );
    await helper.runAgentSessionHookHelper(
      [...hookArgs(contract, unavailablePath), '--unknown'],
      Readable.from(['not-json'])
    );
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  assert.ok(Date.now() - helperStartedAt < 750, 'unavailable bridge must fast-success');
  assert.equal(stdout, '');
  assert.equal(stderr, '');

  // Real bridge: quick ACK before DAO, serialization, dedupe, limits, identity, and permissions.
  const bridgeRoot = tempRoot('event-bridge');
  const bridgeEndpoint = contract.getCodingAgentBridgeEndpoint(bridgeRoot, 'darwin');
  const bridgeServer = new serverModule.AgentSessionEventBridgeServer();
  const firstConsumerGate = deferred();
  const consumed = [];
  await bridgeServer.start({
    endpoint: bridgeEndpoint,
    installationId: INSTALLATION_ID,
    consume: async (event) => {
      consumed.push(event.eventId);
      if (event.eventId === EVENT_1) await firstConsumerGate.promise;
    }
  });
  assert.equal(statSync(dirname(bridgeEndpoint.path)).mode & 0o777, 0o700);
  assert.equal(lstatSync(bridgeEndpoint.path).mode & 0o777, 0o600);
  const firstEvent = makeHookEvent(contract);
  assert.deepEqual(
    await exchangeFrame(bridgeEndpoint.path, `${JSON.stringify(firstEvent)}\n`),
    { ok: true },
    'ACK must not wait for the DAO consumer'
  );
  assert.deepEqual(
    await exchangeFrame(bridgeEndpoint.path, `${JSON.stringify(firstEvent)}\n`),
    { ok: true, duplicate: true }
  );
  const secondEvent = makeHookEvent(contract, { eventId: EVENT_2, occurredAt: 3000 });
  assert.deepEqual(
    await exchangeFrame(bridgeEndpoint.path, `${JSON.stringify(secondEvent)}\n`),
    { ok: true }
  );
  assert.deepEqual(consumed, [EVENT_1], 'DAO consumers must stay serialized');
  const olderEvent = makeHookEvent(contract, { eventId: EVENT_3, occurredAt: 2500 });
  await exchangeFrame(bridgeEndpoint.path, `${JSON.stringify(olderEvent)}\n`);
  assert.equal(bridgeServer.getLastEventAt('codex'), 3000, 'old events cannot regress status time');
  assert.deepEqual(
    await exchangeFrame(
      bridgeEndpoint.path,
      `${JSON.stringify({ ...secondEvent, eventId: EVENT_3, installationId: OTHER_INSTALLATION_ID })}\n`
    ),
    { ok: false, error: 'invalid-event' }
  );
  assert.deepEqual(
    await exchangeFrame(
      bridgeEndpoint.path,
      `${'x'.repeat(contract.CODING_AGENT_BRIDGE_MAX_FRAME_BYTES + 1)}\n`
    ),
    { ok: false, error: 'frame-too-large' }
  );
  const partialStartedAt = Date.now();
  await waitForSocketClose(bridgeEndpoint.path, '{');
  assert.ok(Date.now() - partialStartedAt < 1600, 'partial clients must be timed out');
  firstConsumerGate.resolve();
  await bridgeServer.stop();
  assert.deepEqual(consumed, [EVENT_1, EVENT_2, EVENT_3]);
  assert.equal(bridgeServer.getLastEventAt('codex'), null, 'restart must clear event freshness');
  assert.equal(existsSync(bridgeEndpoint.path), false);

  const nonSocketRoot = tempRoot('bridge-non-socket');
  const nonSocketEndpoint = contract.getCodingAgentBridgeEndpoint(nonSocketRoot, 'darwin');
  mkdirSync(dirname(nonSocketEndpoint.path), { recursive: true });
  writeFileSync(nonSocketEndpoint.path, 'do not unlink me');
  const nonSocketServer = new serverModule.AgentSessionEventBridgeServer();
  await assert.rejects(
    nonSocketServer.start({
      endpoint: nonSocketEndpoint,
      installationId: INSTALLATION_ID,
      consume: async () => {}
    }),
    /Refusing non-socket bridge path/
  );
  assert.equal(readFileSync(nonSocketEndpoint.path, 'utf8'), 'do not unlink me');

  if (process.platform !== 'win32') {
    const staleRoot = tempRoot('bridge-stale');
    const staleEndpoint = contract.getCodingAgentBridgeEndpoint(staleRoot, 'darwin');
    mkdirSync(dirname(staleEndpoint.path), { recursive: true });
    const childCode = [
      "const net = require('node:net');",
      'const server = net.createServer();',
      "server.listen(process.argv[1], () => process.stdout.write('ready\\n'));",
      'setInterval(() => {}, 1000);'
    ].join('');
    const child = spawn(process.execPath, ['-e', childCode, staleEndpoint.path], {
      stdio: ['ignore', 'pipe', 'inherit']
    });
    await once(child.stdout, 'data');
    child.kill('SIGKILL');
    await once(child, 'exit');
    assert.ok(existsSync(staleEndpoint.path), 'SIGKILL fixture must leave a stale socket');
    const staleServer = new serverModule.AgentSessionEventBridgeServer();
    await staleServer.start({
      endpoint: staleEndpoint,
      installationId: INSTALLATION_ID,
      consume: async () => {}
    });
    assert.ok(staleServer.isListening());
    await staleServer.stop();
  }

  // Codex merge/remove: backup, idempotence, unrelated hooks, trust, and explicit repair.
  const codexSetup = makeStatusService(statusModule, 'codex-install', {
    bridgeStatus: () => ({ listening: true, lastEventAt: 4321 })
  });
  const codexSettingsPath = join(codexSetup.homePath, '.codex', 'hooks.json');
  const codexBackupPath = join(
    codexSetup.userDataPath,
    'coding-agent',
    'backups',
    'codex-original.json'
  );
  const codexShimPath = join(codexSetup.userDataPath, 'bin', 'bitterless-codex-session-hook');
  const unrelatedCommand = "'/tmp/another-profile/bitterless-codex-session-hook'";
  const originalCodex = `${JSON.stringify({
    theme: 'dark',
    hooks: {
      Stop: [{
        hooks: [{ type: 'command', command: unrelatedCommand, timeout: 7 }]
      }]
    }
  }, null, 4)}\n`;
  mkdirSync(dirname(codexSettingsPath), { recursive: true });
  writeFileSync(codexSettingsPath, originalCodex);
  const codexInstalled = codexSetup.service.install('codex');
  assert.equal(codexInstalled.configuration, 'configured');
  assert.equal(codexInstalled.requiresTrust, true);
  assert.equal(codexInstalled.bridgeListening, true);
  assert.equal(codexInstalled.lastEventAt, 4321);
  assert.match(codexInstalled.message, /\/hooks/);
  assert.equal(readFileSync(codexBackupPath, 'utf8'), originalCodex);
  const installedCodexText = readFileSync(codexSettingsPath, 'utf8');
  const installedCodex = JSON.parse(installedCodexText);
  assert.equal(installedCodex.theme, 'dark');
  assert.ok(JSON.stringify(installedCodex).includes(unrelatedCommand));
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop']) {
    assert.ok(JSON.stringify(installedCodex.hooks[event]).includes(codexShimPath));
  }
  assert.equal(statSync(codexShimPath).mode & 0o777, 0o700);
  assert.ok(!readFileSync(codexShimPath, 'utf8').includes('$@'));
  codexSetup.service.install('codex');
  assert.equal(readFileSync(codexSettingsPath, 'utf8'), installedCodexText);

  // Modified/duplicated owned definitions report drift; explicit install is the Repair action.
  const modifiedCodex = JSON.parse(readFileSync(codexSettingsPath, 'utf8'));
  const ownedStopHandlers = modifiedCodex.hooks.Stop[0].hooks.filter(
    (handler) => handler.command?.includes(codexShimPath)
  );
  ownedStopHandlers[0].timeout = 9;
  ownedStopHandlers.push({ ...ownedStopHandlers[0] });
  writeFileSync(codexSettingsPath, `${JSON.stringify(modifiedCodex, null, 2)}\n`);
  const driftBytes = readFileSync(codexSettingsPath);
  assert.equal(codexSetup.service.getStatus('codex').configuration, 'drifted');
  assert.deepEqual(readFileSync(codexSettingsPath), driftBytes, 'status checks never repair drift');
  assert.equal(codexSetup.service.install('codex').configuration, 'configured');
  const repairedCodex = JSON.parse(readFileSync(codexSettingsPath, 'utf8'));
  const repairedOwnedStops = repairedCodex.hooks.Stop[0].hooks.filter(
    (handler) => handler.command?.includes(codexShimPath)
  );
  assert.equal(repairedOwnedStops.length, 1);
  assert.equal(repairedOwnedStops[0].timeout, 2);
  assert.ok(JSON.stringify(repairedCodex).includes(unrelatedCommand));

  const movedCodex = JSON.parse(readFileSync(codexSettingsPath, 'utf8'));
  const movedHandlerIndex = movedCodex.hooks.Stop[0].hooks.findIndex(
    (handler) => handler.command?.includes(codexShimPath)
  );
  const [movedHandler] = movedCodex.hooks.Stop[0].hooks.splice(movedHandlerIndex, 1);
  movedCodex.hooks.PreToolUse = [{ matcher: 'Shell', hooks: [movedHandler] }];
  writeFileSync(codexSettingsPath, `${JSON.stringify(movedCodex, null, 2)}\n`);
  assert.match(codexSetup.service.getStatus('codex').message, /unexpected events/);
  assert.equal(codexSetup.service.install('codex').configuration, 'configured');
  const movedRepaired = JSON.parse(readFileSync(codexSettingsPath, 'utf8'));
  assert.ok(!JSON.stringify(movedRepaired.hooks.PreToolUse ?? {}).includes(codexShimPath));
  assert.ok(JSON.stringify(movedRepaired.hooks.Stop).includes(codexShimPath));

  writeFileSync(codexShimPath, 'tampered shim');
  assert.equal(codexSetup.service.getStatus('codex').configuration, 'drifted');
  assert.equal(codexSetup.service.install('codex').configuration, 'configured');
  assert.ok(!readFileSync(codexShimPath, 'utf8').includes('tampered shim'));

  const upgradedService = new statusModule.CodingAgentStatusBridgeService({
    homePath: codexSetup.homePath,
    userDataPath: codexSetup.userDataPath,
    execPath: '/Applications/Bitterless Next.app/Contents/MacOS/Bitterless',
    appPath: '/Applications/Bitterless Next.app',
    platform: 'darwin',
    idFactory: () => OTHER_INSTALLATION_ID
  });
  assert.equal(upgradedService.getStatus('codex').configuration, 'drifted');
  assert.equal(upgradedService.install('codex').configuration, 'configured');
  assert.ok(readFileSync(codexShimPath, 'utf8').includes('Bitterless Next.app'));
  assert.equal(readFileSync(codexBackupPath, 'utf8'), originalCodex, 'first backup is immutable');

  assert.equal(upgradedService.remove('codex').configuration, 'not-installed');
  const removedCodex = JSON.parse(readFileSync(codexSettingsPath, 'utf8'));
  assert.equal(removedCodex.theme, 'dark');
  assert.ok(JSON.stringify(removedCodex).includes(unrelatedCommand));
  assert.ok(!JSON.stringify(removedCodex).includes(codexShimPath));
  const onceRemoved = readFileSync(codexSettingsPath, 'utf8');
  upgradedService.remove('codex');
  assert.equal(readFileSync(codexSettingsPath, 'utf8'), onceRemoved);
  assert.equal(readFileSync(codexBackupPath, 'utf8'), originalCodex);

  const emptySetup = makeStatusService(statusModule, 'codex-empty');
  const emptySettingsPath = join(emptySetup.homePath, '.codex', 'hooks.json');
  assert.equal(emptySetup.service.install('codex').configuration, 'configured');
  assert.ok(existsSync(emptySettingsPath));
  assert.equal(emptySetup.service.remove('codex').configuration, 'not-installed');
  assert.equal(existsSync(emptySettingsPath), false, 'remove restores a missing original file');

  const invalidCodexSetup = makeStatusService(statusModule, 'codex-invalid');
  const invalidCodexPath = join(invalidCodexSetup.homePath, '.codex', 'hooks.json');
  mkdirSync(dirname(invalidCodexPath), { recursive: true });
  writeFileSync(invalidCodexPath, '{ invalid');
  assert.equal(invalidCodexSetup.service.install('codex').configuration, 'invalid');
  assert.equal(readFileSync(invalidCodexPath, 'utf8'), '{ invalid');

  // First-install ownership is persisted before artifacts, so every interruption can retry/remove.
  const codexPendingStages = ['pending-state', 'backup', 'shim', 'settings'];
  for (const outcome of ['retry', 'remove']) {
    for (const stage of codexPendingStages) {
      const pendingSetup = makeStatusService(
        statusModule,
        `codex-pending-${outcome}-${stage}`,
        {
          installCheckpoint: (_provider, checkpoint) => {
            if (checkpoint === stage) throw new Error(`fixture-${stage}`);
          }
        }
      );
      const pendingSettingsPath = join(pendingSetup.homePath, '.codex', 'hooks.json');
      const pendingStatePath = join(
        pendingSetup.userDataPath,
        'coding-agent',
        'installation.json'
      );
      const pendingBackupPath = join(
        pendingSetup.userDataPath,
        'coding-agent',
        'backups',
        'codex-original.json'
      );
      const pendingShimPath = join(
        pendingSetup.userDataPath,
        'bin',
        'bitterless-codex-session-hook'
      );
      const pendingOriginal = `${JSON.stringify({ keep: `${outcome}-${stage}` }, null, 2)}\n`;
      mkdirSync(dirname(pendingSettingsPath), { recursive: true });
      writeFileSync(pendingSettingsPath, pendingOriginal);
      assert.throws(() => pendingSetup.service.install('codex'), new RegExp(`fixture-${stage}`));
      const pendingState = JSON.parse(readFileSync(pendingStatePath, 'utf8'));
      assert.equal(pendingState.providers.codex.installed, false);
      assert.equal(pendingState.providers.codex.pending, true);
      assert.equal(pendingState.providers.codex.settingsPath, pendingSettingsPath);
      assert.equal(typeof pendingState.providers.codex.originalHash, 'string');
      assert.equal(existsSync(pendingBackupPath), stage !== 'pending-state');
      assert.equal(
        existsSync(pendingShimPath),
        stage === 'shim' || stage === 'settings'
      );

      const resumedService = new statusModule.CodingAgentStatusBridgeService({
        homePath: pendingSetup.homePath,
        userDataPath: pendingSetup.userDataPath,
        execPath: '/Applications/Bitterless App.app/Contents/MacOS/Bitterless',
        appPath: '/Applications/Bitterless App.app',
        platform: 'darwin',
        idFactory: () => OTHER_INSTALLATION_ID
      });
      if (outcome === 'retry') {
        assert.equal(resumedService.install('codex').configuration, 'configured');
        assert.equal(readFileSync(pendingBackupPath, 'utf8'), pendingOriginal);
      } else {
        assert.equal(resumedService.remove('codex').configuration, 'not-installed');
        assert.deepEqual(JSON.parse(readFileSync(pendingSettingsPath, 'utf8')), {
          keep: `${outcome}-${stage}`
        });
        assert.equal(existsSync(pendingShimPath), false);
        if (stage !== 'pending-state') {
          assert.equal(readFileSync(pendingBackupPath, 'utf8'), pendingOriginal);
        }
      }
    }
  }
  const tamperedPendingSetup = makeStatusService(
    statusModule,
    'codex-pending-tampered-shim',
    {
      installCheckpoint: (_provider, checkpoint) => {
        if (checkpoint === 'shim') throw new Error('fixture-tampered-shim');
      }
    }
  );
  const tamperedPendingSettings = join(
    tamperedPendingSetup.homePath,
    '.codex',
    'hooks.json'
  );
  mkdirSync(dirname(tamperedPendingSettings), { recursive: true });
  writeFileSync(tamperedPendingSettings, '{"keep":true}\n');
  assert.throws(
    () => tamperedPendingSetup.service.install('codex'),
    /fixture-tampered-shim/
  );
  const tamperedPendingShim = join(
    tamperedPendingSetup.userDataPath,
    'bin',
    'bitterless-codex-session-hook'
  );
  writeFileSync(tamperedPendingShim, 'third-party replacement');
  const tamperedRetry = new statusModule.CodingAgentStatusBridgeService({
    homePath: tamperedPendingSetup.homePath,
    userDataPath: tamperedPendingSetup.userDataPath,
    execPath: '/Applications/Bitterless App.app/Contents/MacOS/Bitterless',
    appPath: '/Applications/Bitterless App.app',
    platform: 'darwin'
  });
  assert.equal(tamperedRetry.install('codex').configuration, 'drifted');
  assert.equal(tamperedRetry.remove('codex').configuration, 'drifted');
  assert.equal(readFileSync(tamperedPendingShim, 'utf8'), 'third-party replacement');

  const tamperedCodexSettingsSetup = makeStatusService(
    statusModule,
    'codex-pending-tampered-settings',
    {
      installCheckpoint: (_provider, checkpoint) => {
        if (checkpoint === 'settings') throw new Error('fixture-tampered-settings');
      }
    }
  );
  assert.throws(
    () => tamperedCodexSettingsSetup.service.install('codex'),
    /fixture-tampered-settings/
  );
  const tamperedCodexSettingsPath = join(
    tamperedCodexSettingsSetup.homePath,
    '.codex',
    'hooks.json'
  );
  const tamperedCodexSettings = JSON.parse(
    readFileSync(tamperedCodexSettingsPath, 'utf8')
  );
  tamperedCodexSettings.hooks.Stop[0].hooks[0].timeout = 9;
  writeFileSync(
    tamperedCodexSettingsPath,
    `${JSON.stringify(tamperedCodexSettings, null, 2)}\n`
  );
  const tamperedCodexRemoval = new statusModule.CodingAgentStatusBridgeService({
    homePath: tamperedCodexSettingsSetup.homePath,
    userDataPath: tamperedCodexSettingsSetup.userDataPath,
    execPath: '/Applications/Bitterless App.app/Contents/MacOS/Bitterless',
    appPath: '/Applications/Bitterless App.app',
    platform: 'darwin'
  });
  assert.equal(tamperedCodexRemoval.remove('codex').configuration, 'drifted');
  assert.equal(
    JSON.parse(readFileSync(tamperedCodexSettingsPath, 'utf8')).hooks.Stop[0].hooks[0].timeout,
    9,
    'pending remove must preserve a tampered Codex handler'
  );

  // Claude JSONC keeps comments/trailing commas and is correctly labeled as CLI, not Desktop.
  const claudeSpecialRoot = tempRoot('claude-special-paths');
  const claudeUserData = join(claudeSpecialRoot, 'User Data %&');
  const claudeExecPath = '/Applications/Bitterless % &.app/Contents/MacOS/Bitterless';
  const claudeAppPath = '/Applications/Bitterless % &.app';
  const claudeSetup = makeStatusService(statusModule, 'claude-jsonc', {
    userDataPath: claudeUserData,
    execPath: claudeExecPath,
    appPath: claudeAppPath
  });
  const claudeSettingsPath = join(claudeSetup.homePath, '.claude', 'settings.json');
  const originalClaude = `{
  // KEEP_ROOT_COMMENT
  "theme": "night",
  "untouched": [
    "KEEP_TRAILING_COMMA",
  ],
  "hooks": {
    "Stop": [
      {
        // KEEP_STOP_COMMENT
        "hooks": [
          { "type": "command", "command": "'/tmp/unrelated-claude-hook'", "timeout": 5 },
          { "type": "command", "command": "/tmp/other-profile-exec", "args": ["--coding-agent-hook-helper", "--coding-agent-installation-id", "${OTHER_INSTALLATION_ID}"], "timeout": 2 },
        ],
      },
    ],
  },
}
`;
  mkdirSync(dirname(claudeSettingsPath), { recursive: true });
  writeFileSync(claudeSettingsPath, originalClaude);
  const claudeInstalled = claudeSetup.service.install('claude');
  assert.equal(claudeInstalled.configuration, 'configured');
  assert.equal(claudeInstalled.product, 'Claude Code CLI');
  assert.equal(claudeInstalled.requiresTrust, false);
  assert.match(claudeInstalled.message, /not Claude Desktop/);
  const installedClaudeText = readFileSync(claudeSettingsPath, 'utf8');
  assert.ok(installedClaudeText.includes('// KEEP_ROOT_COMMENT'));
  assert.ok(installedClaudeText.includes('// KEEP_STOP_COMMENT'));
  assert.ok(installedClaudeText.includes('"theme": "night"'));
  assert.ok(
    installedClaudeText.includes('"KEEP_TRAILING_COMMA",\n  ],'),
    'unrelated trailing comma is preserved'
  );
  const installedClaude = parseJsonc(installedClaudeText, [], { allowTrailingComma: true });
  const claudeHandlers = Object.values(installedClaude.hooks)
    .flatMap((groups) => groups)
    .flatMap((group) => group.hooks);
  const ownedClaudeHandlers = claudeHandlers.filter((handler) =>
    handler.args?.includes(contract.CODING_AGENT_HOOK_HELPER_ARG) &&
    handler.args?.includes(INSTALLATION_ID)
  );
  assert.equal(ownedClaudeHandlers.length, 7);
  for (const handler of ownedClaudeHandlers) {
    assert.deepEqual(Object.keys(handler).sort(), ['args', 'command', 'timeout', 'type']);
    assert.equal(handler.command, claudeExecPath);
    assert.equal(handler.args[0], claudeAppPath);
    assert.ok(handler.args.includes(contract.CODING_AGENT_HOOK_HELPER_ARG));
    assert.ok(handler.args.includes(contract.CODING_AGENT_BRIDGE_PATH_ARG));
    assert.ok(handler.args.includes(INSTALLATION_ID));
  }
  const claudeShimPath = join(claudeUserData, 'bin', 'bitterless-claude-session-hook');
  assert.equal(existsSync(claudeShimPath), false, 'Claude exec-form must not generate a shim');

  const driftedClaudeText = installedClaudeText.replace(
    JSON.stringify(claudeExecPath),
    JSON.stringify('/tmp/drifted Claude command %&')
  );
  assert.notEqual(driftedClaudeText, installedClaudeText);
  writeFileSync(claudeSettingsPath, driftedClaudeText);
  assert.equal(claudeSetup.service.getStatus('claude').configuration, 'drifted');
  assert.equal(claudeSetup.service.install('claude').configuration, 'configured');
  const repairedClaude = parseJsonc(
    readFileSync(claudeSettingsPath, 'utf8'),
    [],
    { allowTrailingComma: true }
  );
  const repairedClaudeHandlers = Object.values(repairedClaude.hooks)
    .flatMap((groups) => groups)
    .flatMap((group) => group.hooks)
    .filter((handler) => handler.args?.includes(INSTALLATION_ID));
  assert.equal(repairedClaudeHandlers.length, 7);
  assert.ok(repairedClaudeHandlers.every((handler) => handler.command === claudeExecPath));
  assert.equal(claudeSetup.service.remove('claude').configuration, 'not-installed');
  const removedClaudeText = readFileSync(claudeSettingsPath, 'utf8');
  assert.ok(removedClaudeText.includes('// KEEP_ROOT_COMMENT'));
  assert.ok(removedClaudeText.includes('// KEEP_STOP_COMMENT'));
  assert.ok(removedClaudeText.includes('"KEEP_TRAILING_COMMA",\n  ],'));
  assert.ok(removedClaudeText.includes("'/tmp/unrelated-claude-hook'"));
  assert.ok(removedClaudeText.includes(OTHER_INSTALLATION_ID));
  assert.ok(!removedClaudeText.includes(INSTALLATION_ID));
  assert.equal(existsSync(claudeShimPath), false);

  const invalidClaudeSetup = makeStatusService(statusModule, 'claude-invalid');
  const invalidClaudePath = join(invalidClaudeSetup.homePath, '.claude', 'settings.json');
  mkdirSync(dirname(invalidClaudePath), { recursive: true });
  writeFileSync(invalidClaudePath, '{ // comment\n invalid: }');
  assert.equal(invalidClaudeSetup.service.install('claude').configuration, 'invalid');
  assert.equal(readFileSync(invalidClaudePath, 'utf8'), '{ // comment\n invalid: }');

  for (const outcome of ['retry', 'remove']) {
    for (const stage of ['pending-state', 'backup', 'settings']) {
      const pendingClaudeRoot = tempRoot(`claude-pending-path-${outcome}-${stage}`);
      const pendingClaudeUserData = join(pendingClaudeRoot, 'User Data %&');
      const pendingClaudeSetup = makeStatusService(
        statusModule,
        `claude-pending-${outcome}-${stage}`,
        {
          userDataPath: pendingClaudeUserData,
          execPath: '/Applications/Bitterless % &.app/Contents/MacOS/Bitterless',
          appPath: '/Applications/Bitterless % &.app',
          installCheckpoint: (_provider, checkpoint) => {
            if (checkpoint === stage) throw new Error(`claude-fixture-${stage}`);
          }
        }
      );
      const settingsPath = join(pendingClaudeSetup.homePath, '.claude', 'settings.json');
      const backupPath = join(
        pendingClaudeUserData,
        'coding-agent',
        'backups',
        'claude-original.json'
      );
      const original = `{
  // PENDING_KEEP_COMMENT
  "keep": "${outcome}-${stage}",
}
`;
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, original);
      assert.throws(
        () => pendingClaudeSetup.service.install('claude'),
        new RegExp(`claude-fixture-${stage}`)
      );
      const resumedClaude = new statusModule.CodingAgentStatusBridgeService({
        homePath: pendingClaudeSetup.homePath,
        userDataPath: pendingClaudeUserData,
        execPath: '/Applications/Bitterless % &.app/Contents/MacOS/Bitterless',
        appPath: '/Applications/Bitterless % &.app',
        platform: 'darwin',
        idFactory: () => OTHER_INSTALLATION_ID
      });
      if (outcome === 'retry') {
        assert.equal(resumedClaude.install('claude').configuration, 'configured');
        assert.equal(readFileSync(backupPath, 'utf8'), original);
      } else {
        assert.equal(resumedClaude.remove('claude').configuration, 'not-installed');
        const removedPendingClaude = readFileSync(settingsPath, 'utf8');
        assert.ok(removedPendingClaude.includes('// PENDING_KEEP_COMMENT'));
        assert.ok(!removedPendingClaude.includes(contract.CODING_AGENT_HOOK_HELPER_ARG));
        assert.equal(
          existsSync(join(pendingClaudeUserData, 'bin', 'bitterless-claude-session-hook')),
          false
        );
      }
    }
  }

  const tamperedClaudeSettingsSetup = makeStatusService(
    statusModule,
    'claude-pending-tampered-settings',
    {
      installCheckpoint: (_provider, checkpoint) => {
        if (checkpoint === 'settings') throw new Error('claude-fixture-tampered-settings');
      }
    }
  );
  assert.throws(
    () => tamperedClaudeSettingsSetup.service.install('claude'),
    /claude-fixture-tampered-settings/
  );
  const tamperedClaudeSettingsPath = join(
    tamperedClaudeSettingsSetup.homePath,
    '.claude',
    'settings.json'
  );
  const tamperedClaudeSettings = JSON.parse(
    readFileSync(tamperedClaudeSettingsPath, 'utf8')
  );
  tamperedClaudeSettings.hooks.Stop[0].hooks[0].args.push('--third-party-change');
  writeFileSync(
    tamperedClaudeSettingsPath,
    `${JSON.stringify(tamperedClaudeSettings, null, 2)}\n`
  );
  const tamperedClaudeRemoval = new statusModule.CodingAgentStatusBridgeService({
    homePath: tamperedClaudeSettingsSetup.homePath,
    userDataPath: tamperedClaudeSettingsSetup.userDataPath,
    execPath: '/Applications/Bitterless App.app/Contents/MacOS/Bitterless',
    appPath: '/Applications/Bitterless App.app',
    platform: 'darwin'
  });
  assert.equal(tamperedClaudeRemoval.remove('claude').configuration, 'drifted');
  assert.ok(
    JSON.parse(readFileSync(tamperedClaudeSettingsPath, 'utf8'))
      .hooks.Stop[0].hooks[0].args.includes('--third-party-change'),
    'pending remove must preserve a tampered Claude handler'
  );

  // Windows Codex schema includes commandWindows and safely quoted special characters.
  const windowsRoot = tempRoot('windows-install');
  const windowsUserData = join(windowsRoot, 'User Data %&^');
  const windowsSetup = makeStatusService(statusModule, 'windows-layout', {
    platform: 'win32',
    userDataPath: windowsUserData,
    execPath: 'C:\\Program Files\\Bitterless % Build&^\\Bitterless.exe',
    appPath: null
  });
  assert.equal(windowsSetup.service.install('codex').configuration, 'configured');
  const windowsConfig = JSON.parse(
    readFileSync(join(windowsSetup.homePath, '.codex', 'hooks.json'), 'utf8')
  );
  const windowsHandlers = Object.values(windowsConfig.hooks)
    .flatMap((groups) => groups)
    .flatMap((group) => group.hooks);
  for (const handler of windowsHandlers) {
    assert.equal(handler.commandWindows, handler.command);
    assert.ok(handler.command.includes('%&^'));
    assert.ok(!handler.command.includes('%%'));
  }
  const windowsHooksPath = join(windowsSetup.homePath, '.codex', 'hooks.json');
  const driftedWindowsConfig = JSON.parse(readFileSync(windowsHooksPath, 'utf8'));
  const driftedWindowsHandler = driftedWindowsConfig.hooks.SessionStart[0].hooks[0];
  driftedWindowsHandler.command = '"C:\\unrelated-hook.cmd"';
  writeFileSync(windowsHooksPath, `${JSON.stringify(driftedWindowsConfig, null, 2)}\n`);
  assert.equal(windowsSetup.service.getStatus('codex').configuration, 'drifted');
  assert.equal(windowsSetup.service.install('codex').configuration, 'configured');
  const repairedWindowsConfig = JSON.parse(readFileSync(windowsHooksPath, 'utf8'));
  const repairedWindowsHandlers = Object.values(repairedWindowsConfig.hooks)
    .flatMap((groups) => groups)
    .flatMap((group) => group.hooks);
  assert.equal(repairedWindowsHandlers.length, windowsHandlers.length);
  assert.ok(
    repairedWindowsHandlers.every((handler) => handler.commandWindows === handler.command),
    'repair removes the commandWindows-owned drifted handler before adding the exact handler'
  );
  assert.ok(
    readFileSync(join(windowsUserData, 'bin', 'bitterless-codex-session-hook.cmd'), 'utf8')
      .includes('Bitterless %% Build&^')
  );

  const windowsClaudeRoot = tempRoot('windows-claude-install');
  const windowsClaudeUserData = join(windowsClaudeRoot, 'Claude User Data %&');
  const windowsClaudeExec = 'C:\\Program Files\\Bitterless % &\\Bitterless.exe';
  const windowsClaudeApp = 'C:\\Program Files\\Bitterless % &\\resources\\app.asar';
  const windowsClaudeSetup = makeStatusService(statusModule, 'windows-claude-layout', {
    platform: 'win32',
    userDataPath: windowsClaudeUserData,
    execPath: windowsClaudeExec,
    appPath: windowsClaudeApp
  });
  assert.equal(windowsClaudeSetup.service.install('claude').configuration, 'configured');
  const windowsClaudePath = join(windowsClaudeSetup.homePath, '.claude', 'settings.json');
  const windowsClaudeConfig = JSON.parse(readFileSync(windowsClaudePath, 'utf8'));
  const windowsClaudeHandlers = Object.values(windowsClaudeConfig.hooks)
    .flatMap((groups) => groups)
    .flatMap((group) => group.hooks);
  assert.equal(windowsClaudeHandlers.length, 7);
  for (const handler of windowsClaudeHandlers) {
    assert.equal(handler.command, windowsClaudeExec);
    assert.equal(handler.args[0], windowsClaudeApp);
    assert.ok(handler.args.some((arg) => arg.includes('\\\\.\\pipe\\')));
    assert.ok(JSON.stringify(handler).includes('% &'));
    assert.ok(!JSON.stringify(handler).includes('%%'));
  }
  assert.equal(
    existsSync(join(windowsClaudeUserData, 'bin', 'bitterless-claude-session-hook.cmd')),
    false
  );
  assert.equal(windowsClaudeSetup.service.remove('claude').configuration, 'not-installed');

  // Hook evidence updates the canonical DAO row, obeys time/source precedence, and broadcasts IDs.
  const records = [];
  let repositoryWrites = 0;
  const repository = {
    list: async () => records.map((record) => ({ ...record })),
    getById: async ({ id }) => records.find((record) => record.id === id) ?? null,
    upsert: async (draft) => {
      repositoryWrites += 1;
      const existing = records.find((record) =>
        record.provider === draft.provider &&
        record.surface === draft.surface &&
        record.externalSessionId === draft.externalSessionId
      );
      const next = {
        ...existing,
        ...draft,
        id: existing?.id ?? draft.id,
        createdAt: existing?.createdAt ?? 1,
        updatedAt: (existing?.updatedAt ?? 1) + 1
      };
      if (existing) Object.assign(existing, next);
      else records.push(next);
      return { ...next };
    },
    updateStatus: async ({ id, ...status }) => {
      repositoryWrites += 1;
      const existing = records.find((record) => record.id === id);
      if (!existing) throw new Error('missing fake record');
      Object.assign(existing, status, { updatedAt: existing.updatedAt + 1 });
      return { ...existing };
    },
    rename: async () => { throw new Error('unused'); },
    softDelete: async () => false
  };
  const broadcasts = [];
  let clock = 1000;
  const sessionService = new sessionModule.CodingAgentSessionService({
    repository,
    codexDiscovery: { discover: async () => { throw new Error('unused'); } },
    claudeDiscovery: { discover: async () => { throw new Error('unused'); } },
    openExternal: async () => {},
    now: () => clock,
    idFactory: (() => {
      const ids = [
        ROW_ID,
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888'
      ];
      return () => ids.shift();
    })(),
    broadcastChanged: (ids, revision) => broadcasts.push({ ids, revision })
  });
  clock = 2000;
  const workingRow = await sessionService.applyHookEvent(firstEvent);
  assert.equal(workingRow.id, ROW_ID);
  assert.equal(workingRow.state, 'working');
  assert.equal(workingRow.lastTurnState, 'in_progress');
  assert.equal(workingRow.statusFreshUntil, 62000);
  assert.deepEqual(broadcasts, [{ ids: [ROW_ID], revision: 1 }]);
  const writesAfterWorking = repositoryWrites;
  const staleStop = makeHookEvent(contract, {
    eventId: EVENT_2,
    occurredAt: 1900,
    rawInput: { hook_event_name: 'Stop' }
  });
  const staleResult = await sessionService.applyHookEvent(staleStop);
  assert.equal(staleResult.state, 'working');
  assert.equal(repositoryWrites, writesAfterWorking);
  assert.equal(broadcasts.length, 1);

  clock = 3000;
  const stopEvent = makeHookEvent(contract, {
    eventId: EVENT_2,
    occurredAt: 3000,
    rawInput: { hook_event_name: 'Stop' }
  });
  const stoppedRow = await sessionService.applyHookEvent(stopEvent);
  assert.equal(stoppedRow.state, 'idle');
  assert.equal(stoppedRow.lastTurnState, 'completed');

  records.push({
    id: '55555555-5555-4555-8555-555555555555',
    provider: 'claude',
    surface: 'claude-code-background',
    externalSessionId: SESSION_ID,
    runtimeJobId: 'agent-job-1',
    title: 'Background agent',
    titleIsCustom: false,
    cwd: projectRoot,
    state: 'working',
    lastTurnState: 'in_progress',
    providerState: 'working',
    statusSource: 'claude-agents-cli',
    statusObservedAt: 3400,
    statusFreshUntil: 6400,
    isProcessAlive: true,
    createdAt: 1,
    updatedAt: 1
  });
  const beforeBackgroundHookCount = records.length;
  const beforeBackgroundHookWrites = repositoryWrites;
  const backgroundHook = makeHookEvent(contract, {
    provider: 'claude',
    eventId: EVENT_3,
    occurredAt: 3500,
    rawInput: { hook_event_name: 'Stop' }
  });
  const backgroundResult = await sessionService.applyHookEvent(backgroundHook);
  assert.equal(backgroundResult.surface, 'claude-code-cli');
  assert.equal(backgroundResult.state, 'idle');
  assert.equal(repositoryWrites, beforeBackgroundHookWrites + 1);
  assert.equal(records.length, beforeBackgroundHookCount + 1);
  assert.equal(
    records.some((record) =>
      record.provider === 'claude' &&
      record.surface === 'claude-code-cli' &&
      record.externalSessionId === SESSION_ID
    ),
    true,
    'a foreground hook after attach/resume gets its own foreground surface'
  );
  assert.equal(
    records.find((record) =>
      record.provider === 'claude' && record.surface === 'claude-code-background'
    ).state,
    'working',
    'historical background evidence remains on the background surface'
  );

  records.push({
    id: '99999999-9999-4999-8999-999999999999',
    provider: 'codex',
    surface: 'codex-managed-app-server',
    externalSessionId: MANAGED_SESSION_ID,
    runtimeJobId: null,
    title: 'Managed task',
    titleIsCustom: false,
    cwd: projectRoot,
    state: 'working',
    lastTurnState: 'in_progress',
    providerState: 'active',
    statusSource: 'codex-app-server',
    statusObservedAt: 3600,
    statusFreshUntil: 6600,
    isProcessAlive: true,
    createdAt: 1,
    updatedAt: 1
  });
  const managedCount = records.length;
  const managedHook = makeHookEvent(contract, {
    eventId: EVENT_2,
    occurredAt: 3700,
    rawInput: { session_id: MANAGED_SESSION_ID, hook_event_name: 'UserPromptSubmit' }
  });
  const managedTransition = await sessionService.applyHookEvent(managedHook);
  assert.equal(managedTransition.surface, 'codex-desktop');
  assert.equal(managedTransition.state, 'working');
  assert.equal(records.length, managedCount + 1);

  const endedEvent = makeHookEvent(contract, {
    provider: 'claude',
    eventId: EVENT_3,
    occurredAt: 4000,
    rawInput: { session_id: OTHER_SESSION_ID, hook_event_name: 'SessionEnd' }
  });
  const endedRow = await sessionService.applyHookEvent(endedEvent);
  assert.equal(endedRow.state, 'ended');
  assert.equal(endedRow.lastTurnState, 'unknown');

  const codexRecord = records.find((record) => record.provider === 'codex');
  codexRecord.statusSource = 'codex-app-server';
  codexRecord.statusObservedAt = 4500;
  codexRecord.statusFreshUntil = 5500;
  codexRecord.state = 'waiting_input';
  clock = 5000;
  const higherSourceWrites = repositoryWrites;
  const ignoredHook = makeHookEvent(contract, {
    eventId: EVENT_3,
    occurredAt: 5000,
    rawInput: { hook_event_name: 'Stop' }
  });
  assert.equal((await sessionService.applyHookEvent(ignoredHook)).state, 'waiting_input');
  assert.equal(repositoryWrites, higherSourceWrites);
  codexRecord.statusFreshUntil = 4999;
  clock = 6000;
  const acceptedAfterExpiry = makeHookEvent(contract, {
    eventId: EVENT_2,
    occurredAt: 6000,
    rawInput: { hook_event_name: 'Stop' }
  });
  const refreshedByHook = await sessionService.applyHookEvent(acceptedAfterExpiry);
  assert.equal(refreshedByHook.state, 'idle');
  assert.equal(refreshedByHook.statusSource, 'codex-hook');
  assert.equal(repositoryWrites, higherSourceWrites + 1);
  codexRecord.statusSource = 'codex-app-server';
  codexRecord.statusObservedAt = 6500;
  codexRecord.statusFreshUntil = null;
  codexRecord.state = 'ended';
  clock = 7000;
  const restartedAfterTerminal = makeHookEvent(contract, {
    eventId: EVENT_3,
    occurredAt: 7000,
    rawInput: { hook_event_name: 'UserPromptSubmit' }
  });
  const restartedByHook = await sessionService.applyHookEvent(restartedAfterTerminal);
  assert.equal(restartedByHook.state, 'working');
  assert.equal(restartedByHook.statusSource, 'codex-hook');
  assert.equal(repositoryWrites, higherSourceWrites + 2);
  assert.deepEqual(
    broadcasts.map((item) => Object.keys(item).sort()),
    broadcasts.map(() => ['ids', 'revision']),
    'broadcasts carry only canonical IDs and a revision'
  );

  // App bootstrap keeps helper mode before readiness and shuts the bridge down first.
  const appSource = readFileSync(join(projectRoot, 'src', 'main', 'app.main.ts'), 'utf8');
  const helperBranchIndex = appSource.indexOf('if (isCodingAgentHookHelperMode)');
  const readinessIndex = appSource.indexOf('app.whenReady()');
  assert.ok(helperBranchIndex >= 0 && helperBranchIndex < readinessIndex);
  assert.ok(appSource.includes("await import('./xpc/xpc.helper')"));
  assert.ok(
    appSource.indexOf('await stopCodingAgentSessionBridge?.()') <
      appSource.indexOf('await mcpBridgeServer.stop()')
  );

  originalStdoutWrite.call(process.stdout, 'coding-agent bridge tests passed\n');
} finally {
  for (const path of tempRoots.reverse()) rmSync(path, { recursive: true, force: true });
}
