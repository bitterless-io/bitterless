/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_IDS,
  parseOmniMiniAppId,
  parseOmniPaneTree
} from '../../src/shared/omni/omni.types.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Motto remains the fourth allowlisted Omni mini app', () => {
  assert.deepEqual(OMNI_MINI_APP_IDS, [
    'todo',
    'eyesOnAgents',
    'translator',
    'motto',
    'onlypreview'
  ]);
  assert.equal(parseOmniMiniAppId('motto'), 'motto');
  assert.equal(OMNI_MINI_APP_DISPLAY_URLS.motto, 'bl://miniapp/motto');
  assert.throws(() => parseOmniMiniAppId('unknown'));

  const parsed = parseOmniPaneTree({
    id: 'motto-pane',
    type: 'leaf',
    url: 'https://www.bing.com',
    contentMode: 'miniapp',
    miniAppId: 'motto'
  });
  assert.equal(parsed.miniAppId, 'motto');
});

test('Motto has dedicated preload, renderer, dev, packaged, and Control mappings', () => {
  const vite = read('electron.vite.config.ts');
  const main = read('src/main/windows/omniWindow.helper.ts');
  const control = read('src/renderer/omni/omniControl/src/components/OmniPane.vue');

  assert.match(vite, /motto:\s*resolve\('src\/preload\/motto\/motto\.preload\.ts'\)/);
  assert.match(vite, /motto:\s*resolve\('src\/renderer\/motto\/index\.html'\)/);
  assert.match(vite, /mottoDevCspPlugin/);
  assert.match(main, /motto:\s*\{\s*preloadFile:\s*'motto\.js',\s*rendererName:\s*'motto'\s*\}/);
  assert.match(main, /`\$\{rendererBaseUrl\}\/\$\{rendererName\}\/index\.html`/);
  assert.match(main, /join\(app\.getAppPath\(\), 'out', 'renderer', rendererName, 'index\.html'\)/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(control, /id:\s*'motto'/);
  assert.match(control, /i18nHelper\.miniApp\.motto\.name/);
  assert.match(control, /motto\.svg/);
});

test('Motto mutations persist the complete next array before reactive state commits', () => {
  const store = read('src/renderer/motto/src/store/motto.store.ts');
  const persistIndex = store.indexOf('persistMottoItems(this.storage, nextItems)');
  const commitIndex = store.indexOf('this.items = persistedItems', persistIndex);

  assert.ok(persistIndex >= 0, 'the store must persist every next collection');
  assert.ok(commitIndex > persistIndex, 'reactive state must commit only after persistence');
  assert.match(store, /submitEditor\(\)[\s\S]*?this\.persistNextItems\(nextItems\)/);
  assert.match(store, /deleteItem\(id: string\)[\s\S]*?this\.persistNextItems\(/);
  assert.match(store, /catch \(error\) \{[\s\S]*?this\.storageError = 'write-failed'/);
  assert.match(
    store,
    /get canSubmitEditor\(\): boolean \{\s*return Boolean\(this\.draftTitle\.trim\(\)\);\s*\}/
  );
  assert.match(
    store,
    /const subtitle = this\.draftSubtitle\.trim\(\);\s*if \(!title \|\| !this\.editorMode\)/
  );
  assert.doesNotMatch(store, /if \(!title \|\| !subtitle/);
  assert.match(store, /\{ id: this\.createUniqueId\(\), title, subtitle \}/);
  assert.match(store, /item\.id === editingId \? \{ \.\.\.item, title, subtitle \} : item/);
});

test('Motto UI owns the required compact card and optional-subtitle editor interactions', () => {
  const app = read('src/renderer/motto/src/App.vue');
  const style = read('src/renderer/motto/src/App.less');
  const main = read('src/renderer/motto/src/main.ts');
  const header = app.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
  const emptyState = app.match(/<section v-else name="motto__empty"[\s\S]*?<\/section>/)?.[0] ?? '';

  assert.match(app, /class="motto__header"/);
  assert.match(
    header,
    /<IconBtn[\s\S]*?name="motto__add"[\s\S]*?:title="i18nHelper\.motto\.add"[\s\S]*?:aria-label="i18nHelper\.motto\.add"/
  );
  assert.match(header, /<IconPlus :size="18" aria-hidden="true" \/>/);
  assert.doesNotMatch(header, /\{\{\s*i18nHelper\.motto\.add\s*\}\}/);
  assert.match(
    emptyState,
    /<a-button[\s\S]*?\{\{\s*i18nHelper\.motto\.add\s*\}\}[\s\S]*?<\/a-button>/
  );
  assert.match(app, /class="motto__list"/);
  assert.match(app, /class="motto__card"/);
  assert.match(app, /<a-dropdown trigger="click"/);
  assert.match(app, /<IconBtn[\s\S]*?IconDots/);
  assert.match(app, /mottoStore\.openEditEditor\(item\)/);
  assert.match(app, /mottoStore\.deleteItem\(item\.id\)/);
  assert.match(app, /<a-modal/);
  assert.match(app, /<a-form/);
  assert.match(app, /field="draftTitle"[\s\S]*?required/);
  assert.doesNotMatch(app, /<a-form-item field="draftSubtitle"[^>]*\brequired\b/);
  assert.match(app, /<p v-if="item\.subtitle" class="motto__card-subtitle">/);
  assert.match(app, /:disabled="!mottoStore\.canSubmitEditor"/);
  assert.match(app, /@cancel="mottoStore\.cancelEditor\(\)"/);
  assert.match(app, /@open="focusTitleInput"/);
  assert.match(app, /i18nHelper\.motto/);
  assert.doesNotMatch(app, /(?:class|:class)="[^"]*(?:\bflex\b|\bp-\d|\bgap-\d)/);

  assert.match(style, /\.motto__header[\s\S]*?flex:\s*0 0 auto/);
  assert.match(
    style,
    /\.motto__add\s*\{[\s\S]*?width:\s*32px[\s\S]*?height:\s*32px[\s\S]*?display:\s*inline-flex[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*center/
  );
  assert.match(style, /\.motto__list[\s\S]*?flex-direction:\s*column/);
  assert.match(style, /\.motto__list[\s\S]*?overflow-y:\s*auto/);
  assert.match(style, /--motto-reminder-strong:\s*#b42318;/);
  assert.match(style, /--motto-reminder-muted:\s*#a65f59;/);
  assert.match(
    style,
    /\.motto__card::before\s*\{[^}]*background:\s*var\(--motto-reminder-strong\);/
  );
  assert.match(style, /\.motto__card-title\s*\{[^}]*color:\s*var\(--motto-reminder-strong\);/);
  assert.match(style, /\.motto__card-subtitle\s*\{[^}]*color:\s*var\(--motto-reminder-muted\);/);
  assert.equal(style.match(/var\(--motto-reminder-strong\)/g)?.length, 2);
  assert.equal(style.match(/var\(--motto-reminder-muted\)/g)?.length, 1);
  assert.match(style, /\.motto\s*\{[^}]*background:\s*var\(--motto-royal-soft\);/);
  assert.match(
    style,
    /\.motto__header\s*\{[^}]*border-bottom:\s*1px solid var\(--motto-line\);[^}]*background:\s*#fff;/
  );
  assert.match(style, /\.motto__card-menu\s*\{[^}]*color:\s*#808ab1;/);
  assert.match(main, /await initializeRendererLanguage\(\)/);
  assert.ok(
    main.indexOf('await initializeRendererLanguage()') < main.indexOf("import('./App.vue')"),
    'shared language must initialize before Motto UI evaluation'
  );
});
