import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const walk = (directory) => readdirSync(join(root, directory)).flatMap((entry) => {
  const relative = join(directory, entry);
  return statSync(join(root, relative)).isDirectory() ? walk(relative) : [relative];
});
const cssRule = (source, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
};

test('EyesOnAgents is a standalone Mini App, not a Home route', () => {
  const config = read('electron.vite.config.ts');
  const miniApps = read('src/renderer/home/src/views/miniApp/miniApps.constant.ts');
  const routes = read('src/renderer/home/src/router/defaultRoutes.ts');

  assert.match(config, /eyesOnAgents: resolve\('src\/preload\/eyesOnAgents\/eyesOnAgents\.preload\.ts'\)/);
  assert.match(config, /eyesOnAgents: resolve\('src\/renderer\/eyesOnAgents\/index\.html'\)/);
  assert.match(miniApps, /id: 'eyes-on-agents'/);
  assert.doesNotMatch(routes, /coding-agents|codingAgentSessions/);
});

test('window contract enforces singleton-safe paths and minimum size', () => {
  const source = read('src/main/xpc/eyesOnAgentsWindow.handler.ts');

  assert.match(source, /creationPromise: Promise<BrowserWindow> \| null/);
  assert.match(source, /minWidth: 800/);
  assert.match(source, /minHeight: 600/);
  assert.match(source, /width: savedLayout\?\.width \?\? 1120/);
  assert.match(source, /renderer', 'eyesOnAgents', 'index\.html'/);
  assert.match(source, /preload', 'eyesOnAgents\.js'/);
  assert.match(source, /_destroyForAuth\(\)/);
});

test('window activation refreshes thread discovery without leaking its listener', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.vue');
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');

  assert.match(app, /window\.addEventListener\('focus', handleWindowFocus\)/);
  assert.match(app, /window\.removeEventListener\('focus', handleWindowFocus\)/);
  assert.match(app, /eyesOnAgentsStore\.refreshOnWindowActivation\(\)/);
  assert.match(store, /async refreshOnWindowActivation\(\): Promise<void>/);
  assert.match(store, /connection\?\.state === 'connected'/);
  assert.match(store, /connection\?\.autoConnectEnabled/);
  assert.match(store, /await this\.loadSnapshot\(true\)/);
});

test('observation board exposes stable regions and reduced motion', () => {
  const rendererFiles = walk('src/renderer/eyesOnAgents');
  const source = rendererFiles
    .filter((path) => /\.(vue|less|ts|html)$/.test(path))
    .map(read)
    .join('\n');

  assert.match(source, /name="eyesOnAgents__board"/);
  assert.match(source, /name="eyesOnAgents__focusColumn"/);
  assert.match(source, /name="eyesOnAgents__domainColumn"/);
  assert.match(source, /name="eyesOnAgents__threadCard"/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /pull: 'clone', put: false/);
  assert.match(source, /eyesOnAgentsEmitter\.moveThread/);
  assert.doesNotMatch(source, /Claude|claude/);
});

test('observation surfaces use Todo-style background hierarchy without decorative borders', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.less');
  const domain = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const thread = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less'
  );
  const addDomain = read(
    'src/renderer/eyesOnAgents/src/components/AddDomainColumn/AddDomainColumn.less'
  );
  const projectFilter = read(
    'src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.less'
  );

  assert.match(app, /--eyes-canvas: oklch\(0\.985 0 0\)/);
  assert.match(app, /--eyes-column: oklch\(0\.96 0 0\)/);
  assert.match(app, /--eyes-column-focus: oklch\(0\.94 0\.04 60\)/);
  assert.match(app, /--eyes-item: oklch\(1 0 0\)/);

  const domainShell = cssRule(domain, '.agent-domain');
  assert.match(domainShell, /background: var\(--eyes-column\)/);
  assert.doesNotMatch(domainShell, /\bborder\s*:/);
  assert.doesNotMatch(domainShell, /box-shadow/);

  const focusDomain = cssRule(domain, '.agent-domain--focus');
  assert.match(focusDomain, /background: var\(--eyes-column-focus\)/);
  assert.doesNotMatch(focusDomain, /border-color|box-shadow/);

  const domainHeader = cssRule(domain, '.agent-domain__header');
  assert.match(domainHeader, /background: transparent/);
  assert.doesNotMatch(domainHeader, /border-bottom|box-shadow/);

  const domainTitleInput = cssRule(domain, '.agent-domain__title-input');
  assert.match(domainTitleInput, /border: 1px solid/);
  const domainTitleFocus = cssRule(domain, '.agent-domain__title-input:focus-visible');
  assert.match(domainTitleFocus, /outline: 2px solid var\(--eyes-focus-ring\)/);

  const threadCard = cssRule(thread, '.thread-card');
  assert.match(threadCard, /background: var\(--eyes-item\)/);
  assert.doesNotMatch(threadCard, /\bborder\s*:/);
  assert.doesNotMatch(threadCard, /\bbox-shadow\s*:|\btransform\s*:/);

  const threadHover = cssRule(thread, '.thread-card:hover');
  assert.match(threadHover, /box-shadow: 0 1px 4px/);
  assert.doesNotMatch(threadHover, /\btransform\s*:/);

  const threadFocus = cssRule(thread, '.thread-card:focus-visible');
  assert.match(threadFocus, /outline: 2px solid var\(--eyes-focus-ring\)/);
  assert.match(threadFocus, /outline-offset: 2px/);

  const threadSource = cssRule(thread, '.thread-card__source');
  assert.doesNotMatch(threadSource, /\bborder\s*:/);
  const signalDot = cssRule(thread, '.thread-card__signal-dot');
  assert.match(signalDot, /border: 2px solid #fff/);

  assert.doesNotMatch(addDomain, /border:\s*1px\s+dashed|\bdashed\b/);
  assert.match(
    addDomain,
    /\.add-domain-column__button,\s*\.add-domain-column__form\s*\{[^}]*border: 0;[^}]*background: var\(--eyes-column\)/
  );
  const addDomainFocus = cssRule(addDomain, '.add-domain-column__button:focus-visible');
  assert.match(addDomainFocus, /outline: 2px solid var\(--eyes-focus-ring\)/);
  assert.match(addDomainFocus, /outline-offset: 2px/);

  const projectSelect = cssRule(projectFilter, '.project-filter__select.arco-select-view');
  assert.match(projectSelect, /border: 0/);
  assert.match(projectSelect, /background: oklch/);
  const projectSelectFocus = cssRule(
    projectFilter,
    '.project-filter__select.arco-select-view:focus-within'
  );
  assert.match(projectSelectFocus, /outline: 2px solid var\(--eyes-focus-ring\)/);
});

test('Project filtering is scoped only to Uncategorized', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const projectFilter = read(
    'src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.vue'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(board, /:threads="eyesOnAgentsStore\.focusThreads"/);
  assert.match(board, /:threads="eyesOnAgentsStore\.filteredUncategorizedThreads"/);
  assert.match(board, /:threads="eyesOnAgentsStore\.threadsForDomain\(element\.id\)"/);
  assert.match(domain, /<ProjectFilter v-if="projectFilter"/);
  assert.match(projectFilter, /<label name="eyesOnAgents__projectFilter"/);
  assert.match(projectFilter, /class="project-filter__label"/);
  assert.match(projectFilter, /allow-search/);
  assert.match(english, /noProject: 'No project'/);
  assert.match(chinese, /noProject: '无 Project'/);
});

test('connection panel presents Connect-managed bridge trust and safe cleanup', () => {
  const panel = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(panel, /bridgeState === 'needs_trust'/);
  assert.match(panel, /eyesOnAgents\.bridge\.trustReview/);
  assert.match(panel, /!canDisconnect\.value &&[\s\S]*'installed', 'needs_trust', 'drifted'/);
  assert.match(menuBar, /case 'needs_trust'/);
  assert.match(english, /Managed by Connect/);
  assert.match(english, /open \/hooks and approve or enable the four Bitterless hooks[\s\S]*Refresh/);
  assert.match(chinese, /打开 \/hooks，批准或启用 4 条 Bitterless hooks[\s\S]*刷新/);
});

test('header Refresh is visible and can recover disconnected or error state', () => {
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(menuBar, /name="eyesOnAgents__menuBar__refresh"/);
  assert.match(menuBar, /\{\{ i18nHelper\.eyesOnAgents\.actions\.refresh \}\}/);
  assert.match(menuBar, /const canRefresh = computed\([\s\S]*connectionState\.value !== 'connecting'[\s\S]*connectionState\.value !== 'syncing'/);
  assert.doesNotMatch(menuBar, /connectionState\.value === 'connected' && !eyesOnAgentsStore\.busyAction/);
  assert.match(menuBar, /handleRefresh[\s\S]*eyesOnAgentsStore\.syncThreads\(\)/);
  assert.match(english, /refresh: 'Refresh'/);
  assert.match(chinese, /refresh: '刷新'/);
});
