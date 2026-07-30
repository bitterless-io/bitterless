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

test('Motto is the fourth allowlisted Omni mini app', () => {
  assert.deepEqual(OMNI_MINI_APP_IDS, ['todo', 'eyesOnAgents', 'translator', 'motto']);
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
});

test('Motto UI owns the required compact card and editor interactions', () => {
  const app = read('src/renderer/motto/src/App.vue');
  const style = read('src/renderer/motto/src/App.less');
  const main = read('src/renderer/motto/src/main.ts');

  assert.match(app, /class="motto__header"/);
  assert.match(app, /class="motto__list"/);
  assert.match(app, /class="motto__card"/);
  assert.match(app, /<a-dropdown trigger="click"/);
  assert.match(app, /<IconBtn[\s\S]*?IconDots/);
  assert.match(app, /mottoStore\.openEditEditor\(item\)/);
  assert.match(app, /mottoStore\.deleteItem\(item\.id\)/);
  assert.match(app, /<a-modal/);
  assert.match(app, /<a-form/);
  assert.match(app, /field="draftTitle"[\s\S]*?required/);
  assert.match(app, /field="draftSubtitle"[\s\S]*?required/);
  assert.match(app, /:disabled="!mottoStore\.canSubmitEditor"/);
  assert.match(app, /@cancel="mottoStore\.cancelEditor\(\)"/);
  assert.match(app, /@open="focusTitleInput"/);
  assert.match(app, /i18nHelper\.motto/);
  assert.doesNotMatch(app, /(?:class|:class)="[^"]*(?:\bflex\b|\bp-\d|\bgap-\d)/);

  assert.match(style, /\.motto__header[\s\S]*?flex:\s*0 0 auto/);
  assert.match(style, /\.motto__list[\s\S]*?flex-direction:\s*column/);
  assert.match(style, /\.motto__list[\s\S]*?overflow-y:\s*auto/);
  assert.match(style, /\.motto__card::before/);
  assert.match(main, /await initializeRendererLanguage\(\)/);
  assert.ok(
    main.indexOf('await initializeRendererLanguage()') < main.indexOf("import('./App.vue')"),
    'shared language must initialize before Motto UI evaluation'
  );
});
