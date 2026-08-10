import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

test('Settings uses one left category rail and one active right-hand settings list', () => {
  const app = readFileSync(
    join(projectRoot, 'src/renderer/onlypreview/settings/src/App.vue'),
    'utf8'
  );
  const store = readFileSync(
    join(projectRoot, 'src/renderer/onlypreview/settings/src/onlyPreviewSettings.store.ts'),
    'utf8'
  );
  const type = readFileSync(
    join(projectRoot, 'src/renderer/onlypreview/settings/src/onlyPreviewSettings.type.ts'),
    'utf8'
  );

  const previewIndex = app.indexOf('name="onlypreview__settingsCategoryPreview"');
  const projectIndex = app.indexOf('name="onlypreview__settingsCategoryProject"');
  const appearanceIndex = app.indexOf('name="onlypreview__settingsCategoryAppearance"');
  assert.ok(previewIndex >= 0 && previewIndex < projectIndex && projectIndex < appearanceIndex);
  assert.match(
    app,
    /name="onlypreview__settingsCategories"[\s\S]*<main name="onlypreview__settingsContent"/
  );
  assert.match(app, /activeCategory === 'preview'[\s\S]*'onlypreview-settings-panel-preview'/);
  assert.match(app, /activeCategory === 'project'[\s\S]*'onlypreview-settings-panel-project'/);
  assert.match(
    app,
    /activeCategory === 'appearance'[\s\S]*'onlypreview-settings-panel-appearance'/
  );
  assert.match(app, /activeCategory === 'preview'[\s\S]*name="onlypreview__settingsPreview"/);
  assert.match(app, /activeCategory === 'project'[\s\S]*name="onlypreview__settingsProject"/);
  assert.match(app, /activeCategory === 'appearance'[\s\S]*name="onlypreview__settingsAppearance"/);
  assert.doesNotMatch(app, /onlypreview__hiddenFiles|onlypreview-hidden-files/);
  assert.match(store, /activeCategory: OnlyPreviewSettingsCategory = 'preview'/);
  assert.match(store, /selectCategory\(category: OnlyPreviewSettingsCategory\): void/);
  assert.match(type, /'preview' \| 'project' \| 'appearance'/);
});

test('Settings category layout keeps navigation and actions fixed around a scrolling detail pane', () => {
  const style = readFileSync(
    join(projectRoot, 'src/renderer/onlypreview/settings/src/App.less'),
    'utf8'
  );

  assert.match(
    style,
    /\.onlypreview-settings__workspace \{[\s\S]*display: flex;[\s\S]*overflow: hidden;/
  );
  assert.match(
    style,
    /\.onlypreview-settings__categories \{[\s\S]*width: 178px;[\s\S]*border-right:/
  );
  assert.match(style, /\.onlypreview-settings__content \{[\s\S]*flex: 1;[\s\S]*overflow-y: auto;/);
  assert.match(style, /\.onlypreview-settings__category--active \{[\s\S]*inset 3px 0 0/);
  assert.match(style, /\.onlypreview-settings__category--active svg \{[\s\S]*#c2410c/);
  assert.match(style, /focus-visible \{[\s\S]*var\(--onlypreview-royal\)/);
  assert.match(style, /\.onlypreview-settings__actions \{[\s\S]*flex: 0 0 52px/);
});
