/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const menuSource = source('src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue');
const menuStyleSource = source('src/renderer/maestro/home/src/components/MenuBar/MenuBar.less');
const iconBtnStyleSource = source('src/renderer/common/components/IconBtn/IconBtn.less');

const requireMatch = (value, pattern, message) => {
  const match = value.match(pattern);
  assert.ok(match, message);
  return match[0];
};

test('tab close and New-tab actions use the shared IconBtn with Tabler glyphs', () => {
  assert.match(
    menuSource,
    /import IconBtn from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/common\/components\/IconBtn\/IconBtn\.vue'/
  );
  assert.match(
    menuSource,
    /import \{[\s\S]*?IconPlus,[\s\S]*?IconX[\s\S]*?\} from '@tabler\/icons-vue'/
  );

  const closeAction = requireMatch(
    menuSource,
    /<IconBtn\s+v-if="!tab\.pinned && tabStore\.tabs\.length > 1"[\s\S]*?<\/IconBtn>/,
    'tab close action must use IconBtn'
  );
  assert.match(closeAction, /class="maestro-menu-bar__tab-close"/);
  assert.match(closeAction, /@click\.stop="onCloseClick\(\$event, tab\.id\)"/);
  assert.match(closeAction, /@dragstart\.stop\.prevent/);
  assert.match(closeAction, /<IconX :size="14" stroke="2" aria-hidden="true" \/>/);

  const newTabAction = requireMatch(
    menuSource,
    /<IconBtn\s+class="maestro-menu-bar__new-tab"[\s\S]*?<\/IconBtn>/,
    'New-tab action must use IconBtn'
  );
  assert.match(newTabAction, /@click="tabStore\.newTab\(\)"/);
  assert.match(newTabAction, /<IconPlus :size="16" stroke="2" aria-hidden="true" \/>/);

  assert.doesNotMatch(menuSource, /×/);
  assert.doesNotMatch(menuSource, /<button[^>]*class="maestro-menu-bar__(?:tab-close|new-tab)"/);
});

test('scoped IconBtn overrides retain exact tab-action geometry and visibility', () => {
  const closeStyle = requireMatch(
    menuStyleSource,
    /\.maestro-menu-bar__tab-close\.icon-btn\.arco-btn \{[\s\S]*?\n\}/,
    'missing high-specificity close IconBtn style'
  );
  assert.match(closeStyle, /top: 4px;/);
  assert.match(closeStyle, /right: 4px;/);
  assert.match(closeStyle, /display: none;/);
  assert.match(closeStyle, /width: 20px;/);
  assert.match(closeStyle, /min-width: 20px;/);
  assert.match(closeStyle, /height: 20px;/);
  assert.match(closeStyle, /flex: 0 0 20px;/);
  assert.doesNotMatch(closeStyle, /translateY/);
  assert.match(
    menuStyleSource,
    /\.maestro-menu-bar__tab:hover \.maestro-menu-bar__tab-close\.icon-btn\.arco-btn,[\s\S]*?\.maestro-menu-bar__tab-close--active\.icon-btn\.arco-btn \{ display: inline-flex; \}/
  );

  const newTabStyle = requireMatch(
    menuStyleSource,
    /\.maestro-menu-bar__new-tab\.icon-btn\.arco-btn \{[^\n]*\}/,
    'missing high-specificity New-tab IconBtn style'
  );
  assert.match(newTabStyle, /width: 28px;/);
  assert.match(newTabStyle, /min-width: 28px;/);
  assert.match(newTabStyle, /height: 28px;/);
  assert.match(newTabStyle, /flex: 0 0 28px;/);
  assert.match(newTabStyle, /border-radius: 999px;/);
});

test('shared IconBtn owns glyph centering, pressed scale, and keyboard focus', () => {
  assert.match(
    iconBtnStyleSource,
    /\.icon-btn\.arco-btn \.arco-btn-icon \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/
  );
  assert.match(
    iconBtnStyleSource,
    /\.icon-btn\.arco-btn:active \{[\s\S]*?transform: scale\(0\.95\);/
  );
  assert.match(iconBtnStyleSource, /\.icon-btn\.arco-btn:focus-visible \{/);
  assert.doesNotMatch(menuStyleSource, /\.maestro-menu-bar__(?:tab-close|new-tab):active/);
});
