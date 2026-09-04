import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Task 089: the copyable per-environment CLAUDE_CONFIG_DIR shell wrapper. Covers the shared pure
// builder (name derivation, the reserved-name fallback, the non-recursive `command claude`
// guarantee, single-quote/comment escaping) and the EyesOnAgentsService method that resolves a row
// id and writes the snippet through the injected writeClipboardText dependency without logging it.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-setup-command-'));
const DEFAULT_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOM_ID = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_ID = '33333333-3333-4333-8333-333333333333';
// The wrapper line's fixed frame, sliced rather than regex-matched so a directory full of quotes,
// backslashes and `$(…)` cannot make the extraction itself ambiguous.
const WRAPPER_PREFIX = "() { CLAUDE_CONFIG_DIR='";
const WRAPPER_SUFFIX = '\' command claude "$@"; }';
// Reverse the shell's close/escape/reopen form to prove the directory round-trips byte-for-byte.
const SINGLE_QUOTE_ESCAPE = "'\\''";

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

const [contractModule, serviceModule] = await Promise.all([
  loadTypeScriptModule('contract', 'src/shared/eyesOnAgents/eyesOnAgents.contract.ts'),
  loadTypeScriptModule('service', 'src/main/eyesOnAgents/eyesOnAgents.service.ts')
]);

const {
  buildEyesOnAgentsClaudeEnvironmentSetupCommand,
  deriveEyesOnAgentsClaudeEnvironmentFunctionName
} = contractModule;
const { EyesOnAgentsService } = serviceModule;

// Peel the emitted directory back out of the wrapper line, asserting the frame is intact both ends.
const emittedDirectory = (snippet) => {
  const lines = snippet.split('\n');
  assert.equal(lines.length, 2, 'the snippet stays exactly two lines');
  const start = lines[1].indexOf(WRAPPER_PREFIX);
  assert.ok(start > 0, 'the wrapper line opens the single-quoted assignment');
  assert.ok(lines[1].endsWith(WRAPPER_SUFFIX), 'the wrapper line closes it and nothing follows');
  return lines[1].slice(start + WRAPPER_PREFIX.length, lines[1].length - WRAPPER_SUFFIX.length);
};

const environment = (overrides = {}) => ({
  id: DEFAULT_ID,
  label: 'Default',
  mode: 'automatic',
  configDirectory: null,
  enabled: true,
  ...overrides
});

// The narrowest harness that reaches copyClaudeEnvironmentSetupCommand: the method touches only the
// injected claudeDirectoryConfig (for listEnvironments) and writeClipboardText. Every logger-shaped
// dependency records instead of logging so the no-logging rule can be asserted, not assumed.
const createHarness = (environments) => {
  const clipboard = [];
  const logs = [];
  const service = new EyesOnAgentsService({
    repository: {},
    settings: { get: async () => false, upsert: async () => undefined },
    appServer: {},
    desktopBridge: {},
    bridgeListener: {},
    openExternal: async () => undefined,
    writeClipboardText: (text) => clipboard.push(text),
    claudeDirectoryConfig: { listEnvironments: () => environments },
    broadcastChanged: () => logs.push('broadcast')
  });
  return { service, clipboard, logs };
};

try {
  await test('the snippet matches the documented claude2 shape exactly', () => {
    assert.equal(
      buildEyesOnAgentsClaudeEnvironmentSetupCommand({
        label: 'claude2',
        configDirectory: '/Users/ral/.claude2'
      }),
      '# Bitterless: Claude environment "claude2"\n'
      + 'claude2() { CLAUDE_CONFIG_DIR=\'/Users/ral/.claude2\' command claude "$@"; }'
    );
  });

  await test('a label of "claude" produces a non-recursive `command claude` wrapper', () => {
    const snippet = buildEyesOnAgentsClaudeEnvironmentSetupCommand({
      label: 'claude',
      configDirectory: '/Users/ral/.claude-work'
    });
    assert.equal(
      snippet,
      '# Bitterless: Claude environment "claude"\n'
      + 'claude() { CLAUDE_CONFIG_DIR=\'/Users/ral/.claude-work\' command claude "$@"; }'
    );
    // The single most important correctness detail: a bare `claude` inside a function named
    // `claude` recurses forever and hangs the user's terminal. `command` skips function lookup for
    // the name it is given, which covers `claude` — but `command` is itself a regular builtin and
    // therefore shadowable, so it does NOT cover a wrapper named `command`. That one case is
    // handled by the reserved-name fallback instead, pinned by the next test.
    assert.match(snippet, /\bcommand claude "\$@"/);
    assert.doesNotMatch(snippet, /\{ CLAUDE_CONFIG_DIR='[^']*' claude /);
  });

  await test('a label deriving to `command` or a bash/zsh reserved word takes the fallback name', () => {
    // `command` shadows the regular builtin the wrapper body depends on: bash hangs outright and
    // zsh aborts with "maximum nested function level reached", so `claude` never starts. The
    // reserved words either cannot be parsed as a function definition or are parsed as a reserved
    // word at the call site, so the pasted snippet is a syntax error or an unreachable wrapper.
    const reserved = [
      'command',
      'case', 'coproc', 'do', 'done', 'elif', 'else', 'end', 'esac', 'fi', 'for', 'foreach',
      'function', 'if', 'in', 'nocorrect', 'repeat', 'select', 'then', 'time', 'until', 'while'
    ];
    for (const label of reserved) {
      assert.equal(
        deriveEyesOnAgentsClaudeEnvironmentFunctionName(label),
        'claude_env',
        `${label} must never become the wrapper's function name`
      );
      // The guard runs after sanitization, so case and separator variants route to it too.
      assert.equal(
        deriveEyesOnAgentsClaudeEnvironmentFunctionName(label.toUpperCase()),
        'claude_env',
        `${label.toUpperCase()} must derive to the same guarded name`
      );
      assert.equal(
        buildEyesOnAgentsClaudeEnvironmentSetupCommand({ label, configDirectory: '/tmp/ok' }),
        `# Bitterless: Claude environment "${label}"\n`
        + 'claude_env() { CLAUDE_CONFIG_DIR=\'/tmp/ok\' command claude "$@"; }',
        `the ${label} snippet must define claude_env, not ${label}`
      );
    }
    // Only the exact derived name is reserved — a longer name that merely contains one is kept, and
    // `builtin` is not reserved because it defines and invokes correctly in both shells.
    assert.equal(deriveEyesOnAgentsClaudeEnvironmentFunctionName('command center'), 'command_center');
    assert.equal(deriveEyesOnAgentsClaudeEnvironmentFunctionName('if only'), 'if_only');
    assert.equal(deriveEyesOnAgentsClaudeEnvironmentFunctionName('builtin'), 'builtin');
  });

  await test('function names derive by lowercase, substitution, collapse, digit prefix, fallback', () => {
    const cases = [
      ['claude2', 'claude2'],
      ['Claude Work', 'claude_work'],
      ['My - Env', 'my_env'],
      ['my___env', 'my_env'],
      ['my_ _env', 'my_env'],
      ['_leading', '_leading'],
      ['2nd account', '_2nd_account'],
      ['9', '_9'],
      ['Claude 工作号', 'claude_'],
      ['工作号', 'claude_env'],
      ['!!!', 'claude_env'],
      ['___', 'claude_env'],
      ['', 'claude_env'],
      ['   ', 'claude_env']
    ];
    for (const [label, expected] of cases) {
      assert.equal(
        deriveEyesOnAgentsClaudeEnvironmentFunctionName(label),
        expected,
        `${JSON.stringify(label)} must derive to ${expected}`
      );
    }
  });

  await test('a CJK-only label falls back while a mixed label keeps its ASCII prefix', () => {
    assert.equal(
      buildEyesOnAgentsClaudeEnvironmentSetupCommand({
        label: '工作号',
        configDirectory: '/Users/ral/.claude-cjk'
      }),
      '# Bitterless: Claude environment "工作号"\n'
      + 'claude_env() { CLAUDE_CONFIG_DIR=\'/Users/ral/.claude-cjk\' command claude "$@"; }'
    );
    // The comment carries the ORIGINAL label so the environment stays identifiable in a shell
    // profile even when the derived function name had to drop or fold most of it.
    assert.equal(
      buildEyesOnAgentsClaudeEnvironmentSetupCommand({
        label: 'Claude 工作号',
        configDirectory: '/Users/ral/.claude-cjk'
      }),
      '# Bitterless: Claude environment "Claude 工作号"\n'
      + 'claude_() { CLAUDE_CONFIG_DIR=\'/Users/ral/.claude-cjk\' command claude "$@"; }'
    );
  });

  await test('a shell-hostile directory cannot break out of its single quotes', () => {
    const snippet = buildEyesOnAgentsClaudeEnvironmentSetupCommand({
      label: 'weird',
      configDirectory: '/tmp/a"b$HOME`id`c\\d'
    });
    // Inside single quotes every one of ", $, `, \ and ! is already inert in both bash and zsh, so
    // the path is emitted verbatim — nothing to escape means nothing to under- or double-escape.
    assert.equal(
      snippet,
      '# Bitterless: Claude environment "weird"\n'
      + 'weird() { CLAUDE_CONFIG_DIR=\'/tmp/a"b$HOME`id`c\\d\' command claude "$@"; }'
    );
    assert.equal(emittedDirectory(snippet), '/tmp/a"b$HOME`id`c\\d');
  });

  await test('every hostile directory round-trips through the single-quoted assignment', () => {
    // The one character that must be escaped is `'`, in the close/escape/reopen form '\''. Cases
    // include the two the double-quoted form got wrong: `!` (history expansion fires inside double
    // quotes at an interactive bash AND zsh prompt) and a trailing backslash.
    const directories = [
      '/Users/ral/.claude2',
      '/Users/ral/Dev/!work/.claude2',
      "/Users/ral/it's/.claude2",
      "/Users/ral/'/.claude2",
      "/Users/ral/''/.claude2",
      '/Users/ral/$(id)/.claude2',
      '/Users/ral/`id`/.claude2',
      '/Users/ral/${HOME}/.claude2',
      '/Users/ral/a\\',
      '/Users/ral/a\\\\\\',
      '/Users/ral/a"b',
      '/Users/ral/a;touch b;c'
    ];
    for (const configDirectory of directories) {
      const emitted = emittedDirectory(buildEyesOnAgentsClaudeEnvironmentSetupCommand({
        label: 'probe',
        configDirectory
      }));
      // No bare `'` may survive outside the '\'' form, or the quoted word would end early.
      assert.equal(
        emitted.split(SINGLE_QUOTE_ESCAPE).join('').includes("'"),
        false,
        `${configDirectory} must leave no bare single quote in the emitted word`
      );
      assert.equal(
        emitted.split(SINGLE_QUOTE_ESCAPE).join("'"),
        configDirectory,
        `${configDirectory} must round-trip byte-for-byte`
      );
    }
  });

  await test('a shell-hostile label cannot break out of its `#` comment', () => {
    const snippet = buildEyesOnAgentsClaudeEnvironmentSetupCommand({
      label: 'ev"il\n rm -rf /\t$(id)',
      configDirectory: '/Users/ral/.claude2'
    });
    const lines = snippet.split('\n');
    assert.equal(lines.length, 2, 'the snippet stays exactly two lines');
    assert.equal(lines[0], '# Bitterless: Claude environment "ev"il rm -rf / $(id)"');
    assert.match(lines[1], /^ev_il_rm_rf_id_\(\) \{ CLAUDE_CONFIG_DIR='/);
    // Everything after # on line 1 is inert; the injected command never becomes its own line.
    assert.doesNotMatch(snippet, /\n\s*rm -rf/);
  });

  await test('an empty or control-character directory throws instead of emitting a bad path', () => {
    for (const configDirectory of ['', '/tmp/a\nb', '/tmp/a\rb', '/tmp/a\0b']) {
      assert.throws(
        () => buildEyesOnAgentsClaudeEnvironmentSetupCommand({ label: 'x', configDirectory }),
        /requires a configured directory/,
        `${JSON.stringify(configDirectory)} must be rejected`
      );
    }
    assert.doesNotMatch(
      buildEyesOnAgentsClaudeEnvironmentSetupCommand({
        label: 'x',
        configDirectory: '/tmp/ok'
      }),
      /undefined|null/,
      'a valid call never emits a stringified undefined/null path'
    );
  });

  await test('the service writes the resolved row snippet to the clipboard and logs nothing', async () => {
    const harness = createHarness([
      environment(),
      environment({
        id: CUSTOM_ID,
        label: 'claude2',
        mode: 'custom',
        configDirectory: '/Users/ral/.claude2'
      })
    ]);
    await harness.service.copyClaudeEnvironmentSetupCommand({ id: CUSTOM_ID });
    assert.deepEqual(harness.clipboard, [
      '# Bitterless: Claude environment "claude2"\n'
      + 'claude2() { CLAUDE_CONFIG_DIR=\'/Users/ral/.claude2\' command claude "$@"; }'
    ]);
    assert.deepEqual(harness.logs, [], 'the clipboard write is the only egress');
  });

  await test('an unknown id and a null-directory environment both fail without a clipboard write', async () => {
    const harness = createHarness([
      environment(),
      environment({
        id: CUSTOM_ID,
        label: 'claude3',
        mode: 'custom',
        configDirectory: null
      })
    ]);
    await assert.rejects(
      harness.service.copyClaudeEnvironmentSetupCommand({ id: UNKNOWN_ID }),
      /Claude environment was not found/
    );
    await assert.rejects(
      harness.service.copyClaudeEnvironmentSetupCommand({ id: DEFAULT_ID }),
      /"Default" has no configured directory/,
      'the automatic environment has no wrapper to copy'
    );
    await assert.rejects(
      harness.service.copyClaudeEnvironmentSetupCommand({ id: CUSTOM_ID }),
      /"claude3" has no configured directory/,
      'a custom environment whose directory was never chosen fails cleanly'
    );
    assert.deepEqual(harness.clipboard, [], 'no malformed snippet is ever written');
  });

  await test('a missing claudeDirectoryConfig dependency fails by name, not by path', async () => {
    const clipboard = [];
    const service = new EyesOnAgentsService({
      repository: {},
      settings: { get: async () => false, upsert: async () => undefined },
      appServer: {},
      desktopBridge: {},
      bridgeListener: {},
      openExternal: async () => undefined,
      writeClipboardText: (text) => clipboard.push(text)
    });
    await assert.rejects(
      service.copyClaudeEnvironmentSetupCommand({ id: CUSTOM_ID }),
      /Claude environment configuration is unavailable/
    );
    assert.deepEqual(clipboard, []);
  });

  await test('no source on the copy path logs the snippet, the directory, or reaches electron clipboard', () => {
    const read = (path) => readFileSync(join(projectRoot, path), 'utf8');
    const service = read('src/main/eyesOnAgents/eyesOnAgents.service.ts');
    const handler = read('src/main/xpc/eyesOnAgents.handler.ts');
    const copyMethod = /async copyClaudeEnvironmentSetupCommand\([\s\S]*?\n  \}/.exec(service);
    assert.ok(copyMethod, 'the service method is present');
    assert.doesNotMatch(
      copyMethod[0],
      /console\.|logger|logClaudeBridgeAction|log\(/,
      'the snippet/configDirectory must never reach a logger'
    );
    assert.match(
      copyMethod[0],
      /this\.dependencies\.writeClipboardText\(buildEyesOnAgentsClaudeEnvironmentSetupCommand\(/,
      'the snippet is written through the injected clipboard dependency'
    );
    assert.doesNotMatch(
      copyMethod[0],
      /configDirectory}|\$\{environment\.configDirectory/,
      'no thrown message may interpolate the directory'
    );
    assert.match(
      copyMethod[0],
      /\$\{environment\.label\}/,
      'the failure identifies the environment by label only'
    );
    const handlerMethod = /async copyClaudeEnvironmentSetupCommand\([\s\S]*?\n  \}/.exec(handler);
    assert.ok(handlerMethod, 'the handler method is present');
    assert.match(
      handlerMethod[0],
      /parseEyesOnAgentsClaudeEnvironmentIdParams\(params\)/,
      'the XPC boundary validates the row id'
    );
    assert.doesNotMatch(
      handlerMethod[0],
      /console\.|logger|logClaudeBridgeAction/,
      'the handler must not log the resolved environment either'
    );
    // Electron's clipboard stays confined to the handler's pre-existing single import, injected
    // into the service as writeClipboardText — this task added no new electron clipboard access.
    assert.doesNotMatch(service, /from 'electron'/);
    assert.equal(
      (handler.match(/\bclipboard\.\w+\(/gu) ?? []).length,
      1,
      'the handler keeps exactly one electron clipboard call site (the injected writeClipboardText)'
    );
  });

  // ---- Task 091: add-by-pasted-path ----
  await test('the add params parser accepts an absolute path and rejects everything else', () => {
    assert.deepEqual(
      contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({
        configDirectory: '/Users/ral/.claude2'
      }),
      { configDirectory: '/Users/ral/.claude2' }
    );
    // Windows absolute paths must survive too — this parser is shared, not macOS-only.
    assert.deepEqual(
      contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({
        configDirectory: 'C:\\Users\\ral\\.claude2'
      }),
      { configDirectory: 'C:\\Users\\ral\\.claude2' }
    );
    // A relative path is the most likely paste mistake and must be caught before it reaches Main.
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ configDirectory: '.claude2' }),
      /absolute/
    );
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ configDirectory: '~/.claude2' }),
      /absolute/,
      'a tilde is not expanded by the parser, so it must be rejected rather than passed through'
    );
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ configDirectory: '' }),
      /Claude config directory/
    );
    // The old label-based shape must no longer be accepted, or a stale caller would silently add
    // an environment pointing at a label-shaped "path".
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({ label: 'claude2' }),
      /Claude environment params/
    );
    assert.throws(
      () => contractModule.parseEyesOnAgentsAddClaudeEnvironmentParams({
        configDirectory: '/Users/ral/.claude2',
        label: 'claude2'
      }),
      /Claude environment params/,
      'extra keys must be rejected, not ignored'
    );
  });

  await test('the set-directory params parser shares the add parser\'s absolute-path rule', () => {
    const parse = contractModule.parseEyesOnAgentsSetClaudeEnvironmentDirectoryParams;
    const id = 'af147ca5-5493-4079-81db-1c6f8841682b';
    assert.deepEqual(parse({ id, configDirectory: '/Users/ral/.claude2' }),
      { id, configDirectory: '/Users/ral/.claude2' });
    // Same rejections as the add parser — the rule is shared, not duplicated.
    assert.throws(() => parse({ id, configDirectory: '.claude2' }), /absolute/);
    assert.throws(() => parse({ id, configDirectory: '~/.claude2' }), /absolute/);
    assert.throws(() => parse({ id, configDirectory: '' }), /Claude config directory/);
    // Both fields are required, and nothing else is accepted.
    assert.throws(() => parse({ configDirectory: '/Users/ral/.claude2' }), /Claude environment/);
    assert.throws(() => parse({ id }), /Claude config directory/);
    assert.throws(() => parse({ id, configDirectory: '/x', label: 'y' }), /Claude environment params/);
    assert.throws(() => parse({ id: 'not-a-uuid', configDirectory: '/x' }), /Claude environment/);
  });

  await test('the environment label is derived from its directory', () => {
    const derive = contractModule.deriveEyesOnAgentsClaudeEnvironmentLabel;
    assert.equal(derive('/Users/ral/.claude2'), 'claude2', 'a leading dot is stripped');
    assert.equal(derive('/Users/ral/claude-work'), 'claude-work');
    // Trailing slashes and "/./" segments must not change the derived label, which is why the
    // caller derives from the canonicalized path.
    assert.equal(derive('/Users/ral/.claude2/'), 'claude2');
    assert.equal(derive('/Users/ral/.claude2//'), 'claude2');
    assert.equal(derive('C:\\Users\\ral\\.claude2'), 'claude2', 'Windows separators too');
    // A dot-only basename leaves nothing after stripping, so the original basename is kept.
    assert.equal(derive('/Users/ral/.'), '.');
    assert.equal(derive('/'), 'Claude environment', 'nothing usable falls back');
    assert.equal(derive(''), 'Claude environment');
    // Labels are bounded the same way parseEyesOnAgentsClaudeEnvironmentLabel bounds them.
    assert.equal(derive(`/Users/ral/${'n'.repeat(200)}`).length, 80);
  });

  console.log('EyesOnAgents Claude environment setup command tests passed');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
