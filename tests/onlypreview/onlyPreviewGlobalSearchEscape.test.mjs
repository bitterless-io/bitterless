/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const mainPath = 'src/main/windows/onlyPreviewWindow.helper.ts';
const windowPath = 'src/main/miniapps/onlypreview/views/onlyPreviewGlobalSearchWindow.service.ts';
const workspacePath =
  'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue';
const compile = (source, bindings, names) => {
  const ast = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements
    .filter(
      (statement) =>
        (ts.isClassDeclaration(statement) && names.includes(statement.name?.text)) ||
        (ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some((declaration) =>
            names.includes(declaration.name.getText(ast))
          ))
    )
    .map((statement) => statement.getText(ast).replace(/^export /u, ''))
    .join('\n');
  const result = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  });
  return runInNewContext(`${result.outputText}\n({${names.join(',')}});`, bindings);
};

const input = (overrides = {}) => ({
  type: 'keyDown',
  key: 'Escape',
  isAutoRepeat: false,
  shift: false,
  alt: false,
  control: false,
  meta: false,
  ...overrides
});
const contents = () => {
  const value = new EventEmitter();
  value.destroyed = false;
  value.focusCount = 0;
  value.isDestroyed = () => value.destroyed;
  value.focus = () => {
    value.focusCount += 1;
  };
  value.close = () => {
    value.destroyed = true;
  };
  return value;
};

// Run actual native dispatch -> window seam -> search layer -> opener restoration. Only Electron
// objects are fakes: no DOM key event is emitted, just as with body/iframe-owned keyboard focus.
const harness = async (origin = 'chrome') => {
  const host = { hostToken: 'active-token', hostId: 'active-host', kind: 'standalone' };
  const broadcasts = [];
  const focus = compile(read('src/main/miniapps/onlypreview/onlyPreviewGlobalSearchFocus.service.ts'), {}, [
    'OnlyPreviewGlobalSearchFocusService'
  ]);
  const focusService = new focus.OnlyPreviewGlobalSearchFocusService();
  const bindings = {
    console: { info: () => undefined },
    ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT: 'visibility',
    ONLY_PREVIEW_GLOBAL_SEARCH_LAYOUT_EVENT: 'layout',
    ONLY_PREVIEW_FOCUS_SEARCH_EVENT: 'focus-search',
    ONLY_PREVIEW_FOCUS_PROJECT_EVENT: 'focus-project'
  };
  const view = compile(
    read('src/main/miniapps/onlypreview/views/onlyPreviewGlobalSearchView.service.ts'),
    bindings,
    ['OnlyPreviewGlobalSearchViewService', 'closeContentView', 'sameBounds', 'cloneLayout']
  );
  const viewService = new view.OnlyPreviewGlobalSearchViewService();
  const layer = { visible: false, hides: 0 };
  const preview = { findOpen: false, closeFindCount: 0, focusCount: 0 };
  const alert = { open: false };
  const services = {
    onlyPreviewGlobalSearchViewService: viewService,
    onlyPreviewGlobalSearchFocusService: focusService,
    onlyPreviewPreviewRegionService: {
      isFindOpen: () => preview.findOpen,
      closeFind: () => {
        preview.findOpen = false;
        preview.closeFindCount += 1;
      },
      focusActiveContent: () => {
        preview.focusCount += 1;
        return true;
      }
    },
    onlyPreviewAlertWindowService: { isOpen: () => alert.open },
    onlyPreviewViewLayerService: {
      show: () => {
        layer.visible = true;
      },
      hide: () => {
        layer.visible = false;
        layer.hides += 1;
      }
    },
    xpcMain: { broadcast: (name, params) => broadcasts.push({ name, params }) }
  };
  const { OnlyPreviewGlobalSearchWindowService } = compile(read(windowPath), services, [
    'OnlyPreviewGlobalSearchWindowService'
  ]);
  const windowService = new OnlyPreviewGlobalSearchWindowService();
  const shell = contents();
  const search = contents();
  const searchView = { webContents: search, setBounds: () => undefined };
  const { OnlyPreviewWindowHelper } = compile(
    read(mainPath),
    {
      ...bindings,
      ...services,
      process: { platform: 'darwin' },
      onlyPreviewGlobalSearchWindowService: windowService
    },
    [
      'OnlyPreviewWindowHelper',
      'isCommandModifier',
      'isGlobalSearchShortcut',
      'isCurrentFileFindShortcut',
      'isProjectItemCopyShortcut'
    ]
  );
  // Avoid constructing a real window/runtime; exercise the real methods installed on all views.
  const helper = Object.create(OnlyPreviewWindowHelper.prototype);
  helper.standaloneHost = host;
  helper.shortcutContents = new WeakSet();
  const commands = [];
  helper.commandHandler = (command) => commands.push(command);
  windowService.start({
    host,
    shellView: { webContents: shell },
    isHostLive: () => true,
    isCurrent: () => true,
    createView: () => searchView,
    loadView: async () => {}
  });
  windowService.updateBounds(
    host.hostToken,
    { x: 0, y: 0, width: 1000, height: 800 },
    { x: 200, y: 40, width: 800, height: 760 }
  );
  const opener = origin === 'shell' ? shell : contents();
  windowService.open(host, origin, opener);
  await Promise.resolve();
  const send = (source = search, changes = {}) => {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      }
    };
    source.emit('before-input-event', event, input(changes));
    return event.prevented;
  };
  helper.bindNativeShortcuts(search, host, 'search');
  return {
    host,
    helper,
    windowService,
    viewService,
    opener,
    shell,
    search,
    send,
    layer,
    preview,
    alert,
    broadcasts,
    commands
  };
};

test('native Escape closes once from the search renderer and restores each original surface', async () => {
  for (const origin of ['shell', 'vue', 'chrome']) {
    const h = await harness(origin);
    assert.equal(h.layer.visible, true);
    assert.equal(h.send(), true);
    assert.equal(h.windowService.isActive(h.host.hostToken), false);
    assert.equal(h.layer.visible, false);
    assert.equal(h.layer.hides, 1);
    assert.equal(h.opener.focusCount, 1);
    assert.equal(h.search.destroyed, false, 'closing retains the preloaded search renderer');
    assert.equal(h.broadcasts.at(-1).params.hostId, h.host.hostId);
    assert.equal(
      h.broadcasts.some(({ name, params }) => name === 'visibility' && !params.active),
      true
    );
    assert.deepEqual(h.commands, [], 'no tab close, project mutation or refresh command');
    assert.equal(h.send(), false, 'a second delivery cannot dismiss anything else');
    assert.equal(h.layer.hides, 1);
  }
});

test('native Escape works from every composite surface, independent of DOM focus ancestry', async () => {
  for (const origin of ['shell', 'vue', 'chrome', 'search']) {
    const h = await harness();
    const source = contents();
    h.helper.bindNativeShortcuts(source, h.host, origin);
    assert.equal(h.send(source), true);
    assert.equal(h.layer.visible, false);
    assert.equal(h.opener.focusCount, 1);
  }
});

test('only the current host consumes bare first keydown; modal alert keeps priority', async () => {
  const h = await harness();
  for (const change of [
    { type: 'keyUp' },
    { isAutoRepeat: true },
    { shift: true },
    { alt: true },
    { control: true },
    { meta: true },
    { key: 'x' }
  ])
    assert.equal(h.send(h.search, change), false);
  h.alert.open = true;
  assert.equal(h.send(), false);
  assert.equal(h.layer.visible, true);
  h.alert.open = false;
  h.helper.standaloneHost = { hostToken: 'replacement-token' };
  assert.equal(h.send(), false, 'old view cannot dismiss the replacement host');
  h.helper.standaloneHost = h.host;
  assert.equal(h.send(), true);
});

test('Global Search wins over Find, while Find-only Escape behavior remains intact', async () => {
  const h = await harness();
  h.preview.findOpen = true;
  assert.equal(h.send(), true);
  assert.equal(h.preview.closeFindCount, 0);
  assert.equal(h.preview.focusCount, 0);
  assert.equal(h.send(), true);
  assert.equal(h.preview.closeFindCount, 1);
  assert.equal(h.preview.focusCount, 1);
});

test('a dead opener falls back to Project focus without changing Project or closing the tab', async () => {
  const h = await harness();
  h.opener.destroyed = true;
  assert.equal(h.send(), true);
  assert.equal(h.shell.focusCount, 1);
  assert.equal(h.opener.focusCount, 0);
  assert.deepEqual(h.commands, []);
});

test('renderer fallback dismisses both query states and ignores modified/repeated Escape', async () => {
  const storeSource = read('src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts');
  const { OnlyPreviewGlobalSearchStore } = compile(storeSource, {}, [
    'OnlyPreviewGlobalSearchStore'
  ]);
  for (const query of ['', 'non-empty query']) {
    const store = Object.create(OnlyPreviewGlobalSearchStore.prototype);
    store.query = query;
    let dismisses = 0;
    store.dismiss = async () => {
      dismisses += 1;
    };
    await store.handleEscape();
    assert.equal(dismisses, 1);
  }
  const descriptor = parse(read(workspacePath), { filename: workspacePath }).descriptor;
  let escapes = 0;
  const { handleWorkspaceKeydown } = compile(
    descriptor.scriptSetup.content,
    {
      onlyPreviewGlobalSearchStore: {
        handleEscape: () => {
          escapes += 1;
        }
      }
    },
    ['handleWorkspaceKeydown']
  );
  const key = { key: 'Escape', target: { closest: () => null }, preventDefault: () => undefined };
  handleWorkspaceKeydown(key);
  assert.equal(escapes, 1);
  for (const change of [
    { repeat: true },
    { shiftKey: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true }
  ])
    handleWorkspaceKeydown({ ...key, ...change });
  assert.equal(escapes, 1);
  compileScript(descriptor, { id: 'escape-workspace' });
  const result = compileTemplate({
    source: descriptor.template.content,
    filename: workspacePath,
    id: 'escape-workspace'
  });
  assert.deepEqual(result.errors, []);
});
