/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test helpers. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { parse } from '@bgotink/kdl/v1-compat';

/**
 * The seeded config is validated by the REAL bundled binary, not by eyeballing the KDL.
 *
 * Session UI themes and web terminal themes use separate color formats. Check both with the
 * pinned binary, including option spelling, before these defaults can affect startup.
 */
const BINARY = 'build/maestro-tools/zellij';
const directory = mkdtempSync(join(tmpdir(), 'zellij-default-config-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'default.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijDefaultConfig.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile
});
const { buildZellijDefaultConfig } = createRequire(import.meta.url)(outfile);

const check = (platform) => {
  const file = join(directory, `${platform}.kdl`);
  writeFileSync(file, buildZellijDefaultConfig({ platform }));
  return execFileSync(BINARY, ['--config', file, 'setup', '--check'], { encoding: 'utf8' });
};

test(
  'the seeded config is accepted by the bundled Zellij on every platform default',
  {
    skip: existsSync(BINARY) ? false : `${BINARY} is not staged — run yarn tools:init`
  },
  () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      assert.match(
        check(platform),
        /\[CONFIG FILE\]: Well defined\./,
        `${platform} default config was rejected by Zellij`
      );
    }
  }
);

test('the defaults configure the session UI and the separate full web terminal palette', () => {
  const config = buildZellijDefaultConfig({ platform: 'darwin' });
  assert.match(config, /^themes \{/m, 'no themes block');
  assert.match(config, /^theme "bitterless"$/m, 'theme defined but never selected');
  assert.match(config, /^explicit_theme_hue "dark"$/m);
  assert.match(config, /^default_layout "default"$/m);
  // Session UI colors use RGB triples; web terminal colors use hex strings.
  assert.match(config, /\n\s+fg \d{1,3} \d{1,3} \d{1,3}\n/);
  const document = parse(config);
  const web = document.nodes.find((node) => node.getName() === 'web_client');
  const palette = web.children.nodes.find((node) => node.getName() === 'theme');
  const colors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  for (const name of [
    'background',
    'foreground',
    'cursor',
    ...colors,
    ...colors.map((name) => `bright_${name}`)
  ]) {
    assert.match(
      palette.children.nodes.find((node) => node.getName() === name)?.getArguments()[0] ?? '',
      /^#[0-9a-f]{6}$/
    );
  }
  assert.equal(
    document.nodes.find((node) => node.getName() === 'web_server').getArguments()[0],
    false
  );
  assert.equal(
    document.nodes.find((node) => node.getName() === 'web_sharing').getArguments()[0],
    'on'
  );
});

test('the seeded binds are the same ones the settings panel calls default', () => {
  // Hand-written binds here would read back as drift the first time the panel opened.
  const mac = buildZellijDefaultConfig({ platform: 'darwin' });
  assert.match(mac, /bind "Super d" \{ NewPane "Right"; \}/);
  assert.match(mac, /bind "Super Shift d" \{ NewPane "Down"; \}/);
  assert.match(mac, /bind "Super w" \{ CloseFocus; \}/);

  const other = buildZellijDefaultConfig({ platform: 'linux' });
  assert.match(other, /bind "Ctrl Alt w" \{ CloseFocus; \}/);
  assert.doesNotMatch(other, /Super/, 'Super is a macOS-only modifier here');
});
