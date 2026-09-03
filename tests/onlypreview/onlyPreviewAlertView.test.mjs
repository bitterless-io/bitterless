/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-alert-view-'));
const bundlePath = join(buildRoot, 'alertView.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/main/onlypreview/views/onlyPreviewAlertView.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { OnlyPreviewAlertViewService } = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const host = {
  kind: 'standalone',
  role: 'content',
  hostId: 'alert-host',
  hostToken: 'alert-host-token-000000'
};
const bounds = { x: 0, y: 0, width: 1280, height: 800 };

const NEW_FOLDER = {
  title: 'New Folder',
  destinationLabel: 'in “docs”',
  nameLabel: 'Name',
  suggestedName: 'untitled folder',
  invalidNameMessage: 'This name cannot be used on Windows or macOS.',
  confirmLabel: 'OK',
  cancelLabel: 'Cancel'
};

const CONFIRM = {
  title: 'Delete 2 items?',
  message: 'They will be removed from disk immediately.',
  entries: [
    { relativePath: 'docs', nodeKind: 'directory' },
    { relativePath: 'notes/one.md', nodeKind: 'file' }
  ],
  moreLabel: '',
  folderTag: 'folder',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  confirmHint: '⌘⏎',
  destructive: true
};

const CONFLICT = {
  title: 'Name already in use',
  message: '“notes” already exists in “docs”.',
  confirmLabel: 'OK'
};

const tick = async () => {
  await new Promise((resolveTick) => setImmediate(resolveTick));
};

const createView = (name) => {
  const webContents = new EventEmitter();
  webContents.destroyed = false;
  webContents.focusCount = 0;
  webContents.isDestroyed = () => webContents.destroyed;
  webContents.focus = () => {
    webContents.focusCount += 1;
  };
  webContents.close = () => {
    webContents.destroyed = true;
  };
  return {
    name,
    bounds: null,
    webContents,
    setBounds(nextBounds) {
      this.bounds = { ...nextBounds };
    }
  };
};

const createHarness = (loadView = async () => undefined) => {
  const views = [];
  const broadcasts = [];
  const shows = [];
  const hides = [];
  const opener = { destroyed: false, focusCount: 0 };
  opener.isDestroyed = () => opener.destroyed;
  opener.focus = () => {
    opener.focusCount += 1;
  };
  const window = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    }
  };
  const service = new OnlyPreviewAlertViewService();
  service.start({
    window,
    host,
    createView: () => {
      const view = createView(`alert-${views.length + 1}`);
      views.push(view);
      return view;
    },
    loadView,
    broadcast: (eventName, params) => broadcasts.push({ eventName, params }),
    showInAlertLayer: (view) => shows.push(view.name),
    hideAlertLayer: () => hides.push(true),
    focusedContents: () => opener
  });
  service.updateBounds(host.hostToken, bounds);
  return { service, views, broadcasts, shows, hides, window, opener };
};

const dialogId = (harness) => harness.service.snapshot(host.hostToken).dialog.dialogId;
const errorId = (harness) => harness.service.snapshot(host.hostToken).error.dialogId;

test('an unloaded alert view is never attached', async () => {
  let release;
  const harness = createHarness(() => new Promise((resolveLoad) => (release = resolveLoad)));
  const pending = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  // A full-window scrim that is attached before its page paints is an invisible click sink over the
  // shell and the preview.
  assert.deepEqual(harness.shows, []);
  release();
  await tick();
  assert.deepEqual(harness.shows, ['alert-1']);
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  assert.equal(await pending, false);
});

test('a confirmation settles on the owner answer and hides the layer', async () => {
  const harness = createHarness();
  const confirmed = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  assert.deepEqual(harness.shows, ['alert-1']);
  const snapshot = harness.service.snapshot(host.hostToken);
  assert.equal(snapshot.dialog.kind, 'confirm');
  assert.equal(snapshot.dialog.destructive, true);
  assert.equal(snapshot.error, null);
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: snapshot.dialog.dialogId,
    outcome: 'confirm',
    value: ''
  });
  assert.equal(await confirmed, true);
  assert.deepEqual(harness.hides, [true]);
  assert.equal(harness.service.snapshot(host.hostToken).dialog, null);
  // Focus goes back where the dialog took it from.
  assert.equal(harness.opener.focusCount, 1);
});

test('the view survives a close so the next dialog is instant', async () => {
  const harness = createHarness();
  const first = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  assert.equal(await first, false);
  const second = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  assert.equal(harness.views.length, 1, 'the renderer is reused, not respawned');
  assert.deepEqual(harness.shows, ['alert-1', 'alert-1']);
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  await second;
});

test('a rejected name keeps the dialog open with the error stacked above it', async () => {
  const harness = createHarness();
  const attempts = [];
  const created = harness.service.requestNewFolder(host.hostToken, NEW_FOLDER, async (name) => {
    attempts.push(name);
    return attempts.length === 1 ? { ok: false, error: CONFLICT } : { ok: true };
  });
  await tick();
  const opened = dialogId(harness);
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: opened,
    outcome: 'confirm',
    value: 'notes'
  });
  const rejected = harness.service.snapshot(host.hostToken);
  // This is the whole point of the commit callback: the dialog is still there, so the renderer still
  // holds the typed name and the owner edits it instead of retyping it.
  assert.equal(rejected.dialog.dialogId, opened);
  assert.equal(rejected.error.title, CONFLICT.title);
  assert.notEqual(rejected.error.dialogId, opened);

  // While the error is up it owns the keyboard, so the dialog underneath cannot be answered.
  await assert.rejects(
    async () =>
      await harness.service.resolve(host.hostToken, {
        hostToken: host.hostToken,
        dialogId: opened,
        outcome: 'confirm',
        value: 'notes'
      }),
    /An alert error is still open/
  );

  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: rejected.error.dialogId,
    outcome: 'confirm',
    value: ''
  });
  const reopened = harness.service.snapshot(host.hostToken);
  assert.equal(reopened.error, null);
  assert.equal(reopened.dialog.dialogId, opened);
  assert.deepEqual(harness.hides, [], 'the layer stays up between the error and the dialog');

  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: opened,
    outcome: 'confirm',
    value: 'notes-2'
  });
  assert.equal(await created, true);
  assert.deepEqual(attempts, ['notes', 'notes-2']);
  assert.equal(harness.service.snapshot(host.hostToken).dialog, null);
});

test('cancelling a New Folder dialog never runs the commit', async () => {
  const harness = createHarness();
  let commits = 0;
  const created = harness.service.requestNewFolder(host.hostToken, NEW_FOLDER, async () => {
    commits += 1;
    return { ok: true };
  });
  await tick();
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: 'typed but abandoned'
  });
  assert.equal(await created, false);
  assert.equal(commits, 0);
});

test('a failure with nothing to say closes the dialog instead of trapping the owner', async () => {
  const harness = createHarness();
  const created = harness.service.requestNewFolder(host.hostToken, NEW_FOLDER, async () => ({
    ok: false,
    error: null
  }));
  await tick();
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'confirm',
    value: 'notes'
  });
  assert.equal(await created, false);
  assert.equal(harness.service.snapshot(host.hostToken).dialog, null);
});

test('a commit that throws is a cancel, not an unhandled rejection', async () => {
  const harness = createHarness();
  const created = harness.service.requestNewFolder(host.hostToken, NEW_FOLDER, async () => {
    throw new Error('the authority went away');
  });
  await tick();
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'confirm',
    value: 'notes'
  });
  assert.equal(await created, false);
  assert.equal(harness.service.snapshot(host.hostToken).dialog, null);
});

test('a standalone error resolves its own caller', async () => {
  const harness = createHarness();
  let dismissed = false;
  const shown = harness.service.showError(host.hostToken, CONFLICT).then(() => {
    dismissed = true;
  });
  await tick();
  assert.deepEqual(harness.shows, ['alert-1']);
  assert.equal(harness.service.snapshot(host.hostToken).dialog, null);
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: errorId(harness),
    outcome: 'confirm',
    value: ''
  });
  await shown;
  assert.equal(dismissed, true);
  assert.deepEqual(harness.hides, [true]);
});

test('a second base dialog is refused rather than stacked', async () => {
  const harness = createHarness();
  const first = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  assert.throws(
    () => harness.service.requestConfirm(host.hostToken, CONFIRM),
    /An alert dialog is already open/
  );
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  await first;
});

test('a stale dialog id can never answer the current dialog', async () => {
  const harness = createHarness();
  const pending = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  await assert.rejects(
    async () =>
      await harness.service.resolve(host.hostToken, {
        hostToken: host.hostToken,
        dialogId: 'a-dialog-that-is-gone',
        outcome: 'confirm',
        value: ''
      }),
    /Alert dialog is unavailable/
  );
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  assert.equal(await pending, false);
});

test('another host cannot read or answer this host dialog', async () => {
  const harness = createHarness();
  const pending = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  assert.throws(() => harness.service.snapshot('another-host-token-0000'), /does not belong/);
  await assert.rejects(
    async () =>
      await harness.service.resolve('another-host-token-0000', {
        hostToken: 'another-host-token-0000',
        dialogId: dialogId(harness),
        outcome: 'confirm',
        value: ''
      }),
    /does not belong/
  );
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  await pending;
});

test('destroying the window cancels every open dialog', async () => {
  const harness = createHarness();
  const confirmed = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  harness.service.destroy();
  assert.equal(await confirmed, false, 'a dialog with no window has no answer');
  assert.equal(harness.views[0].webContents.destroyed, true);
});

test('a dead renderer cancels the dialog rather than leaving it unanswerable', async () => {
  const harness = createHarness();
  const created = harness.service.requestNewFolder(
    host.hostToken,
    NEW_FOLDER,
    async () => ({ ok: true })
  );
  await tick();
  harness.views[0].webContents.emit('render-process-gone');
  assert.equal(await created, false);
  assert.deepEqual(harness.hides, [true]);
});

test('a bounds change while a dialog is open re-attaches with the new rect', async () => {
  const harness = createHarness();
  const pending = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  harness.service.updateBounds(host.hostToken, { x: 0, y: 0, width: 900, height: 600 });
  assert.deepEqual(harness.shows, ['alert-1', 'alert-1']);
  assert.deepEqual(harness.views[0].bounds, { x: 0, y: 0, width: 900, height: 600 });
  // An identical rect is not a change, so it does not re-sort the layers.
  harness.service.updateBounds(host.hostToken, { x: 0, y: 0, width: 900, height: 600 });
  assert.equal(harness.shows.length, 2);
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  await pending;
});

test('the dialog list is capped so a large selection cannot become a scroller', async () => {
  const harness = createHarness();
  const entries = Array.from({ length: 40 }, (_unused, index) => ({
    relativePath: `notes/${index}.md`,
    nodeKind: 'file'
  }));
  const pending = harness.service.requestConfirm(host.hostToken, {
    ...CONFIRM,
    entries,
    moreLabel: '…and 30 more'
  });
  await tick();
  const snapshot = harness.service.snapshot(host.hostToken);
  assert.equal(snapshot.dialog.entries.length, 10);
  assert.equal(snapshot.dialog.moreLabel, '…and 30 more');
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: snapshot.dialog.dialogId,
    outcome: 'cancel',
    value: ''
  });
  await pending;
});

test('the state event carries only a revision, never the dialog', async () => {
  const harness = createHarness();
  const pending = harness.service.requestConfirm(host.hostToken, CONFIRM);
  await tick();
  const events = harness.broadcasts.filter(
    ({ eventName }) => eventName === 'onlypreview/alertState'
  );
  assert.ok(events.length >= 1);
  for (const { params } of events) {
    // The renderer pulls the state, because a broadcast has no replay and this renderer exists
    // before any dialog does.
    assert.deepEqual(Object.keys(params).sort(), ['hostId', 'revision']);
  }
  await harness.service.resolve(host.hostToken, {
    hostToken: host.hostToken,
    dialogId: dialogId(harness),
    outcome: 'cancel',
    value: ''
  });
  await pending;
});
