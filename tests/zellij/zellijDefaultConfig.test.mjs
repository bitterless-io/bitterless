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
const children = (document, name) => {
  const node = document.nodes.find((node) => node.getName() === name);
  assert.ok(node?.children, `missing ${name} section`);
  return node.children;
};
const values = (document) =>
  Object.fromEntries(document.nodes.map((node) => [node.getName(), node.getArguments()]));
const luminance = (rgb) =>
  rgb
    .map((channel) => channel / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => {
  const lights = [luminance(a), luminance(b)];
  return (Math.max(...lights) + 0.05) / (Math.min(...lights) + 0.05);
};
const rgb = (hex) => hex.match(/[0-9a-f]{2}/g).map((channel) => parseInt(channel, 16));

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
    assert.match(execFileSync(BINARY, ['--version'], { encoding: 'utf8' }), /^zellij 0\.45\.1\s*$/);
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
  assert.match(config, /\n\s+base \d{1,3} \d{1,3} \d{1,3}\n/);
  const document = parse(config);
  const web = document.nodes.find((node) => node.getName() === 'web_client');
  const palette = web.children.nodes.find((node) => node.getName() === 'theme');
  const colors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  for (const name of [
    'background',
    'foreground',
    'cursor',
    'selection_background',
    'selection_foreground',
    'selection_inactive_background',
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

test('native and browser text selections have visible regions and readable glyphs', () => {
  const document = parse(buildZellijDefaultConfig({ platform: 'darwin' }));
  const native = values(
    children(children(children(document, 'themes'), 'bitterless'), 'text_selected')
  );
  const web = values(children(children(document, 'web_client'), 'theme'));
  assert.deepEqual(native.base, [21, 22, 30]);
  assert.deepEqual(native.background, [122, 162, 247]);
  assert.equal(web.selection_background[0], '#7aa2f7');
  assert.equal(web.selection_foreground[0], '#15161e');
  assert.equal(web.selection_inactive_background[0], '#6686c2');
  assert.deepEqual(native.base, rgb(web.selection_foreground[0]));
  assert.deepEqual(native.background, rgb(web.selection_background[0]));
  for (const background of [web.selection_background[0], web.selection_inactive_background[0]]) {
    assert.ok(contrast(rgb(background), rgb(web.background[0])) >= 3, 'selection region contrast');
    assert.ok(
      contrast(rgb(background), rgb(web.selection_foreground[0])) >= 4.5,
      'selected text contrast'
    );
  }
});

test('semantic migration preserves every other color resolved from the legacy native palette', () => {
  // Pinned upstream contract: zellij-utils/src/data.rs, impl From<Palette> for Styling.
  // https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/data.rs#L1646-L1771
  const palette = {
    white: [192, 202, 245],
    black: [26, 27, 38],
    fg: [216, 222, 233],
    bg: [26, 27, 38],
    red: [247, 118, 142],
    green: [158, 206, 106],
    yellow: [224, 175, 104],
    blue: [122, 162, 247],
    magenta: [187, 154, 247],
    cyan: [125, 207, 255],
    orange: [255, 158, 100],
    default: [0] // PaletteColor::EightBit(0), not RGB black.
  };
  const legacyStyles = {
    text_unselected: ['white', 'black', 'orange', 'cyan', 'green', 'magenta'],
    text_selected: ['white', 'bg', 'orange', 'cyan', 'green', 'magenta'],
    ribbon_unselected: ['black', 'fg', 'red', 'white', 'blue', 'magenta'],
    ribbon_selected: ['black', 'green', 'red', 'orange', 'magenta', 'blue'],
    exit_code_success: ['green', 'default', 'cyan', 'black', 'magenta', 'blue'],
    exit_code_error: ['red', 'default', 'yellow', 'default', 'default', 'default'],
    frame_selected: ['green', 'default', 'orange', 'cyan', 'magenta', 'default'],
    frame_highlight: ['orange', 'default', 'magenta', 'default', 'orange', 'orange'],
    table_title: ['green', 'default', 'orange', 'cyan', 'green', 'magenta'],
    table_cell_unselected: ['white', 'black', 'orange', 'cyan', 'green', 'magenta'],
    table_cell_selected: ['white', 'bg', 'orange', 'cyan', 'green', 'magenta'],
    list_unselected: ['white', 'black', 'orange', 'cyan', 'green', 'magenta'],
    list_selected: ['white', 'bg', 'orange', 'cyan', 'green', 'magenta']
  };
  const fields = ['base', 'background', 'emphasis_0', 'emphasis_1', 'emphasis_2', 'emphasis_3'];
  const theme = children(
    children(parse(buildZellijDefaultConfig({ platform: 'darwin' })), 'themes'),
    'bitterless'
  );
  assert.deepEqual(
    theme.nodes.map((node) => node.getName()).sort(),
    [...Object.keys(legacyStyles), 'multiplayer_user_colors'].sort()
  );
  for (const [name, colors] of Object.entries(legacyStyles)) {
    const expected = Object.fromEntries(
      colors.map((color, index) => [fields[index], palette[color]])
    );
    if (name === 'text_selected') {
      expected.base = [21, 22, 30];
      expected.background = [122, 162, 247];
    }
    assert.deepEqual(values(children(theme, name)), expected, name);
  }
  const players = [
    'magenta',
    'blue',
    'default',
    'yellow',
    'cyan',
    'default',
    'red',
    'default',
    'default',
    'default'
  ];
  assert.deepEqual(
    values(children(theme, 'multiplayer_user_colors')),
    Object.fromEntries(players.map((color, index) => [`player_${index + 1}`, palette[color]]))
  );
});

test('unselected web content and all sixteen ANSI colors retain the original palette', () => {
  const theme = values(
    children(
      children(parse(buildZellijDefaultConfig({ platform: 'darwin' })), 'web_client'),
      'theme'
    )
  );
  const original = {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    bright_black: '#414868',
    bright_red: '#f7768e',
    bright_green: '#9ece6a',
    bright_yellow: '#e0af68',
    bright_blue: '#7aa2f7',
    bright_magenta: '#bb9af7',
    bright_cyan: '#7dcfff',
    bright_white: '#c0caf5'
  };
  for (const [name, color] of Object.entries(original))
    assert.deepEqual(theme[name], [color], name);
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
