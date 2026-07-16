import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-bridge-build-'));
const profileRoot = mkdtempSync(join(tmpdir(), 'bitterless-eyes-bridge-profile-'));
const homePath = join(profileRoot, 'home');
const userDataPath = join(profileRoot, 'user-data');
const settingsPath = join(homePath, '.codex', 'hooks.json');
const shimPath = join(userDataPath, 'bin', 'bitterless-codex-session-hook');
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
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

const ownedHandlers = (root) => Object.values(root.hooks ?? {}).flatMap((groups) =>
  groups.flatMap((group) => group.hooks.filter((handler) =>
    typeof handler.command === 'string' && handler.command.includes('bitterless-codex-session-hook')
  ))
);

try {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: 'custom',
        hooks: [{ type: 'command', command: '/usr/bin/user-hook', timeout: 5 }]
      }]
    },
    userSetting: true
  }, null, 2)}\n`);

  const { CodexDesktopBridgeService } = await loadTypeScriptModule(
    'service',
    'src/main/eyesOnAgents/codexDesktopBridge.service.ts'
  );
  const service = new CodexDesktopBridgeService({
    userDataPath,
    homePath,
    execPath: '/Applications/Bitterless.app/Contents/MacOS/Bitterless',
    appPath: null,
    platform: 'darwin',
    idFactory: () => INSTALLATION_ID,
    runtimeStatus: () => ({ listening: true, lastEventAt: 123 })
  });

  assert.equal(service.getStatus().state, 'not_installed');
  assert.equal(service.install().state, 'installed');
  assert.equal(existsSync(shimPath), true);
  let root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(root.userSetting, true);
  assert.equal(root.hooks.SessionStart[0].hooks[0].command, '/usr/bin/user-hook');
  assert.equal(ownedHandlers(root).length, 4);
  assert.equal(existsSync(join(homePath, '.claude')), false, 'Codex bridge must not touch other agents');

  assert.equal(service.install().state, 'installed');
  root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(ownedHandlers(root).length, 4, 'repeated install must stay idempotent');

  const owned = ownedHandlers(root)[0];
  owned.timeout = 999;
  writeFileSync(settingsPath, `${JSON.stringify(root, null, 2)}\n`);
  assert.equal(service.getStatus().state, 'drifted');
  assert.equal(service.install().state, 'installed', 'install must repair owned hook drift');

  assert.equal(service.remove().state, 'not_installed');
  root = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(root.userSetting, true);
  assert.equal(root.hooks.SessionStart[0].hooks[0].command, '/usr/bin/user-hook');
  assert.equal(ownedHandlers(root).length, 0);
  assert.equal(existsSync(shimPath), false);

  const contract = await loadTypeScriptModule(
    'contract',
    'src/shared/eyesOnAgents/codexHookBridge.contract.ts'
  );
  const endpoint = contract.getCodexHookBridgeEndpoint(userDataPath, 'darwin');
  const args = contract.createCodexHookHelperArguments(endpoint.path, INSTALLATION_ID);
  assert.deepEqual(
    contract.parseCodexHookHelperArgs(['Bitterless', ...args], 'darwin'),
    { endpoint, installationId: INSTALLATION_ID }
  );
  const providerIndex = args.indexOf('--coding-agent-provider');
  const rejectedArgs = [...args];
  rejectedArgs[providerIndex + 1] = 'unsupported-agent';
  assert.throws(
    () => contract.parseCodexHookHelperArgs(['Bitterless', ...rejectedArgs], 'darwin'),
    /only accepts codex/
  );

  const secret = 'PROMPT-SENTINEL-MUST-NOT-BE-FORWARDED';
  const event = contract.createCodexHookEvent({
    rawInput: {
      session_id: THREAD_ID,
      cwd: '/repo',
      hook_event_name: 'UserPromptSubmit',
      turn_id: 'turn-a',
      prompt: secret,
      transcript: secret,
      tool_payload: secret
    },
    installationId: INSTALLATION_ID,
    eventId: EVENT_ID,
    occurredAt: 500
  });
  assert.doesNotMatch(JSON.stringify(event), /PROMPT-SENTINEL/);
  assert.equal(event.payload.sessionId, THREAD_ID);

  console.log('EyesOnAgents Codex bridge tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(profileRoot, { recursive: true, force: true });
}
