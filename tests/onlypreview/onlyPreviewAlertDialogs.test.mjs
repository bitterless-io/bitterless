/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-alert-dialogs-'));
const source = (path) => readFileSync(join(projectRoot, path), 'utf8');

const bundle = async (entry, outfile, alias) => {
  const outPath = join(buildRoot, outfile);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile: outPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
    ...(alias ? { alias } : {})
  });
  return await import(pathToFileURL(outPath).href);
};

const keyboard = await bundle(
  'src/renderer/onlypreview/alert/src/onlyPreviewAlert.service.ts',
  'keyboard.mjs'
);
const newFolder = await bundle(
  'tests/onlypreview/alertNewFolder.entry.ts',
  'newFolder.mjs',
  {
    'electron-xpc/main': join(projectRoot, 'tests/onlypreview/fixtures/xpcMain.stub.mjs'),
    '@main/onlypreview/views/onlyPreviewAlertWindow.service': join(
      projectRoot,
      'tests/onlypreview/fixtures/alertWindow.stub.mjs'
    ),
    '@main/i18n/i18n.helper': join(projectRoot, 'tests/onlypreview/fixtures/newFolderI18n.stub.mjs')
  }
);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const { resolveOnlyPreviewAlertKey, resolveOnlyPreviewAlertKeyboardLayer } = keyboard;
const { presentOnlyPreviewNewFolderDialog, OnlyPreviewContractError } = newFolder;
const alertWindow = await import(
  pathToFileURL(join(projectRoot, 'tests/onlypreview/fixtures/alertWindow.stub.mjs')).href
);
const xpcStub = await import(
  pathToFileURL(join(projectRoot, 'tests/onlypreview/fixtures/xpcMain.stub.mjs')).href
);

const key = (value, modifiers = {}) => ({
  key: value,
  meta: false,
  control: false,
  alt: false,
  composing: false,
  ...modifiers
});

test('the error surface owns the keyboard while it is up', () => {
  const dialog = { kind: 'new-folder', dialogId: 'd' };
  const error = { kind: 'error', dialogId: 'e' };
  assert.equal(resolveOnlyPreviewAlertKeyboardLayer({ revision: 1, dialog: null, error: null }), 'none');
  assert.equal(
    resolveOnlyPreviewAlertKeyboardLayer({ revision: 1, dialog, error: null }),
    'new-folder'
  );
  assert.equal(
    resolveOnlyPreviewAlertKeyboardLayer({
      revision: 1,
      dialog: { kind: 'confirm', dialogId: 'c' },
      error: null
    }),
    'confirm'
  );
  // Stacked: the dialog underneath must not act on Enter, or the owner answers the wrong question.
  assert.equal(resolveOnlyPreviewAlertKeyboardLayer({ revision: 1, dialog, error }), 'error');
});

test('every dismissal gesture closes a one-button error', () => {
  // The owner's rule: 「回车 esc 点确定都能关闭」.
  assert.equal(resolveOnlyPreviewAlertKey('error', key('Enter')), 'dismiss-error');
  assert.equal(resolveOnlyPreviewAlertKey('error', key('Escape')), 'dismiss-error');
  assert.equal(resolveOnlyPreviewAlertKey('error', key('Esc')), 'dismiss-error');
  assert.equal(resolveOnlyPreviewAlertKey('error', key('a')), 'none');
});

test('New Folder commits on a plain Enter and cancels on Escape', () => {
  assert.equal(resolveOnlyPreviewAlertKey('new-folder', key('Enter')), 'confirm');
  assert.equal(resolveOnlyPreviewAlertKey('new-folder', key('Escape')), 'cancel');
  for (const modifier of ['meta', 'control', 'alt']) {
    assert.equal(
      resolveOnlyPreviewAlertKey('new-folder', key('Enter', { [modifier]: true })),
      'none',
      `${modifier}+Enter is not the commit gesture`
    );
  }
});

test('a composition Enter never commits', () => {
  // An IME's Enter closes the candidate window; the owner types CJK folder names.
  assert.equal(
    resolveOnlyPreviewAlertKey('new-folder', key('Enter', { composing: true })),
    'none'
  );
  assert.equal(resolveOnlyPreviewAlertKey('error', key('Enter', { composing: true })), 'none');
  // Escape is not a composition key here, so it still cancels.
  assert.equal(
    resolveOnlyPreviewAlertKey('new-folder', key('Escape', { composing: true })),
    'cancel'
  );
});

test('a destructive confirmation makes the safe gesture the default one', () => {
  assert.equal(resolveOnlyPreviewAlertKey('confirm', key('Escape')), 'cancel');
  // Plain Enter activates the focused button, and Cancel holds the focus.
  assert.equal(resolveOnlyPreviewAlertKey('confirm', key('Enter')), 'cancel');
  assert.equal(resolveOnlyPreviewAlertKey('confirm', key('Enter', { meta: true })), 'confirm');
  assert.equal(resolveOnlyPreviewAlertKey('confirm', key('Enter', { control: true })), 'confirm');
});

test('a closed stack consumes nothing', () => {
  assert.equal(resolveOnlyPreviewAlertKey('none', key('Enter')), 'none');
  assert.equal(resolveOnlyPreviewAlertKey('none', key('Escape')), 'none');
});

const target = {
  hostId: 'host-id',
  hostToken: 'host-token-000000',
  workspaceId: 'workspace-000000',
  parentRelativePath: 'docs',
  destinationName: 'docs'
};

const runNewFolder = async (answers, creators) => {
  alertWindow.resetAlertWindowStub(answers);
  xpcStub.resetXpcMainStub();
  await presentOnlyPreviewNewFolderDialog(target, creators);
  return {
    requests: alertWindow.state.requests,
    errors: alertWindow.state.errors,
    broadcasts: xpcStub.state.broadcasts
  };
};

test('an untouched suggestion runs the untitled sequence', async () => {
  const calls = [];
  const result = await runNewFolder(['untitled folder'], {
    createUntitled: async (value) => {
      calls.push(['untitled', value.parentRelativePath]);
      return { relativePath: 'docs/untitled folder 2' };
    },
    createNamed: async () => {
      calls.push(['named']);
      return { relativePath: 'never' };
    }
  });
  // Confirming Main's own suggestion always creates something, so Enter is never a dead key.
  assert.deepEqual(calls, [['untitled', 'docs']]);
  assert.equal(result.requests[0].suggestedName, 'untitled folder');
  assert.equal(result.requests[0].destinationLabel, 'in “docs”');
  assert.deepEqual(result.broadcasts, [
    {
      eventName: 'onlypreview/projectNewFolder',
      params: {
        hostId: 'host-id',
        workspaceId: 'workspace-000000',
        relativePath: 'docs/untitled folder 2'
      }
    }
  ]);
});

test('a typed name is created verbatim', async () => {
  const calls = [];
  await runNewFolder(['Design Notes'], {
    createUntitled: async () => {
      calls.push(['untitled']);
      return { relativePath: 'never' };
    },
    createNamed: async (value) => {
      calls.push(['named', value.name]);
      return { relativePath: 'docs/Design Notes' };
    }
  });
  // Silently creating "untitled folder 2" instead of the typed name would be worse than a conflict.
  assert.deepEqual(calls, [['named', 'Design Notes']]);
});

test('a duplicate typed name reports a conflict naming both the name and the folder', async () => {
  const result = await runNewFolder(['Design Notes'], {
    createUntitled: async () => ({ relativePath: 'never' }),
    createNamed: async () => {
      throw new OnlyPreviewContractError(
        'NAME_EXISTS',
        'An item with this name already exists in this folder.'
      );
    }
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Design Notes/);
  assert.match(result.errors[0].message, /docs/);
  assert.equal(result.errors[0].title, 'Name already in use');
  assert.equal(result.errors[0].confirmLabel, 'OK');
  assert.deepEqual(result.broadcasts, [], 'nothing reaches the tree when nothing was created');
});

test('a cancelled dialog performs no filesystem work at all', async () => {
  let creates = 0;
  const result = await runNewFolder([], {
    createUntitled: async () => {
      creates += 1;
      return { relativePath: 'never' };
    },
    createNamed: async () => {
      creates += 1;
      return { relativePath: 'never' };
    }
  });
  assert.equal(creates, 0);
  assert.deepEqual(result.broadcasts, []);
});

test('the Project root dialog names no destination', async () => {
  alertWindow.resetAlertWindowStub(['untitled folder']);
  xpcStub.resetXpcMainStub();
  await presentOnlyPreviewNewFolderDialog(
    { ...target, parentRelativePath: '', destinationName: '' },
    {
      createUntitled: async () => ({ relativePath: 'untitled folder' }),
      createNamed: async () => ({ relativePath: 'never' })
    }
  );
  assert.equal(alertWindow.state.requests[0].destinationLabel, '');
});

test('the alert renderer carries no wording of its own', () => {
  // Every string it shows arrives inside the dialog payload, already localized by Main. That is what
  // makes the error dialog reusable, and it is also how the repo's no-hardcoded-text rule is met.
  for (const path of [
    'src/renderer/onlypreview/alert/src/App.vue',
    'src/renderer/onlypreview/alert/src/components/AlertNewFolder/AlertNewFolder.vue',
    'src/renderer/onlypreview/alert/src/components/AlertConfirm/AlertConfirm.vue',
    'src/renderer/onlypreview/alert/src/components/AlertError/AlertError.vue'
  ]) {
    const text = source(path);
    const template = text.slice(0, text.indexOf('</template>'));
    assert.doesNotMatch(template, />[^<>{}\n]*[A-Za-z]{3,}[^<>{}]*</u, `${path} renders literal text`);
  }
  const main = source('src/renderer/onlypreview/alert/src/main.ts');
  assert.doesNotMatch(main, /onlyPreviewI18n/);
});

test('the alert renderer is registered everywhere a renderer surface has to be', () => {
  const vite = source('electron.vite.config.ts');
  assert.match(vite, /'onlypreview\/alert': resolve\('src\/renderer\/onlypreview\/alert\/index\.html'\)/);
  assert.match(vite, /'globalSearch', 'alert', 'settings', 'guide'/);
  assert.match(source('src/preload/onlypreview/onlyPreviewEnv.preload.ts'), /value === 'alert'/);
  assert.match(
    source('src/main/onlypreview/views/onlyPreviewRendererTarget.service.ts'),
    /OnlyPreviewRendererMode =[\s\S]*'alert'/
  );
  const html = source('src/renderer/onlypreview/alert/index.html');
  assert.match(html, /<meta charset=/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  // No office, no media, no network: a dialog needs none of it.
  assert.doesNotMatch(html, /wasm-unsafe-eval/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /media-src 'none'/);
});

test('the alert layer has an owner and the view service never attaches its own view', () => {
  assert.match(
    source('src/main/onlypreview/views/onlyPreviewViewLayer.service.ts'),
    /OnlyPreviewViewLayerOwner = 'shell' \| 'preview' \| 'globalSearch' \| 'alert'/
  );
  const view = source('src/main/onlypreview/views/onlyPreviewAlertView.service.ts');
  assert.doesNotMatch(view, /addChildView|removeChildView/);
  assert.match(view, /runtime\.showInAlertLayer\(view\)/);
  assert.match(view, /runtime\.hideAlertLayer\(\)/);
  const windowService = source('src/main/onlypreview/views/onlyPreviewAlertWindow.service.ts');
  assert.match(windowService, /onlyPreviewViewLayerService\.show\('alert', 'alert', view\)/);
  assert.match(windowService, /onlyPreviewViewLayerService\.hide\('alert', 'alert'\)/);
});

test('a modal dialog swallows the find chords instead of opening them underneath itself', () => {
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  assert.match(
    helper,
    /command === 'find-in-file' \|\| command === 'focus-search'[\s\S]*onlyPreviewAlertWindowService\.isOpen\(host\.hostToken\)/
  );
  // The alert view gets no `before-input-event` binding of its own for the same reason.
  assert.match(helper, /if \(mode !== 'alert'\) \{[\s\S]*this\.bindNativeShortcuts\(/);
});
