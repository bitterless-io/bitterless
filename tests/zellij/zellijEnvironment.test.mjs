import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-environment-tests-'));
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Node runs this JavaScript harness directly.
const load = (name) => {
  const output = join(directory, `${name}.cjs`);
  buildSync({
    entryPoints: [`src/main/zellij/${name}.service.ts`],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'tsconfig.node.json'
  });
  return createRequire(import.meta.url)(output);
};
const {
  resolveZellijChildEnvironment,
  ensureZellijSocketDirectory,
  resolveZellijSessionEnvironment
} = load('zellijEnvironment');
const { ZELLIJ_SESSION_MAX_LENGTH, resolveZellijSessionName } = load('zellijSession');
test.after(() => rmSync(directory, { recursive: true, force: true }));

test('long macOS TMPDIR cannot exceed the native socket limit for any profile or 32-bit uid', () => {
  const original = {
    TMPDIR: '/var/folders/wy/7d_0dtns4lxc3g7r2l1z1jl80000gn/T/',
    KEEP_VALUE: 'untouched'
  };
  const paths = new Set();
  for (const profile of [
    'production',
    'production-preview',
    'production-debug',
    'test-debug',
    'test-release'
  ]) {
    for (const uid of [0, 501, 0xffffffff]) {
      const env = resolveZellijChildEnvironment(profile, {
        platform: 'darwin',
        env: original,
        uid
      });
      const session = resolveZellijSessionName(profile, 'x'.repeat(100));
      assert.equal(session.length, ZELLIJ_SESSION_MAX_LENGTH);
      const path = `${env.ZELLIJ_SOCKET_DIR}/contract_version_1/${session}`;
      assert.ok(Buffer.byteLength(path) < 104, path);
      assert.equal(env.TMPDIR, original.TMPDIR);
      assert.equal(env.KEEP_VALUE, original.KEEP_VALUE);
      paths.add(env.ZELLIJ_SOCKET_DIR);
    }
  }
  assert.equal(paths.size, 15);
  assert.equal(original.ZELLIJ_SOCKET_DIR, undefined);
});

test('socket and temporary-directory overrides remain unchanged while GUI color capabilities are supplied', () => {
  const explicit = { ZELLIJ_SOCKET_DIR: '/private/chosen-path', TMPDIR: '/preserved' };
  const mac = resolveZellijChildEnvironment('production-debug', {
    platform: 'darwin',
    env: explicit,
    uid: 501
  });
  assert.equal(mac.ZELLIJ_SOCKET_DIR, explicit.ZELLIJ_SOCKET_DIR);
  assert.equal(mac.TMPDIR, explicit.TMPDIR);
  assert.equal(mac.TERM, 'xterm-256color');
  assert.equal(mac.COLORTERM, 'truecolor');
  assert.equal(mac.CLICOLOR, '1');
  const windows = { TEMP: 'C:\\Temp' };
  assert.equal(
    resolveZellijChildEnvironment('production-debug', { platform: 'win32', env: windows }).TEMP,
    windows.TEMP
  );
  const launcher = {
    TERM: 'dumb',
    COLORTERM: '',
    CLICOLOR: '0',
    NO_COLOR: '1',
    NODE_DISABLE_COLORS: '1',
    FORCE_COLOR: '0',
    CLICOLOR_FORCE: '0'
  };
  const gui = resolveZellijChildEnvironment('production', { platform: 'win32', env: launcher });
  assert.deepEqual(gui, { TERM: 'xterm-256color', COLORTERM: 'truecolor', CLICOLOR: '1' });
  assert.equal(
    launcher.NO_COLOR,
    '1',
    'normalizing the GUI terminal never mutates its launcher environment'
  );
  const opted = resolveZellijChildEnvironment('production', {
    platform: 'win32',
    env: { NO_COLOR: '' }
  });
  assert.equal(opted.COLORTERM, 'truecolor');
  assert.equal(opted.CLICOLOR, '1');
  assert.equal(opted.FORCE_COLOR, undefined);
  for (const uid of [undefined, -1, 1.5, 0x100000000]) {
    assert.throws(
      () => resolveZellijChildEnvironment('production', { platform: 'darwin', env: {}, uid }),
      /operation-failed/
    );
  }
});

test('a launcher without any locale gets UTF-8, and every locale it does set is kept', () => {
  // launchd gives a GUI app no LANG, and the C locale makes the macOS system encoding Mac OS Roman:
  // `没有` copied out of the terminal comes back as `Ê≤°Êúâ`.
  const launcher = { TMPDIR: '/preserved' };
  const supplied = resolveZellijChildEnvironment('production', {
    platform: 'darwin',
    env: launcher,
    uid: 501
  });
  assert.equal(supplied.LANG, 'en_US.UTF-8');
  assert.equal(launcher.LANG, undefined);
  // The socket-directory override returns early, and must not step over the locale on its way out.
  assert.equal(
    resolveZellijChildEnvironment('production', {
      platform: 'darwin',
      env: { ZELLIJ_SOCKET_DIR: '/private/chosen-path' },
      uid: 501
    }).LANG,
    'en_US.UTF-8'
  );
  for (const locale of [{ LANG: 'ja_JP.eucJP' }, { LC_ALL: 'C' }, { LC_CTYPE: 'zh_CN.GB18030' }]) {
    const kept = resolveZellijChildEnvironment('production', {
      platform: 'darwin',
      env: locale,
      uid: 501
    });
    assert.deepEqual(
      { LANG: kept.LANG, LC_ALL: kept.LC_ALL, LC_CTYPE: kept.LC_CTYPE },
      {
        LANG: locale.LANG,
        LC_ALL: locale.LC_ALL,
        LC_CTYPE: locale.LC_CTYPE
      }
    );
  }
  // Windows has no POSIX locale to lose.
  assert.equal(
    resolveZellijChildEnvironment('production', { platform: 'win32', env: {} }).LANG,
    undefined
  );
  // The user's KDL env is still the override point, applied after this normalization.
  assert.equal(
    resolveZellijSessionEnvironment(supplied, 'env {\n LANG "zh_CN.UTF-8"\n}\n').env.LANG,
    'zh_CN.UTF-8'
  );
});

test('explicit KDL shell and color environment wins after launcher normalization', () => {
  const gui = resolveZellijChildEnvironment('production', {
    platform: 'win32',
    env: { NO_COLOR: '1' }
  });
  const configured = resolveZellijSessionEnvironment(
    gui,
    'default_shell "/custom/shell"\nenv {\n TERM "screen"\n COLORTERM "24bit"\n CLICOLOR 0\n NO_COLOR "1"\n ZDOTDIR "/custom/rc"\n}\n'
  );
  assert.equal(configured.explicitDefaultShell, true);
  assert.equal(configured.explicitZdotdir, true);
  assert.deepEqual(configured.env, {
    TERM: 'screen',
    COLORTERM: '24bit',
    CLICOLOR: '0',
    NO_COLOR: '1',
    ZDOTDIR: '/custom/rc'
  });
  assert.equal(gui.NO_COLOR, undefined);
  assert.equal(resolveZellijSessionEnvironment(gui, '').explicitDefaultShell, false);
});

test(
  'managed directories are private, preserve existing contents, and reject unsafe entries',
  { skip: process.platform === 'win32' },
  () => {
    const uid = process.getuid();
    const managed = join(directory, 'managed');
    ensureZellijSocketDirectory(managed, uid);
    assert.equal(lstatSync(managed).mode & 0o777, 0o700);
    const session = join(managed, 'existing-session');
    writeFileSync(session, 'preserved');
    ensureZellijSocketDirectory(managed, uid);
    assert.equal(readFileSync(session, 'utf8'), 'preserved');
    assert.throws(() => ensureZellijSocketDirectory(managed, uid + 1), /private and owned/);
    const alias = join(directory, 'alias');
    symlinkSync(managed, alias);
    assert.throws(() => ensureZellijSocketDirectory(alias, uid), /private and owned/);
    chmodSync(managed, 0o755);
    assert.throws(() => ensureZellijSocketDirectory(managed, uid), /private and owned/);
    assert.equal(lstatSync(managed).mode & 0o777, 0o755);
    const file = join(directory, 'not-directory');
    writeFileSync(file, 'preserved');
    assert.throws(() => ensureZellijSocketDirectory(file, uid), /private and owned/);
    assert.equal(readFileSync(file, 'utf8'), 'preserved');
  }
);
