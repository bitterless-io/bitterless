import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildClaudeAuthLoginEnvironment } from '../../src/main/claudeSubscription/claudeAuthLogin.pty';

const readSource = async (relativePath: string): Promise<string> =>
  await readFile(path.resolve(process.cwd(), relativePath), 'utf8');

test('auth login environment is rebuilt with three exact directories and no inherited auth', () => {
  const environment = buildClaudeAuthLoginEnvironment(
    {
      PATH: '/usr/bin',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
      ANTHROPIC_API_KEY: 'danger',
      ANTHROPIC_AUTH_TOKEN: 'danger',
      ANTHROPIC_BASE_URL: 'danger',
      ANTHROPIC_PROFILE: 'danger',
      CLAUDE_CODE_OAUTH_TOKEN: 'danger',
      CLAUDE_CODE_REFRESH_TOKEN: 'danger',
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_PROFILE: 'danger',
      GOOGLE_APPLICATION_CREDENTIALS: 'danger',
      AZURE_API_KEY: 'danger',
      BROWSER: '/usr/bin/open'
    },
    {
      configDirectory: '/tmp/bitterless-account/profile',
      secureStorageConfigDirectory: '/tmp/bitterless-account/profile',
      anthropicConfigDirectory: '/tmp/bitterless-account/profile/anthropic'
    }
  );
  assert.deepEqual(
    {
      PATH: environment.PATH,
      HOME: environment.HOME,
      LANG: environment.LANG,
      TERM: environment.TERM,
      CLAUDE_CONFIG_DIR: environment.CLAUDE_CONFIG_DIR,
      CLAUDE_SECURESTORAGE_CONFIG_DIR: environment.CLAUDE_SECURESTORAGE_CONFIG_DIR,
      ANTHROPIC_CONFIG_DIR: environment.ANTHROPIC_CONFIG_DIR,
      BROWSER: environment.BROWSER
    },
    {
      PATH: '/usr/bin',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      CLAUDE_CONFIG_DIR: '/tmp/bitterless-account/profile',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: '/tmp/bitterless-account/profile',
      ANTHROPIC_CONFIG_DIR: '/tmp/bitterless-account/profile/anthropic',
      BROWSER: '/usr/bin/true'
    }
  );
  for (const forbidden of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_PROFILE',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_REFRESH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'AWS_PROFILE',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'AZURE_API_KEY'
  ]) {
    assert.equal(environment[forbidden], undefined);
  }
});

test('auth BrowserWindow source fixes the partition and denies privileged escape surfaces', async () => {
  const source = await readSource('src/main/claudeSubscription/claudeAuth.browser.ts');
  for (const required of [
    'partition: input.partition',
    'sandbox: true',
    'contextIsolation: true',
    'nodeIntegration: false',
    'nodeIntegrationInWorker: false',
    'nodeIntegrationInSubFrames: false',
    'webSecurity: true',
    'webviewTag: false',
    'allowRunningInsecureContent: false',
    'devTools: false',
    "setWindowOpenHandler(() => ({ action: 'deny' }))",
    "on('will-attach-webview'",
    "on('will-navigate'",
    "on('will-redirect', fenceMainFrameRedirect)",
    'if (isMainFrame) fenceNavigation(event, target)',
    'setPermissionCheckHandler(() => false)',
    'setPermissionRequestHandler',
    "on('will-download', preventDownload)",
    'clearStorageData()'
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.doesNotMatch(source, /preload\s*:/u);
  assert.doesNotMatch(source, /openExternal|openDevTools/u);
});

test('PTY source uses fixed shell-free auth login argv and awaits TERM to KILL', async () => {
  const source = await readSource('src/main/claudeSubscription/claudeAuthLogin.pty.ts');
  assert.match(source, /const SCRIPT_EXECUTABLE = '\/usr\/bin\/script'/u);
  assert.match(source, /const EXPECT_EXECUTABLE = '\/usr\/bin\/expect'/u);
  assert.match(
    source,
    /spawn -noecho \$\{SCRIPT_EXECUTABLE\} -q \/dev\/null \$claude_executable auth login --claudeai/u
  );
  assert.match(source, /unset env\(\$\{EXPECT_CLAUDE_EXECUTABLE_VARIABLE\}\)/u);
  assert.match(source, /set wait_failed \[catch \{wait\} result\]/u);
  assert.match(source, /\[llength \$result\] != 4/u);
  assert.match(source, /exit \[lindex \$result 3\]/u);
  assert.match(source, /shell: false/u);
  assert.match(source, /detached: true/u);
  assert.match(source, /process\.kill\(-processId, signal\)/u);
  assert.match(source, /#exitResult: ClaudeAuthLoginPtyExit \| null = null/u);
  assert.match(source, /queueMicrotask\(\(\) =>/u);
  assert.match(source, /'SIGTERM'/u);
  assert.match(source, /'SIGKILL'/u);
  assert.match(source, /await Promise\.race/u);
});

test('runtime stays lazy and XPC exposes only fixed metadata actions and snapshot event', async () => {
  const runtime = await readSource('src/main/claudeSubscription/claudeSubscription.runtime.ts');
  const appMain = await readSource('src/main/app.main.ts');
  const handler = await readSource('src/main/xpc/claudeSubscription.handler.ts');
  const helper = await readSource('src/main/xpc/xpc.helper.ts');
  const contract = await readSource('src/shared/claudeSubscription/claudeSubscription.contract.ts');

  assert.match(runtime, /const createDefaultClaudeSubscriptionService = async/u);
  assert.match(
    runtime,
    /export const claudeSubscriptionRuntime = new ClaudeSubscriptionMainRuntime\(\)/u
  );
  assert.doesNotMatch(runtime, /void claudeSubscriptionRuntime\.start/u);
  assert.match(runtime, /probeClaudeCliCapabilities/u);
  assert.match(
    runtime,
    /const starting = this\.#startPromise;[\s\S]*await service\.stop\(\);[\s\S]*if \(starting\) await starting\.catch/u
  );
  assert.doesNotMatch(runtime, /safeStorage|ClaudeSafeStorage|encryptedToken/u);
  assert.match(helper, /import '\.\/claudeSubscription\.handler'/u);
  assert.match(contract, /claude-subscription\/snapshot-changed/u);
  assert.match(appMain, /await claudeSubscriptionRuntime\.start\(\)/u);
  assert.match(appMain, /await claudeSubscriptionRuntime\.stop\(\)/u);
  for (const action of [
    'getSnapshot',
    'startAuthorization',
    'submitAuthorizationCode',
    'cancelAuthorization',
    'renameAccount',
    'setAccountEnabled',
    'testAccount',
    'removeAccount',
    'copyCodexProfile'
  ]) {
    assert.match(handler, new RegExp(`async ${action}\\(`, 'u'));
  }
  assert.doesNotMatch(
    handler,
    /parseClaudeSubscription(?:StartAuth|SubmitAuthCode|FlowId|AccountId|RenameAccount|SetAccountEnabled)Input/u
  );
  assert.match(handler, /Claude subscription state is unavailable\./u);
});

test('auth source has no Bitterless credential custody or safeStorage caller', async () => {
  const policy = await readSource('src/main/security/safeStoragePolicy.service.ts');
  const repository = await readSource(
    'src/main/claudeSubscription/claudeAccount.repository.ts'
  );
  const coordinator = await readSource(
    'src/main/claudeSubscription/claudeAuth.coordinator.ts'
  );
  assert.doesNotMatch(policy, /'claude-subscription'/u);
  assert.match(policy, /if \(!input\.mode && input\.packaged\) return/u);
  assert.doesNotMatch(repository, /encryptedToken|ClaudeSecretCipher|saveCredential|decryptString/u);
  assert.doesNotMatch(coordinator, /findClaudeSetupToken|saveCredential|oauthToken/u);
  assert.match(coordinator, /flow\.codeSubmitted = true;\s+flow\.parserOutput = '';/u);
});
