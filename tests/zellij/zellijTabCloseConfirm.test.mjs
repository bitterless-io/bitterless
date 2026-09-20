/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test helpers. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';

/**
 * The close confirmation is rendered, not asserted as source text: the question it has to answer is
 * what a person SEES, and the thing under test is a `v-if` that decides whether a line appears.
 */
const root = resolve(import.meta.dirname, '../..');
const app = readFileSync(
  resolve(root, 'src/renderer/maestro/tabAlias/src/TabAliasApp.vue'),
  'utf8'
);
const closeText = {
  title: 'Close this terminal tab?',
  titleMany: 'Close these terminal tabs?',
  message: 'one',
  messageMany: 'many',
  confirm: 'Close',
  cancel: 'Cancel'
};

const renderDialog = (terminalLabels) => {
  const fragment = app
    .match(/<section\s+v-else-if="closeDialog"[\s\S]*?\n {4}<\/section>/)[0]
    // The fragment is rendered on its own, with no sibling `v-if` to chain onto.
    .replace('v-else-if="closeDialog"', 'v-if="closeDialog"');
  const render = new Function('Vue', compile(fragment, { mode: 'function' }).code)({
    ...Vue,
    resolveComponent: (name) => ({ name })
  });
  return render({
    closeDialog: { terminalLabels },
    closeMany: terminalLabels.length > 1,
    closeText,
    tabAliasStore: { busy: false, cancel() {}, confirm() {} }
  });
};

/** Every `name` attribute present anywhere in the rendered tree. */
const names = (vnode, found = []) => {
  if (Array.isArray(vnode)) for (const child of vnode) names(child, found);
  else if (vnode && typeof vnode === 'object') {
    if (vnode.props?.name) found.push(vnode.props.name);
    names(vnode.children, found);
  }
  return found;
};

const texts = (vnode, found = []) => {
  if (Array.isArray(vnode)) for (const child of vnode) texts(child, found);
  else if (typeof vnode === 'string') found.push(vnode.trim());
  else if (vnode && typeof vnode === 'object') texts(vnode.children, found);
  return found;
};

test('closing ONE terminal tab does not repeat its name back at the reader', () => {
  const rendered = renderDialog(['Zellij']);
  // The reader pressed the close button on that exact tab. A list naming it again reads like a
  // heading and carries nothing (Ral 2026-09-20:「zellij 标题多余了,直接展示提示文字」).
  assert.ok(
    !names(rendered).includes('maestro__tabCloseConfirmTerminals'),
    'a single-tab close must not list the tab it was opened from'
  );
  const shown = texts(rendered);
  assert.ok(shown.includes(closeText.title), 'the question still has to be asked');
  assert.ok(shown.includes(closeText.message), 'the consequence still has to be stated');
  assert.ok(!shown.includes('Zellij'), 'the tab label is not repeated anywhere');
});

test('closing SEVERAL terminal tabs still says which ones', () => {
  const rendered = renderDialog(['Zellij', 'build', 'logs']);
  // Here the list is the only thing that bounds the damage, so it stays.
  assert.ok(
    names(rendered).includes('maestro__tabCloseConfirmTerminals'),
    'a multi-tab close must name the terminals it takes'
  );
  const shown = texts(rendered);
  for (const label of ['Zellij', 'build', 'logs']) assert.ok(shown.includes(label), label);
  assert.ok(shown.includes(closeText.titleMany));
  assert.ok(shown.includes(closeText.messageMany));
});

test('the dialog keeps its copy in i18n, never inline in the template', () => {
  const template = app.match(/<template>[\s\S]*<\/template>/)[0];
  assert.doesNotMatch(
    template,
    /Close this terminal tab|ends with the tab|会话会随标签页/u,
    'user-visible copy belongs in en.ts / zh.ts'
  );
});
