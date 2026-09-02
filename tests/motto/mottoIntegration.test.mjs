/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import {
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_IDS,
  parseOmniMiniAppId,
  parseOmniPaneTree
} from '../../src/shared/omni/omni.types.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const nodeRequire = createRequire(import.meta.url);

const loadTypeScriptModule = (path, dependencies = {}) => {
  const transpiled = ts.transpileModule(read(path), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: path,
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    []
  );

  const loaded = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier.startsWith('.')) throw new Error(`Missing test dependency ${specifier}`);
    return nodeRequire(specifier);
  };
  const execute = new Function(
    'require',
    'module',
    'exports',
    'console',
    `${transpiled.outputText}\n//# sourceURL=${path}`
  );
  execute(localRequire, loaded, loaded.exports, { error: () => undefined });
  return loaded.exports;
};

const loadMottoState = () => {
  const storageModule = loadTypeScriptModule(
    'src/renderer/motto/src/store/mottoStorage.service.ts'
  );
  return loadTypeScriptModule('src/renderer/motto/src/store/motto.store.ts', {
    vue: { reactive: (value) => value },
    './mottoStorage.service': storageModule
  }).MottoState;
};

test('Motto remains the fourth allowlisted Omni mini app before Trench', () => {
  assert.deepEqual(OMNI_MINI_APP_IDS, [
    'todo',
    'eyesOnAgents',
    'translator',
    'motto',
    'trench',
    'submodules'
  ]);
  assert.equal(parseOmniMiniAppId('motto'), 'motto');
  assert.equal(OMNI_MINI_APP_DISPLAY_URLS.motto, 'bl://miniapp/motto');
  assert.throws(() => parseOmniMiniAppId('unknown'));
  assert.throws(() => parseOmniMiniAppId('onlypreview'), /Unsupported Omni mini app: onlypreview/);

  const parsed = parseOmniPaneTree({
    id: 'motto-pane',
    type: 'leaf',
    url: 'https://www.bing.com',
    contentMode: 'miniapp',
    miniAppId: 'motto'
  });
  assert.equal(parsed.miniAppId, 'motto');

  assert.throws(
    () =>
      parseOmniPaneTree({
        id: 'persisted-onlypreview-pane',
        type: 'leaf',
        url: 'https://www.bing.com',
        contentMode: 'miniapp',
        miniAppId: 'onlypreview'
      }),
    /Unsupported Omni mini app: onlypreview/
  );
});

test('Motto has dedicated preload, renderer, dev, packaged, and Control mappings', () => {
  const vite = read('electron.vite.config.ts');
  const main = read('src/main/windows/omniWindow.helper.ts');
  const runtime = read('src/main/windows/omniMiniAppRuntime.service.ts');
  const control = read('src/renderer/omni/omniControl/src/components/OmniPane.vue');

  assert.match(vite, /motto:\s*resolve\('src\/preload\/motto\/motto\.preload\.ts'\)/);
  assert.match(vite, /motto:\s*resolve\('src\/renderer\/motto\/index\.html'\)/);
  assert.match(vite, /mottoDevCspPlugin/);
  assert.match(
    runtime,
    /motto:\s*\{\s*preloadFile:\s*'motto\.js',\s*rendererName:\s*'motto',\s*sandbox:\s*false\s*\}/
  );
  assert.match(main, /`\$\{rendererBaseUrl\}\/\$\{rendererName\}\/index\.html`/);
  assert.match(main, /join\(app\.getAppPath\(\), 'out', 'renderer', rendererName, 'index\.html'\)/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(control, /id:\s*'motto'/);
  assert.match(control, /i18nHelper\.miniApp\.motto\.name/);
  assert.match(control, /motto\.svg/);
});

test('Motto inline mutations keep drafts outside the persisted collection and commit after writes', () => {
  const store = read('src/renderer/motto/src/store/motto.store.ts');
  const persistIndex = store.indexOf('persistMottoItems(this.storage, nextItems)');
  const commitIndex = store.indexOf('this.items = persistedItems', persistIndex);
  const beginAdd = store.slice(store.indexOf('  beginAdd'), store.indexOf('  beginEdit'));
  const addCommit = store.slice(
    store.indexOf('    if (this.pendingDraft?.id === editingId)'),
    store.indexOf('    const item = this.items.find', store.indexOf('commitInlineEdit'))
  );
  const reorder = store.slice(store.indexOf('  reorderItems'), store.indexOf('  private discard'));

  assert.ok(persistIndex >= 0, 'the store must persist every next collection');
  assert.ok(commitIndex > persistIndex, 'reactive state must commit only after persistence');
  assert.match(store, /pendingDraft: MottoItem \| null = null/);
  assert.match(beginAdd, /this\.pendingDraft = pendingDraft/);
  assert.match(beginAdd, /this\.editingField = 'title'/);
  assert.doesNotMatch(beginAdd, /persistNextItems/);
  assert.match(
    addCommit,
    /const nextItems = \[\.\.\.this\.items, \{ \.\.\.this\.pendingDraft, title: value \}\]/
  );
  assert.match(addCommit, /if \(!this\.persistNextItems\(nextItems\)\) return false/);
  assert.match(addCommit, /this\.pendingDraft = null/);
  assert.match(store, /commitInlineEdit\(\): boolean[\s\S]*?this\.persistNextItems\(nextItems\)/);
  assert.match(store, /deleteItem\(id: string\)[\s\S]*?this\.persistNextItems\(/);
  assert.match(reorder, /if \(this\.inlineEditorActive/);
  assert.match(reorder, /currentItem\.title !== item\.title/);
  assert.match(reorder, /currentItem\.subtitle !== item\.subtitle/);
  assert.match(reorder, /return this\.persistNextItems\(\[\.\.\.nextItems\]\)/);
  assert.match(store, /catch \(error\) \{[\s\S]*?this\.storageError = 'write-failed'/);
  assert.match(
    store,
    /if \(editingField === 'title' && !value\) \{\s*this\.clearInlineEditor\(\);\s*return false;/
  );
  assert.match(
    store,
    /candidate\.id === editingId \? \{ \.\.\.candidate, \[editingField\]: value \} : candidate/
  );
  assert.match(store, /cancelInlineEdit\(\): void[\s\S]*?this\.pendingDraft = null/);
});

test('Motto add, inline edit, and reorder preserve the last persisted collection on failure', () => {
  const MottoState = loadMottoState();
  let state;
  let serialized = JSON.stringify([
    { id: 'first', title: 'First', subtitle: 'One' },
    { id: 'second', title: 'Second', subtitle: 'Two' }
  ]);
  let failWrite = false;
  const writes = [];
  const storage = {
    getItem: () => serialized,
    setItem: (_key, value) => {
      const nextItems = JSON.parse(value);
      writes.push({
        currentIds: state.items.map((item) => item.id),
        nextIds: nextItems.map((item) => item.id)
      });
      if (failWrite) throw new Error('quota');
      serialized = value;
    }
  };
  state = new MottoState();
  state.initialize(storage);

  assert.equal(state.beginAdd(), true);
  const pendingId = state.pendingDraft.id;
  assert.deepEqual(
    state.items.map((item) => item.id),
    ['first', 'second']
  );
  assert.equal(writes.length, 0);
  state.draftValue = '  Third  ';
  assert.equal(state.commitInlineEdit(), true);
  assert.deepEqual(writes.at(-1), {
    currentIds: ['first', 'second'],
    nextIds: ['first', 'second', pendingId]
  });
  assert.deepEqual(state.items.at(-1), { id: pendingId, title: 'Third', subtitle: '' });

  assert.equal(state.beginEdit('first', 'title'), true);
  state.draftValue = '   ';
  assert.equal(state.commitInlineEdit(), false);
  assert.equal(state.items[0].title, 'First');

  assert.equal(state.beginEdit('first', 'subtitle'), true);
  state.draftValue = '   ';
  assert.equal(state.commitInlineEdit(), true);
  assert.equal(state.items[0].subtitle, '');

  assert.equal(state.beginEdit('second', 'title'), true);
  state.draftValue = 'Changed but cancelled';
  state.cancelInlineEdit();
  assert.equal(state.items[1].title, 'Second');

  const reordered = [state.items[2], state.items[0], state.items[1]];
  assert.equal(state.reorderItems(reordered), true);
  assert.deepEqual(writes.at(-1), {
    currentIds: ['first', 'second', pendingId],
    nextIds: [pendingId, 'first', 'second']
  });

  const orderBeforeFailure = state.items.map((item) => item.id);
  failWrite = true;
  assert.equal(state.reorderItems([...state.items].reverse()), false);
  assert.deepEqual(
    state.items.map((item) => item.id),
    orderBeforeFailure
  );
  assert.equal(state.storageError, 'write-failed');

  assert.equal(state.beginEdit('first', 'title'), true);
  state.draftValue = 'Retry me';
  assert.equal(state.commitInlineEdit(), false);
  assert.equal(state.items.find((item) => item.id === 'first').title, 'First');
  assert.equal(state.isEditing('first', 'title'), true);
  assert.equal(state.draftValue, 'Retry me');
  failWrite = false;
  assert.equal(state.commitInlineEdit(), true);
  assert.equal(state.items.find((item) => item.id === 'first').title, 'Retry me');
});

test('a failed new Motto write keeps its UI-only Title draft available for retry', () => {
  const MottoState = loadMottoState();
  let failWrite = true;
  let writes = 0;
  const storage = {
    getItem: () => null,
    setItem: () => {
      writes += 1;
      if (failWrite) throw new Error('quota');
    }
  };
  const state = new MottoState();
  state.initialize(storage);

  state.beginAdd();
  state.draftValue = '   ';
  assert.equal(state.commitInlineEdit(), false);
  assert.equal(state.pendingDraft, null);
  assert.equal(writes, 0);

  state.beginAdd();
  state.cancelInlineEdit();
  assert.equal(state.pendingDraft, null);
  assert.equal(writes, 0);

  state.beginAdd();
  const pendingId = state.pendingDraft.id;
  state.draftValue = 'Retry this title';

  assert.equal(state.commitInlineEdit(), false);
  assert.deepEqual(state.items, []);
  assert.equal(state.pendingDraft.id, pendingId);
  assert.equal(state.isEditing(pendingId, 'title'), true);
  assert.equal(state.draftValue, 'Retry this title');
  assert.equal(state.beginAdd(), true);
  assert.equal(state.pendingDraft.id, pendingId);

  failWrite = false;
  assert.equal(state.commitInlineEdit(), true);
  assert.equal(writes, 2);
  assert.deepEqual(state.items, [{ id: pendingId, title: 'Retry this title', subtitle: '' }]);
});

test('Motto UI owns direct editing, compact cards, and handle-only persistent reordering', () => {
  const app = read('src/renderer/motto/src/App.vue');
  const style = read('src/renderer/motto/src/App.less');
  const main = read('src/renderer/motto/src/main.ts');
  const header = app.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
  const emptyState = app.match(/<section v-else name="motto__empty"[\s\S]*?<\/section>/)?.[0] ?? '';

  assert.match(app, /class="motto-menu-bar"/);
  assert.match(header, /<IconNotes :size="16" aria-hidden="true" \/>/);
  assert.match(
    header,
    /<a-button[\s\S]*?name="motto__add"[\s\S]*?:title="i18nHelper\.motto\.add"[\s\S]*?:aria-label="i18nHelper\.motto\.add"/
  );
  assert.match(header, /<IconPlus :size="16" aria-hidden="true" \/>/);
  assert.doesNotMatch(header, /\{\{\s*i18nHelper\.motto\.add\s*\}\}/);
  assert.match(
    emptyState,
    /<a-button[\s\S]*?@click="beginAdd"[\s\S]*?\{\{\s*i18nHelper\.motto\.add\s*\}\}[\s\S]*?<\/a-button>/
  );
  assert.match(app, /import draggable from 'vuedraggable'/);
  assert.match(app, /<draggable[\s\S]*?class="motto__list"/);
  assert.match(app, /:model-value="mottoStore\.items"/);
  assert.match(app, /item-key="id"/);
  assert.match(app, /handle="\.motto__drag-handle"/);
  assert.match(app, /:disabled="mottoStore\.inlineEditorActive"/);
  assert.match(app, /@update:model-value="reorderItems"/);
  assert.match(app, /class="motto__card"/);
  assert.match(app, /<a-dropdown trigger="click"/);
  assert.match(app, /<IconBtn[\s\S]*?IconDots/);
  assert.match(app, /<IconGripVertical :size="17"/);
  assert.match(app, /@click\.stop="beginEdit\(item\.id, 'title'\)"/);
  assert.match(app, /@click\.stop="beginEdit\(item\.id, 'subtitle'\)"/);
  assert.match(app, /v-model="mottoStore\.draftValue"/);
  assert.match(app, /@press-enter="commitInlineEdit"/);
  assert.match(app, /@blur="commitInlineEdit"/);
  assert.match(app, /@keydown\.esc\.prevent\.stop="cancelInlineEdit"/);
  assert.match(app, /const focusInlineInput[\s\S]*?nextTick/);
  assert.match(app, /mottoStore\.deleteItem\(item\.id\)/);
  assert.doesNotMatch(app, /IconPencil|openEditEditor|i18nHelper\.motto\.edit/);
  assert.doesNotMatch(app, /<a-modal|<a-form/);
  assert.match(app, /item\.subtitle \|\| i18nHelper\.motto\.form\.subtitle/);
  assert.match(app, /mottoStore\.pendingDraft/);
  assert.match(app, /const beginAdd[\s\S]*?mottoStore\.beginAdd\(\)[\s\S]*?focusInlineInput/);
  assert.match(app, /i18nHelper\.motto/);
  assert.doesNotMatch(app, /(?:class|:class)="[^"]*(?:\bflex\b|\bp-\d|\bgap-\d)/);

  assert.match(style, /\.motto-menu-bar[\s\S]*?flex:\s*0 0 auto/);
  assert.match(
    style,
    /\.motto-menu-bar__actions \.arco-btn\s*\{[\s\S]*?width:\s*27px[\s\S]*?height:\s*27px[\s\S]*?display:\s*inline-flex[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*center/
  );
  assert.match(style, /\.motto__list[\s\S]*?flex-direction:\s*column/);
  assert.match(style, /\.motto__list[\s\S]*?overflow-y:\s*auto/);
  assert.match(style, /--motto-reminder-strong:\s*#b42318;/);
  assert.match(style, /--motto-reminder-muted:\s*#a65f59;/);
  assert.match(style, /\.motto__card\s*\{[^}]*padding:\s*8px;/);
  assert.doesNotMatch(style, /\.motto__card::before|border-left/);
  assert.match(style, /\.motto__card-title\s*\{[^}]*color:\s*var\(--motto-reminder-strong\);/);
  assert.match(style, /\.motto__card-subtitle\s*\{[^}]*color:\s*var\(--motto-reminder-muted\);/);
  assert.match(
    style,
    /\.motto__card-title,[\s\S]*?\.motto__card-subtitle\s*\{[^}]*-webkit-line-clamp:\s*2;/
  );
  assert.match(
    style,
    /\.motto__card-title,[\s\S]*?\.motto__card-subtitle\s*\{[^}]*text-overflow:\s*ellipsis;/
  );
  assert.match(style, /\.motto__drag-handle\s*\{[^}]*cursor:\s*grab;/);
  assert.match(style, /\.motto\s*\{[^}]*background:\s*var\(--motto-royal-soft\);/);
  assert.match(
    style,
    /\.motto-menu-bar\s*\{[^}]*height:\s*32px;[^}]*border-bottom:\s*1px solid var\(--motto-chrome-line\);[^}]*background:\s*var\(--motto-royal\);/
  );
  assert.match(style, /--motto-chrome-line:\s*#3d4666;/);
  assert.match(style, /--motto-chrome-ink:\s*#f6f7fc;/);
  assert.match(style, /\.motto__card-menu\s*\{[^}]*color:\s*#808ab1;/);
  assert.match(main, /await initializeRendererLanguage\(\)/);
  assert.ok(
    main.indexOf('await initializeRendererLanguage()') < main.indexOf("import('./App.vue')"),
    'shared language must initialize before Motto UI evaluation'
  );
});
