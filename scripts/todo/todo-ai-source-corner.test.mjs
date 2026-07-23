import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('AI source marker is a direct conditional child of TodoRow without a metadata wrapper', () => {
  const source = read('src/renderer/todo/src/components/TodoRow/TodoRow.vue');
  const markerIndex = source.indexOf(
    '<span v-if="isAiTodo" class="todo-row__source-tag">{{ i18nHelper.todo.aiSourceTag }}</span>',
  );
  const checkboxIndex = source.indexOf('<a-checkbox', markerIndex);
  const contentIndex = source.indexOf('<div class="todo-row__content">', markerIndex);

  assert.ok(markerIndex > source.indexOf('class="todo-row"'));
  assert.match(
    source,
    /@contextmenu\.prevent="onContextMenu"\s*>\s*<span v-if="isAiTodo" class="todo-row__source-tag">\{\{ i18nHelper\.todo\.aiSourceTag \}\}<\/span>\s*<a-checkbox/,
  );
  assert.ok(checkboxIndex > markerIndex, 'AI marker must be a direct sibling before the checkbox');
  assert.ok(contentIndex > checkboxIndex, 'AI marker must not remain inside Todo content');
  assert.doesNotMatch(source, /todo-row__meta/);
  assert.match(source, /const isAiTodo = computed\(\(\) => \{\s*return props\.todo\.source === 'ai';\s*\}\)/);
});

test('AI source marker occupies the top-left corner without intercepting input', () => {
  const styles = read('src/renderer/todo/src/components/TodoRow/TodoRow.less');
  const rowRule = cssRule(styles, '.todo-row');
  const markerRule = cssRule(styles, '.todo-row__source-tag');
  const contentRule = cssRule(styles, '.todo-row__content');

  assert.match(rowRule, /position:\s*relative/);
  assert.match(rowRule, /padding:\s*8px/);
  assert.match(markerRule, /position:\s*absolute/);
  assert.match(markerRule, /top:\s*0/);
  assert.match(markerRule, /left:\s*0/);
  assert.match(markerRule, /z-index:\s*1/);
  assert.match(markerRule, /border-radius:\s*6px 0 4px 0/);
  assert.match(markerRule, /pointer-events:\s*none/);
  assert.match(markerRule, /height:\s*16px/);
  assert.match(markerRule, /padding:\s*0 5px/);
  assert.match(markerRule, /background-color:\s*oklch\(0\.94 0\.04 274\)/);
  assert.match(markerRule, /color:\s*oklch\(0\.42 0\.11 274\)/);
  assert.match(markerRule, /font-size:\s*10px/);
  assert.match(markerRule, /font-weight:\s*700/);
  assert.match(markerRule, /line-height:\s*1/);
  assert.doesNotMatch(contentRule, /padding/);
  assert.doesNotMatch(styles, /\.todo-row__meta/);
});

test('checkbox, title, subtitle, and star interactions remain wired for every Todo', () => {
  const source = read('src/renderer/todo/src/components/TodoRow/TodoRow.vue');

  assert.match(
    source,
    /<a-checkbox[\s\S]*?:model-value="todo\.status === 1"[\s\S]*?@change="handleToggleStatus"[\s\S]*?@click\.stop/,
  );
  assert.match(
    source,
    /v-if="!editing"[\s\S]*?class="todo-row__title"[\s\S]*?@click\.stop="handleTitleClick"/,
  );
  assert.match(
    source,
    /<textarea[\s\S]*?v-else[\s\S]*?v-model="titleInput"[\s\S]*?@blur="onTitleBlur"/,
  );
  assert.match(source, /<div v-if="hasSubtitle" class="todo-row__subtitle">/);
  assert.match(source, /v-if="subTodoProgress" class="todo-row__subtodo-progress"/);
  assert.match(source, /v-if="dueDateText"[\s\S]*?class="todo-row__due-date"/);
  assert.match(
    source,
    /class="todo-row__star"[\s\S]*?'todo-row__star--active': todo\.important === 1[\s\S]*?@click\.stop="handleToggleImportant"/,
  );
});

test('ordinary Todo selection and visual states remain wired', () => {
  const source = read('src/renderer/todo/src/components/TodoRow/TodoRow.vue');
  const styles = read('src/renderer/todo/src/components/TodoRow/TodoRow.less');
  const selectTodo = source.match(
    /const selectTodo = \(\): void => \{[\s\S]*?\n\};(?=\n\nconst handleTitleClick)/,
  );
  const handleRowClick = source.match(
    /const handleRowClick = \(\) => \{[\s\S]*?\n\};(?=\n\nconst onContextMenu)/,
  );

  assert.match(source, /@click="handleRowClick"/);
  assert.match(
    source,
    /'todo-row--active': todoStore\.detailVisible && todoStore\.selectedTodo\?\.id === todo\.id/,
  );
  assert.match(source, /'todo-row--new': todoStore\.newlyCreatedTodoId === todo\.id/);
  assert.ok(selectTodo, 'Missing Todo selection entry point');
  assert.match(selectTodo[0], /void observeTodoMutation\(async \(\) => \{/);
  assert.match(
    selectTodo[0],
    /if \(props\.overrideSelect\) \{\s*await props\.overrideSelect\(\);\s*return;\s*\}/,
  );
  assert.match(selectTodo[0], /await todoStore\.selectTodo\(props\.todo\)/);
  assert.ok(handleRowClick, 'Missing row-click selection entry point');
  assert.match(handleRowClick[0], /if \(!editing\.value\) \{\s*selectTodo\(\);\s*\}/);

  assert.match(cssRule(styles, '.todo-row--active'), /background-color:/);
  assert.match(cssRule(styles, '.todo-row--new'), /animation:\s*todo-row-flash/);
  assert.match(cssRule(styles, '.todo-row:hover'), /box-shadow:/);
  assert.match(
    styles,
    /@keyframes todo-row-flash\s*\{[\s\S]*?0%[\s\S]*?60%[\s\S]*?100%[\s\S]*?\}/,
  );
});

test('ordinary completion and importance mutations remain wired', () => {
  const source = read('src/renderer/todo/src/components/TodoRow/TodoRow.vue');
  const handleToggleStatus = source.match(
    /const handleToggleStatus = \(\) => \{[\s\S]*?\n\};(?=\n\nconst handleToggleImportant)/,
  );
  const handleToggleImportant = source.match(
    /const handleToggleImportant = \(\) => \{[\s\S]*?\n\};(?=\n<\/script>)/,
  );

  assert.ok(handleToggleStatus, 'Missing Todo completion handler');
  assert.match(
    handleToggleStatus[0],
    /if \(props\.todo\.status === 0\) \{\s*void observeTodoMutation\(\(\) => todoStore\.completeTodo\(props\.todo\.id\)\);\s*\} else \{\s*void observeTodoMutation\(\(\) => todoStore\.uncompleteTodo\(props\.todo\.id\)\);\s*\}/,
  );
  assert.ok(handleToggleImportant, 'Missing Todo importance handler');
  assert.match(
    handleToggleImportant[0],
    /void observeTodoMutation\(\(\) => todoStore\.toggleImportant\(props\.todo\.id\)\)/,
  );
});

test('package exposes the focused AI source marker contract', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(
    packageJson.scripts['test:todo-ai-source'],
    'node --test scripts/todo/todo-ai-source-corner.test.mjs',
  );
});
