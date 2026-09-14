/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-shell-runtime-'));
const output = join(directory, 'env.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijEnvironment.service.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs'
});
const helpers = createRequire(import.meta.url)(output);
const file = ts.createSourceFile(
  'runtime.ts',
  readFileSync('src/main/zellij/zellijRuntime.service.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const run = file.statements.filter(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) =>
      ['runCli', 'childEnvironment', 'getNativeSessions'].includes(declaration.name.getText(file))
    )
);
assert.ok(run);
const code = ts.transpileModule(
  `${run.map((node) => node.getText(file)).join('\n')}\nglobalThis.run = runCli; globalThis.native = getNativeSessions;`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }
).outputText;
test.after(() => rmSync(directory, { recursive: true, force: true }));

const fixture = (source = '', platform = 'darwin', shell = '/bin/zsh') => {
  const calls = { reads: 0, shells: [], commands: [] };
  const context = vm.createContext({
    ...helpers,
    process: { platform, resourcesPath: '/packaged/Resources' },
    app: {
      isPackaged: true,
      getPath: () => '/profile',
      getAppPath: () => '/packaged/Resources/app.asar'
    },
    join,
    resolve,
    nativeSessions: null,
    runtimeConfig: { file: '/profile/config.kdl' },
    ZellijNativeSessionService: class {
      constructor(deps) {
        this.deps = deps;
      }
    },
    homedir: () => '/home',
    userInfo: () => ({ shell: '/bin/zsh' }),
    binaryPath: () => '/binary',
    getRuntimeProfile: () => ({ id: 'production-debug' }),
    prepareZellijChildEnvironment: () =>
      helpers.resolveZellijChildEnvironment('production-debug', {
        platform: 'darwin',
        uid: 501,
        env: { SHELL: shell ?? undefined, TERM: 'dumb', NO_COLOR: '1' }
      }),
    readFileSync: () => {
      calls.reads++;
      return source;
    },
    ensureZellijShellIntegration: (options) => {
      calls.shells.push(options);
      return options.explicitDefaultShell
        ? options.env
        : { ...options.env, ZDOTDIR: '/profile/shell' };
    },
    runZellijCli: async (_binary, options) => {
      calls.commands.push(options);
      return '';
    }
  });
  vm.runInContext(code, context);
  return { run: context.run, native: context.native, calls };
};

test('native config validation and metadata never parse the old configuration or initialize shell files', async () => {
  const current = fixture('this is invalid {');
  await current.run(['--config', '/candidate.kdl', 'setup', '--check']);
  await current.run([
    '--config',
    '/config.kdl',
    '--session',
    'owned',
    'action',
    'list-panes',
    '--json'
  ]);
  assert.equal(current.calls.reads, 0);
  assert.equal(current.calls.shells.length, 0);
  assert.ok(current.calls.commands.every(({ cwd }) => cwd === '/home'));
});

test('new native sessions get the packaged shell asset and chosen cwd after launcher normalization', async () => {
  const current = fixture('', 'darwin', null);
  await current.run(
    ['--config', '/config.kdl', 'attach', '--create-background', 'owned'],
    '/chosen/cwd'
  );
  assert.equal(current.calls.shells[0].assetDirectory, '/packaged/Resources/zellij-shell');
  assert.equal(current.calls.shells[0].selectedShell, '/bin/zsh');
  assert.equal(current.calls.commands[0].cwd, '/chosen/cwd');
  assert.equal(current.calls.commands[0].env.ZDOTDIR, '/profile/shell');
  assert.equal(current.calls.commands[0].env.TERM, 'xterm-256color');
  assert.equal(current.calls.commands[0].env.NO_COLOR, undefined);
  assert.equal(
    current.calls.commands[0].env.SHELL,
    '/bin/zsh',
    'Finder launch uses the same OS default shell as its integration'
  );
});

test('explicit KDL shell/startup/color choices and Windows sessions retain their own startup', async () => {
  for (const source of [
    'default_shell "/custom/shell"\nenv { NO_COLOR "1"; }\n',
    'env { ZDOTDIR "/custom/rc"; NO_COLOR "1"; }\n'
  ]) {
    const current = fixture(source);
    await current.run(['--config', '/config.kdl', 'attach', '--create-background', 'owned']);
    assert.notEqual(current.calls.commands[0].env.ZDOTDIR, '/profile/shell');
    assert.equal(current.calls.commands[0].env.NO_COLOR, '1');
  }
  const windows = fixture('invalid original {', 'win32');
  await windows.run(['--config', '/config.kdl', 'attach', '--create-background', 'owned']);
  assert.equal(windows.calls.reads, 0);
  assert.equal(windows.calls.shells.length, 0);
});

test('hidden native server creation keeps shell integration, child colors and explicit cwd', async () => {
  const current = fixture('', 'darwin', null);
  const service = current.native();
  await service.deps.spawn('/canonical/contract_version_1/owned', 'owned', '/selected');
  const command = current.calls.commands[0];
  assert.deepEqual(Array.from(command.args), ['--server', '/canonical/contract_version_1/owned']);
  assert.equal(command.cwd, '/selected');
  assert.equal(command.env.SHELL, '/bin/zsh');
  assert.equal(command.env.ZDOTDIR, '/profile/shell');
  assert.equal(command.env.TERM, 'xterm-256color');
  assert.equal(command.env.NO_COLOR, undefined);
  assert.equal(command.env.ZELLIJ_SESSION_NAME, 'owned');
  assert.equal(command.env.ZELLIJ, '0');
  const explicit = fixture(
    'default_shell "/custom/shell"\nenv { ZDOTDIR "/custom/rc"; NO_COLOR "1"; }\n'
  );
  await explicit.native().deps.spawn('/canonical/owned', 'owned', '/chosen');
  assert.equal(explicit.calls.commands[0].env.ZDOTDIR, '/custom/rc');
  assert.equal(explicit.calls.commands[0].env.NO_COLOR, '1');
});
