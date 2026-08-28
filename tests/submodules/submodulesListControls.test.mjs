/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SUBMODULES_VIEW_SETTING_SUB_KEY,
  createDefaultSubmodulesViewSettings
} from '../../src/shared/submodules/submodules.type.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the controls row carries a case-insensitive search and the sort selector', () => {
  const controls = read(
    'src/renderer/submodules/src/components/SubmodulesListControls/SubmodulesListControls.vue'
  );

  assert.match(controls, /name="submodules__listControls"/);
  assert.match(controls, /name="submodules__listControls__search"/);
  // The placeholder states the platform shortcut; the accessible name stays the plain label.
  assert.match(controls, /:placeholder="searchPlaceholder"/);
  assert.match(controls, /uaHelper\.isMac[\s\S]*searchShortcutMac[\s\S]*searchShortcutWin/);
  assert.match(controls, /:aria-label="i18nHelper\.submodules\.actions\.search"/);
  assert.match(controls, /@keydown\.esc[^\n]*"clearSearch"/);
  // Esc clears and keeps the caret in the box, and Cmd+F reaches the same focus path.
  assert.match(controls, /const clearSearch[\s\S]*clearSearch\(\)[\s\S]*focusSearch\(\)/);
  assert.match(controls, /defineExpose\(\{ focusSearch \}\)/);
  assert.match(controls, /name="submodules__listControls__sortMode"/);
  for (const mode of ['name', 'updated']) {
    assert.match(controls, new RegExp(`<a-option value="${mode}">`));
  }
  // Sorting is Main-owned state, so the selector reads the snapshot instead of local component state.
  assert.match(controls, /:model-value="submodulesStore\.settings\.sortMode"/);
  assert.doesNotMatch(controls, /\$t\(|useI18n\(/);

  // The word `Sort` is gone from the row: a glyph plus the option labels carry the meaning, and the
  // label key survives only as the accessible name.
  assert.doesNotMatch(controls, /submodules-controls__sort-label|sort\.label \}\}/);
  assert.match(controls, /:aria-label="i18nHelper\.submodules\.sort\.label"/);
  // Owner decision 2026-08-20: option text only — no label, no glyph — at an unchanged 132px.
  assert.doesNotMatch(controls, /IconArrowsSort/);
  const style = read(
    'src/renderer/submodules/src/components/SubmodulesListControls/SubmodulesListControls.less'
  );
  assert.match(style, /\.submodules-controls__sort \{[^}]*width: 132px;/);
  // The dropdown is sized to its option text instead of being clipped to the trigger width.
  assert.match(
    controls,
    /:trigger-props="\{ autoFitPopupWidth: false, autoFitPopupMinWidth: true \}"/
  );
});

test('Cmd+F, Alt+F and Ctrl+F all focus the search box, and the listener is removed with the view', () => {
  const app = read('src/renderer/submodules/src/App.vue');

  // All three modifiers fire: macOS uses Cmd, Windows uses Alt (Chat's combo) and Ctrl.
  assert.match(app, /event\.metaKey \|\| event\.ctrlKey \|\| event\.altKey/);
  // `event.code` must lead: macOS Option+F reports `key === 'ƒ'`, so a key-only check would miss it.
  assert.match(app, /event\.code === 'KeyF' \|\| event\.key\.toLocaleLowerCase\(\) === 'f'/);
  assert.doesNotMatch(app, /!event\.altKey/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /listControlsRef\.value\?\.focusSearch\(\)/);
  assert.match(app, /window\.addEventListener\('keydown', handleWindowKeydown\)/);
  assert.match(app, /window\.removeEventListener\('keydown', handleWindowKeydown\)/);
});

test('the search filter is tokenized, NFKC-normalized and case-folded like the EyesOnAgents one', () => {
  const service = read('src/renderer/submodules/src/services/submoduleTree.service.ts');

  const tokenizer = service.slice(
    service.indexOf('export const searchTokens'),
    service.indexOf('const rowLabel')
  );
  assert.match(tokenizer, /normalize\('NFKC'\)/);
  assert.match(tokenizer, /toLocaleLowerCase\(\)/);
  assert.match(tokenizer, /split\(SEARCH_SEPARATOR_PATTERN\)/);

  // Every query token must be found, and the haystack is the displayed name plus the declared path.
  const matcher = service.slice(
    service.indexOf('const matches'),
    service.indexOf('export const filterSubmoduleTree')
  );
  assert.match(matcher, /tokens\.every\(/);
  assert.match(matcher, /rowLabel\(entry\)[^\n]*entry\.path/);

  // The search and the expanded set must never be persisted: they are view state, not settings.
  const store = read('src/renderer/submodules/src/store/submodules.store.ts');
  assert.doesNotMatch(store, /sub_key[\s\S]*(search|expanded)/i);
});

test('the tree is two levels: nested rows are indented 12px and never expandable themselves', () => {
  const app = read('src/renderer/submodules/src/App.vue');
  const row = read('src/renderer/submodules/src/components/SubmoduleRow/SubmoduleRow.vue');
  const style = read('src/renderer/submodules/src/components/SubmoduleRow/SubmoduleRow.less');
  const shared = read('src/shared/submodules/submodules.type.ts');

  // Children render from the row's own `children`, with `nested` set and no toggle handler — the
  // second level is the last one.
  assert.match(app, /v-for="child in row\.children"/);
  assert.match(app, /nested\n\s+@open="handleOpen"/);
  assert.match(app, /@toggle="submodulesStore\.toggleExpanded\(\$event\)"/);

  assert.match(row, /name="submodules__row__toggleChildren"/);
  assert.match(row, /:aria-expanded="expanded"/);
  assert.match(row, /'submodule-row--nested': nested/);

  // 12px of indent on top of the row's own 12px padding.
  assert.match(style, /\.submodule-row--nested \{\s*padding-left: 24px;/);
  // Rows without children keep the control's width so first-level names stay aligned.
  assert.match(row, /submodule-row__toggle-spacer/);

  assert.match(shared, /children: SubmoduleEntry\[\];/);
  const scanner = read('src/main/submodules/submoduleScanner.service.ts');
  // One level only: a child is described with `nested` true and never scans grandchildren.
  assert.match(scanner, /const children = nested \? \[\] : readChildren\(absolutePath\)/);
  assert.match(scanner, /describeSubmodule\(absolutePath, section, true\)/);
});

test('both controls are persisted through the runtime and travel in the snapshot', () => {
  assert.deepEqual(createDefaultSubmodulesViewSettings(), {
    showDiffOnTop: true,
    sortMode: 'name'
  });
  assert.equal(SUBMODULES_VIEW_SETTING_SUB_KEY, 'view');

  const runtime = read('src/main/submodules/submodulesRuntime.service.ts');
  assert.match(runtime, /SUBMODULES_VIEW_SETTING_SUB_KEY/);
  assert.match(runtime, /entries: orderSubmodules\(scanned\.entries, this\.settings\)/);
  // Settings belong to the change fingerprint, or a flipped switch would never reach other views.
  const fingerprint = runtime.slice(
    runtime.indexOf('const snapshotFingerprint'),
    runtime.indexOf('const sanitizeViewSettings')
  );
  assert.match(fingerprint, /settings: snapshot\.settings/);

  const handler = read('src/main/xpc/submodules.handler.ts');
  assert.match(handler, /async updateViewSettings\(/);
});

test('the settings switch lives behind the menu-bar gear and defaults to on', () => {
  const menuBar = read(
    'src/renderer/submodules/src/components/SubmodulesMenuBar/SubmodulesMenuBar.vue'
  );

  assert.match(menuBar, /name="submodules__menuBar__settings"/);
  assert.match(menuBar, /name="submodules__menuBar__showDiffOnTop"/);
  assert.match(menuBar, /:model-value="submodulesStore\.settings\.showDiffOnTop"/);
  assert.match(menuBar, /i18nHelper\.submodules\.settings\.showDiffOnTop/);
  // `createDefaultSubmodulesViewSettings` is the single source of the default; the switch must not
  // hard-code one of its own.
  assert.doesNotMatch(menuBar, /:default-checked|model-value="true"/);
});

test('the list renders the filtered rows and offers a way out of an empty result', () => {
  const app = read('src/renderer/submodules/src/App.vue');

  assert.match(app, /v-for="row in submodulesStore\.visibleTree"/);
  assert.match(app, /name="submodules__noMatches"/);
  assert.match(app, /i18nHelper\.submodules\.empty\.noMatches/);
  assert.match(app, /submodulesStore\.clearSearch\(\)/);
  // The controls row only exists once a root is watched, like the root summary above it.
  assert.match(app, /<SubmodulesListControls v-if="submodulesStore\.snapshot\.rootPath" ref=/);
});

test('every new key exists in both languages', () => {
  const en = read('src/renderer/common/i18n/en.ts');
  const zh = read('src/renderer/common/i18n/zh.ts');

  for (const key of [
    'settings:',
    'search:',
    'searchShortcutMac:',
    'searchShortcutWin:',
    'clearSearch:',
    'expandChildren:',
    'collapseChildren:',
    'noMatches:',
    'settingsFailed:'
  ]) {
    assert.match(en, new RegExp(key), `en.ts must declare ${key}`);
    assert.match(zh, new RegExp(key), `zh.ts must declare ${key}`);
  }
  for (const source of [en, zh]) {
    const sort = source.slice(source.indexOf('    sort: {'), source.indexOf('    branch: {'));
    for (const key of ['label:', 'name:', 'updated:']) {
      assert.match(sort, new RegExp(key), `both languages must declare sort.${key}`);
    }
  }
});
