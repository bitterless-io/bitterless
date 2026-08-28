/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { submoduleDisplayName } from '../../src/shared/submodules/submodules.type.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const entry = (overrides) => ({
  name: 'projects/bitterless',
  path: 'projects/bitterless',
  absolutePath: '/Users/ral/Documents/projects/overmind/projects/bitterless',
  url: null,
  configuredBranch: 'dev/next',
  branch: 'dev/next',
  commit: 'a1b2c3d',
  state: 'ok',
  errorCode: null,
  ...overrides
});

test('the row title is the submodule directory name, never the declared path', () => {
  assert.equal(submoduleDisplayName(entry({})), 'bitterless');
  assert.equal(
    submoduleDisplayName(
      entry({ name: 'projects/ai-scribe-eval-pipeline', path: 'projects/ai-scribe-eval-pipeline' })
    ),
    'ai-scribe-eval-pipeline'
  );
  // A nested or trailing-slash path still resolves to the leaf directory.
  assert.equal(submoduleDisplayName(entry({ path: 'projects/micromeet/mono/' })), 'mono');
  assert.equal(submoduleDisplayName(entry({ path: 'rig' })), 'rig');
  // A path-less section falls back to the section name so the row is never blank.
  assert.equal(submoduleDisplayName(entry({ path: '', name: 'projects/rig' })), 'rig');
});

test('the row renders the directory name as title and the declared path as subtitle', () => {
  const row = read('src/renderer/submodules/src/components/SubmoduleRow/SubmoduleRow.vue');
  assert.match(row, /class="submodule-row__name">\{\{ displayName \}\}/);
  assert.match(row, /class="submodule-row__path">\{\{ entry\.path \}\}/);
  assert.match(
    row,
    /const displayName = computed\(\(\) => submoduleDisplayName\(props\.entry\)\);/
  );
  assert.doesNotMatch(row, /submodule-row__name">\{\{ entry\.name \}\}/);
});

test('a row carries no border, no state dot, and no hover tint', () => {
  const row = read('src/renderer/submodules/src/components/SubmoduleRow/SubmoduleRow.vue');
  const style = read('src/renderer/submodules/src/components/SubmoduleRow/SubmoduleRow.less');

  assert.doesNotMatch(row, /state-dot/);
  assert.doesNotMatch(style, /state-dot/);
  // Owner decision 2026-08-20: the row itself never reacts to hover; only the action button does.
  assert.doesNotMatch(style, /\.submodule-row:hover/);

  // Only nested elements (the branch tag) may keep a border; no `.submodule-row` state may.
  for (const selector of [
    '.submodule-row {',
    '.submodule-row--missing,\n.submodule-row--error {'
  ]) {
    const start = style.indexOf(selector);
    assert.notEqual(start, -1, `${selector} must exist`);
    const block = style.slice(start, style.indexOf('}', start));
    assert.doesNotMatch(block, /border(-color)?:/, `${selector} must declare no border`);
  }
});

test('line one carries name plus branch and action, line two carries path plus warnings', () => {
  const row = read('src/renderer/submodules/src/components/SubmoduleRow/SubmoduleRow.vue');
  const primary = row.slice(
    row.indexOf('name="submodules__row__primary"'),
    row.indexOf('name="submodules__row__secondary"')
  );
  const secondary = row.slice(
    row.indexOf('name="submodules__row__secondary"'),
    row.indexOf('</template>')
  );

  for (const marker of [
    'submodule-row__name',
    'submodule-row__branch-tag',
    'submodule-row__open'
  ]) {
    assert.match(primary, new RegExp(marker), `line one must carry ${marker}`);
  }
  assert.doesNotMatch(primary, /submodule-row__mismatch|submodule-row__path/);

  for (const marker of ['submodule-row__path', 'submodule-row__mismatch', 'entry-error']) {
    assert.match(secondary, new RegExp(marker), `line two must carry ${marker}`);
  }
  assert.doesNotMatch(secondary, /submodule-row__branch-tag|submodule-row__open/);
});

test('Open in WebStorm is an icon-only IconBtn that keeps its accessible name', () => {
  const row = read('src/renderer/submodules/src/components/SubmoduleRow/SubmoduleRow.vue');
  assert.match(row, /import IconBtn from '@renderer\/common\/components\/IconBtn\/IconBtn\.vue';/);
  // The row now opens with the expand/collapse chevron, so the Open action is located by its name.
  const openStart = row.lastIndexOf('<IconBtn', row.indexOf('submodules__row__openInWebStorm'));
  const button = row.slice(openStart, row.indexOf('</IconBtn>', openStart));
  assert.match(button, /:title="i18nHelper\.submodules\.actions\.openInWebStorm"/);
  assert.match(button, /:aria-label="i18nHelper\.submodules\.actions\.openInWebStorm"/);
  assert.match(button, /<IconExternalLink :size="16" \/>/);
  // The label must not render as button text any more.
  assert.doesNotMatch(button, /\{\{ i18nHelper\.submodules\.actions\.openInWebStorm \}\}/);
});
