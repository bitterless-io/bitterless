/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, beforeEach, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-find-menu-'));
const bundlePath = join(buildRoot, 'findMenu.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/main/menu/applicationFindMenu.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  alias: { electron: join(projectRoot, 'tests/onlypreview/fixtures/electronMenu.stub.mjs') }
});

const { buildApplicationFindMenuTemplate, setApplicationFindDispatch } = await import(
  pathToFileURL(bundlePath).href
);
const { state, resetElectronMenuStub } = await import(
  pathToFileURL(join(projectRoot, 'tests/onlypreview/fixtures/electronMenu.stub.mjs')).href
);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const editSubmenu = () => {
  const template = buildApplicationFindMenuTemplate();
  const edit = template.find((item) => item.label === 'Edit');
  assert.ok(edit, 'the template must carry an Edit menu');
  return edit.submenu;
};

const findItem = (accelerator) => {
  const item = editSubmenu().find((entry) => entry.accelerator === accelerator);
  assert.ok(item, `no menu item is bound to ${accelerator}`);
  return item;
};

const createContents = () => {
  const events = [];
  return {
    events,
    isDestroyed: () => false,
    sendInputEvent: (event) => events.push(event)
  };
};

beforeEach(() => {
  resetElectronMenuStub();
  setApplicationFindDispatch(null);
});

test('the menu carries both find accelerators', () => {
  assert.equal(findItem('Command+F').label, 'Find…');
  assert.equal(findItem('Shift+Command+F').label, 'Find in Project…');
});

test('installing the menu keeps the default editing accelerators', () => {
  const roles = editSubmenu()
    .map((entry) => entry.role)
    .filter(Boolean);
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.ok(roles.includes(role), `Edit must keep the ${role} role`);
  }
  const top = buildApplicationFindMenuTemplate()
    .map((entry) => entry.role)
    .filter(Boolean);
  for (const role of ['appMenu', 'fileMenu', 'viewMenu', 'windowMenu']) {
    assert.ok(top.includes(role), `the template must keep the ${role} menu`);
  }
});

test('a claimed chord is not replayed to the focused contents', () => {
  const contents = createContents();
  state.focusedWebContents = contents;
  const seen = [];
  setApplicationFindDispatch((command) => {
    seen.push(command);
    return true;
  });
  findItem('Command+F').click();
  findItem('Shift+Command+F').click();
  assert.deepEqual(seen, ['find-in-file', 'focus-search']);
  assert.deepEqual(contents.events, []);
});

test('an unclaimed chord is replayed so other windows keep their own find', () => {
  const contents = createContents();
  state.focusedWebContents = contents;
  setApplicationFindDispatch(() => false);
  findItem('Command+F').click();
  assert.deepEqual(contents.events, [
    { type: 'keyDown', keyCode: 'F', modifiers: ['meta'] },
    { type: 'keyUp', keyCode: 'F', modifiers: ['meta'] }
  ]);
  contents.events.length = 0;
  findItem('Shift+Command+F').click();
  assert.deepEqual(contents.events, [
    { type: 'keyDown', keyCode: 'F', modifiers: ['meta', 'shift'] },
    { type: 'keyUp', keyCode: 'F', modifiers: ['meta', 'shift'] }
  ]);
});

test('a chord pressed with no dispatcher registered still reaches the focused contents', () => {
  const contents = createContents();
  state.focusedWebContents = contents;
  findItem('Command+F').click();
  assert.equal(contents.events.length, 2);
});

test('a chord with nothing focused is dropped instead of throwing', () => {
  setApplicationFindDispatch(() => false);
  assert.doesNotThrow(() => findItem('Command+F').click());
});
