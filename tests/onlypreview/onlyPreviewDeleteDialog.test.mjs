/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-delete-dialog-'));
const bundlePath = join(buildRoot, 'deleteDialog.mjs');
const source = (path) => readFileSync(join(projectRoot, path), 'utf8');

await build({
  entryPoints: [join(projectRoot, 'src/main/onlypreview/onlyPreviewDeleteDialog.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  alias: {
    '@main/onlypreview/views/onlyPreviewAlertWindow.service': join(
      projectRoot,
      'tests/onlypreview/fixtures/alertWindow.stub.mjs'
    ),
    '@main/i18n/i18n.helper': join(projectRoot, 'tests/onlypreview/fixtures/deleteI18n.stub.mjs')
  }
});

const {
  presentOnlyPreviewDeleteDialog,
  describeOnlyPreviewDeletePlan,
  ONLY_PREVIEW_MAX_DELETE_ENTRIES
} = await import(pathToFileURL(bundlePath).href);
const alertWindow = await import(
  pathToFileURL(join(projectRoot, 'tests/onlypreview/fixtures/alertWindow.stub.mjs')).href
);
const { i18nHelper } = await import(
  pathToFileURL(join(projectRoot, 'tests/onlypreview/fixtures/deleteI18n.stub.mjs')).href
);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
const dir = (relativePath) => ({ relativePath, nodeKind: 'directory' });
const file = (relativePath) => ({ relativePath, nodeKind: 'file' });

const run = async (selection, { confirm = true, fail = null, platform = 'darwin' } = {}) => {
  alertWindow.resetAlertWindowStub([], [confirm]);
  const removed = [];
  const outcome = await presentOnlyPreviewDeleteDialog(
    { hostToken: 'host-token-000000', selection, platform },
    {
      removeEntry: async (entry) => {
        if (entry.relativePath === fail) throw new Error('refused');
        removed.push(entry.relativePath);
      }
    }
  );
  return {
    outcome,
    removed,
    confirms: alertWindow.state.confirms,
    errors: alertWindow.state.errors
  };
};

test('the plan is what gets confirmed, not what was clicked', async () => {
  // Owner rule: selecting a1/b1/c1, a1/b1 and a2 must delete a1/b1 and a2 only.
  const result = await run([dir('a1/b1/c1'), dir('a1/b1'), dir('a2')]);
  assert.equal(result.confirms.length, 1);
  assert.deepEqual(
    result.confirms[0].entries.map((entry) => entry.relativePath),
    ['a1/b1', 'a2']
  );
  assert.deepEqual(result.removed, ['a1/b1', 'a2']);
  assert.equal(result.outcome.failed, null);
});

test('one file names itself in the title and lists nothing', () => {
  const plan = describeOnlyPreviewDeletePlan([file('docs/report.pdf')], labels, 'darwin');
  assert.equal(plan.title, 'Delete “report.pdf”?');
  assert.deepEqual(plan.entries, [], 'a single entry is already named in the title');
  assert.equal(plan.message, labels.deleteConfirmSingleMessage);
  assert.equal(plan.destructive, true);
});

test('one folder says that everything inside it goes', () => {
  const plan = describeOnlyPreviewDeletePlan([dir('docs')], labels, 'darwin');
  assert.equal(plan.title, 'Delete “docs” and everything inside it?');
});

test('a long plan is capped with a count of the rest', () => {
  const entries = Array.from({ length: 14 }, (_unused, index) => file(`notes/${index}.md`));
  const plan = describeOnlyPreviewDeletePlan(entries, labels, 'darwin');
  assert.equal(plan.title, 'Delete 14 items?');
  assert.equal(plan.entries.length, 10);
  assert.equal(plan.moreLabel, '…and 4 more');
});

test('the confirm hint follows the platform', () => {
  assert.equal(describeOnlyPreviewDeletePlan([dir('a')], labels, 'darwin').confirmHint, '⌘⏎');
  assert.equal(describeOnlyPreviewDeletePlan([dir('a')], labels, 'win32').confirmHint, 'Ctrl+⏎');
});

test('cancelling removes nothing', async () => {
  const result = await run([file('a.txt'), dir('b')], { confirm: false });
  assert.deepEqual(result.removed, []);
  assert.equal(result.outcome.confirmed, false);
  assert.deepEqual(result.errors, []);
});

test('a failure stops the run and reports what actually happened', async () => {
  const result = await run([file('a.txt'), dir('b'), file('c.txt')], { fail: 'b' });
  assert.deepEqual(result.removed, ['a.txt'], 'entries after the failure are not attempted');
  assert.equal(result.outcome.failed.relativePath, 'b');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].title, labels.deletePartialTitle);
  assert.equal(result.errors[0].message, '1 of 3 items were deleted.\n“b” could not be deleted.');
});

test('a single failed entry uses the plain failure message', async () => {
  const result = await run([file('a.txt')], { fail: 'a.txt' });
  assert.deepEqual(result.removed, []);
  assert.equal(result.errors[0].title, labels.deleteFailureTitle);
  assert.equal(result.errors[0].message, labels.deleteFailureMessage);
});

test('the Project root is refused instead of confirmed', async () => {
  const result = await run([dir(''), file('a.txt')]);
  assert.deepEqual(result.confirms, [], 'nothing is confirmed');
  assert.deepEqual(result.removed, []);
  assert.equal(result.errors[0].title, labels.deleteRootRefusedTitle);
});

test('an empty selection does nothing at all', async () => {
  const result = await run([]);
  assert.deepEqual(result.confirms, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.outcome.confirmed, false);
});

test('an oversized plan is refused with its limit before any confirmation', async () => {
  const entries = Array.from({ length: ONLY_PREVIEW_MAX_DELETE_ENTRIES + 1 }, (_unused, index) =>
    file(`notes/${index}.md`)
  );
  const result = await run(entries);
  assert.deepEqual(result.confirms, []);
  assert.deepEqual(result.removed, []);
  assert.equal(result.errors[0].title, labels.deleteTooManyTitle);
  assert.match(result.errors[0].message, new RegExp(String(ONLY_PREVIEW_MAX_DELETE_ENTRIES)));
});

test('the authority accepts a folder and removes it as a tree', () => {
  const authority = source('src/preload/fileSearch/fileSearchProjectAuthority.service.ts');
  // Delete used to be regular-files-only.
  assert.doesNotMatch(authority, /Only regular files can be deleted/);
  assert.match(authority, /Only files and folders can be deleted/);
  // A directory cannot be pinned by a descriptor — `open()` on one fails on Windows — so its
  // identity is re-checked by lstat, immediately before and after the isolate rename.
  assert.match(
    authority,
    /if \(item\.nodeKind === 'file'\) \{[\s\S]*openPinnedDeleteHandle[\s\S]*\} else \{[\s\S]*requireDirectoryDeleteIdentity/
  );
  assert.match(
    authority,
    /requirePinnedDeleteIdentity[\s\S]*isolateDeleteEntry[\s\S]*requireIsolatedDeleteIdentity/
  );
  assert.match(
    authority,
    /prepared\.nodeKind === 'directory'[\s\S]*removeTree\(isolated\.entryPath\)[\s\S]*else[\s\S]*unlink\(isolated\.entryPath\)/
  );
  // `rm` unlinks a symlink rather than following it, and `force: false` keeps a vanished tree an
  // error instead of a silent success.
  assert.match(authority, /rm\(path, \{ recursive: true, force: false \}\)/);
  // A directory's size and mtime change whenever a child changes, so only dev/ino identify it.
  assert.match(
    authority,
    /nodeKind === 'directory'\s*\?\s*left\.deviceId === right\.deviceId && left\.inode === right\.inode/
  );
  // A directory cannot be hard-linked back, and renaming onto a taken name would clobber it.
  assert.match(authority, /nodeKind === 'file'[\s\S]*link\(isolated\.entryPath/);
});

test('Main drives one delete surface and keeps the two-phase grant', () => {
  const actions = source('src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts');
  // The native message box is gone; the alert dialog covers every delete.
  assert.doesNotMatch(actions, /deleteConfirmTitle|deleteConfirmDetail|destructiveId/);
  assert.match(actions, /presentOnlyPreviewDeleteDialog\(/);
  assert.match(
    actions,
    /prepareProjectDelete\([\s\S]*requireCurrentItem\(authority\)[\s\S]*commitProjectDelete\(/
  );
  assert.match(actions, /catch \(error\) \{[\s\S]*cancelDelete\(authority, prepared\.grantId\)/);
  // A previewed file inside a removed folder is as gone as the folder.
  assert.match(actions, /selected\?\.startsWith\(`\$\{authority\.relativePath\}\/`\)/);
  // Delete is offered on folders now, and the label carries the count for a multi-selection.
  assert.doesNotMatch(actions, /if \(item\.nodeKind === 'file'\) \{\s*template\.push\(\s*\{ type: 'separator' \}/);
  assert.match(actions, /menuSelection\.length > 1[\s\S]*labels\.deleteManyMenu/);
});
