import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-config-arg-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'config.cjs');
buildSync({
    tsconfig: 'tsconfig.node.json',
  entryPoints: ['src/main/zellij/zellijConfig.service.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const { parseZellijConfigArg, resolveZellijConfigFile, ZELLIJ_CONFIG_ARG } =
  createRequire(import.meta.url)(outfile);

const base = { env: {}, home: '/fixture/home', platform: 'darwin' };

test('the launch argument outranks both Zellij environment variables', () => {
  // An exported env var leaks into every child process — including the `zellij` CLI itself, where it
  // would override the `--config` we pass explicitly. A launch argument describes only this launch.
  const file = resolveZellijConfigFile({
    ...base,
    argv: ['/Applications/Bitterless.app', `${ZELLIJ_CONFIG_ARG}=/tmp/from-argv.kdl`],
    env: { ZELLIJ_CONFIG_FILE: '/tmp/from-env.kdl', ZELLIJ_CONFIG_DIR: '/tmp/dir' }
  });
  assert.equal(file, '/tmp/from-argv.kdl');
});

test('a relative path is made absolute, and any filename is accepted', () => {
  const file = resolveZellijConfigFile({ ...base, argv: [`${ZELLIJ_CONFIG_ARG}=./preview.kdl`] });
  assert.equal(file, resolve('./preview.kdl'));
  assert.equal(
    resolveZellijConfigFile({ ...base, argv: [`${ZELLIJ_CONFIG_ARG}=/tmp/not-named-config.kdl`] }),
    '/tmp/not-named-config.kdl'
  );
});

test('without the argument, resolution falls through to the existing env/probe order', () => {
  assert.equal(
    resolveZellijConfigFile({ ...base, argv: ['/Applications/Bitterless.app'], env: { ZELLIJ_CONFIG_FILE: '/tmp/env.kdl' } }),
    '/tmp/env.kdl'
  );
  assert.equal(
    resolveZellijConfigFile({ ...base, argv: [], env: { ZELLIJ_CONFIG_DIR: '/tmp/dir' } }),
    join('/tmp/dir', 'config.kdl')
  );
});

test('ambiguous or malformed usage throws instead of guessing', () => {
  // Two values is a misconfiguration; silently picking one hides it until the wrong config loads.
  assert.throws(
    () => parseZellijConfigArg([`${ZELLIJ_CONFIG_ARG}=/a.kdl`, `${ZELLIJ_CONFIG_ARG}=/b.kdl`]),
    /may be provided only once/
  );
  // The space-separated form must not swallow the next argv entry — on a packaged launch that is
  // just as likely to be a file path the OS appended.
  assert.throws(() => parseZellijConfigArg([ZELLIJ_CONFIG_ARG, '/a.kdl']), /must be written as/);
  assert.throws(() => parseZellijConfigArg([`${ZELLIJ_CONFIG_ARG}=`]), /non-empty single-line/);
  assert.throws(() => parseZellijConfigArg([`${ZELLIJ_CONFIG_ARG}=/a\nb.kdl`]), /non-empty single-line/);
});

test('unrelated arguments are ignored, including lookalikes', () => {
  assert.equal(parseZellijConfigArg([]), undefined);
  assert.equal(parseZellijConfigArg(['--onlypreview-open=/x', '--user-data-dir=/y']), undefined);
  assert.equal(parseZellijConfigArg(['--zellij-config-extra=/x']), undefined);
});
