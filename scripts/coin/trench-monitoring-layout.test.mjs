/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const sourceFiles = (path) =>
  readdirSync(resolve(root, path), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(`${path}/${entry.name}`) : [`${path}/${entry.name}`]
  );
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
};
const objectKeys = (source, marker) =>
  [...section(source, marker, '} as const;').matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map(
    (match) => match[1]
  );

const MONITORING_METHODS = ['list', 'get', 'save', 'start', 'stop', 'listSamples', 'listAnomalies'];
const SNIPING_METHODS = [
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
  'listActivity'
];
const componentRoot = 'src/renderer/coin/src/components/LongTermMonitoringWorkspace';

test('Monitoring is one separate exact-seven frozen bridge while Sniping remains exact fourteen', () => {
  const monitoringShared = read('src/shared/monitoring/monitoringBridge.type.ts');
  const snipingShared = read('src/shared/sniping/snipingBridge.type.ts');
  const preload = read('src/preload/trench/trench.preload.ts');
  const ipc = read('src/main/monitoring/monitoringIpc.service.ts');
  const renderer = read('src/renderer/coin/src/contextBridge/monitoring.bridge.ts');
  assert.deepEqual(
    objectKeys(snipingShared, 'export const SNIPING_IPC_CHANNELS = {'),
    SNIPING_METHODS
  );
  assert.deepEqual(
    objectKeys(monitoringShared, 'export const MONITORING_IPC_CHANNELS = {'),
    MONITORING_METHODS
  );
  const interfaceBody = section(monitoringShared, 'export interface MonitoringBridge {', '\n}');
  const interfaceMethods = [...interfaceBody.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\(/gm)].map(
    (match) => match[1]
  );
  const preloadBody = section(
    preload,
    'const monitoringBridge = Object.freeze<MonitoringBridge>({',
    '\n});'
  );
  const preloadMethods = [...preloadBody.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(interfaceMethods, MONITORING_METHODS);
  assert.deepEqual(preloadMethods, MONITORING_METHODS);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('monitoring', monitoringBridge\)/);
  assert.equal((preload.match(/exposeInMainWorld\('monitoring'/g) ?? []).length, 1);
  assert.equal((preload.match(/exposeInMainWorld\('sniping'/g) ?? []).length, 1);
  for (const method of MONITORING_METHODS) {
    assert.equal(
      (ipc.match(new RegExp(`handle\\(MONITORING_IPC_CHANNELS\\.${method}\\b`, 'g')) ?? []).length,
      1,
      `${method} must have exactly one guarded IPC handler`
    );
  }
  assert.equal(
    renderer.trim(),
    [
      "import type { MonitoringBridge } from '@shared/monitoring/monitoringBridge.type';",
      '',
      'export const monitoringBridge = window.monitoring as MonitoringBridge;'
    ].join('\n')
  );
});

test('Main alone owns fixed monitoring routes, SG/JP and desired-state injection', () => {
  const bridge = read('src/main/monitoring/monitoringBridge.service.ts');
  const shared = read('src/shared/monitoring/monitoringBridge.type.ts');
  const preload = read('src/preload/trench/trench.preload.ts');
  const env = read('src/renderer/coin/src/env.d.ts');
  const rendererBoundary = `${shared}\n${preload}\n${env}`;
  assert.deepEqual(objectKeys(bridge, 'export const MONITORING_CORE_ROUTES = {'), [
    'list',
    'get',
    'save',
    'state',
    'samples',
    'anomalies'
  ]);
  for (const path of [
    '/sniping/monitor/list',
    '/sniping/monitor/detail',
    '/sniping/monitor/save',
    '/sniping/monitor/set-desired-state',
    '/sniping/monitor/sample/list',
    '/sniping/monitor/anomaly/list'
  ])
    assert.match(bridge, new RegExp(`path: '${path.replaceAll('/', '\\/')}'`));
  assert.match(bridge, /primary_region: 'sg', standby_region: 'jp'/);
  assert.match(bridge, /input, 'armed'/);
  assert.match(bridge, /input, 'disabled'/);
  assert.doesNotMatch(
    shared,
    /\b(?:chain\?|regions?\?|desired_state\?|provider|headers?|url|uri|credential|sql)\b/i
  );
  assert.doesNotMatch(preload, /coreToken|customerJwt|-x-bl-token|provider_reference/i);
  assert.doesNotMatch(env, /monitoringSession|coreToken|customerJwt/);
  assert.match(env, /readonly monitoring: MonitoringBridge/);
  assert.doesNotMatch(rendererBoundary, /\b(?:execute|broadcast|signer|calldata|trade)\b/i);
  assert.match(read('src/renderer/coin/index.html'), /connect-src 'none'/);
});

test('one Arco rail owns Monitoring fourth, with Watches and Anomalies lazy initialization', () => {
  const app = read('src/renderer/coin/src/App.vue');
  const navigation = read(
    'src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue'
  );
  const store = read('src/renderer/coin/src/views/navigation/trenchNavigation.store.ts');
  assert.ok(navigation.indexOf('key="index"') < navigation.indexOf('key="trenchers"'));
  assert.ok(navigation.indexOf('key="trenchers"') < navigation.indexOf('key="sniping"'));
  assert.ok(navigation.indexOf('key="sniping"') < navigation.indexOf('key="monitoring"'));
  assert.ok(
    navigation.indexOf('key="monitoring:watches"') <
      navigation.indexOf('key="monitoring:anomalies"')
  );
  assert.match(
    navigation,
    /:default-open-keys="\['index', 'trenchers', 'sniping', 'monitoring'\]"/
  );
  assert.match(navigation, /name="monitoring__navigation"/);
  assert.match(
    app,
    /<LongTermMonitoringWorkspace v-else :scope="navigation\.monitoringScope"\s*\/>/
  );
  assert.match(app, /if \(module === 'monitoring'\) void monitoringStore\.initialize\(\)/);
  assert.match(store, /'monitoring:watches',[\s\S]*?'monitoring:anomalies'/);
  assert.match(store, /get monitoringScope\(\): 'watches' \| 'anomalies'/);
});

test('Monitoring preserves stable names, textual evidence and focus return paths', () => {
  const componentPaths = sourceFiles(componentRoot).filter((path) => path.endsWith('.vue'));
  const allComponents = componentPaths.map(read).join('\n');
  const detail = read(`${componentRoot}/MonitoringWatchDetail.vue`);
  const anomalies = read(`${componentRoot}/MonitoringAnomalies.vue`);
  const dialog = read(`${componentRoot}/MonitoringWatchDialog.vue`);
  const chart = read(`${componentRoot}/MonitoringChart.vue`);
  const watchList = read(`${componentRoot}/MonitoringWatchList.vue`);
  const sampleDrawer = read(`${componentRoot}/MonitoringSampleDrawer.vue`);
  for (const name of [
    'monitoring__workspace',
    'monitoring__navigation',
    'monitoring__watch__list',
    'monitoring__watch__row',
    'monitoring__watch__detail',
    'monitoring__watch__back',
    'monitoring__watch__edit',
    'monitoring__watch__evidence-table',
    'monitoring__watch__evidence-row',
    'monitoring__watch__open-evidence-detail',
    'monitoring__watch__evidence-drawer',
    'monitoring__watch__close-evidence',
    'monitoring__watch__close-dialog',
    'monitoring__watch__load-older',
    'monitoring__anomalies',
    'monitoring__anomaly__row',
    'monitoring__anomaly__load-older',
    'monitoring__anomaly__drawer',
    'monitoring__anomaly__close-drawer',
    'monitoring__anomaly__evidence-region'
  ])
    assert.match(`${navigationSource()}\n${allComponents}`, new RegExp(`name="${name}"`));
  assert.match(detail, /v-for="item in store\.sampleDisplays"/);
  assert.match(detail, /item\.evidence\.count/);
  assert.match(detail, /item\.aggregateZ/);
  assert.match(detail, /item\.sample\.reason_code/);
  assert.doesNotMatch(detail, /monitoringEvidenceDisplay|Math\.min\(\.\.\.currentSample/);
  assert.match(detail, /store\.isMonitoring[\s\S]*?:disabled="!store\.canEdit"/);
  assert.match(detail, /v-else-if="store\.errors\.detail\s*&&\s*!detail"/);
  assert.match(
    detail,
    /name="monitoring__watch__retry-missing-detail"[\s\S]{0,300}@click="retryDetail"/
  );
  assert.match(
    detail,
    /const retryDetail = \(\): void => \{[\s\S]{0,200}store\.selectWatch\(store\.selectedConfigId, false\)/
  );
  assert.match(
    detail,
    /v-if="store\.errors\.samples"[\s\S]{0,300}name="monitoring__watch__retry-series"/
  );
  assert.match(
    detail,
    /name="monitoring__watch__retry-series"[\s\S]{0,300}:loading="store\.samplesLoading"[\s\S]{0,300}@click="store\.retrySamples\(\)"/
  );
  assert.match(detail, /store\.sampleViewState\.mode === 'loading'/);
  assert.match(detail, /store\.sampleViewState\.mode === 'error'/);
  assert.match(detail, /store\.sampleViewState\.showEmpty/);
  assert.match(detail, /display\.evidence\.confirmation === 'unknown'/);
  assert.match(detail, /display\.baselineState === 'WARMING'/);
  assert.match(detail, /display\.baselineMinimumCount/);
  assert.match(detail, /:aria-label="[\s\S]{0,180}openDetailsFor/);
  assert.match(detail, /@closed="restoreEvidenceFocus"/);
  for (const field of [
    'config_revision',
    'asset_key',
    'end_block_hash',
    'zscore_threshold',
    'agreement',
    'reason_code'
  ])
    assert.match(sampleDrawer, new RegExp(`display\\.sample\\.${field}\\b`));
  for (const field of [
    'componentId',
    'componentVersion',
    'schemaHash',
    'metricKind',
    'detectorVersion'
  ])
    assert.match(sampleDrawer, new RegExp(`display\\.releaseIdentity\\.${field}\\b`));
  assert.match(sampleDrawer, /v-for="region in display\.regionDiagnostics"/);
  assert.match(detail, /display\.staleRuntime/);
  assert.match(detail, /region\.runtimeLastErrorCode/);
  assert.match(detail, /trench\.monitoring\.detail\.lastVerifiedStale/);
  assert.match(watchList, /v-for="row in store\.watchDisplays"/);
  assert.match(watchList, /v-for="region in row\.regions"/);
  assert.match(watchList, /runtimeStateLabel\(region\.runtimeObservedState\)/);
  assert.match(watchList, /:aria-label="t\('trench\.monitoring\.watches\.search'\)"/);
  assert.match(watchList, /store\.appliedWatchSearch/);
  assert.match(watchList, /store\.failedListIntent/);
  assert.match(watchList, /store\.retryWatches\(\)/);
  assert.match(watchList, /v-if="store\.watchesLoading && !store\.watches\.length"/);
  assert.match(
    watchList,
    /name="monitoring__watch__retry-list"[\s\S]{0,220}:loading="store\.watchesLoading"/
  );
  assert.match(chart, /<svg[\s\S]*?aria-hidden="true"/);
  assert.match(chart, /:aria-label="t\('trench\.monitoring\.detector\.range'\)"/);
  assert.match(dialog, /@before-open="(?:rememberFocus|captureReturnFocus)"/);
  assert.match(dialog, /returnFocus\?\.focus\(\)/);
  assert.match(dialog, /v-else-if="store\.dialogRevisionConflict"/);
  assert.doesNotMatch(dialog, /v-else-if="store\.revisionConflict"/);
  assert.match(dialog, /min\(520px, calc\(100vw - 24px\)\)/);
  assert.match(dialog, /:closable="false"/);
  assert.match(sampleDrawer, /:closable="false"/);
  assert.match(anomalies, /:closable="false"/);
  assert.equal(
    (allComponents.match(/:aria-label="t\('trench\.monitoring\.actions\.close'\)"/g) ?? []).length,
    3
  );
  assert.match(anomalies, /drawerInvoker = event\.currentTarget/);
  assert.match(anomalies, /drawerInvoker\?\.focus\(\)/);
  assert.match(anomalies, /:aria-selected="store\.selectedAnomaly === item\.sample"/);
  assert.match(anomalies, /v-if="store\.errors\.anomalyOptions"/);
  assert.match(anomalies, /store\.anomalyViewState\.mode === 'loading'/);
  assert.match(anomalies, /store\.anomalyViewState\.showEmpty/);
  assert.match(anomalies, /store\.anomaliesStaleSince/);
  assert.match(anomalies, /store\.anomalyFailedCursor/);
  assert.match(anomalies, /name="monitoring__anomaly__retry-older"/);
  assert.match(anomalies, /store\.retryAnomalies\(\)/);
  assert.match(anomalies, /selectedDisplay\.evidence\.confirmation/);
  assert.match(anomalies, /:aria-label="t\('trench\.monitoring\.anomalies\.watchFilterLabel'\)"/);
  assert.match(anomalies, /:aria-label="t\('trench\.monitoring\.anomalies\.stateFilterLabel'\)"/);
  assert.match(anomalies, /code:\s*store\.errors\.anomalyOptions/);
  for (const field of ['baselineCount', 'baselineMean', 'baselineStddev']) {
    assert.match(anomalies, new RegExp(`selectedDisplay\\.${field}\\b`));
  }
  for (const field of [
    'componentId',
    'componentVersion',
    'schemaHash',
    'metricKind',
    'detectorVersion'
  ]) {
    assert.match(anomalies, new RegExp(`selectedDisplay\\.releaseIdentity\\.${field}\\b`));
  }
  assert.match(anomalies, /v-for="region in selectedDisplay\.regionDiagnostics"/);
  for (const field of [
    'state',
    'count',
    'baselineCount',
    'baselineMean',
    'baselineStddev',
    'zScore',
    'blockRange',
    'endHash',
    'completeness',
    'reason',
    'fingerprint'
  ]) {
    assert.match(anomalies, new RegExp(`region\\.${field}\\b`));
  }
  assert.doesNotMatch(anomalies, /selectedDisplay\.sample\.regions|sample_fingerprint\.slice/);
  assert.doesNotMatch(anomalies, /monitoringEvidenceDisplay|Math\.min/);
  assert.match(
    read('tests/coin/run-monitoring-unit.mjs'),
    /env:\s*\{\s*\.\.\.process\.env,\s*TZ:\s*'UTC'\s*\}/
  );
  const header = read('src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue');
  const monitoringHeader = section(
    header,
    "if (trenchNavigationStore.module === 'monitoring') {",
    "if (trenchNavigationStore.snipingScope === 'products')"
  );
  assert.match(
    monitoringHeader,
    /monitoringStore\.anomalyLoading \|\| monitoringStore\.anomalyOptionsLoading/
  );
  assert.match(
    monitoringHeader,
    /monitoringStore\.workspaceRefreshLoading \|\|[\s\S]*?monitoringStore\.watchesLoading \|\|[\s\S]*?monitoringStore\.detailLoading/
  );
  assert.doesNotMatch(monitoringHeader, /monitoringStore\.(?:samplesLoading|errors\.samples)/);
  const anomalyHeader = section(
    monitoringHeader,
    "scope === 'anomalies'",
    ': monitoringStore.phase'
  );
  assert.doesNotMatch(anomalyHeader, /monitoringStore\.phase/);
});

test('responsive styles keep list/detail, short detail scroll and narrow filters reachable', () => {
  const mainStyles = read(`${componentRoot}/LongTermMonitoringWorkspace.less`);
  const styles = `${mainStyles}\n${read(`${componentRoot}/MonitoringResponsive.less`)}`;
  const narrow = section(styles, '@media (max-width: 919px) {', '@media (max-width: 559px)');
  const compact = styles.slice(styles.indexOf('@media (max-width: 559px) {'));
  const short = styles.slice(styles.indexOf('@media (max-height: 359px) {'));
  assert.match(section(mainStyles, '.monitoring-workspace {', '\n}'), /overflow: hidden;/);
  assert.match(
    styles,
    /grid-template-columns:\s*(?:minmax\(260px,[^)]*\)|(?:2[6-9]\d|[3-9]\d\d)px)\s+minmax\(0, 1fr\)/
  );
  assert.match(narrow, /\.monitoring-watches:not\(\.monitoring-watches--detail\)/);
  assert.match(narrow, /\.monitoring-watches--detail \.monitoring-watch-list/);
  assert.match(narrow, /\.monitoring-watch-detail__back\s*\{[\s\S]*?display: inline-flex;/);
  assert.match(short, /\.monitoring-watch-detail\s*\{[\s\S]*?overflow-y: auto;/);
  assert.match(short, /\.monitoring-watch-detail__scroll\s*\{[^}]*overflow: visible;/);
  assert.doesNotMatch(short, /\.monitoring-watch-detail\s*\{[^}]*overflow:\s*hidden;/);
  assert.match(styles, /\.monitoring-anomalies__filters\s*\{[\s\S]*?overflow-x: auto;/);
  assert.match(compact, /\.monitoring-workspace__header/);
  const phone = styles.slice(styles.indexOf('@media (max-width: 460px) {'));
  assert.match(phone, /\.monitoring-evidence-table td,[\s\S]*?display: block;/);
  assert.match(phone, /\.monitoring-anomalies__table td\s*\{[\s\S]*?display: block;/);
  assert.match(phone, /\.monitoring-evidence-table__region\s*\{\s*overflow-x: hidden;/);
  const detail = read(`${componentRoot}/MonitoringWatchDetail.vue`);
  assert.equal((detail.match(/:data-label="t\('trench\.monitoring\.evidence\./g) ?? []).length, 6);
});

const navigationSource = () =>
  read('src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue');

test('task-owned source and focused tests stay within the 800-line hard limit', () => {
  const roots = [
    'src/main/monitoring',
    'src/shared/monitoring',
    'src/renderer/coin/src/views/monitoring',
    componentRoot
  ];
  const paths = roots.flatMap(sourceFiles).concat(
    sourceFiles('tests/coin/unit').filter((path) => /\/monitoring.*\.ts$/.test(path)),
    [
      'tests/coin/run-monitoring-unit.mjs',
      'tests/coin/tsconfig.monitoring-unit.json',
      'scripts/coin/trench-monitoring-layout.test.mjs'
    ]
  );
  const oversized = paths
    .filter((path) => /\.(?:[cm]?[jt]s|less)$/.test(path))
    .map((path) => ({
      path,
      lines: read(path).split(/\r?\n/).length - 1
    }))
    .filter(({ lines }) => lines > 800);
  assert.deepEqual(oversized, []);
});

test('every static Monitoring locale key exists in English and Chinese', () => {
  const componentSource = sourceFiles(componentRoot)
    .filter((path) => path.endsWith('.vue'))
    .map(read)
    .join('\n');
  const en = read('src/renderer/common/i18n/enTrench.ts');
  const zh = read('src/renderer/common/i18n/zhTrench.ts');
  const keys = new Set(
    [...componentSource.matchAll(/t\('trench\.monitoring\.([a-zA-Z0-9_.-]+)'/g)].map((match) =>
      match[1].split('.').at(-1)
    )
  );
  assert.ok(keys.size > 35, 'the complete Monitoring UI should use the shared locale tree');
  assert.match(en, /monitoring:\s*\{/);
  assert.match(zh, /monitoring:\s*\{/);
  assert.match(en, /paired:\s*'regional evidence matched'/);
  assert.match(zh, /paired:\s*'地域证据已匹配'/);
  assert.match(
    en,
    /monitoring:\s*\{[\s\S]*?workspace:\s*\{[\s\S]*?watchesTitle:[\s\S]*?anomaliesTitle:/
  );
  assert.match(
    zh,
    /monitoring:\s*\{[\s\S]*?workspace:\s*\{[\s\S]*?watchesTitle:[\s\S]*?anomaliesTitle:/
  );
  const enSniping = section(en, 'sniping: {', 'monitoring: {');
  const zhSniping = section(zh, 'sniping: {', 'monitoring: {');
  assert.doesNotMatch(enSniping, /watchesTitle|anomaliesTitle/);
  assert.doesNotMatch(zhSniping, /watchesTitle|anomaliesTitle/);
  for (const state of [
    'WARMING',
    'BASELINE_FLAT',
    'READY',
    'HIGH',
    'LOW',
    'INCOMPLETE_RANGE',
    'SINGLE_REGION',
    'REGION_MISMATCH'
  ]) {
    assert.match(en, new RegExp(`\\b${state}:`));
    assert.match(zh, new RegExp(`\\b${state}:`));
  }
  for (const key of keys) {
    const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
    assert.match(en, pattern, `missing English Monitoring key: ${key}`);
    assert.match(zh, pattern, `missing Chinese Monitoring key: ${key}`);
  }
});
