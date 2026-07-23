import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const cssRule = (source, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
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

test('Todo board scrolls vertically and reserves the 320px detail panel responsively', () => {
  const app = read('src/renderer/todo/src/App.vue');
  const styles = read('src/renderer/todo/src/App.less');
  const boardScrollRule = cssRule(styles, '.todo-app__board-scroll');
  const detailOpenRule = cssRule(
    styles,
    '.todo-app__board--detail-open .todo-app__board-scroll',
  );

  assert.match(
    app,
    /:class="\{ 'todo-app__board--detail-open': todoStore\.detailVisible \}"/,
  );
  assert.match(boardScrollRule, /overflow-x:\s*hidden/);
  assert.match(boardScrollRule, /overflow-y:\s*auto/);
  assert.match(detailOpenRule, /padding-right:\s*calc\(320px \+ 12px\)/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.todo-app__board--detail-open \.todo-app__board-scroll\s*\{\s*padding-right:\s*12px/,
  );
  assert.match(
    styles,
    /@media \(max-width: 323px\)[\s\S]*?\.todo-app__board-scroll\s*\{\s*overflow-x:\s*auto/,
  );
});

test('Focus and Domain columns share the exact flexible width contract', () => {
  const columnSources = [
    ['Domain', read('src/renderer/todo/src/components/DomainColumn/DomainColumn.less'), '.domain-column'],
    ['Focus', read('src/renderer/todo/src/components/FocusedColumn/FocusedColumn.less'), '.focused-column'],
  ];

  for (const [label, source, selector] of columnSources) {
    const rule = cssRule(source, selector);
    assert.match(rule, /(?:^|\n)\s*width:\s*auto;/, `${label} must use width: auto`);
    assert.match(rule, /min-width:\s*300px;/, `${label} must keep its 300px minimum`);
    assert.match(rule, /max-width:\s*480px;/, `${label} must keep its 480px maximum`);
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

test('Todo location uses vertical visibility and retains row centering', () => {
  const store = read('src/renderer/todo/src/store/todo.store.ts');
  const selection = store.match(/  async selectTodo\([\s\S]*?\n  \}(?=\n\n  async selectTodoFromFocused)/);
  const focusedSelection = store.match(
    /  async selectTodoFromFocused\([\s\S]*?\n  \}(?=\n\n  locateTodo)/,
  );
  const locateTodo = store.match(/  locateTodo\([\s\S]*?\n  \}(?=\n\n  closeDetail)/);

  assert.ok(selection, 'Missing Todo selection behavior');
  assert.ok(focusedSelection, 'Missing Focus selection behavior');
  assert.ok(locateTodo, 'Missing Todo location behavior');
  assert.match(
    selection[0],
    /await this\.loadSubTodos\(todo\.id\);\s*await nextTick\(\);\s*this\.locateTodo\(todo\.id, todo\.domain_id\)/,
  );
  assert.doesNotMatch(focusedSelection[0], /scrollLeft|scrollTo\(\{\s*left|offsetLeft/);
  assert.doesNotMatch(locateTodo[0], /scrollLeft|scrollTo\(\{\s*left|offsetLeft|clientWidth/);
  assert.match(
    locateTodo[0],
    /columnEl\.scrollIntoView\(\{ block: 'nearest', behavior: 'smooth' \}\)/,
  );
  assert.match(locateTodo[0], /const targetScrollTop = rowOffsetTop - \(bodyHeight - rowHeight\) \/ 2/);
  assert.match(
    locateTodo[0],
    /columnBody\.scrollTo\(\{ top: Math\.max\(0, targetScrollTop\), behavior: 'smooth' \}\)/,
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
