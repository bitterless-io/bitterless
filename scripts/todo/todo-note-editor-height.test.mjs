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

test('Todo Note opens at 480px and keeps bounded vertical resizing', () => {
  const styles = read('src/renderer/todo/src/components/TodoDetail/TodoDetail.less');
  const noteRule = cssRule(styles, '.todo-detail__note');

  assert.match(noteRule, /(?:^|\n)\s*height:\s*480px;/);
  assert.match(noteRule, /(?:^|\n)\s*min-height:\s*80px;/);
  assert.match(noteRule, /(?:^|\n)\s*max-height:\s*500px;/);
  assert.match(noteRule, /(?:^|\n)\s*resize:\s*vertical;/);
});

test('Todo detail body remains the scroll owner around the taller Note', () => {
  const styles = read('src/renderer/todo/src/components/TodoDetail/TodoDetail.less');
  const panelRule = cssRule(styles, '.todo-detail__panel');
  const contentRule = cssRule(styles, '.todo-detail__content');
  const bodyRule = cssRule(styles, '.todo-detail__body');
  const footerRule = cssRule(styles, '.todo-detail__footer');

  assert.match(panelRule, /(?:^|\n)\s*overflow:\s*hidden;/);
  assert.match(contentRule, /(?:^|\n)\s*overflow:\s*hidden;/);
  assert.match(bodyRule, /(?:^|\n)\s*flex:\s*1;/);
  assert.match(bodyRule, /(?:^|\n)\s*min-height:\s*0;/);
  assert.match(bodyRule, /(?:^|\n)\s*overflow-y:\s*auto;/);
  assert.match(footerRule, /(?:^|\n)\s*flex-shrink:\s*0;/);
});
