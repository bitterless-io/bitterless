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
  assert.match(store, /this\.snapshot\?\.bridge\.state !== 'not_installed'/);
  assert.match(store, /await this\.refreshCodexBridgeStatus\(\)/);
  assert.match(store, /if \(this\.activationPromise\) return await this\.activationPromise/);
});

test('relative thread times share one renderer-global reactive clock', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.vue');
  const globalStore = read('src/renderer/eyesOnAgents/src/store/global.store.ts');
  const threadCard = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );

  assert.match(globalStore, /currentTime = Date\.now\(\)/);
  assert.match(globalStore, /private currentTimeTimer: number \| null = null/);
  assert.match(globalStore, /startCurrentTimeLoop\(\): void/);
  assert.match(globalStore, /this\.currentTime = Date\.now\(\)/);
  assert.match(globalStore, /if \(this\.currentTimeTimer !== null\) return/);
  assert.match(globalStore, /window\.setInterval\([\s\S]*?10_000\)/);
  assert.match(globalStore, /stopCurrentTimeLoop\(\): void/);
  assert.match(globalStore, /window\.clearInterval\(this\.currentTimeTimer\)/);
  assert.match(globalStore, /this\.currentTimeTimer = null/);
  assert.match(globalStore, /reactive\(new GlobalState\(\)\)/);

  assert.match(app, /globalStore\.startCurrentTimeLoop\(\)/);
  assert.match(app, /globalStore\.stopCurrentTimeLoop\(\)/);

  assert.match(
    threadCard,
    /props\.thread\.lastActivityAt \?\? props\.thread\.lastCompletedAt/
  );
  assert.match(threadCard, /globalStore\.currentTime - timestamp/);
  assert.doesNotMatch(threadCard, /Date\.now\(\)|setInterval\(|clearInterval\(/);
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
  assert.match(domainTitleInput, /min-width: 40px/);
  assert.match(domainTitleInput, /max-width: 200px/);
  assert.match(domainTitleInput, /border: 0/);
  assert.match(domainTitleInput, /box-shadow: 0 0 0 1px/);
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

test('thread cards use compact title and action rows with accessible status marks', () => {
  const component = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.doesNotMatch(
    component,
    /thread-card__(?:signal|source|status-row|runtime|new-badge|meta|path)|displayPath/
  );
  assert.doesNotMatch(component, /thread-card--|\{\{\s*runtimeLabel\s*\}\}/);
  assert.doesNotMatch(component, /sourceLabel|sourceInitial|sourceTooltip/);
  assert.doesNotMatch(
    styles,
    /thread-card__(?:signal|source|status-row|runtime|new-badge|meta|path)|thread-signal-pulse/
  );

  assert.match(component, /:aria-label="`\$\{displayTitle\}, \$\{runtimeLabel\}`"/);
  assert.match(component, /@dblclick="handleDoubleClick"/);
  assert.match(component, /@keydown\.enter\.prevent="handleOpen"/);
  assert.match(component, /eyesOnAgentsStore\.openThread\(props\.thread\.threadId\)/);
  assert.match(
    component,
    /v-if="thread\.runtimeState === 'working'"[\s\S]*?class="thread-card__working"[\s\S]*?role="status"[\s\S]*?:aria-label="runtimeLabel"[\s\S]*?<a-spin :size="12"/
  );
  assert.equal((component.match(/<a-spin/g) ?? []).length, 1);

  const cardShell = cssRule(styles, '.thread-card');
  assert.doesNotMatch(cardShell, /min-height/);
  assert.doesNotMatch(cardShell, /(?:^|\n)\s*height\s*:/);
  const cardContent = cssRule(styles, '.thread-card__content');
  assert.match(cardContent, /gap: 4px/);
  assert.match(cardContent, /padding: 8px/);
  const cardTitle = cssRule(styles, '.thread-card__title');
  assert.match(cardTitle, /line-height: 18px/);
  assert.match(cardTitle, /min-height: 18px/);
  assert.match(cardTitle, /max-height: 36px/);
  assert.match(cardTitle, /overflow: hidden/);
  assert.match(cardTitle, /overflow-wrap: anywhere/);
  assert.match(cardTitle, /-webkit-line-clamp: 2/);
  assert.doesNotMatch(cardTitle, /line-height: 1\.35|min-height: (?:34|36)px/);
  assert.doesNotMatch(cardTitle, /(?:^|\n)\s*height\s*:\s*36px/);

  assert.match(
    component,
    /<div class="thread-card__actions">\s*<span class="thread-card__time">[\s\S]*?<div class="thread-card__controls"[\s\S]*?class="thread-card__folder"[\s\S]*?class="thread-card__open-control thread-card__control"[\s\S]*?<a-dropdown/
  );
  const cardActions = cssRule(styles, '.thread-card__actions');
  assert.match(cardActions, /justify-content: space-between/);

  assert.match(
    component,
    /<a-tooltip v-if="thread\.cwd" :content="folderLabel"[\s\S]*?:title="folderLabel"[\s\S]*?:aria-label="folderLabel"[\s\S]*?<IconFolder :size="10" aria-hidden="true"/
  );
  assert.match(
    component,
    /thread\.workingDirectory[\s\S]*?\.replace\('\{path\}', props\.thread\.cwd \?\? ''\)/
  );
  assert.match(english, /workingDirectory: 'Working directory: \{path\}'/);
  assert.match(chinese, /workingDirectory: '工作目录：\{path\}'/);

  const openAction = component.match(
    /<a-tooltip :content="i18nHelper\.eyesOnAgents\.actions\.open"[\s\S]*?<a-button[\s\S]*?<\/a-button>[\s\S]*?<\/a-tooltip>/
  );
  assert.ok(openAction, 'Missing localized Open tooltip and button');
  assert.match(openAction[0], /:title="i18nHelper\.eyesOnAgents\.actions\.open"/);
  assert.match(openAction[0], /:aria-label="openAriaLabel"/);
  assert.match(openAction[0], /:loading="eyesOnAgentsStore\.openingThreadIds\.has\(thread\.threadId\)"/);
  assert.match(openAction[0], /:disabled="eyesOnAgentsStore\.openingThreadIds\.has\(thread\.threadId\)"/);
  assert.match(openAction[0], /@click\.stop="handleOpen"/);
  assert.match(openAction[0], /<template #icon><IconExternalLink :size="9" \/><\/template>/);
  assert.doesNotMatch(
    openAction[0],
    /\{\{\s*i18nHelper\.eyesOnAgents\.actions\.open\s*\}\}/
  );
  assert.match(
    component,
    /const showUnreadDot = computed\(\(\) =>\s*props\.thread\.isUnread && props\.thread\.runtimeState === 'idle'\);/
  );
  assert.match(
    component,
    /const openAriaLabel = computed\(\(\) => showUnreadDot\.value[\s\S]*?actions\.open[\s\S]*?thread\.new/
  );
  assert.equal((component.match(/eyesOnAgents\.thread\.new/g) ?? []).length, 1);
  assert.doesNotMatch(component, /v-if\s*=\s*["']thread\.isUnread["']/);
  assert.match(
    component,
    /v-if="showUnreadDot"\s+class="thread-card__unread-dot"\s+aria-hidden="true"/
  );
  const unreadDot = cssRule(styles, '.thread-card__unread-dot');
  assert.match(unreadDot, /position: absolute/);
  assert.match(unreadDot, /background: #ef4444/);

  assert.match(
    component,
    /:aria-label="i18nHelper\.eyesOnAgents\.actions\.more"[\s\S]*?<IconDots :size="12" \/>/
  );
  const folderBox = cssRule(styles, '.thread-card__folder');
  assert.match(folderBox, /width: 20px/);
  assert.match(folderBox, /height: 20px/);
  const actionButtons = cssRule(
    styles,
    '.thread-card__controls .arco-btn-size-mini.arco-btn-only-icon'
  );
  assert.match(actionButtons, /width: 20px/);
  assert.match(actionButtons, /height: 20px/);

  assert.match(component, /closest\('\.thread-card__control'\)/);
  assert.doesNotMatch(component, /closest\('\.thread-card__actions'\)/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.thread-card__working \.arco-icon-loading\s*\{[\s\S]*?animation: none/
  );
});

test('All projects every thread while Focus and custom Domains retain their scopes', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const projectFilter = read(
    'src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.vue'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(board, /:threads="eyesOnAgentsStore\.focusThreads"/);
  assert.match(board, /:title="i18nHelper\.eyesOnAgents\.board\.all"/);
  assert.match(board, /:threads="eyesOnAgentsStore\.filteredAllThreads"/);
  assert.doesNotMatch(board, /total-count|totalCount/);
  assert.match(board, /:threads="eyesOnAgentsStore\.threadsForDomain\(element\.id\)"/);
  assert.match(store, /get allThreads\(\): EyesOnAgentsThread\[\] \{\s*return sortThreads\(this\.threads\);/);
  assert.match(store, /buildEyesOnAgentsProjectFilterOptions\(\s*this\.allThreads,/);
  assert.match(store, /filterEyesOnAgentsThreadsByProject\(\s*this\.allThreads,/);
  assert.doesNotMatch(store, /uncategorizedProjectFilter|filteredUncategorizedThreads|uncategorizedThreads/);
  assert.match(domain, /<ProjectFilter v-if="projectFilter"/);
  assert.match(projectFilter, /<label name="eyesOnAgents__projectFilter"/);
  assert.match(projectFilter, /class="project-filter__label"/);
  assert.match(projectFilter, /allow-search/);
  assert.match(projectFilter, /eyesOnAgentsStore\.allProjectFilterValue/);
  assert.match(projectFilter, /eyesOnAgentsStore\.allProjectOptions/);
  assert.match(projectFilter, /selectAllProjectFilter/);
  assert.match(projectFilter, /class="project-filter__count">\{\{ option\.count \}\}/);
  assert.match(projectFilter, /`\$\{optionLabel\(option\)\} \(\$\{option\.count\}\)`/);
  assert.match(english, /all: 'All'/);
  assert.match(chinese, /all: 'All'/);
  assert.match(chinese, /allProjects: 'All'/);
  assert.match(english, /projectFilterLabel: 'Filter All by Project'/);
  assert.match(chinese, /projectFilterLabel: '按 Project 筛选 All'/);
  assert.match(english, /noProject: 'No project'/);
  assert.match(chinese, /noProject: '无 Project'/);
});

test('Domain headers cannot restore counts or their obsolete height', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');
  const rendererSource = walk('src/renderer/eyesOnAgents')
    .filter((path) => /\.(vue|less|ts|html)$/.test(path))
    .map(read)
    .join('\n');

  assert.doesNotMatch(rendererSource, /agent-domain__count/);
  assert.doesNotMatch(board, /:total-count=|totalCount/);
  assert.doesNotMatch(domain, /agent-domain__count|countLabel|totalCount/);
  assert.doesNotMatch(styles, /agent-domain__count|min-height:\s*57px/);
  assert.doesNotMatch(
    english,
    /signals: '\{count\} signals'|filteredThreads:|threads: '\{count\} threads'/
  );
  assert.doesNotMatch(
    chinese,
    /signals: '\{count\} 个信号'|filteredThreads:|threads: '\{count\} 个任务'/
  );
});

test('Domain board wraps one draggable list and uses clone-only fixed projections', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const boardStyles = read(
    'src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.less'
  );
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const domainStyles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const addDomainStyles = read(
    'src/renderer/eyesOnAgents/src/components/AddDomainColumn/AddDomainColumn.less'
  );

  assert.equal((board.match(/<draggable/g) ?? []).length, 1);
  assert.match(board, /<template #header>[\s\S]*eyesOnAgents__focusColumn[\s\S]*eyesOnAgents__allColumn[\s\S]*<template #item/);
  assert.match(board, /<template #footer>[\s\S]*<AddDomainColumn \/>/);
  assert.doesNotMatch(board, /direction="horizontal"|scrollToFocus|showJumpToFocus|IconArrowLeft/);
  assert.match(board, /oldDraggableIndex\?: number/);
  assert.match(board, /newDraggableIndex\?: number/);
  assert.match(board, /reorderCustomDomains\(event\.oldDraggableIndex, event\.newDraggableIndex\)/);
  assert.doesNotMatch(board, /event\.oldIndex|event\.newIndex/);
  const boardShell = cssRule(boardStyles, '.agent-board');
  assert.match(boardShell, /overflow-x: hidden/);
  assert.match(boardShell, /overflow-y: auto/);
  assert.match(boardStyles, /\.agent-board__columns\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
  assert.doesNotMatch(boardStyles, /display:\s*contents|overflow-x:\s*auto/);

  assert.match(domain, /props\.focus \|\| props\.all[\s\S]*pull: 'clone', put: false/);
  assert.match(domain, /:sort="!focus && !all"/);
  assert.match(domainStyles, /\.agent-domain\s*\{[^}]*max-height: 600px;/);
  const domainBody = cssRule(domainStyles, '.agent-domain__body');
  assert.match(domainBody, /overflow-y: auto/);
  assert.match(domainBody, /padding: 0 9px 9px/);
  assert.doesNotMatch(domainBody, /padding:\s*9px\s*;/);
  assert.doesNotMatch(addDomainStyles, /height:\s*100%/);
});

test('custom Domain titles edit on click with Todo-sized inputs and no Rename menu item', () => {
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const domainStyles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const addDomain = read(
    'src/renderer/eyesOnAgents/src/components/AddDomainColumn/AddDomainColumn.vue'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(domain, /v-else-if="canManage"[\s\S]*@click\.stop="beginRename"/);
  assert.match(domain, /ref="titleSizerRef" class="agent-domain__title-sizer"/);
  assert.match(domain, /:style="\{ width: `\$\{inputWidth\}px` \}"/);
  assert.match(domain, /offsetWidth \?\? 0\) \+ 8/);
  assert.match(domain, /Math\.min\(Math\.max\(measured, 40\), 200\)/);
  assert.match(domain, /@blur="commitRename"/);
  assert.match(domain, /@keydown\.enter\.prevent="blurTitleInput"/);
  assert.match(domain, /@keydown\.esc\.prevent\.stop="cancelRename"/);
  assert.match(domain, /value\.toLocaleLowerCase\(\) === 'all'/);
  assert.match(addDomain, /normalizedTitle\.value\.toLocaleLowerCase\(\) === 'all'/);
  assert.doesNotMatch(domain, /IconPencil|actions\.rename/);
  assert.doesNotMatch(english, /rename: 'Rename'|renameTitle:/);
  assert.doesNotMatch(chinese, /rename: '重命名'|renameTitle:/);
  assert.match(domainStyles, /\.agent-domain__title-sizer\s*\{[^}]*visibility: hidden;/);
  assert.match(domainStyles, /\.agent-domain__title-input\s*\{[^}]*min-width: 40px;[^}]*max-width: 200px;/);
});

test('connection panel presents independent Codex observation onboarding and review', () => {
  const panel = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(panel, /const canEnableBridge = computed\(\(\) => bridgeState\.value === 'not_installed'\)/);
  assert.match(panel, /const canRepairBridge = computed\(\(\) => bridgeState\.value === 'drifted'\)/);
  assert.match(panel, /bridgeState\.value === 'needs_trust' \|\| bridgeState\.value === 'error'/);
  assert.match(panel, /eyesOnAgentsStore\.reviewCodexBridge\(\)/);
  assert.match(panel, /eyesOnAgentsStore\.refreshCodexBridgeStatus\(\)/);
  assert.match(panel, /bridgeReviewReason\.value === 'disabled'/);
  assert.match(panel, /bridge\.value\?\.listening[\s\S]*observing[\s\S]*installedPaused/);
  assert.match(panel, /lastInspectedAt/);
  assert.match(panel, /lastEventAt/);
  assert.doesNotMatch(panel, /!canDisconnect\.value/);
  assert.match(menuBar, /case 'needs_trust'/);
  assert.match(english, /Global Codex observation/);
  assert.match(english, /Installed, paused/);
  assert.match(english, /Review in Codex/);
  assert.match(english, /Re-enable and review/);
  assert.match(english, /Check again/);
  assert.match(english, /Codex Settings → Hooks[\s\S]*\/hooks/);
  assert.match(chinese, /全局 Codex 观测/);
  assert.match(chinese, /已安装，监听暂停/);
  assert.match(chinese, /在 Codex 中审核/);
  assert.match(chinese, /重新启用并审核/);
  assert.match(chinese, /再次检查/);
  assert.match(chinese, /Codex 设置 → Hooks[\s\S]*\/hooks/);
  assert.doesNotMatch(english, /Managed by Connect/);
  assert.doesNotMatch(chinese, /由“连接”统一管理/);
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
