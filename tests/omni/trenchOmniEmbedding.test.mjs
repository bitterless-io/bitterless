/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { OMNI_MINI_APP_RUNTIME } from '../../src/main/windows/omniMiniAppRuntime.service.ts';
import {
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_IDS,
  parseOmniLayoutConfig,
  parseOmniMiniAppId
} from '../../src/shared/omni/omni.types.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Trench is the fifth bounded Omni mini app and survives persisted round trips', () => {
  assert.deepEqual(OMNI_MINI_APP_IDS, ['todo', 'eyesOnAgents', 'translator', 'motto', 'trench']);
  assert.equal(parseOmniMiniAppId('trench'), 'trench');
  assert.equal(OMNI_MINI_APP_DISPLAY_URLS.trench, 'bl://miniapp/trench');

  const persisted = {
    tree: {
      id: 'trench-cell',
      type: 'leaf',
      url: 'https://preserved.example.test/research',
      contentMode: 'miniapp',
      miniAppId: 'trench'
    }
  };
  const first = parseOmniLayoutConfig(persisted);
  const second = parseOmniLayoutConfig(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(second, persisted);
  assert.throws(() => parseOmniMiniAppId('onlypreview'), /Unsupported Omni mini app: onlypreview/);
});

test('Trench owns the dedicated local renderer and the only sandboxed mini-app runtime', () => {
  assert.deepEqual(Object.keys(OMNI_MINI_APP_RUNTIME), OMNI_MINI_APP_IDS);
  assert.deepEqual(OMNI_MINI_APP_RUNTIME.trench, {
    preloadFile: 'trench.js',
    rendererName: 'coin',
    sandbox: true
  });
  assert.deepEqual(
    Object.entries(OMNI_MINI_APP_RUNTIME)
      .filter(([, runtime]) => runtime.sandbox)
      .map(([id]) => id),
    ['trench']
  );

  const helper = read('src/main/windows/omniWindow.helper.ts');
  const preload = read('src/preload/trench/trench.preload.ts');
  assert.match(helper, /sandbox:\s*runtime\.sandbox/);
  assert.match(helper, /contextIsolation:\s*true/);
  assert.match(helper, /nodeIntegration:\s*false/);
  assert.match(helper, /webSecurity:\s*true/);
  assert.match(helper, /webviewTag:\s*false/);
  assert.match(helper, /allowRunningInsecureContent:\s*false/);
  assert.match(
    helper,
    /additionalArguments:\s*\[\s*'--mode=omni',\s*\.\.\.createOmniCellActiveFrameArguments\(cellId, 'miniapp-content'\),?\s*\]/
  );
  assert.match(
    preload,
    /host:\s*process\.argv\.includes\('--mode=omni'\)\s*\?\s*'omni'\s*:\s*'standalone'/
  );
  assert.match(helper, /join\(app\.getAppPath\(\), 'out', 'preload', runtime\.preloadFile\)/);
  assert.match(
    helper,
    /join\(app\.getAppPath\(\), 'out', 'renderer', rendererName, 'index\.html'\)/
  );
  assert.doesNotMatch(helper, /import\s*\{[^}]*\bBrowserWindow\b[^}]*\}\s*from\s*'electron'/s);
  assert.doesNotMatch(helper, /new\s+BrowserWindow\s*\(/);
});

test('privileged Trench operation views deny popup and remote in-cell navigation', () => {
  const helper = read('src/main/windows/omniWindow.helper.ts');
  const miniAppFence = helper.slice(
    helper.indexOf('// Mini-app cells have privileged first-party preloads.'),
    helper.indexOf('// Browser-only chrome may mount after the page has already navigated.')
  );
  assert.match(miniAppFence, /setWindowOpenHandler/);
  assert.match(miniAppFence, /return \{ action: 'deny' \}/);
  assert.match(miniAppFence, /navigationUrl === expectedRendererUrl/);
  assert.match(miniAppFence, /event\.preventDefault\(\)/);
  assert.match(miniAppFence, /webContents\.on\('will-navigate', fenceMiniAppNavigation\)/);
  assert.match(miniAppFence, /webContents\.on\('will-redirect', fenceMiniAppNavigation\)/);
});

test('Omni Control exposes exactly five localized mini apps including Trench', () => {
  const control = read('src/renderer/omni/omniControl/src/components/OmniPane.vue');
  const en = read('src/renderer/common/i18n/en.ts');
  const zh = read('src/renderer/common/i18n/zh.ts');
  const entries = [
    ...control.matchAll(/\bid:\s*'(todo|eyesOnAgents|translator|motto|trench)'/g)
  ].map((match) => match[1]);
  assert.deepEqual(entries, OMNI_MINI_APP_IDS);
  assert.match(control, /trenchIcon from '@renderer\/common\/assets\/icons\/coin\.png'/);
  assert.match(control, /i18nHelper\.miniApp\.trench\.name/);
  assert.match(en, /trench:\s*\{\s*name:\s*'Trench'/);
  assert.match(zh, /trench:\s*\{\s*name:\s*'Trench'/);
});

test('embedded Trench removes standalone chrome and keeps all accepted responsive states', () => {
  const app = read('src/renderer/coin/src/App.vue');
  const appStyle = read('src/renderer/coin/src/App.less');
  const header = read('src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue');
  const headerStyle = read('src/renderer/coin/src/components/TrenchHeader/TrenchHeader.less');
  const workspaceStyle = read(
    'src/renderer/coin/src/components/TrenchRecordWorkspace/TrenchRecordWorkspace.less'
  );

  assert.match(app, /'trench-app--embedded': host\.host === 'omni'/);
  assert.match(app, /:data-host="host\.host"/);
  assert.match(
    header,
    /'trench-header--mac': host\.platform === 'darwin' && host\.host === 'standalone'/
  );
  assert.match(header, /'trench-header--embedded': host\.host === 'omni'/);
  assert.match(
    headerStyle,
    /\.trench-header\s*\{[^}]*height:\s*32px;[^}]*min-height:\s*32px;[^}]*flex:\s*0 0 32px;[^}]*padding:\s*0 12px;[^}]*border-bottom:\s*1px solid #3d4666;[^}]*background-color:\s*#4e5882;/s
  );
  assert.match(headerStyle, /\.trench-header--mac\s*\{[^}]*padding:\s*0 12px 0 78px;/s);
  assert.match(
    headerStyle,
    /\.trench-header--embedded\s*\{[^}]*padding:\s*0 12px;[^}]*-webkit-app-region:\s*no-drag;/s
  );
  assert.match(header, /class="trench-header__title">Trench<\/span>/);
  assert.match(header, /class="trench-header__actions"/);
  assert.match(header, /class="trench-header__status-label">\{\{ statusText \}\}<\/span>/);
  assert.doesNotMatch(header, /trench-header__mark|trench\.header\.subtitle/);
  assert.match(
    header,
    /<a-button\s+name="trench__header__agent-guide"[\s\S]*?size="mini"[\s\S]*?type="text"[\s\S]*?:aria-label="t\('trench\.agentGuide\.trigger'\)"[\s\S]*?<IconRobot/
  );
  assert.match(
    header,
    /<a-button\s+name="trench__header__refresh"[\s\S]*?size="mini"[\s\S]*?type="text"[\s\S]*?:loading="refreshPending"[\s\S]*?:disabled="refreshPending"[\s\S]*?:aria-label="t\('trench\.actions\.refresh'\)"[\s\S]*?<IconRefresh/
  );
  assert.doesNotMatch(header, />\s*\{\{ t\('trench\.actions\.refresh'\) \}\}\s*</);
  assert.match(
    headerStyle,
    /\.trench-header__actions\s*\{[^}]*gap:\s*8px;[^}]*-webkit-app-region:\s*no-drag;/s
  );
  assert.match(
    headerStyle,
    /\.trench-header__actions \.arco-btn\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/s
  );
  const narrowHeaderStyle = headerStyle.slice(headerStyle.indexOf('@media (max-width: 559px)'));
  assert.match(narrowHeaderStyle, /\.trench-header__status-label\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(
    narrowHeaderStyle,
    /\.trench-header__(?:status|actions)\s*\{[^}]*display:\s*none;/s
  );
  assert.match(appStyle, /min-width:\s*0/);
  assert.match(appStyle, /min-height:\s*0/);
  assert.doesNotMatch(appStyle, /min-width:\s*800px/);
  assert.doesNotMatch(appStyle, /min-height:\s*600px/);
  assert.match(workspaceStyle, /@media \(max-width:\s*479px\)/);
  assert.match(appStyle, /@media \(max-height:\s*359px\)/);
  assert.doesNotMatch(appStyle, /\.trench-app \.trench-header\s*\{/);
});

test('production build contains the Trench preload and renderer targets', () => {
  const vite = read('electron.vite.config.ts');
  assert.match(vite, /trench:\s*resolve\('src\/preload\/trench\/trench\.preload\.ts'\)/);
  assert.match(vite, /coin:\s*resolve\('src\/renderer\/coin\/index\.html'\)/);
  assert.match(vite, /coinHtmlSecurityPlugin/);

  const sourcePaths = [
    'electron.vite.config.ts',
    'src/main/windows/omniMiniAppRuntime.service.ts',
    'src/main/windows/omniWindow.helper.ts',
    'src/main/monitoring/monitoringBridge.service.ts',
    'src/preload/trench/trench.preload.ts',
    'src/shared/monitoring/monitoringBridge.type.ts',
    'src/renderer/coin/index.html',
    'src/renderer/coin/src/App.vue',
    'src/renderer/coin/src/components/LongTermMonitoringWorkspace/LongTermMonitoringWorkspace.vue',
    'src/renderer/coin/src/components/LongTermMonitoringWorkspace/LongTermMonitoringWorkspace.less',
    'src/renderer/coin/src/views/monitoring/monitoring.store.ts',
    'src/renderer/coin/src/components/TrenchRecordDetail/TrenchRecordDetail.vue',
    'src/renderer/coin/src/components/TrenchAnalysisDetail/TrenchAnalysisDetail.vue',
    'src/renderer/coin/src/components/TrenchDocumentAction/TrenchDocumentAction.vue',
    'src/renderer/coin/src/components/TrenchIndexWalletDetail/TrenchIndexWalletDetail.vue',
    'src/renderer/coin/src/components/TrenchNegativeWalletDetail/TrenchNegativeWalletDetail.vue',
    'src/renderer/coin/src/components/TrenchStructuredValue/TrenchStructuredValue.vue',
    'src/renderer/omni/omniControl/src/components/OmniPane.vue',
    'src/shared/omni/omni.types.ts'
  ];
  const newestSourceTime = Math.max(
    ...sourcePaths.map(
      (relativePath) => statSync(new URL(`../../${relativePath}`, import.meta.url)).mtimeMs
    )
  );
  for (const relativePath of [
    'out/main/app.main.js',
    'out/preload/trench.js',
    'out/renderer/coin/index.html',
    'out/renderer/omni/omniControl/index.html'
  ]) {
    const target = new URL(`../../${relativePath}`, import.meta.url);
    assert.equal(existsSync(target), true, `${relativePath} must exist after the production build`);
    assert.equal(statSync(target).isFile(), true);
    assert.ok(statSync(target).size > 0, `${relativePath} must not be empty`);
    assert.ok(
      statSync(target).mtimeMs >= newestSourceTime,
      `${relativePath} must be rebuilt after the Omni Trench sources`
    );
  }

  const coinHtml = read('out/renderer/coin/index.html');
  const coinHead = coinHtml.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  assert.match(
    coinHead,
    /^\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*<meta\s+charset=/i,
    'Trench CSP and charset must be the first two head elements before Monaco'
  );
  assert.ok(
    coinHtml.toLowerCase().indexOf('<meta charset=') < 1024,
    'Trench charset declaration must remain inside the first 1024 bytes'
  );
  const inlineScripts = [...coinHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim().length > 0);
  assert.ok(inlineScripts.length > 0, 'the production Monaco bootstrap must be audited');
  for (const script of inlineScripts) {
    const hash = createHash('sha256').update(script).digest('base64');
    assert.match(coinHead, new RegExp(`'sha256-${hash}'`));
  }
  assert.doesNotMatch(coinHtml, /"\.\/monacoeditorwork\//);
  const workerPaths = [...coinHtml.matchAll(/"(\.\.\/monacoeditorwork\/[^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.ok(workerPaths.length > 0, 'Trench Monaco worker paths must resolve beside coin/');
  for (const workerPath of new Set(workerPaths)) {
    assert.equal(
      existsSync(new URL(`../../out/renderer/coin/${workerPath}`, import.meta.url)),
      true,
      `${workerPath} must exist in the production renderer output`
    );
  }
});
