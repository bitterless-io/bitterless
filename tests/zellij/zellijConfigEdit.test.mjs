import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-config-edit-'));
const output = join(directory, 'config.cjs');
buildSync({
  entryPoints: ['src/main/zellij/zellijConfigEdit.service.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output
});
const { defaultZellijShortcuts, readZellijShortcuts, editZellijShortcuts } = createRequire(
  import.meta.url
)(output);
test.after(() => rmSync(directory, { recursive: true, force: true }));

const existing = `// personal configuration\nsession_serialization false\nkeybinds clear-defaults=false {\n  normal {\n    // preserve this note\n    bind "Super d" "Alt j" { NewPane "Down"; }\n    bind "Super Shift d" { NewPane "Right"; }\n    bind "Super w" { CloseFocus; }\n    bind "Alt x" { NewPane "Down"; SwitchToMode "Normal"; }\n  }\n}\nplugins {\n  compact-bar location="zellij:compact-bar"\n}\n`;

test('reads the existing single-action shortcuts and leaves multi-action bindings alone', () => {
  assert.deepEqual(readZellijShortcuts(existing, 'darwin'), {
    splitDown: 'Super d',
    splitRight: 'Super Shift d',
    closePane: 'Super w'
  });
  assert.equal(readZellijShortcuts('', 'win32').closePane, 'Ctrl Alt w');
});

test('updates only managed nodes, removes superseded aliases, preserves KDL v1 bytes', () => {
  const next = editZellijShortcuts(existing, {
    splitDown: 'Super j',
    splitRight: 'Super k',
    closePane: 'Ctrl q'
  });
  assert.ok(
    next.startsWith(
      '// personal configuration\nsession_serialization false\nkeybinds clear-defaults=false'
    )
  );
  assert.ok(next.endsWith('plugins {\n  compact-bar location="zellij:compact-bar"\n}\n'));
  assert.ok(next.includes('// preserve this note'));
  assert.ok(next.includes('bind "Alt x" { NewPane "Down"; SwitchToMode "Normal"; }'));
  assert.ok(!next.includes('"Alt j"'));
  assert.ok(!next.includes('"Super d"'));
  assert.deepEqual(readZellijShortcuts(next, 'darwin'), {
    splitDown: 'Super j',
    splitRight: 'Super k',
    closePane: 'Ctrl q'
  });
  assert.equal((next.match(/^keybinds/gm) ?? []).length, 1);
});

test('adds missing actions inside the first keybinds, preserves shared modes and CRLF', () => {
  const source =
    'session_serialization false\r\nkeybinds {\r\n  shared_except "locked" {\r\n    bind "Alt n" { NewPane; }\r\n  }\r\n}\r\n';
  const next = editZellijShortcuts(source, defaultZellijShortcuts('darwin'));
  assert.equal((next.match(/shared_except/g) ?? []).length, 1);
  assert.equal((next.match(/keybinds/g) ?? []).length, 1);
  assert.ok(next.includes('bind "Alt n" { NewPane; }'));
  assert.ok(!next.replaceAll('\r\n', '').includes('\n'));
  assert.equal(readZellijShortcuts(next, 'darwin').splitDown, 'Super Shift d');
});

test('rejects malformed documents, duplicate keys, invalid syntax and unrelated key conflicts', () => {
  assert.throws(() => editZellijShortcuts('keybinds {', defaultZellijShortcuts('darwin')), {
    code: 'config-invalid'
  });
  assert.throws(
    () =>
      editZellijShortcuts(existing, {
        splitDown: 'Super j',
        splitRight: 'Super j',
        closePane: 'Ctrl w'
      }),
    { code: 'shortcut-conflict' }
  );
  assert.throws(
    () =>
      editZellijShortcuts(existing, {
        ...defaultZellijShortcuts('darwin'),
        splitDown: 'Command d'
      }),
    { code: 'shortcut-invalid' }
  );
  assert.throws(
    () =>
      editZellijShortcuts(existing, { ...defaultZellijShortcuts('darwin'), splitDown: 'Alt x' }),
    { code: 'shortcut-conflict' }
  );
});

test('creates a single valid keybinds block and source offsets preserve Unicode', () => {
  const source = '// 终端 🧭\nsession_serialization false\n';
  const next = editZellijShortcuts(source, defaultZellijShortcuts('darwin'));
  assert.ok(next.startsWith(source));
  assert.equal((next.match(/keybinds/g) ?? []).length, 1);
  const changed = editZellijShortcuts(next, {
    splitDown: 'Super j',
    splitRight: 'Super k',
    closePane: 'Ctrl q'
  });
  assert.ok(changed.startsWith(source));
  assert.equal(readZellijShortcuts(changed, 'darwin').closePane, 'Ctrl q');
});

test('reads and edits only Normal; identical actions in other modes remain byte-for-byte intact', () => {
  const otherModes =
    '  pane {\n    bind "d" { NewPane "Down"; }\n    bind "r" { NewPane "Right"; }\n    bind "x" { CloseFocus; }\n  }\n  shared_except "locked" {\n    bind "Alt x" { CloseFocus; }\n  }\n';
  const source = `keybinds {\n${otherModes}}\n`;
  assert.deepEqual(readZellijShortcuts(source, 'darwin'), defaultZellijShortcuts('darwin'));
  const next = editZellijShortcuts(source, {
    splitDown: 'Super j',
    splitRight: 'Super k',
    closePane: 'Ctrl q'
  });
  assert.ok(next.includes(otherModes));
  assert.equal((next.match(/  normal \{/g) ?? []).length, 1);
  assert.deepEqual(readZellijShortcuts(next, 'darwin'), {
    splitDown: 'Super j',
    splitRight: 'Super k',
    closePane: 'Ctrl q'
  });
});
