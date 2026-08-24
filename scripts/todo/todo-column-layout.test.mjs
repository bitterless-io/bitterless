import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
// The selector must start its line: `da.domain-column { … }` contains `.domain-column { … }` as a
// substring but is a dead rule that styles nothing, and an unanchored match accepted it as the
// contract while every Domain column lost its width, flex, and wrapping rules.
const cssRule = (source, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)[ \\t]*${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
};

test('Todo uses one wrapping draggable with Focus fixed in its header', () => {
  const app = read('src/renderer/todo/src/App.vue');
  const styles = read('src/renderer/todo/src/App.less');
  const draggableRule = cssRule(styles, '.todo-app__board-draggable');

  assert.equal((app.match(/<draggable\b/g) ?? []).length, 1);
  assert.match(app, /<draggable[\s\S]*?v-model="todoStore\.domainList"/);
  assert.match(
    app,
    /<template #header>\s*<FocusedColumn v-if="todoSettingStore\.showFocused" \/>\s*<\/template>/,
  );
  assert.match(app, /<template #item="\{ element \}">\s*<DomainColumn :domain="element" \/>/);
  assert.match(draggableRule, /width:\s*100%/);
  assert.match(draggableRule, /display:\s*flex/);
  assert.match(draggableRule, /flex-wrap:\s*wrap/);
  assert.match(draggableRule, /align-content:\s*flex-start/);
  assert.match(draggableRule, /align-items:\s*flex-start/);
  assert.match(draggableRule, /gap:\s*12px/);

  assert.doesNotMatch(
    app,
    /direction="horizontal"|AddDomainButton|detail-spacer|IconArrowLeft|showScrollToLeft|scrollToLeft|scrollLeft/,
  );
  assert.doesNotMatch(styles, /detail-spacer|scroll-to-left/);
});

test('the open detail panel overlays the board instead of squeezing it', () => {
  const app = read('src/renderer/todo/src/App.vue');
  const styles = read('src/renderer/todo/src/App.less');
  const boardScrollRule = cssRule(styles, '.todo-app__board-scroll');
  const detailOpenScrollRule = cssRule(
    styles,
    '.todo-app__board--detail-open .todo-app__board-scroll',
  );
  const detailOpenDraggableRule = cssRule(
    styles,
    '.todo-app__board--detail-open .todo-app__board-draggable',
  );
  const panelRule = cssRule(
    read('src/renderer/todo/src/components/TodoDetail/TodoDetail.less'),
    '.todo-detail__panel',
  );

  assert.match(
    app,
    /:class="\{ 'todo-app__board--detail-open': todoStore\.detailVisible \}"/,
  );
  assert.match(boardScrollRule, /overflow-x:\s*hidden/);
  assert.match(boardScrollRule, /overflow-y:\s*auto/);
  assert.match(panelRule, /position:\s*absolute/, 'the detail panel must stay a right overlay');
  assert.match(panelRule, /width:\s*320px/);

  assert.doesNotMatch(
    detailOpenScrollRule,
    /padding-right/,
    'an open detail panel must not reserve board width, which would re-wrap the columns',
  );
  assert.match(
    detailOpenScrollRule,
    /overflow-x:\s*auto/,
    'an open detail panel must allow horizontal reveal of the occluded strip',
  );
  assert.match(
    detailOpenDraggableRule,
    /margin-right:\s*320px/,
    'the wrapping draggable must carry exactly the panel width of trailing scroll slack',
  );
  assert.doesNotMatch(
    detailOpenDraggableRule,
    /width|max-width/,
    'the draggable must keep its full-width wrapping contract while the panel is open',
  );
  assert.doesNotMatch(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.todo-app__board--detail-open/,
    'the 680px override only undid the removed reservation',
  );
  assert.match(
    styles,
    /@media \(max-width: 323px\)[\s\S]*?\.todo-app__board-scroll\s*\{\s*overflow-x:\s*auto/,
  );
});

test('Focus and Domain columns share the exact flexible width and height contract', () => {
  const columnSources = [
    ['Domain', read('src/renderer/todo/src/components/DomainColumn/DomainColumn.less'), '.domain-column'],
    ['Focus', read('src/renderer/todo/src/components/FocusedColumn/FocusedColumn.less'), '.focused-column'],
  ];

  for (const [label, source, selector] of columnSources) {
    const rule = cssRule(source, selector);
    assert.match(rule, /(?:^|\n)\s*width:\s*auto;/, `${label} must use width: auto`);
    assert.match(rule, /min-width:\s*300px;/, `${label} must keep its 300px minimum`);
    assert.match(rule, /max-width:\s*480px;/, `${label} must keep its 480px maximum`);
    assert.match(rule, /max-height:\s*80vh;/, `${label} must cap at 80% of the window height`);
    assert.match(rule, /flex:\s*1 1 300px;/, `${label} must share row space from a 300px basis`);
    assert.match(rule, /align-self:\s*flex-start;/, `${label} must align to the row start`);
    assert.doesNotMatch(rule, /(?:^|\n)\s*width:\s*300px;/, `${label} must not use a fixed width`);
    assert.doesNotMatch(rule, /flex-shrink:\s*0/, `${label} must remain flexible`);
  }
});

test('Add Domain is the first menu action with limit, loading, and reveal behavior', () => {
  const menu = read('src/renderer/todo/src/components/MenuBar/MenuBar.vue');
  const styles = read('src/renderer/todo/src/components/MenuBar/MenuBar.less');
  const actionsIndex = menu.indexOf('<div name="menubar__actions"');
  const addDomainIndex = menu.indexOf('class="menubar__add-domain"', actionsIndex);
  const archiveIndex = menu.indexOf('i18nHelper.todo.archivedDomains', actionsIndex);

  assert.ok(actionsIndex >= 0 && addDomainIndex > actionsIndex);
  assert.ok(archiveIndex > addDomainIndex, 'Add Domain must be the first menu-bar action');
  assert.match(
    menu,
    /name="menubar__add-domain"\s*class="menubar__add-domain"\s*size="mini"\s*type="text"/,
  );
  assert.match(menu, /<IconPlus :size="14" aria-hidden="true" \/>/);
  assert.match(menu, /menubar__add-domain-label">\{\{ i18nHelper\.todo\.addDomain \}\}/);
  assert.match(menu, /:aria-label="i18nHelper\.todo\.addDomain"/);
  assert.match(menu, /:loading="addDomainLoading"/);
  assert.match(menu, /:disabled="addDomainLoading \|\| domainLimitReached"/);
  assert.match(menu, /todoStore\.domainList\.length >= 17/);
  assert.match(menu, /i18nHelper\.todo\.domainLimitReached : i18nHelper\.todo\.addDomain/);
  assert.match(menu, /await observeTodoMutation\(\(\) => todoStore\.createDomain\(\)\)/);
  assert.match(menu, /await nextTick\(\)/);
  assert.match(menu, /data-domain-id="\$\{createdDomain\.id\}"/);
  assert.match(menu, /scrollIntoView\(\{ block: 'nearest', behavior: 'smooth' \}\)/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.menubar__add-domain-label\s*\{\s*display:\s*none/,
  );
});

test('Todo location reveals the column beside the detail panel and retains row centering', () => {
  const store = read('src/renderer/todo/src/store/todo.store.ts');
  const selection = store.match(/  async selectTodo\([\s\S]*?\n  \}(?=\n\n  async selectTodoFromFocused)/);
  const focusedSelection = store.match(
    /  async selectTodoFromFocused\([\s\S]*?\n  \}(?=\n\n  private _beginTodoSelection)/,
  );
  const locateTodo = store.match(/  locateTodo\([\s\S]*?\n  \}(?=\n\n  private _revealColumn)/);
  const revealColumn = store.match(/  private _revealColumn\([\s\S]*?\n  \}(?=\n\n  closeDetail)/);

  assert.ok(selection, 'Missing Todo selection behavior');
  assert.ok(focusedSelection, 'Missing Focus selection behavior');
  assert.ok(locateTodo, 'Missing Todo location behavior');
  assert.ok(revealColumn, 'Missing panel-aware column reveal behavior');
  assert.match(
    selection[0],
    /const detailGeneration = this\._beginTodoSelection\(todo\);\s*if \(!await this\._readAndCommitSelectedSubTodos\(todo\.id, detailGeneration\)\) return;\s*await nextTick\(\);\s*this\.locateTodo\(todo\.id, todo\.domain_id\)/,
  );
  assert.doesNotMatch(selection[0], /loadSubTodos/);
  assert.doesNotMatch(focusedSelection[0], /scrollLeft|scrollTo\(\{\s*left|offsetLeft/);

  assert.match(locateTodo[0], /this\._revealColumn\(columnEl\)/);
  assert.doesNotMatch(
    locateTodo[0],
    /scrollIntoView/,
    'locate must not use panel-unaware scrollIntoView',
  );
  assert.match(locateTodo[0], /const targetScrollTop = rowOffsetTop - \(bodyHeight - rowHeight\) \/ 2/);
  assert.match(
    locateTodo[0],
    /columnBody\.scrollTo\(\{ top: Math\.max\(0, targetScrollTop\), behavior: 'smooth' \}\)/,
  );

  assert.match(store, /const DETAIL_PANEL_WIDTH = 320;/);
  assert.match(store, /const DETAIL_PANEL_GAP = 12;/);
  assert.match(
    revealColumn[0],
    /document\.querySelector<HTMLElement>\('\.todo-app__board-scroll'\)/,
  );
  assert.match(
    revealColumn[0],
    /const reservedRight = this\.detailVisible \? DETAIL_PANEL_WIDTH \+ DETAIL_PANEL_GAP : 0;/,
  );
  assert.match(
    revealColumn[0],
    /\{ start: boardRect\.left, end: boardRect\.right - reservedRight \}/,
    'the horizontal visible region must stop before the detail panel',
  );
  assert.match(
    revealColumn[0],
    /\{ start: boardRect\.top, end: boardRect\.bottom \}/,
    'the vertical visible region must stay the whole board',
  );
  assert.match(
    revealColumn[0],
    /boardScroll\.scrollTo\(\{\s*left: Math\.max\(0, left\),\s*top: Math\.max\(0, top\),\s*behavior: 'smooth',\s*\}\)/,
  );
  assert.match(
    store,
    /const axisScrollDelta = \(\s*box: \{ start: number; end: number \},\s*visible: \{ start: number; end: number \},\s*\): number => \{/,
    'the axis math must stay a shared two-parameter helper',
  );
});

test('remote refresh preserves active Domain and Todo title drafts', () => {
  const domain = read('src/renderer/todo/src/components/DomainColumn/DomainColumn.vue');
  const detail = read('src/renderer/todo/src/components/TodoDetail/TodoDetail.vue');
  const descriptionWatch = domain.match(
    /watch\(\(\) => props\.domain\.description,[\s\S]*?\n\}\);/,
  );
  const descriptionBlur = domain.match(
    /const onDescriptionBlur = \(\): void => \{[\s\S]*?\n\};/,
  );
  const selectedTitleWatch = detail.match(
    /watch\(\(\) => \(\{\n\s+id: todoStore\.selectedTodo\?\.id[\s\S]*?\}, \{ immediate: true \}\);/,
  );

  assert.match(domain, /@focus="onDescriptionFocus"/);
  assert.match(domain, /const descriptionEditing = ref\(false\)/);
  assert.ok(descriptionWatch, 'Domain description must react to remote snapshot changes');
  assert.match(descriptionWatch[0], /if \(descriptionEditing\.value\) return;/);
  assert.ok(descriptionBlur, 'Domain description blur must save and end draft protection');
  assert.match(descriptionBlur[0], /todoStore\.updateDomainDescription/);
  assert.match(descriptionBlur[0], /descriptionEditing\.value = false;/);

  assert.ok(selectedTitleWatch, 'Todo detail title must watch selected identity and title');
  assert.match(selectedTitleWatch[0], /if \(selectedTodo\.id !== previousTodo\?\.id\)/);
  assert.match(selectedTitleWatch[0], /headerEditing\.value = false;/);
  assert.match(selectedTitleWatch[0], /if \(!headerEditing\.value\) _headerTitleText\.value = selectedTodo\.title;/);
  assert.doesNotMatch(
    detail,
    /watch\(\(\) => todoStore\.selectedTodo\?\.title, \(\) => \{\s*headerEditing\.value = false;/,
  );
});

test('obsolete AddDomainButton files are removed', () => {
  assert.equal(
    existsSync(join(root, 'src/renderer/todo/src/components/AddDomainButton/AddDomainButton.vue')),
    false,
  );
  assert.equal(
    existsSync(join(root, 'src/renderer/todo/src/components/AddDomainButton/AddDomainButton.less')),
    false,
  );
});

test('ordinary Todo board behaviors remain wired', () => {
  const app = read('src/renderer/todo/src/App.vue');

  assert.match(app, /@end="onDomainDragEnd"/);
  assert.match(app, /observeTodoMutation\(\(\) => todoStore\.saveDomainOrder\(order\)\)/);
  assert.match(app, /@click="onBoardClick"/);
  assert.match(app, /if \(!target\.closest\('\.domain-column'\)[\s\S]*?todoStore\.closeDetail\(\)/);
  assert.match(app, /if \(e\.key === 'Escape'\) \{\s*todoStore\.closeDetail\(\)/);
  assert.match(app, /<MenuBar :is-standalone="isStandalone" :is-omni="isOmni" \/>/);
});

test('package exposes the Todo layout contract', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(
    packageJson.scripts['test:todo-layout'],
    'node --test scripts/todo/todo-column-layout.test.mjs',
  );
});
