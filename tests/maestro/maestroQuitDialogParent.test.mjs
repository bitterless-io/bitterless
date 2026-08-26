/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const result = await build({
  entryPoints: [join(projectRoot, 'src/main/dialog/dialogParent.service.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false
});
const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
const { selectDialogParent } = await import(`data:text/javascript;base64,${encoded}`);

const candidate = (name, { destroyed = false, visible = true } = {}) => ({
  name,
  isDestroyed: () => destroyed,
  isVisible: () => visible
});

test('focused visible BaseWindow candidate wins over candidate order', () => {
  const home = candidate('home');
  const maestro = candidate('maestro');

  assert.equal(selectDialogParent(maestro, [home, maestro]), maestro);
});

test('first visible candidate is used when the focused candidate is hidden', () => {
  const focused = candidate('focused-hidden', { visible: false });
  const hiddenHome = candidate('home-hidden', { visible: false });
  const maestro = candidate('maestro');
  const anotherVisibleWindow = candidate('another-visible');

  assert.equal(
    selectDialogParent(focused, [hiddenHome, maestro, anotherVisibleWindow]),
    maestro
  );
});

test('hidden-only candidates do not own a dialog', () => {
  const hiddenHome = candidate('home-hidden', { visible: false });
  const hiddenMaestro = candidate('maestro-hidden', { visible: false });

  assert.equal(selectDialogParent(hiddenHome, [hiddenHome, hiddenMaestro]), null);
});

test('destroyed focused and list candidates are skipped', () => {
  const focused = candidate('focused-destroyed', { destroyed: true });
  const destroyedHome = candidate('home-destroyed', { destroyed: true });
  const maestro = candidate('maestro');

  assert.equal(selectDialogParent(focused, [destroyedHome, maestro]), maestro);
  assert.equal(selectDialogParent(focused, [destroyedHome]), null);
});

test('empty candidates resolve to no dialog owner', () => {
  assert.equal(selectDialogParent(null, []), null);
});

test('DialogHelper resolves BaseWindow ownership for both dialog methods and supports no owner', () => {
  const helper = source('src/main/dialog/dialog.helper.ts');

  assert.match(helper, /import \{ BaseWindow, dialog,/);
  assert.match(
    helper,
    /selectDialogParent\(BaseWindow\.getFocusedWindow\(\), BaseWindow\.getAllWindows\(\)\)/
  );
  assert.doesNotMatch(helper, /BrowserWindow/);
  assert.doesNotMatch(helper, /getAllWindows\(\)\[0\]/);
  assert.match(
    helper,
    /return owner \? await dialog\.showMessageBox\(owner, options\) : await dialog\.showMessageBox\(options\)/
  );
  assert.equal((helper.match(/showMessageBoxWithResolvedParent\(options\)/g) ?? []).length, 2);
});
