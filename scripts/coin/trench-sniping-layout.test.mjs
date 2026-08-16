/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sourceFiles = (path) => readdirSync(resolve(root, path), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory()
    ? sourceFiles(`${path}/${entry.name}`)
    : [`${path}/${entry.name}`]);
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
};
const objectKeys = (source, marker) => [
  ...section(source, marker, '} as const;').matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm),
].map((match) => match[1]);

const BRIDGE_METHODS = [
  'listComponents',
  'listConfigs',
  'getConfig',
  'validateConfig',
  'saveConfig',
  'startMonitoring',
  'stopMonitoring',
  'listRuntimes',
  'listSimulationEvents',
  'requestExactSimulation',
  'listExactSimulations',
  'requestShadowSimulation',
  'listShadowSimulations',
  'listActivity',
];

test('Coin exposes exactly fourteen fixed typed Sniping methods through one frozen preload bridge', () => {
  const shared = read('src/shared/sniping/snipingBridge.type.ts');
  const preload = read('src/preload/trench/trench.preload.ts');
  const renderer = read('src/renderer/coin/src/contextBridge/sniping.bridge.ts');
  const ipc = read('src/main/sniping/snipingIpc.service.ts');
  const channelKeys = objectKeys(shared, 'export const SNIPING_IPC_CHANNELS = {');
  const interfaceBody = section(shared, 'export interface SnipingBridge {', '\n}');
  const interfaceMethods = [...interfaceBody.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\(/gm)]
    .map((match) => match[1]);
  const preloadBody = section(preload, 'const snipingBridge = Object.freeze<SnipingBridge>({', '\n});');
  const preloadMethods = [...preloadBody.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)]
    .map((match) => match[1]);

  assert.deepEqual(channelKeys, BRIDGE_METHODS);
  assert.deepEqual(interfaceMethods, BRIDGE_METHODS);
  assert.deepEqual(preloadMethods, BRIDGE_METHODS);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('sniping', snipingBridge\)/);
  assert.equal((preload.match(/exposeInMainWorld\('sniping'/g) ?? []).length, 1);
  for (const method of BRIDGE_METHODS) {
    assert.equal(
      (ipc.match(new RegExp(`trenchHandle\\(SNIPING_IPC_CHANNELS\\.${method}\\b`, 'g')) ?? []).length,
      1,
      `${method} must have exactly one guarded IPC handler`,
    );
  }
  assert.equal(renderer.trim(), [
    "import type { SnipingBridge } from '@shared/sniping/snipingBridge.type';",
    '',
    'export const snipingBridge = window.sniping as SnipingBridge;',
  ].join('\n'));
});

test('the renderer boundary is credential-free and cannot ask Main for URL, headers or execution', () => {
  const preload = read('src/preload/trench/trench.preload.ts');
  const shared = read('src/shared/sniping/snipingBridge.type.ts');
  const env = read('src/renderer/coin/src/env.d.ts');
  const contextBridge = read('src/renderer/coin/src/contextBridge/sniping.bridge.ts');
  const preloadBody = section(preload, 'const snipingBridge = Object.freeze<SnipingBridge>({', '\n});');
  const bridgeInterface = section(shared, 'export interface SnipingBridge {', '\n}');
  const rendererBoundary = `${env}\n${contextBridge}`;

  assert.doesNotMatch(rendererBoundary, /\b(?:ipcRenderer|fetch|XMLHttpRequest|axios|coreToken|customerJwt)\b/i);
  assert.doesNotMatch(preloadBody, /\b(?:url|uri|headers?|authorization|coreToken|customerJwt|privateKey|mnemonic|calldata|signature|database)\b/i);
  assert.doesNotMatch(bridgeInterface, /\b(?:execution|canary|armProduct|disarm|sign|broadcast|trade|activityDetail|setDesiredState|requestUrl)\b/i);
  assert.match(env, /readonly sniping: SnipingBridge/);
  assert.doesNotMatch(env, /snipingSession|coreToken|customerJwt/);

  const coinHtml = read('src/renderer/coin/index.html');
  assert.match(coinHtml, /connect-src 'none'/);
  assert.doesNotMatch(coinHtml, /connect-src[^;]*(?:https?:|wss?:)/);
});

test('Main alone owns the fixed authenticated route table and exposes no execution route', () => {
  const relay = read('src/main/sniping/snipingRelay.client.ts');
  const routes = objectKeys(relay, 'export const SNIPING_CORE_ROUTES = {');
  assert.deepEqual(routes, [
    'listComponents', 'listConfigs', 'getConfig', 'validateConfig', 'saveConfig',
    'setDesiredState', 'listRuntimes', 'listSimulationEvents', 'requestExactSimulation',
    'listExactSimulations', 'requestShadowSimulation', 'listShadowSimulations', 'listActivity',
  ]);
  for (const path of [
    '/sniping/components', '/sniping/config/list', '/sniping/config/detail',
    '/sniping/config/validate', '/sniping/config/save', '/sniping/config/set-desired-state',
    '/sniping/runtime/list', '/sniping/simulation/event/list', '/sniping/simulation/request',
    '/sniping/simulation/list', '/sniping/shadow/request', '/sniping/shadow/list',
    '/sniping/activity/list',
  ]) assert.match(relay, new RegExp(`path: '${path.replaceAll('/', '\\/')}'`));
  assert.doesNotMatch(relay, /\/sniping\/(?:execution|canary|arm|trade|sign|broadcast)/i);
  assert.match(relay, /redirect: 'error'/);
  assert.match(relay, /const RESPONSE_LIMIT_BYTES = 1_048_576/);
  assert.match(relay, /\[TOKEN_HEADER\]: active\.token/);
});

test('Home session activation remains a two-method Main-memory boundary absent from Coin', () => {
  const shared = read('src/shared/sniping/snipingSession.type.ts');
  const homeBridge = read('src/renderer/home/src/contextBridge/snipingSession.bridge.ts');
  const homePreload = read('src/preload/home/home.preload.ts');
  const coinPreload = read('src/preload/trench/trench.preload.ts');
  assert.deepEqual(objectKeys(shared, 'export const SNIPING_SESSION_IPC_CHANNELS = {'), ['activate', 'clear']);
  assert.match(homeBridge, /SnipingSessionBridge/);
  assert.match(homeBridge, /globalThis as unknown as \{ snipingSession: SnipingSessionBridge \}/);
  assert.match(homePreload, /SNIPING_SESSION_IPC_CHANNELS\.activate/);
  assert.match(homePreload, /SNIPING_SESSION_IPC_CHANNELS\.clear/);
  assert.doesNotMatch(coinPreload, /SNIPING_SESSION_IPC_CHANNELS|coreToken|customerJwt/);
});

test('application shutdown fences the Sniping session before awaiting optional cleanup', () => {
  const main = read('src/main/app.main.ts');
  const cleanup = section(main, 'const cleanupResources =', 'const runLegacyMcpHelper');
  assert.ok(
    cleanup.indexOf('snipingSessionService.clearCurrent()') <
      cleanup.indexOf('await optionalIntegrationsLifecycle.fenceAndJoin()'),
    'Sniping request generations must abort before an optional integration can stall shutdown',
  );
});

test('Sniping sender targets and configuration actions remain exact and fail closed', () => {
  const guard = read('src/main/sniping/snipingSender.guard.ts');
  const mainWindow = read('src/main/windows/mainWindow.helper.ts');
  const config = read('src/renderer/coin/src/components/SnipingWorkspace/SnipingConfigurationPanel.vue');
  const styles = read('src/renderer/coin/src/components/SnipingWorkspace/SnipingWorkspace.less');
  assert.match(guard, /join\(appPath, 'out', 'renderer', renderer, 'index\.html'\)/);
  assert.match(guard, /actualUrl\.href === expectedUrl\.href/);
  assert.match(mainWindow, /webContents\.on\('will-navigate'/);
  assert.match(mainWindow, /webContents\.on\('will-redirect'/);
  assert.match(mainWindow, /matchesSnipingRendererTarget\(targetUrl, expectedHomeUrl\)/);
  assert.ok(
    config.indexOf('name="trench__sniping__save"') <
      config.indexOf('name="trench__sniping__validate"'),
    'mobile action order must remain Start/Stop, Save, Validate, Advanced',
  );
  assert.doesNotMatch(styles, /--trench-negative/);
  assert.match(styles, /stage--blocked[\s\S]*?--trench-danger/);
});

test('one Arco rail owns INDEX, Trenchers and Sniping in the specified order', () => {
  const app = read('src/renderer/coin/src/App.vue');
  const navigation = read(
    'src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue',
  );
  const store = read('src/renderer/coin/src/views/navigation/trenchNavigation.store.ts');
  const header = read('src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue');
  assert.equal((app.match(/<TrenchModuleNavigation\s*\/>/g) ?? []).length, 1);
  assert.match(app, /v-if="navigation\.module === 'index'"/);
  assert.match(app, /v-else-if="navigation\.module === 'trenchers'"/);
  assert.match(app, /<SnipingWorkspace v-else :scope="navigation\.snipingScope"\s*\/>/);
  assert.ok(navigation.indexOf('key="index"') < navigation.indexOf('key="trenchers"'));
  assert.ok(navigation.indexOf('key="trenchers"') < navigation.indexOf('key="sniping"'));
  assert.ok(navigation.indexOf('key="sniping:products"') < navigation.indexOf('key="sniping:activity"'));
  assert.match(navigation, /:default-open-keys="\['index', 'trenchers', 'sniping'\]"/);
  assert.match(store, /'sniping:products',[\s\S]*?'sniping:activity'/);
  assert.match(header, /snipingStore\.refreshWorkspace\(\)/);
  assert.match(header, /snipingStore\.refreshActivity\(\)/);
  const currentList = section(header, 'const currentList = computed', 'const analyzing = computed');
  const statusText = section(header, 'const statusText = computed', 'const refreshActiveModule');
  assert.match(currentList, /snipingStore\.productsErrorCode \? 'unavailable' : snipingStore\.phase/);
  assert.match(currentList, /snipingStore\.activityErrorCode \? 'unavailable' : 'ready'/);
  assert.match(statusText, /snipingStore\.productsErrorCode[\s\S]*?snipingStore\.activityErrorCode/);
  assert.doesNotMatch(`${currentList}\n${statusText}`, /snipingStore\.(?:currentErrorCode|surfaceErrors)/);
});

test('Canary, financial Armed and Twitter remain explanatory locks with no command surface', () => {
  const detail = read('src/renderer/coin/src/components/SnipingWorkspace/SnipingProductDetail.vue');
  const config = read('src/renderer/coin/src/components/SnipingWorkspace/SnipingConfigurationPanel.vue');
  const pane = read('src/renderer/coin/src/components/SnipingWorkspace/SnipingProductPane.vue');
  const simulation = read('src/renderer/coin/src/components/SnipingWorkspace/SnipingSimulationPanel.vue');
  const roadmap = section(pane, 'name="trench__sniping__roadmap"', '</section>');

  assert.match(detail, /qualification\.canaryLocked/);
  assert.match(detail, /qualification\.armedLocked/);
  assert.match(detail, /qualification\.executionUnavailable/);
  assert.doesNotMatch(detail, /@click="[^"]*(?:canary|arm|execute|trade)/i);
  assert.match(config, /store\.setMonitoring\(true\)/);
  assert.match(config, /store\.setMonitoring\(false\)/);
  assert.match(config, /:disabled="!store\.remoteReady \|\| store\.pendingAction !== null"/);
  assert.doesNotMatch(config, /setDesiredState|canary|armProduct|execute|trade|broadcast/i);
  assert.match(roadmap, /roadmap-twitter/);
  assert.match(roadmap, /twitterUnavailable/);
  assert.doesNotMatch(roadmap, /<a-button|@click|store\./);
  assert.match(simulation, /SIMULATED/);
  assert.doesNotMatch(simulation, /sign|broadcast|sendTransaction|allowance.*write/i);
});

test('Products and Activity preserve stable names, independent scroll and keyboard paths', () => {
  const componentRoot = 'src/renderer/coin/src/components/SnipingWorkspace';
  const files = sourceFiles(componentRoot).filter((path) => path.endsWith('.vue'));
  const allComponents = files.map(read).join('\n');
  const detail = read(`${componentRoot}/SnipingProductDetail.vue`);
  const activity = read(`${componentRoot}/SnipingActivityWorkspace.vue`);
  const styles = read(`${componentRoot}/SnipingWorkspace.less`);
  const narrowStyles = section(styles, '@media (max-width: 919px) {', '@media (max-width: 720px)');
  const appStyles = read('src/renderer/coin/src/App.less');
  const navigationStyles = read(
    'src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.less',
  );

  for (const name of [
    'trench__sniping', 'trench__sniping__product-pane', 'trench__sniping__product-detail',
    'trench__sniping__configuration', 'trench__sniping__simulation',
    'trench__sniping__activity', 'trench__sniping__activity-row',
  ]) assert.match(allComponents, new RegExp(`name="${name}"`));
  assert.match(detail, /role="tablist"/);
  assert.match(detail, /role="tab"/);
  assert.match(detail, /:tabindex="store\.detailTab === tab \? 0 : -1"/);
  assert.match(detail, /ArrowRight/);
  assert.match(detail, /ArrowLeft/);
  assert.match(detail, /event\.key === 'Home'/);
  assert.match(detail, /event\.key === 'End'/);
  assert.match(activity, /tabindex="0"/);
  assert.match(activity, /@keydown\.enter="store\.selectActivity\(row\)"/);
  assert.match(activity, /const row = store\.selectedActivity/);
  assert.match(activity, /trench\.sniping\.activity\.sanitizedOnly/);
  assert.doesNotMatch(activity, /import\s+\{\s*snipingBridge\s*\}|\bgetActivity\b|\bactivityDetail\b|fetch\(/);

  assert.match(styles, /grid-template-columns:\s*260px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 919px\)/);
  assert.match(styles, /@media \(max-width: 559px\)/);
  assert.match(styles, /@media \(max-height: 359px\)/);
  assert.match(styles, /\.sniping-product-detail__scroll\s*\{[\s\S]*?overflow: auto;/);
  assert.match(narrowStyles, /\.sniping-product-pane,\s*\.sniping-product-detail\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/);
  assert.match(narrowStyles, /\.sniping-product-detail__scroll\s*\{[\s\S]*?flex: 0 0 auto;[\s\S]*?overflow: visible;/);
  assert.doesNotMatch(narrowStyles, /\.sniping-product-detail\s*\{[^}]*overflow:\s*hidden;/);
  assert.equal((detail.match(/class="sniping-product-detail__scroll"/g) ?? []).length, 1);
  const narrowDetailOrder = [
    'name="trench__sniping__back-to-products"',
    'name="trench__sniping__product-header"',
    'name="trench__sniping__qualification"',
    '<SnipingEvidenceRail />',
    'name="trench__sniping__detail-tabs"',
    'name="trench__sniping__detail-scroll"',
  ].map((marker) => detail.indexOf(marker));
  assert.ok(narrowDetailOrder.every((position) => position >= 0));
  assert.deepEqual(narrowDetailOrder, [...narrowDetailOrder].sort((left, right) => left - right));
  assert.match(styles, /\.sniping-activity__table-region\s*\{[\s\S]*?overflow: auto;/);
  assert.match(navigationStyles, /width: 148px;[\s\S]*?flex: 0 0 148px;/);
  assert.match(navigationStyles, /@media \(max-width: 559px\)[\s\S]*?width: 112px;/);
  assert.match(appStyles, /html,[\s\S]*?#app[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
});

test('800x282 detail keeps Back, evidence and primary actions in one vertical scroll path', () => {
  const root = 'src/renderer/coin/src/components/SnipingWorkspace';
  const styles = read(`${root}/SnipingWorkspace.less`);
  const detail = read(`${root}/SnipingProductDetail.vue`);
  const configuration = read(`${root}/SnipingConfigurationPanel.vue`);
  const narrowStyles = section(styles, '@media (max-width: 919px) {', '@media (max-width: 720px)');
  const shortStyles = styles.slice(styles.indexOf('@media (max-height: 359px) {'));
  assert.match(section(styles, '.sniping-workspace {', '\n}'), /overflow: hidden;/);
  assert.match(section(styles, '.sniping-products {', '\n}'), /overflow: hidden;/);
  assert.match(narrowStyles, /\.sniping-product-detail\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/);
  assert.match(narrowStyles, /\.sniping-product-detail > \*\s*\{[\s\S]*?flex-shrink: 0;/);
  assert.match(narrowStyles, /\.sniping-product-detail__scroll\s*\{[\s\S]*?flex: 0 0 auto;[\s\S]*?overflow: visible;/);
  assert.doesNotMatch(narrowStyles, /\.sniping-product-detail\s*\{[^}]*overflow:\s*hidden;/);
  assert.doesNotMatch(shortStyles, /overflow/);
  const orderedMarkers = [
    'name="trench__sniping__back-to-products"',
    'name="trench__sniping__product-header"',
    'name="trench__sniping__qualification"',
    '<SnipingEvidenceRail />',
    'name="trench__sniping__detail-tabs"',
    'name="trench__sniping__detail-scroll"',
    '<SnipingConfigurationPanel />',
  ].map((marker) => detail.indexOf(marker));
  assert.ok(orderedMarkers.every((position) => position >= 0));
  assert.deepEqual(orderedMarkers, [...orderedMarkers].sort((left, right) => left - right));
  assert.match(configuration, /name="trench__sniping__configuration-actions"/);
  assert.ok(
    configuration.indexOf('name="trench__sniping__start-monitoring"') <
      configuration.indexOf('name="trench__sniping__save"'),
  );
});

test('evidence rail treats pending as neutral and distinguishes expired from unknown evidence', () => {
  const rail = read(
    'src/renderer/coin/src/components/SnipingWorkspace/SnipingEvidenceRail.vue',
  );
  const evidence = read('src/renderer/coin/src/views/sniping/snipingEvidence.service.ts');
  assert.match(rail, /store\.evidenceStages\.map/);
  assert.doesNotMatch(rail, /acceptedSnipingReport|reportedSnipingReport|requestState|reportState/);
  assert.match(evidence, /SnipingEvidenceState = 'idle' \| 'ready' \| 'blocked' \| 'unknown' \| 'expired'/);
  assert.match(evidence, /if \(run\?\.evidence_expired\) return 'expired'/);
  assert.match(evidence, /outcome === 'unknown' \? 'unknown' : 'idle'/);
  const requestState = section(evidence, 'const requestState =', 'export const buildSnipingEvidenceStages');
  assert.match(requestState, /if \(run\?\.state === 'failed'\) return 'blocked'/);
  assert.match(requestState, /if \(run\?\.state !== 'completed'\) return 'idle'/);
  assert.match(requestState, /reportedSnipingReport\(run\) \? 'ready' : 'unknown'/);
  assert.doesNotMatch(requestState, /(?:pending|claimed)[\s\S]*?'ready'/);
  const requestStage = section(evidence, "key: 'request'", "key: 'exact'");
  assert.doesNotMatch(requestStage, /\['pending', 'claimed'\][\s\S]*?\? 'ready'/);
  assert.match(requestStage, /state: requestState\(input\.exact\)/);
  const shadowStage = section(evidence, "key: 'shadow'", '\n];');
  assert.match(shadowStage, /reportedSnipingReport\(input\.shadow\)/);
  assert.match(shadowStage, /reportedSnipingReport\(input\.shadow\)[\s\S]*?position_count \?\? 0/);
  const runList = read(
    'src/renderer/coin/src/components/SnipingWorkspace/SnipingSimulationRunList.vue',
  );
  const reportService = read('src/renderer/coin/src/views/sniping/snipingReport.service.ts');
  assert.match(runList, /v-for="run in displayRuns"/);
  assert.match(runList, /buildSnipingSimulationRunDisplay/);
  assert.match(runList, /run\.hasReportedEvidence[\s\S]*?run\.outcomeSummary/);
  assert.match(runList, /trench\.sniping\.evidence\.positionUnknown/);
  assert.doesNotMatch(runList, /shadowCohortCounts|new Map|checkpoint\.block_number|shadow_policy\./);
  assert.match(reportService, /const shadowOutcomeSummary =/);
  assert.match(reportService, /\['hit', 'executable', 'blocked', 'unknown', 'duplicate'\]/);
  assert.match(reportService, /\['executable', 'blocked', 'unknown'\]/);
  assert.match(reportService, /hasReportedEvidence: report !== null/);
  assert.match(reportService, /checkpointSummary: checkpointSummary\(position\)/);
  assert.doesNotMatch(runList, /positionCount \|\| 0/);
});

test('task-owned TypeScript, JavaScript and Less files stay within the 800-line hard limit', () => {
  const roots = [
    'src/main/sniping',
    'src/shared/sniping',
    'src/renderer/coin/src/views/sniping',
    'src/renderer/coin/src/components/SnipingWorkspace',
  ];
  const paths = roots.flatMap(sourceFiles).concat(
    sourceFiles('tests/coin/unit').filter((path) => /\/sniping.*\.test\.ts$/.test(path)),
    [
    'src/preload/trench/trench.preload.ts',
    'src/shared/sniping/snipingSession.type.ts',
    'src/renderer/home/src/contextBridge/snipingSession.bridge.ts',
    'src/renderer/home/src/stores/auth/snipingSessionActivation.service.ts',
    'tests/coin/run-sniping-unit.mjs',
    'scripts/coin/trench-sniping-layout.test.mjs',
    ],
  );
  const checked = paths.filter((path) => /\.(?:ts|js|mjs|less)$/.test(path));
  const oversized = checked.map((path) => ({
    path,
    lines: read(path).split(/\r?\n/).length - 1,
  })).filter(({ lines }) => lines > 800);
  assert.deepEqual(oversized, []);
});

test('every static Sniping locale key used by the renderer exists in English and Chinese', () => {
  const componentRoot = 'src/renderer/coin/src/components/SnipingWorkspace';
  const componentSource = sourceFiles(componentRoot)
    .filter((path) => path.endsWith('.vue'))
    .map(read)
    .join('\n');
  const en = read('src/renderer/common/i18n/enTrench.ts');
  const zh = read('src/renderer/common/i18n/zhTrench.ts');
  const keys = new Set([...componentSource.matchAll(/t\('trench\.sniping\.([a-zA-Z0-9_.-]+)'/g)]
    .map((match) => match[1].split('.').at(-1)));
  assert.match(en, /sniping:\s*\{/);
  assert.match(zh, /sniping:\s*\{/);
  assert.ok(keys.size > 50, 'the complete Sniping UI should use the shared locale tree');
  for (const key of keys) {
    const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
    assert.match(en, pattern, `missing English Sniping key: ${key}`);
    assert.match(zh, pattern, `missing Chinese Sniping key: ${key}`);
  }
});
