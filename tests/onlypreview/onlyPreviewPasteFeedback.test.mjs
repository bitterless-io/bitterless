/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { test } from 'node:test';
import less from 'less';

const projectRoot = resolvePath(dirname(new URL(import.meta.url).pathname), '..', '..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

// Less keeps `/* */` comments, and a comment explaining a declaration almost always quotes the
// declaration it explains — so `doesNotMatch(/var\(/)` was matched by the comment saying not to use
// `var()` here. `onlyPreviewGlobalSearchShadow.test.mjs` learned this first; same helper, same reason.
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

const APP_VUE = 'src/renderer/onlypreview/shell/src/App.vue';
const PASTE = 'src/renderer/onlypreview/shell/src/onlyPreviewProjectPaste.service.ts';
const AUTHORING = 'src/renderer/onlypreview/shell/src/onlyPreviewProjectAuthoring.store.ts';
const FLASH = 'src/renderer/onlypreview/shell/src/onlyPreviewPasteFlash.store.ts';
const STYLESHEET = 'src/renderer/onlypreview/shell/src/App.less';
const CATALOG = 'src/renderer/onlypreview/common/onlyPreviewI18n.ts';

/**
 * Owner, 2026-09-18: 「粘贴一个已经存在的内容的时候不要这种 UI 提示，应该通过 alertview 提示」.
 *
 * The Project rail's banner is for index and runtime breakage and carries the Copy-detail button —
 * offering it for "this name is taken" invites a bug report about a file that simply already exists.
 */
test('a paste name conflict goes to the alert layer, and only that conflict', () => {
  const paste = source(PASTE);
  assert.match(paste, /error instanceof OnlyPreviewContractError && error\.code === 'NAME_EXISTS'/);
  assert.match(paste, /await this\.showConflict\(/);
  // Everything that is NOT a conflict still reaches the banner: a refused workspace or a failed
  // write is real breakage, and Copy-detail is the right affordance for it.
  assert.match(paste, /this\.host\.errorMessage = this\.errorMessage\(error\)/);

  const app = source(APP_VUE);
  assert.match(app, /onlyPreviewI18n\.project\.pasteConflictTitle/);
  assert.match(app, /tone: 'error'/, 'a conflict is an error, not the default notice tone');
});

test('both catalogs carry the conflict dialog copy', () => {
  const catalog = source(CATALOG);
  for (const key of ['pasteConflictTitle', 'pasteConflictClose']) {
    assert.equal(
      (catalog.match(new RegExp(`${key}:`, 'g')) ?? []).length,
      2,
      `${key} must exist in the English and Chinese catalogs`
    );
  }
});

/**
 * Owner: 「将文件粘贴到目录下要自动滚动到该文件上…但是不用打开预览哦」.
 *
 * `selectedRelativePath` IS the previewed file, so the whole difference between New Folder's reveal
 * and paste's is that one assignment.
 */
test('paste reveals without opening the preview, and scrolls to the row', () => {
  const authoring = source(AUTHORING);
  assert.match(authoring, /async revealPastedEntries\(/);
  assert.match(authoring, /if \(options\.preview\) this\.host\.selectedRelativePath = entry;/);

  const app = source(APP_VUE);
  assert.match(app, /revealPastedEntries\(entries, workspaceId\)/);
  // Locate's existing centring scroll, not a second scroller.
  assert.match(app, /await focusTreePath\(landed\[0\], true\)/);
  assert.match(app, /onlyPreviewPasteFlash\.flash\(landed\)/);
});

test('the flash is a one-shot class that clears itself and survives a re-render', () => {
  const flash = source(FLASH);
  // Paths, not elements: the tree re-renders rows freely.
  assert.match(flash, /isFlashing\(relativePath: string\): boolean/);
  assert.match(flash, /setTimeout\(/, 'the class must clear even when no animationend ever fires');
  assert.match(flash, /clear\(\): void/);

  const app = source(APP_VUE);
  assert.match(app, /'onlypreview-shell__tree-row--paste-flash':/);
  // Opening another workspace replaces every row, so a pending flash has nothing to land on.
  assert.match(app, /onlyPreviewPasteFlash\.clear\(\)/);
});

test('the compiled CSS really animates the row, and reduced motion opts out', async () => {
  const compiled = (
    await less.render(readFileSync(join(projectRoot, STYLESHEET), 'utf8'), {
      filename: join(projectRoot, STYLESHEET)
    })
  ).css;

  const keyframes = stripCssComments(compiled).match(/@keyframes onlypreview-paste-flash \{[\s\S]*?\n\}/)?.[0];
  assert.ok(keyframes, 'the keyframes must survive compilation, not just exist in the Less');
  // none -> blue -> none, exactly what was asked for.
  assert.match(keyframes, /0% \{\s*background-color: transparent;/);
  assert.match(keyframes, /background-color: #d6e4ff;/, 'the Project selection blue, not a new one');
  assert.match(keyframes, /100% \{\s*background-color: transparent;\s*\}/);
  // A `var()` here silently yields an empty value — the token it first referenced did not exist.
  assert.doesNotMatch(keyframes, /var\(/);

  assert.match(compiled, /\.onlypreview-shell__tree-row--paste-flash \{\s*animation: onlypreview-paste-flash/);
  const reduced = compiled.slice(compiled.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(
    reduced,
    /\.onlypreview-shell__tree-row--paste-flash \{\s*animation: none;/,
    'reduced motion still scrolls and selects; it just does not animate'
  );
});

/**
 * Owner: 「copy 按钮和 copied 都改用 tabler 中合适的 icon 别用文字了」.
 *
 * Once it is an icon button the workspace's borderless rule binds: icon buttons carry no outline.
 */
test('the copy-detail control is a borderless tabler icon button', async () => {
  const app = source(APP_VUE);
  assert.match(app, /<IconCheck v-if="onlyPreviewErrorDetail\.copied"/);
  assert.match(app, /<IconCopy v-else/);
  // The label survives as the accessible name — "no text" meant the visible label, not the aria one.
  assert.match(app, /:aria-label="\s*onlyPreviewErrorDetail\.copied/);

  const compiled = (
    await less.render(readFileSync(join(projectRoot, STYLESHEET), 'utf8'), {
      filename: join(projectRoot, STYLESHEET)
    })
  ).css;
  const rule = compiled.slice(
    compiled.indexOf('.onlypreview-shell__inline-error-copy {'),
    compiled.indexOf('}', compiled.indexOf('.onlypreview-shell__inline-error-copy {'))
  );
  assert.match(rule, /border: 0/, 'an icon button carries no outline');
  assert.doesNotMatch(rule, /border: 1px/);
});
