import assert from 'node:assert/strict';
import { test } from 'node:test';
import { source } from './onlyPreviewCoreTest.helper.mjs';

test('Shell removes the Project filter and mounts Global Search in the right work area', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const shell = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');

  assert.doesNotMatch(app, /name="onlypreview__search"|ProjectSearchResults/);
  assert.doesNotMatch(shell, /searchQuery|onlyPreviewTreeFilter|onlyPreviewProjectSearchStore/);
  assert.match(app, /<GlobalSearchWorkspace v-if="onlyPreviewGlobalSearchStore\.active"/);
  assert.match(app, /<section v-else name="onlypreview__previewRegion"/);
  assert.match(shell, /focusSearch: \(origin\)[\s\S]*onlyPreviewGlobalSearchStore\.enter\(origin\)/);
  assert.match(shell, /handleFocusFind[\s\S]*onlyPreviewGlobalSearchStore\.exit\(false\)/);
  assert.ok(shell.split(/\r?\n/).length < 800);
});

test('Shell reports zero native bounds while Global Search is active and restores live bounds', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');

  assert.match(
    app,
    /onlyPreviewGlobalSearchStore\.active[\s\S]*reportPreviewBounds\(\{ x: 0, y: 0, width: 0, height: 0 \}\)/
  );
  assert.match(app, /watch\([\s\S]*onlyPreviewGlobalSearchStore\.active[\s\S]*nextTick/);
  assert.match(
    app,
    /await restorePreviewBounds\(\)[\s\S]*restoreOnlyPreviewGlobalSearchFocus\('opener'\)[\s\S]*opener\?\.isConnected[\s\S]*focusTreePath\(onlyPreviewShellStore\.focusTree\(\)\)[\s\S]*restoreOnlyPreviewGlobalSearchFocus\('preview'\)/
  );
  assert.match(
    app,
    /document\.activeElement instanceof HTMLElement[\s\S]*\{ flush: 'sync' \}/
  );
  assert.doesNotMatch(app, /if \(!active\) void focusTreePath/);
  assert.match(app, /watch\([\s\S]*previewHostRef[\s\S]*resizeObserver\.observe\(host\)/);
  assert.match(windowHelper, /const isHiddenPreviewBounds/);
  assert.match(
    windowHelper,
    /isHiddenPreviewBounds\(value\)[\s\S]*\{ x: 0, y: 0, width: 0, height: 0 \}[\s\S]*clampPreviewBounds/
  );
  assert.match(
    windowHelper,
    /isHiddenPreviewBounds\(currentBounds\)[\s\S]*\{ x: 0, y: 0, width: 0, height: 0 \}/
  );
});

test('Global Search UI keeps grouped ledger, bounded split, keyboard controls, and responsive motion rules', () => {
  const workspace = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue'
  );
  const style = source(
    'src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less'
  );

  assert.ok(workspace.indexOf('section="files"') < workspace.indexOf('section="contents"'));
  assert.match(workspace, /@compositionstart/);
  assert.match(workspace, /@compositionend/);
  assert.match(workspace, /event\.key === 'Escape'/);
  assert.match(workspace, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(workspace, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(workspace, /aria-valuemin="25"/);
  assert.match(workspace, /aria-valuemax="70"/);
  assert.match(style, /--onlypreview-search-preview-height/);
  assert.match(style, /@media \(max-width: 800px\)/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(style, /border-left: 3px solid var\(--onlypreview-royal\)/);
});
