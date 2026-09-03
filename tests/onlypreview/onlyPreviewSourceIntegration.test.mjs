import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load as loadYaml } from 'js-yaml';
import { source } from './onlyPreviewCoreTest.helper.mjs';

test('window sources delegate dual Preview isolation and preserve generic Omni renderer cleanup', () => {
  const standalone = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const rendererTarget = source(
    'src/main/onlypreview/views/onlyPreviewRendererTarget.service.ts'
  );
  const globalSearchWindow = source(
    'src/main/onlypreview/views/onlyPreviewGlobalSearchWindow.service.ts'
  );
  assert.match(standalone, /new BaseWindow\(/);
  assert.equal((standalone.match(/new WebContentsView\(/g) ?? []).length, 1);
  assert.match(standalone, /sandbox:\s*true/);
  assert.match(standalone, /contextIsolation:\s*true/);
  assert.match(standalone, /nodeIntegration:\s*false/);
  assert.match(standalone, /webSecurity:\s*true/);
  assert.match(rendererTarget, /url === expectedUrl/);
  assert.match(rendererTarget, /setWindowOpenHandler[\s\S]*action:\s*'deny'/);
  assert.match(rendererTarget, /webContents\.on\('will-redirect',\s*fenceNavigation\)/);
  assert.match(standalone, /MIN_SIDEBAR_WIDTH\s*=\s*180/);
  assert.match(standalone, /RESIZE_HANDLE_WIDTH\s*=\s*5/);
  assert.match(standalone, /MENU_BAR_HEIGHT\s*=\s*32/);
  assert.match(standalone, /STATUS_HEIGHT\s*=\s*25/);
  assert.doesNotMatch(standalone, /PREVIEW_HEADER_HEIGHT/);
  assert.match(
    standalone,
    /addChildView\(shellView\)[\s\S]*onlyPreviewPreviewRegionService\.start\(\{/
  );
  assert.doesNotMatch(standalone, /addChildView\(previewView\)/);
  assert.doesNotMatch(standalone, /previewHeaderView/);
  assert.match(
    standalone,
    /onlyPreviewPreviewRegionService\.updateBounds\([\s\S]*clampPreviewBounds\(currentBounds, width, height\)/
  );
  assert.doesNotMatch(standalone, /sandbox:\s*mode !== 'preview'/);
  assert.match(standalone, /mode === 'preview'[\s\S]*onlypreviewContent\.js[\s\S]*onlypreview\.js/);
  assert.match(
    standalone,
    /configureOnlyPreviewNavigationFence\(view\.webContents, target\.url, mode === 'shell'\)/
  );
  assert.match(rendererTarget, /allowExternalHttp = true[\s\S]*shell\.openExternal/);
  assert.match(globalSearchWindow, /createView: runtime\.createView[\s\S]*loadView: runtime\.loadView/);
  assert.match(
    standalone,
    /loadVuePreviewView: async \(view\) => await this\.loadView\(view, 'preview'\)[\s\S]*await this\.loadView\(shellView, 'shell'\)/
  );
  assert.match(standalone, /onlyPreviewHostRegistry\.revoke\(host\.hostToken\)/);
  assert.match(standalone, /minWidth:\s*MIN_WIDTH/);
  assert.match(standalone, /minHeight:\s*MIN_HEIGHT/);
  assert.match(standalone, /autoHideMenuBar:\s*true/);
  assert.match(standalone, /titleBarStyle:\s*'hidden'/);
  assert.match(
    standalone,
    /process\.platform === 'darwin'[\s\S]*trafficLightPosition:\s*\{\s*x:\s*12,\s*y:\s*8\s*\}/
  );
  assert.doesNotMatch(standalone, /titleBarStyle:\s*'hiddenInset'/);
  assert.doesNotMatch(standalone, /frame:\s*false/);
  assert.doesNotMatch(standalone, /`--mode=\$\{hostKind\}`/);
  assert.match(
    standalone,
    /minimizeWindow\(hostToken: string\): void \{[\s\S]*this\.requireStandaloneWindow\(hostToken\)\.minimize\(\)/
  );
  assert.match(
    standalone,
    /toggleMaximizeWindow\(hostToken: string\): void \{[\s\S]*this\.requireStandaloneWindow\(hostToken\)[\s\S]*isMaximized\(\)[\s\S]*unmaximize\(\)[\s\S]*maximize\(\)/
  );
  assert.match(
    standalone,
    /closeWindow\(hostToken: string\): void \{[\s\S]*this\.requireStandaloneWindow\(hostToken\)\.close\(\)/
  );
  assert.match(
    standalone,
    /private requireStandaloneWindow\(hostToken: string\): BaseWindow \{[\s\S]*this\.requireStandaloneHost\(hostToken\)/
  );

  const autoOpenDevToolsGuard = standalone.slice(
    standalone.indexOf('const shouldAutoOpenOnlyPreviewDevTools'),
    standalone.indexOf('const isOnlyPreviewDevToolsEnabled')
  );
  assert.match(
    autoOpenDevToolsGuard,
    /import\.meta\.env\.VITE_MODE === 'debug' && process\.env\.BITTERLESS_E2E !== '1'/
  );
  assert.doesNotMatch(autoOpenDevToolsGuard, /app\.isPackaged|is\.dev|\|\|/);
  for (const { viteMode, e2e, expected } of [
    { viteMode: 'debug', e2e: undefined, expected: true },
    { viteMode: 'debug', e2e: '0', expected: true },
    { viteMode: 'debug', e2e: '1', expected: false },
    { viteMode: 'release', e2e: undefined, expected: false },
    { viteMode: 'release', e2e: '1', expected: false }
  ]) {
    assert.equal(viteMode === 'debug' && e2e !== '1', expected);
  }

  const devToolsGuard = standalone.slice(
    standalone.indexOf('const isOnlyPreviewDevToolsEnabled'),
    standalone.indexOf('const isOnlyPreviewDevToolsShortcut')
  );
  assert.match(devToolsGuard, /import\.meta\.env\.VITE_MODE === 'debug'/);
  assert.match(devToolsGuard, /process\.env\.BITTERLESS_E2E === '1' && !app\.isPackaged/);
  const devToolsShortcut = standalone.slice(
    standalone.indexOf('const isOnlyPreviewDevToolsShortcut'),
    standalone.indexOf('const bindOnlyPreviewDevToolsShortcut')
  );
  assert.match(
    devToolsShortcut,
    /input\.type !== 'keyDown' \|\| input\.isAutoRepeat[\s\S]*key === 'f12'/
  );
  assert.match(
    devToolsShortcut,
    /if \(key === 'f12'\) return !input\.shift && !input\.control && !input\.alt && !input\.meta/
  );
  assert.match(devToolsShortcut, /if \(key !== 'i'\) return false/);
  assert.match(
    devToolsShortcut,
    /process\.platform === 'darwin'[\s\S]*input\.meta && input\.alt && !input\.control && !input\.shift/
  );
  assert.match(
    devToolsShortcut,
    /process\.platform === 'win32'[\s\S]*input\.control && input\.shift && !input\.meta && !input\.alt/
  );
  const bindDevToolsShortcut = standalone.slice(
    standalone.indexOf('const bindOnlyPreviewDevToolsShortcut'),
    standalone.indexOf('const clampPreviewBounds')
  );
  assert.match(
    bindDevToolsShortcut,
    /if \(!isOnlyPreviewDevToolsEnabled\(\)\) return;[\s\S]*webContents\.on\('before-input-event'/
  );
  assert.match(
    bindDevToolsShortcut,
    /event\.preventDefault\(\);[\s\S]*webContents\.isDevToolsOpened\(\)[\s\S]*webContents\.closeDevTools\(\)[\s\S]*webContents\.openDevTools\(\{ mode: 'detach' \}\)/
  );
  const createViewBody = standalone.slice(
    standalone.indexOf('private createView('),
    standalone.indexOf('private async loadView(')
  );
  assert.match(
    createViewBody,
    /this\.bindNativeShortcuts\([\s\S]*mode === 'shell' \? 'shell' : mode === 'preview' \? 'vue' : 'search'[\s\S]*bindOnlyPreviewDevToolsShortcut\(view\.webContents\)/
  );
  assert.doesNotMatch(createViewBody, /openDevTools\(/);
  const standaloneStartup = standalone.slice(
    standalone.indexOf('private async createStandaloneWindow('),
    standalone.indexOf('private createView(')
  );
  const initialLoads = standaloneStartup.indexOf("await this.loadView(shellView, 'shell')");
  const autoOpenGuard = standaloneStartup.indexOf('shouldAutoOpenOnlyPreviewDevTools()');
  const previewAutoOpen = standaloneStartup.indexOf('previewView.webContents.openDevTools(');
  assert.ok(initialLoads >= 0 && initialLoads < autoOpenGuard && autoOpenGuard < previewAutoOpen);
  assert.match(
    standaloneStartup,
    /this\.baseWindow !== window[\s\S]*this\.shellView !== shellView[\s\S]*!previewView/
  );
  assert.match(
    standaloneStartup,
    /window\.isDestroyed\(\)[\s\S]*previewView\.webContents\.isDestroyed\(\)[\s\S]*previewView\.webContents\.isDevToolsOpened\(\)/
  );
  assert.match(
    standaloneStartup,
    /previewView\.webContents\.openDevTools\(\{ mode: 'detach', activate: false \}\)/
  );
  assert.doesNotMatch(standaloneStartup, /shellView\.webContents\.openDevTools\(/);
  assert.equal((standaloneStartup.match(/openDevTools\(/g) ?? []).length, 1);
  const loadViewBody = standalone.slice(
    standalone.indexOf('private async loadView('),
    standalone.indexOf('private applyInitialBounds(')
  );
  assert.doesNotMatch(loadViewBody, /openDevTools\(|did-finish-load/);
  assert.equal((standalone.match(/openDevTools\(/g) ?? []).length, 2);

  const omni = source('src/main/windows/omniWindow.helper.ts');
  assert.doesNotMatch(omni, /onlypreview/i);
  assert.match(omni, /render-process-gone/);
  assert.match(omni, /additionalArguments:\s*\[\s*'--mode=omni'/);
  assert.match(omni, /content\.webContents\.on\('will-redirect',\s*fenceMiniAppNavigation\)/);
  const firstContentCreationCatch = omni.slice(
    omni.indexOf('let content: WebContentsView;'),
    omni.indexOf('try {\n      this.baseWindow.contentView.addChildView(content);')
  );
  assert.match(firstContentCreationCatch, /this\.disposeWebContentsView\(menubar\)/);

  const closeViewBody = omni.slice(
    omni.indexOf('private closeWebContentsView('),
    omni.indexOf('private detachWebContentsView(')
  );
  assert.match(closeViewBody, /if \(!view\) return/);
  assert.match(closeViewBody, /if \(!view\.webContents\.isDestroyed\(\)\)/);
  assert.match(closeViewBody, /view\.webContents\.close\(\)/);
  assert.doesNotMatch(closeViewBody, /isCrashed\(\)/);

  const detachViewBody = omni.slice(
    omni.indexOf('private detachWebContentsView('),
    omni.indexOf('private disposeWebContentsView(')
  );
  assert.match(detachViewBody, /removeChildView\(view\)/);
  assert.match(detachViewBody, /catch \{/);

  const disposeViewBody = omni.slice(
    omni.indexOf('private disposeWebContentsView('),
    omni.indexOf('private cleanupAllViews(')
  );
  assert.match(
    disposeViewBody,
    /this\.detachWebContentsView\(view\);[\s\S]*this\.closeWebContentsView\(view\);/
  );

  const broadcastLoadStateBody = omni.slice(
    omni.indexOf('private broadcastMiniAppLoadState('),
    omni.indexOf('private replayMiniAppLoadFailures(')
  );
  assert.match(
    broadcastLoadStateBody,
    /miniAppLoadFailures\.(?:set|delete)[\s\S]*try \{[\s\S]*xpcMain\.broadcast/
  );

  const loadMiniAppBody = omni.slice(
    omni.indexOf('private loadMiniAppCellContent('),
    omni.indexOf('private addCell(')
  );
  assert.match(
    loadMiniAppBody,
    /this\.cells = this\.cells\.filter[\s\S]*this\.removeCellViews\(cell\);[\s\S]*this\.reportMiniAppLoadFailure\(/
  );

  const lifecycleBody = omni.slice(
    omni.indexOf('private bindCellContentLifecycle('),
    omni.indexOf('private replaceBrowserCellContentView(')
  );
  assert.match(
    lifecycleBody,
    /render-process-gone[\s\S]*this\.cells = this\.cells\.filter[\s\S]*this\.removeCellViews\(cell\);[\s\S]*this\.reportMiniAppLoadFailure\(/
  );

  const removeCellViewsBody = omni.slice(
    omni.indexOf('private removeCellViews('),
    omni.indexOf('private notifyCellUrl(')
  );
  assert.match(
    removeCellViewsBody,
    /this\.disposeWebContentsView\(cell\.menubar\);[\s\S]*this\.disposeWebContentsView\(cell\.content\);/
  );
  assert.doesNotMatch(removeCellViewsBody, /host|revoke/i);
});

test('Home, Omni, preload, i18n, logging, build, and installer sources include the complete integration gates', () => {
  const homeCard = source('src/renderer/home/src/views/miniApp/miniApps.constant.ts');
  const homeEmitter = source('src/renderer/home/src/emitter/onlyPreview.emitter.ts');
  const homeView = source('src/renderer/home/src/views/miniApp/MiniApp.vue');
  assert.match(homeCard, /onlypreview/);
  assert.match(homeEmitter, /OnlyPreviewHandler/);
  assert.match(homeView, /onlyPreviewEmitter\.openOnlyPreviewWindow\(\)/);

  const omniTypes = source('src/shared/omni/omni.types.ts');
  const omniPane = source('src/renderer/omni/omniControl/src/components/OmniPane.vue');
  const omniRuntime = source('src/main/windows/omniWindow.helper.ts');
  assert.doesNotMatch(omniTypes, /onlypreview/i);
  assert.doesNotMatch(omniPane, /onlypreview/i);
  assert.doesNotMatch(omniRuntime, /onlypreview/i);

  const onlyPreviewTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  assert.match(onlyPreviewTypes, /OnlyPreviewHostKind = 'standalone' \| 'settings' \| 'guide'/);
  assert.doesNotMatch(onlyPreviewTypes, /OnlyPreviewHostKind[^;]*omni/i);

  const preload = source('src/preload/onlypreview/onlypreview.preload.ts');
  const contentPreload = source('src/preload/onlypreview/onlypreviewContent.preload.ts');
  const envPreload = source('src/preload/onlypreview/onlyPreviewEnv.preload.ts');
  const preloadTypes = source('src/preload/onlypreview/onlypreview.preload.type.ts');
  assert.match(preload, /exposeOnlyPreviewEnv\(\)/);
  assert.match(envPreload, /contextBridge\.exposeInMainWorld/);
  assert.match(envPreload, /hostToken/);
  assert.match(contentPreload, /exposeOnlyPreviewEnv\(\)/);
  assert.doesNotMatch(
    contentPreload,
    /OnlyPreviewSearchRuntimeHandler|search-token|worker_threads/
  );
  for (const preloadSource of [preload, contentPreload, envPreload]) {
    assert.doesNotMatch(preloadSource, /ipcMain|ipcRenderer/);
    assert.doesNotMatch(preloadSource, /containerMode|--mode=/);
  }
  assert.doesNotMatch(preloadTypes, /containerMode|ContainerMode|omni/i);

  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  assert.doesNotMatch(shellApp, /PreviewSurface|isOmni|--omni/);
  assert.doesNotMatch(shellStore, /onlyPreviewPreviewStore|containerMode|isOmni/);
  assert.match(shellApp, /new ResizeObserver\(reportPreviewBounds\)/);

  const previewApp = source('src/renderer/onlypreview/preview/src/App.vue');
  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(previewApp, /onlyPreviewPreviewStore\.initialize\(\)/);
  assert.match(previewStore, /async initialize\(\): Promise<void>/);
  assert.doesNotMatch(previewStore, /initialize\(restore/);

  for (const locale of ['en', 'zh']) {
    const i18n = source(`src/renderer/common/i18n/${locale}.ts`);
    assert.match(i18n, /onlypreview/i);
  }
  assert.match(source('src/main/logging/logPolicy.service.ts'), /onlypreview/i);

  const appMain = source('src/main/app.main.ts');
  const configureE2EStart = appMain.indexOf('const configureE2EUserData');
  const configureE2ECall = appMain.indexOf('configureE2EUserData();');
  const guiStartup = appMain.indexOf('app.whenReady()');
  assert.ok(configureE2EStart >= 0 && configureE2ECall > configureE2EStart);
  assert.ok(configureE2ECall < guiStartup);
  const configureE2EBody = appMain.slice(configureE2EStart, configureE2ECall);
  assert.match(configureE2EBody, /if \(app\.isPackaged\)[\s\S]*BITTERLESS_E2E is unavailable/);
  assert.match(
    appMain,
    /handleCoreSqliteReady:[\s\S]*onlyPreviewSettingsService\.hydrateFromStorage\(\)/
  );

  const sqlitePassword = source('src/preload/sqlite/sqliteHelper/sqlitePassword.helper.ts');
  const e2ePasswordGuard = sqlitePassword.indexOf("process.env.BITTERLESS_E2E === '1'");
  const releasePasswordFlow = sqlitePassword.indexOf(
    "console.log('[sqlitePassword] release mode detected"
  );
  assert.ok(e2ePasswordGuard >= 0 && e2ePasswordGuard < releasePasswordFlow);
  assert.match(
    sqlitePassword,
    /process\.env\.BITTERLESS_E2E === '1'[\s\S]*return \{ password: E2E_PASSWORD, isReset: false \}/
  );

  const vite = source('electron.vite.config.ts');
  const preloadConfigStart = vite.indexOf('  preload: {');
  const rendererConfigStart = vite.indexOf('\n  renderer:', preloadConfigStart);
  assert.ok(preloadConfigStart >= 0 && rendererConfigStart > preloadConfigStart);
  const preloadConfig = vite.slice(preloadConfigStart, rendererConfigStart);
  assert.match(
    preloadConfig,
    /input:\s*\{[\s\S]*onlypreview:\s*resolve\('src\/preload\/onlypreview\/onlypreview\.preload\.ts'\)[\s\S]*onlypreviewContent:\s*resolve\('src\/preload\/onlypreview\/onlypreviewContent\.preload\.ts'\)/
  );
  assert.match(
    preloadConfig,
    /fileSearch:\s*resolve\('src\/preload\/fileSearch\/fileSearch\.preload\.ts'\)/
  );
  for (const renderer of ['shell', 'preview', 'globalSearch', 'settings', 'guide']) {
    assert.match(vite, new RegExp(`'onlypreview/${renderer}'`));
  }
  assert.match(vite, /fileSearch:\s*resolve\('src\/renderer\/fileSearch\/index\.html'\)/);
  assert.doesNotMatch(vite, /onlypreviewSearchUtility|onlyPreviewSearch\.utility/);
  const sandboxPluginStart = vite.indexOf('const onlyPreviewSandboxPreloadPlugin');
  const nextPluginStart = vite.indexOf('const trenchSandboxPreloadPlugin', sandboxPluginStart);
  assert.ok(sandboxPluginStart >= 0 && nextPluginStart > sandboxPluginStart);
  const sandboxPlugin = vite.slice(sandboxPluginStart, nextPluginStart);
  assert.match(
    sandboxPlugin,
    /async writeBundle\(\)[\s\S]*onlypreview:\s*resolve\([\s\S]*onlypreviewContent:\s*resolve\([\s\S]*bundle: true[\s\S]*format: 'cjs'/
  );
  assert.doesNotMatch(sandboxPlugin, /apply:\s*'build'/);
  assert.match(vite, /vite-plugin-monaco-editor-esm/);
  assert.match(vite, /unpdf/);

  const builder = source('electron-builder.tmp.yml');
  assert.match(builder, /fileAssociations:/);
  assert.match(builder, /rank:\s*Alternate/);
  assert.match(builder, /CFBundleTypeRole:\s*Viewer/);
  assert.match(builder, /public\.data/);
  const classifier = source('src/main/onlypreview/onlyPreviewClassifier.service.ts');
  const supportedExtensions = new Set();
  for (const catalogName of [
    'TEXT_EXTENSIONS',
    'PDF_EXTENSIONS',
    'IMAGE_EXTENSIONS',
    'AUDIO_EXTENSIONS',
    'VIDEO_EXTENSIONS'
  ]) {
    const catalog = classifier.match(
      new RegExp(`const ${catalogName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`)
    )?.[1];
    assert.ok(catalog, `${catalogName} must remain an explicit extension catalog`);
    for (const match of catalog.matchAll(/'\.([^']+)'/g)) supportedExtensions.add(match[1]);
  }
  const builderConfig = loadYaml(builder);
  const associatedExtensions = new Set(
    builderConfig.fileAssociations.flatMap((association) => association.ext)
  );
  assert.deepEqual(
    [...associatedExtensions].sort(),
    [...supportedExtensions].sort(),
    'explicit OS associations must match every extension supported by OnlyPreview'
  );
  const installerTemplate = source('build/installer.tmp.nsh');
  const installerGenerator = source('scripts/before.js');
  assert.match(installerTemplate, /^ONLY_PREVIEW_INSTALL$/m);
  assert.match(installerTemplate, /^ONLY_PREVIEW_UNINSTALL$/m);
  assert.match(installerTemplate, /customUnInstall/);
  assert.match(installerGenerator, /Software\\\\Classes\\\\\*\\\\shell\\\\OnlyPreview/);
  assert.match(installerGenerator, /Open in Bitterless/);
  assert.match(installerGenerator, /DeleteRegKey/);
});

test('renderers keep empty state distinct from index failure and PDF/Monaco runtime contracts explicit', () => {
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const globalSearchApp = source('src/renderer/onlypreview/globalSearch/src/App.vue');
  assert.match(shellApp, /empty|emptyState|empty-state/i);
  assert.match(shellStore, /error/);
  assert.doesNotMatch(shellApp, />\s*INDEX_FAILED\s*</);
  assert.doesNotMatch(shellApp, /index\.truncated|indexPartial|indexReady/);
  assert.match(
    shellApp,
    /:tabindex="row\.entry\.relativePath === treeFocusRelativePath \? 0 : -1"/
  );
  assert.match(
    shellApp,
    /const treeFocusRelativePath = computed\(\(\) => onlyPreviewShellStore\.treeFocusRelativePath\)/
  );
  assert.match(shellApp, /:data-relative-path="row\.entry\.relativePath"/);
  assert.match(shellApp, /focusProjectTree/);
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.match(shellApp, new RegExp(`event\\.key !== '${key}'`));
  }
  assert.match(shellApp, /event\.key === ' ' \|\| event\.key === 'Enter'/);
  assert.match(shellStore, /get treeFocusRelativePath\(\): string/);
  assert.match(shellStore, /moveTreeFocus\(/);
  assert.match(shellStore, /handleTreeClick\(entry:[\s\S]*if \(clickCount > 1\) return/);
  assert.match(
    shellApp,
    // The row delegates through a local wrapper that keeps the row being renamed inert; the chevron
    // still calls the store directly because it only toggles.
    /@click="handleTreeRowClick\(row\.entry, \$event\.detail\)"/
  );
  assert.match(
    shellApp,
    /<span[\s\S]*name="onlypreview__treeChevron"[\s\S]*@click\.stop="onlyPreviewShellStore\.handleTreeClick\(row\.entry, \$event\.detail, true\)"[\s\S]*@dblclick\.prevent\.stop[\s\S]*<IconChevronRight/
  );
  assert.match(
    shellStore,
    /handleTreeClick\(entry:[\s\S]*toggleDirectory = false[\s\S]*clickCount > 1[\s\S]*activateEntry\(entry, clickCount === 0 \|\| toggleDirectory, toggleDirectory\)/
  );
  assert.match(
    shellStore,
    /handleTreeDoubleClick[\s\S]*entry\.nodeKind === 'file'[\s\S]*openFilesWithSingleClick[\s\S]*activateEntry\(entry, true, true\)/
  );
  assert.match(
    shellStore,
    /this\.treeSelectedRelativePath = entry\.relativePath[\s\S]*if \(entry\.nodeKind === 'directory'\)[\s\S]*if \(toggleDirectory\) this\.toggleDirectory/
  );
  assert.match(
    shellApp,
    /tree-row--selected'[\s\S]*onlyPreviewShellStore\.treeSelectedRelativePath[\s\S]*:aria-selected="[\s\S]*row\.entry\.relativePath === onlyPreviewShellStore\.treeSelectedRelativePath/
  );
  const globalSearchContext = shellStore.slice(
    shellStore.indexOf('getGlobalSearchContext()'),
    shellStore.indexOf('setFocusedPath(')
  );
  assert.match(globalSearchContext, /currentDirectoryRelativePath: this\.currentDirectoryRelativePath/);
  assert.doesNotMatch(globalSearchContext, /focusedRelativePath|selectedRelativePath/);
  assert.match(
    shellStore,
    /this\.workspace = null;[\s\S]*this\.treeSelectedRelativePath = null;[\s\S]*this\.focusedRelativePath = '';/
  );
  assert.match(
    shellStore,
    /this\.selectedRelativePath = workspace\.selectedRelativePath \|\| '';[\s\S]*this\.treeSelectedRelativePath = this\.selectedRelativePath \|\| null;/
  );
  assert.match(shellStore, /if \(entry\.nodeKind !== 'file'\) return/);
  assert.doesNotMatch(shellApp, /name="onlypreview__search"|ProjectSearchResults/);
  assert.doesNotMatch(shellApp, /GlobalSearchWorkspace|onlyPreviewGlobalSearchStore/);
  assert.match(globalSearchApp, /<GlobalSearchWorkspace \/>/);
  assert.match(shellApp, /role="status"[\s\S]*aria-live="polite"/);

  const settingsApp = source('src/renderer/onlypreview/settings/src/App.vue');
  assert.match(
    settingsApp,
    /@change="\(value\) => onlyPreviewSettingsStore\.setWordWrap\(value\)"/
  );
  assert.match(settingsApp, /window\.addEventListener\('keydown', handleWindowKeydown\)/);
  assert.match(settingsApp, /event\.key !== 'Escape'/);
  const settingsStyle = source('src/renderer/onlypreview/settings/src/App.less');
  assert.match(settingsStyle, /html,[\s\S]*#app[\s\S]*height:\s*100%/);
  assert.match(settingsStyle, /\.onlypreview-settings[\s\S]*min-height:\s*0/);

  const monaco = source(
    'src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue'
  );
  assert.match(monaco, /readOnly:\s*true/);
  assert.match(monaco, /domReadOnly:\s*true/);
  assert.match(monaco, /editor\.create/);

  const adapter = source('src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts');
  const viewService = source('src/main/onlypreview/views/onlyPreviewPreviewView.service.ts');
  assert.match(adapter, /descriptor\.kind === 'pdf'/);
  assert.match(adapter, /adapterId:\s*'chromium-pdf'/);
  assert.match(viewService, /plugins:\s*true/);
  assert.doesNotMatch(
    source('src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'),
    /PdfPreview|pdfjs|canvas/
  );
});

test('file-search SQLite remains unencrypted node:sqlite storage', () => {
  const sqliteIndex = source('src/preload/onlypreview/search/core/sqlite-index.mjs');
  const sqliteSchema = source('src/preload/onlypreview/search/core/sqlite-schema.mjs');
  assert.match(sqliteIndex, /import \{ DatabaseSync \} from 'node:sqlite';/);
  assert.match(sqliteIndex, /new DatabaseSync\(databasePath\)/);
  for (const guardedSource of [sqliteIndex, sqliteSchema, source('package.json')]) {
    assert.doesNotMatch(
      guardedSource,
      /sqlcipher|PRAGMA\s+(?:key|cipher(?:_[a-z_]+)?)/iu
    );
  }
});

test('selected Project rows keep their blue surface while excluded rows remain orange', () => {
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');

  assert.match(
    shellApp,
    /'onlypreview-shell__tree-row--search-excluded': row\.searchExcluded/
  );
  assert.equal(
    (
      shellApp.match(
        /'onlypreview-shell__tree-icon--search-excluded-directory': row\.searchExcluded/g
      ) ?? []
    ).length,
    2
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-row--selected \{[^}]*background:\s*#d6e4ff[^}]*color:\s*#303858/
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-row--selected:hover \{[^}]*background:\s*#d6e4ff/
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-row:focus-visible,[^}]*outline:\s*2px solid var\(--onlypreview-focus\)/
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-row--search-excluded \{[^}]*background:\s*#fff4e8/
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-row--search-excluded:hover \{[^}]*background:\s*#ffead3/
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-row--search-excluded\.onlypreview-shell__tree-row--selected \{[^}]*background:\s*#f9dfc2[^}]*color:\s*#303858/
  );
  assert.ok(
    shellStyle.indexOf(
      '.onlypreview-shell__tree-row--search-excluded.onlypreview-shell__tree-row--selected'
    ) > shellStyle.indexOf('.onlypreview-shell__tree-row--selected:hover')
  );
  assert.ok(
    shellStyle.indexOf(
      '.onlypreview-shell__tree-row--search-excluded.onlypreview-shell__tree-row--selected'
    ) > shellStyle.indexOf('.onlypreview-shell__tree-row--search-excluded:hover')
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-icon--search-excluded-directory \{[^}]*color:\s*#c2410c/i
  );
  assert.match(
    shellStyle,
    /\.onlypreview-shell__tree-row--selected::after \{[^}]*background:\s*var\(--onlypreview-royal\)/
  );
});
