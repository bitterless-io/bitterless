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

test('completed threads use one localized silent notification and bundled cross-platform tone', () => {
  const notifier = read('src/main/notificationcenter/notify.helper.ts');
  const handler = read('src/main/xpc/eyesOnAgents.handler.ts');
  const appMain = read('src/main/app.main.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');
  const builder = read('electron-builder.tmp.yml');
  const sound = readFileSync(
    join(root, 'build/sounds/eyes-on-agents-thread-completed.wav')
  );

  assert.match(english, /completionNotification:\s*\{\s*title: 'Thread finished',\s*body: '《\{title\}》'/);
  assert.match(chinese, /completionNotification:\s*\{\s*title: 'Thread 结束',\s*body: '《\{title\}》'/);
  assert.match(notifier, /i18nHelper\.getMessages\(\)\.eyesOnAgents/);
  assert.match(notifier, /messages\.thread\.untitled/);
  assert.match(notifier, /MAX_NOTIFICATION_THREAD_TITLE_LENGTH = 300/);
  assert.match(
    notifier,
    /this\.runtime\.createNotification\(\{\s*title: messages\.completionNotification\.title,[\s\S]*body:[\s\S]*silent: true/
  );
  assert.doesNotMatch(notifier, /shell\.openExternal|openThread\(/);
  assert.doesNotMatch(notifier, /intent\.(?:prompt|response)|lastUserPrompt/);

  assert.match(notifier, /app\.isPackaged/);
  assert.match(notifier, /process\.resourcesPath, 'sounds'/);
  assert.match(notifier, /app\.getAppPath\(\), 'build', 'sounds'/);
  assert.match(notifier, /spawn\('\/usr\/bin\/afplay', \[soundPath\]/);
  assert.match(notifier, /System\.Media\.SoundPlayer/);
  assert.match(notifier, /spawn\(\s*'powershell\.exe'/);
  assert.equal((notifier.match(/shell: false/g) ?? []).length, 2);
  assert.doesNotMatch(notifier, /\bexec(?:File|Sync)?\(/);

  assert.match(handler, /notifyThreadCompleted: \(intent\) => notifyHelper\.notifyThreadCompleted\(intent\)/);
  assert.match(builder, /- from: build\/sounds\s+to: sounds/);
  assert(sound.length > 44, 'Completion WAV must contain audio data');

  assert.match(
    appMain,
    /import\.meta\.env\.VITE_ENV === 'dev'\s*\?\s*'io\.bitterless\.desktop_dev'\s*:\s*'io\.bitterless\.desktop'/
  );
});

test('window contract enforces singleton-safe paths and minimum size', () => {
  const source = read('src/main/xpc/eyesOnAgentsWindow.handler.ts');

  assert.match(source, /creationPromise: Promise<BrowserWindow> \| null/);
  assert.match(source, /minWidth: 800/);
  assert.match(source, /minHeight: 600/);
  assert.match(source, /width: restored\?\.bounds\.width \?\? 1120/);
  assert.match(source, /windowStateService\.register\(\s*'eyes-on-agents',\s*created/);
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

test('silent tiered All polling owns one non-overlapping refresh interval', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.vue');
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const connectionPanel = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  const sharedTypes = read('src/shared/eyesOnAgents/eyesOnAgents.type.ts');
  const mainService = read('src/main/eyesOnAgents/eyesOnAgents.service.ts');
  const mainHandler = read('src/main/xpc/eyesOnAgents.handler.ts');
  const repositoryDao = read('src/preload/sqlite/dao/eyesOnAgents.dao.ts');
  const appServerSupervisor = read(
    'src/main/eyesOnAgents/codexAppServer.supervisor.ts'
  );
  const storePath = 'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts';
  const globalStorePath = 'src/renderer/eyesOnAgents/src/store/global.store.ts';
  const store = read(storePath);
  const globalStore = read(globalStorePath);
  const mounted = app.match(/onMounted\(async \(\) => \{[\s\S]*?\n\}\);/);
  const unmounted = app.match(/onBeforeUnmount\(\(\) => \{[\s\S]*?\n\}\);/);
  const startPolling = store.match(
    /  startRefreshPolling\(\): void \{[\s\S]*?\n  \}(?=\n\n  stopRefreshPolling)/
  );
  const stopPolling = store.match(
    /  stopRefreshPolling\(\): void \{[\s\S]*?\n  \}(?=\n\n  selectProjectFilter)/
  );
  const pollingTick = store.match(
    /  private async performRefreshPollingTick\(\): Promise<void> \{[\s\S]*?\n  \}(?=\n\n  private async performBackgroundThreadPagesRefresh)/
  );
  const backgroundRefresh = store.match(
    /  private async performBackgroundThreadPagesRefresh\(\): Promise<void> \{[\s\S]*?\n  \}(?=\n\n  private async performWindowActivationRefresh)/
  );
  const mainThreadPagesRefresh = mainService.match(
    /  async refreshThreadPages\(\): Promise<EyesOnAgentsThreadPagesRefreshResult> \{[\s\S]*?\n  \}(?=\n\n  private async joinBackgroundRefresh)/
  );
  const mainClaudeBackgroundRefresh = mainService.match(
    /  private refreshClaudeBackground\(\): Promise<void> \{[\s\S]*?\n  \}(?=\n\n  private async joinClaudeBackgroundRefresh)/
  );
  const mainTieredRefresh = mainService.match(
    /  private async performRefreshThreadPages\(context: AppServerContext\): Promise<boolean> \{[\s\S]*?\n  \}(?=\n\n  private async refreshThreadBatch)/
  );
  const mainThreadBatch = mainService.match(
    /  private async refreshThreadBatch\([\s\S]*?\n  \}(?=\n\n  private async projectThreadRefreshCandidate)/
  );
  const mainThreadProjection = mainService.match(
    /  private async projectThreadRefreshCandidate\([\s\S]*?\n  \}(?=\n\n  async openThread)/
  );
  const repositoryPageSelection = repositoryDao.match(
    /  async getThreadRefreshPages\(params: \{[\s\S]*?\n  \}(?=\n\n  async getThreadRefreshCandidate)/
  );
  const timerOwners = walk('src/renderer/eyesOnAgents')
    .filter((path) => /\.(?:ts|vue)$/.test(path))
    .filter((path) => /\bsetInterval\(/.test(read(path)))
    .sort();

  assert.ok(mounted, 'Missing EyesOnAgents mount lifecycle');
  assert.ok(unmounted, 'Missing EyesOnAgents unmount lifecycle');
  assert.match(mounted[0], /eyesOnAgentsStore\.startRefreshPolling\(\)/);
  const startPollingIndex = mounted[0].indexOf('eyesOnAgentsStore.startRefreshPolling()');
  const firstAwaitIndex = mounted[0].indexOf('await ');
  assert.ok(firstAwaitIndex >= 0, 'Missing awaited EyesOnAgents mount work');
  assert.ok(
    startPollingIndex < firstAwaitIndex,
    'Refresh polling must start before the first mounted await',
  );
  assert.match(unmounted[0], /eyesOnAgentsStore\.stopRefreshPolling\(\)/);
  assert.equal((app.match(/eyesOnAgentsStore\.startRefreshPolling\(\)/g) ?? []).length, 1);
  assert.equal((app.match(/eyesOnAgentsStore\.stopRefreshPolling\(\)/g) ?? []).length, 1);

  assert.match(store, /private refreshTimer: number \| null = null/);
  assert.match(store, /private backgroundRefreshPromise: Promise<void> \| null = null/);
  assert.ok(startPolling, 'Missing refresh polling start method');
  assert.match(startPolling[0], /if \(this\.refreshTimer !== null\) return/);
  assert.match(
    startPolling[0],
    /this\.refreshTimer = window\.setInterval\(\(\) => \{\s*void this\.performRefreshPollingTick\(\)\.catch\(\(\) => undefined\);\s*\}, 10_000\)/
  );
  assert.ok(stopPolling, 'Missing refresh polling stop method');
  assert.match(stopPolling[0], /if \(this\.refreshTimer === null\) return/);
  assert.match(stopPolling[0], /window\.clearInterval\(this\.refreshTimer\)/);
  assert.match(stopPolling[0], /this\.refreshTimer = null/);
  assert.doesNotMatch(stopPolling[0], /backgroundRefreshPromise/);
  assert.equal((store.match(/\bsetInterval\(/g) ?? []).length, 1);
  assert.equal((store.match(/\bclearInterval\(/g) ?? []).length, 1);
  assert.equal((globalStore.match(/\bsetInterval\(/g) ?? []).length, 1);
  assert.deepEqual(timerOwners, [storePath, globalStorePath].sort());

  assert.ok(pollingTick, 'Missing refresh polling tick');
  assert.ok(mainTieredRefresh, 'Missing Main-owned tiered All scheduler');
  assert.ok(mainThreadBatch, 'Missing bounded thread refresh batch');
  assert.ok(mainThreadProjection, 'Missing thread/read projection pipeline');
  assert.ok(repositoryPageSelection, 'Missing transactional thread page selector');
  assert.match(
    pollingTick[0],
    /if \(this\.snapshotPromise \|\| this\.busyAction \|\| this\.backgroundRefreshPromise\) return/
  );
  assert.match(
    pollingTick[0],
    /const request = this\.performBackgroundThreadPagesRefresh\(\);[\s\S]*this\.backgroundRefreshPromise = request\.finally\(\(\) => \{[\s\S]*this\.backgroundRefreshPromise = null;[\s\S]*await this\.backgroundRefreshPromise/
  );
  assert.doesNotMatch(pollingTick[0], /connection|shouldSync/);
  assert.ok(backgroundRefresh, 'Missing silent tiered All refresh helper');
  assert.match(
    backgroundRefresh[0],
    /try \{\s*await eyesOnAgentsEmitter\.refreshThreadPages\(\);\s*this\.applySnapshot\(await eyesOnAgentsEmitter\.getSnapshot\(\)\);\s*\} catch/
  );
  assert.match(backgroundRefresh[0], /catch \{[\s\S]*\}/);
  assert.doesNotMatch(backgroundRefresh[0], /actionError|loadError|throw/);
  assert.ok(mainThreadPagesRefresh, 'Missing Main-owned provider refresh coordinator');
  assert.ok(mainClaudeBackgroundRefresh, 'Missing Main-owned Claude reconciliation chain');
  assert.match(
    mainThreadPagesRefresh[0],
    /void this\.refreshClaudeBackground\(\);/,
  );
  assert.match(
    mainClaudeBackgroundRefresh[0],
    /await this\.dependencies\.claudeObservation\?\.refresh\('poll'\)[\s\S]*await this\.dependencies\.repository\.expireClaudeAgentStates\?\./,
  );
  assert.match(
    mainThreadPagesRefresh[0],
    /status\.state === 'connecting' \|\| status\.state === 'syncing'[\s\S]*!this\.dependencies\.appServer\.isConnected\(\) && !this\.autoConnectEnabled/,
  );
  assert.ok(
    mainThreadPagesRefresh[0].indexOf('this.refreshClaudeBackground()')
      < mainThreadPagesRefresh[0].indexOf('this.backgroundRefreshPromise'),
    'Claude polling and lease expiry must remain independent of the Codex connection gate',
  );
  const backgroundPollingFlow = `${pollingTick[0]}\n${backgroundRefresh[0]}`;
  assert.doesNotMatch(
    backgroundPollingFlow,
    /runSnapshotAction\(|syncThreads\(|busyAction\s*=/,
  );
  assert.equal((store.match(/eyesOnAgentsEmitter\.refreshThreadPages\(\)/g) ?? []).length, 1);
  assert.match(
    sharedTypes,
    /export interface EyesOnAgentsThreadPagesRefreshResult \{\s*changed: boolean;\s*\}/,
  );
  assert.match(
    sharedTypes,
    /refreshThreadPages\(\): Promise<EyesOnAgentsThreadPagesRefreshResult>/,
  );
  assert.doesNotMatch(sharedTypes, /refreshThreadPages\(params/);
  assert.match(
    sharedTypes,
    /getThreadRefreshPages\(params: \{\s*coldPage: number;\s*previousPageCount: number \| null;\s*\}\): Promise<EyesOnAgentsThreadRefreshPages>/,
  );
  assert.match(
    mainService,
    /private backgroundRefreshPromise: Promise<EyesOnAgentsThreadPagesRefreshResult> \| null = null/,
  );
  assert.match(
    mainService,
    /if \(this\.backgroundRefreshPromise\) \{\s*return await this\.backgroundRefreshPromise;\s*\}/,
  );
  assert.match(
    mainService,
    /private foregroundAppServerOperationPending = 0/,
  );
  assert.match(
    mainThreadPagesRefresh[0],
    /if \(this\.foregroundAppServerOperationPending > 0\) return false/,
  );
  assert.match(mainService, /const THREAD_REFRESH_PAGE_SIZE = 40/);
  assert.match(mainService, /const THREAD_REFRESH_CONCURRENCY = 4/);
  assert.match(mainService, /private coldThreadRefreshPage = 2/);
  assert.match(mainService, /private threadRefreshPageCount: number \| null = null/);
  assert.match(repositoryDao, /const THREAD_REFRESH_PAGE_SIZE = 40/);
  assert.match(
    repositoryDao,
    /getThreadRefreshPages\(params: \{\s*coldPage: number;\s*previousPageCount: number \| null;\s*\}\): Promise<EyesOnAgentsThreadRefreshPages>/,
  );
  assert.match(
    repositoryDao,
    /const transaction = sqliteManager\.db\.transaction\(\(\): EyesOnAgentsThreadRefreshPages => \{[\s\S]*SELECT COUNT\(\*\) AS count[\s\S]*const hotRows = selectPage\.all\([\s\S]*const coldRows = coldPage === null[\s\S]*return \{\s*hot: hotRows\.map\(toRefreshCandidate\),\s*cold: coldRows\.map\(toRefreshCandidate\),\s*pageCount,\s*coldPage\s*\};\s*\}\);\s*return transaction\(\)/,
  );
  assert.doesNotMatch(
    repositoryPageSelection[0],
    /domain_id|project_key|title\s+LIKE|isEyesOnAgentsFocused/,
  );
  assert.match(
    repositoryPageSelection[0],
    /SELECT \$\{THREAD_REFRESH_CANDIDATE_COLUMNS\}/,
  );
  const repositoryCandidate = repositoryDao.match(
    /const toRefreshCandidate = \([\s\S]*?\n\};/,
  );
  assert.ok(repositoryCandidate, 'Missing shared refresh candidate classifier');
  assert.match(
    repositoryCandidate[0],
    /statusSource === 'codex_hook' \|\| statusSource === 'app_server_turn'[\s\S]*\['working', 'waiting_approval', 'waiting_input'\]\.includes\(runtimeState\)[\s\S]*activeTurnId !== `hook-\$\{statusObservedAt\}`[\s\S]*\{ turnId: activeTurnId, statusObservedAt, statusSource, runtimeState \}/,
  );
  assert.match(
    repositoryCandidate[0],
    /const recoveryCandidate = activeTurn === null &&\s*statusSource === 'discovery' &&\s*runtimeState === 'unknown' &&\s*row\.is_unread === 1 &&\s*activeTurnId === null &&\s*statusObservedAt !== null/,
    'missed-working recovery must select only unread discovery+unknown rows with no active turn',
  );
  assert.match(
    repositoryDao,
    /async getThreadRefreshCandidate\(params: \{[\s\S]*?WHERE provider = 'codex' AND thread_id = \? AND archive_state = 'active'[\s\S]*?toRefreshCandidate\(row\)/,
    'one-thread status sync must reuse the same candidate classification',
  );
  assert.match(
    repositoryDao,
    /ORDER BY COALESCE\(last_activity_at, updated_at\) DESC,\s*updated_at DESC, thread_id ASC\s*LIMIT \? OFFSET \?/,
  );
  assert.match(
    repositoryDao,
    /const pageCountShrank = params\.previousPageCount !== null &&\s*pageCount < params\.previousPageCount;[\s\S]*const coldPage = pageCount <= 1\s*\? null\s*: pageCountShrank \|\| params\.coldPage > pageCount\s*\? 2\s*: params\.coldPage/,
  );
  assert.match(
    mainService,
    /const selected = await this\.awaitUnlessCancelled\(\s*this\.dependencies\.repository\.getThreadRefreshPages\(\{\s*coldPage: this\.coldThreadRefreshPage,\s*previousPageCount: this\.threadRefreshPageCount\s*\}\)/,
  );
  assert.match(
    mainService,
    /const pageCount = selected\.value\.pageCount;\s*const coldPage = selected\.value\.coldPage;[\s\S]*this\.threadRefreshPageCount = pageCount/,
  );
  assert.match(
    mainTieredRefresh[0],
    /selected\.value\.hot\.length > THREAD_REFRESH_PAGE_SIZE \|\|\s*selected\.value\.cold\.length > THREAD_REFRESH_PAGE_SIZE[\s\S]*new Set\(selectedThreadIds\)\.size !== selectedThreadIds\.length/,
  );
  assert.doesNotMatch(
    mainTieredRefresh[0],
    /getSnapshot\(|isEyesOnAgentsFocused|domainId|projectKey|titleQuery/,
  );
  assert.match(
    mainService,
    /const hot = await this\.refreshThreadBatch\([\s\S]*if \(!hot\.completed\) return hot\.changed;[\s\S]*let cold: ThreadRefreshBatchResult;[\s\S]*cold = await this\.refreshThreadBatch\([\s\S]*if \(!cold\.completed\) return changed;[\s\S]*this\.coldThreadRefreshPage = coldPage >= pageCount\s*\? 2\s*: coldPage \+ 1/,
  );
  assert.match(
    mainService,
    /if \(cancelled \|\| !this\.isAppServerActive\(context\)\) \{\s*return \{ changed: false, completed: false \};\s*\}/,
  );
  assert.match(
    mainThreadProjection[0],
    /\): Promise<CancellableResult<EyesOnAgentsThreadRefreshPatch \| null>> \{\s*const observedAt = this\.now\(\);[\s\S]*const read = await this\.awaitUnlessCancelled\([\s\S]*readThread\(candidate\.threadId\)[\s\S]*parseThreadRefreshRead\(read\.value, \{\s*expectedThreadId: candidate\.threadId\s*\}\)/,
  );
  assert.match(
    mainService,
    /const workerCount = Math\.min\(THREAD_REFRESH_CONCURRENCY, candidates\.length\);[\s\S]*for \(let index = 0; index < workerCount; index \+= 1\) workers\.push\(worker\(\)\);[\s\S]*await Promise\.all\(workers\)/,
  );
  assert.match(
    mainService,
    /readThread\(candidate\.threadId\)[\s\S]*projection\.providerActivityAt[\s\S]*listThreadTurns\(candidate\.threadId\)/,
  );
  assert.match(
    mainService,
    /promptAdmission\.enabled[\s\S]*candidate\.lastUserPromptCheckedAt === null[\s\S]*projection\.providerActivityAt > candidate\.lastUserPromptCheckedAt/,
  );
  assert.match(
    mainService,
    /if \(!promptWriteAllowed\) delete patch\.lastUserPrompt;[\s\S]*if \(refreshed\.changed \|\| clearedDiagnostic\) this\.notify\(\)/,
  );
  assert.match(
    mainThreadBatch[0],
    /const refreshed = await this\.dependencies\.repository\.refreshThreadPage\(\{\s*threads: semanticPatches\s*\}\);\s*for \(const intent of refreshed\.completionAlerts \?\? \[\]\) \{\s*this\.notifyThreadCompleted\(intent\);\s*\}[\s\S]*if \(!this\.isAppServerActive\(context\)\) \{\s*return \{ changed: refreshed\.changed, completed: false \};\s*\}\s*if \(refreshed\.changed \|\| clearedDiagnostic\) this\.notify\(\);\s*return \{ changed: refreshed\.changed, completed: true \}/,
  );
  assert.doesNotMatch(
    mainThreadBatch[0],
    /awaitUnlessCancelled\([\s\S]*repository\.refreshThreadPage/,
  );
  assert.match(
    mainService,
    /const operation = callback\(context\);\s*this\.activeAppServerOperations\.add\(operation\);\s*try \{\s*await operation;\s*\} finally \{\s*this\.activeAppServerOperations\.delete\(operation\);\s*\}/,
  );
  assert.match(
    mainService,
    /private async joinAppServerWork\(\): Promise<void> \{[\s\S]*this\.activeAppServerOperations,[\s\S]*this\.activeAppServerRuntimeOperations[\s\S]*await Promise\.allSettled\(\[\.\.\.pending\]\)[\s\S]*private async performAppServerTeardown\(\): Promise<void> \{[\s\S]*await this\.joinAppServerWork\(\)/,
  );
  assert.match(
    repositoryDao,
    /thread\.lastActivityAt > row\.last_activity_at[\s\S]*updates\.set\('last_activity_at', thread\.lastActivityAt\)/,
  );
  assert.match(
    repositoryDao,
    /if \(updates\.size > 0\) \{[\s\S]*WHERE provider = 'codex' AND thread_id = \? AND archive_state = 'active'/,
  );
  assert.match(
    repositoryDao,
    /status_source = 'app_server'[\s\S]*WHERE provider = 'codex' AND thread_id = \?[\s\S]*AND archive_state = 'active'[\s\S]*AND status_source = \?[\s\S]*AND runtime_state IN \('working', 'waiting_approval', 'waiting_input'\)[\s\S]*AND active_turn_id = \?[\s\S]*AND status_observed_at = \?/,
  );
  assert.match(
    repositoryDao,
    /runtime_state = 'working',[\s\S]*status_source = 'app_server_turn',[\s\S]*WHERE provider = 'codex' AND thread_id = \?[\s\S]*AND archive_state = 'active'[\s\S]*AND is_unread = 1[\s\S]*AND status_source = 'discovery'[\s\S]*AND runtime_state = 'unknown'[\s\S]*AND active_turn_id IS NULL[\s\S]*AND status_observed_at = \?[\s\S]*AND COALESCE\(last_completed_turn_id, ''\) <> \?/,
    'working recovery must compare-and-set against the exact selected candidate',
  );
  assert.match(
    repositoryDao,
    /WHEN eyes_on_agents_thread\.status_source = 'app_server_turn'\s*THEN eyes_on_agents_thread\.active_turn_id/,
    'full inventory discovery must preserve recovered active identity',
  );
  assert.match(
    mainService,
    /async connectAppServer\(\): Promise<EyesOnAgentsSnapshot> \{\s*this\.foregroundAppServerOperationPending \+= 1;[\s\S]*?await this\.joinBackgroundRefresh\(\)[\s\S]*?finally \{\s*this\.foregroundAppServerOperationPending -= 1;/,
  );
  assert.match(
    mainService,
    /async syncThreads\(\): Promise<EyesOnAgentsSnapshot> \{\s*this\.foregroundAppServerOperationPending \+= 1;[\s\S]*?await this\.joinBackgroundRefresh\(\)[\s\S]*?finally \{\s*this\.foregroundAppServerOperationPending -= 1;/,
  );
  assert.match(
    mainService,
    /async syncThreads\(\): Promise<EyesOnAgentsSnapshot> \{[\s\S]*?await this\.performSync\(context\);\s*if \(!this\.isAppServerActive\(context\)\) return;\s*await this\.performRefreshThreadPages\(context\);/,
  );
  assert.match(
    mainService,
    /thread\.provider === 'claude'[\s\S]*?claudeLastUserPromptCaptureEnabled[\s\S]*?: lastUserPromptCaptureEnabled[\s\S]*?state: 'unavailable' as const,[\s\S]*?checkedAt: null,[\s\S]*?truncated: false/,
  );
  assert.match(
    mainService,
    /Object\.prototype\.hasOwnProperty\.call\(turnValue, 'itemsView'\)[\s\S]*?turnValue\.itemsView !== 'full'/,
  );
  assert.match(
    appServerSupervisor,
    /Object\.prototype\.hasOwnProperty\.call\(turn, 'itemsView'\)[\s\S]*?turn\.itemsView !== 'full'/,
  );
  assert.match(
    appServerSupervisor,
    /this\.request\(connection, 'thread\/read', \{\s*threadId,\s*includeTurns: false\s*\}\)/,
  );
  const fullTurnPagination = appServerSupervisor.match(
    /async listThreadTurns\(threadId: string\): Promise<unknown\[]> \{[\s\S]*?\n  \}\n\n  async readLatestThreadTurn/,
  );
  assert.ok(fullTurnPagination, 'Missing bounded full-turn pagination');
  assert.match(
    fullTurnPagination[0],
    /for \(let page = 0; page < THREAD_TURN_LIMIT; page \+= 1\)/,
  );
  assert.match(
    fullTurnPagination[0],
    /this\.request\(connection, 'thread\/turns\/list', \{\s*threadId,\s*cursor,\s*itemsView: 'full',\s*sortDirection: 'desc',\s*limit: 1\s*\}\)/,
  );
  assert.match(
    fullTurnPagination[0],
    /parseTurnCursor\(result\.nextCursor, 'nextCursor'\)[\s\S]*parseTurnCursor\(result\.backwardsCursor, 'backwardsCursor'\)[\s\S]*turnContainsTextualUserMessage\(turn\)[\s\S]*visitedCursors\.has\(nextCursor\)/,
  );
  assert.match(
    appServerSupervisor,
    /capabilities: \{ experimentalApi: true \}/,
  );
  assert.match(
    appServerSupervisor,
    /readLatestThreadTurn\(threadId: string\): Promise<unknown \| null>[\s\S]*this\.request\(connection, 'thread\/turns\/list', \{\s*threadId,\s*cursor: null,\s*itemsView: 'notLoaded',\s*sortDirection: 'desc',\s*limit: 1\s*\}\)[\s\S]*turn\.itemsView !== 'notLoaded'[\s\S]*turn\.items\.length !== 0/,
  );
  assert.match(
    mainThreadProjection[0],
    /const activeTurn = candidate\.activeTurn \?\? null[\s\S]*if \(activeTurn !== null \|\| recoveryCandidate !== null\)[\s\S]*readLatestThreadTurn\(\s*candidate\.threadId\s*\)[\s\S]*terminalTurnFromLatest[\s\S]*recoveredTurnFromLatest/,
  );
  assert.match(
    mainThreadProjection[0],
    /const recoveryCandidate = activeTurn === null\s*\? candidate\.recoveryCandidate \?\? null\s*: null/,
    'one thread may take either terminal reconciliation or working recovery, never both',
  );
  const handlerRefresh = mainHandler.match(
    /async refreshThreadPages\(\): Promise<EyesOnAgentsThreadPagesRefreshResult> \{[\s\S]*?\n  \}/,
  );
  assert.ok(handlerRefresh, 'Missing changed-only tiered All refresh handler');
  assert.match(
    handlerRefresh[0],
    /return await eyesOnAgentsService\.refreshThreadPages\(\)/,
  );
  assert.doesNotMatch(handlerRefresh[0], /EyesOnAgentsSnapshot|getSnapshot\(/);
  assert.match(
    store,
    /async syncThreads\(\): Promise<void> \{\s*await this\.runSnapshotAction\('sync', \(\) => eyesOnAgentsEmitter\.syncThreads\(\)\);\s*\}/,
  );
  assert.equal(
    (menuBar.match(/:loading="eyesOnAgentsStore\.busyAction === 'sync'"/g) ?? []).length,
    1,
  );
  assert.equal(
    (connectionPanel.match(/:loading="eyesOnAgentsStore\.busyAction === 'sync'"/g) ?? []).length,
    1,
  );
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
  assert.doesNotMatch(source, /vuedraggable|<draggable/);
  assert.doesNotMatch(source, /moveThread|createDomain|renameDomain|deleteDomain|reorderDomains/);
});

test('observation surfaces use Todo-style background hierarchy without decorative borders', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.less');
  const domain = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const thread = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less'
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

  assert.doesNotMatch(domain, /agent-domain__title-input|agent-domain__title-sizer|agent-domain__drag-handle/);

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

  assert.match(component, /:aria-label="cardAriaLabel"/);
  assert.match(component, /@dblclick="handleDoubleClick"/);
  assert.match(component, /@keydown\.enter\.prevent="handleOpen"/);
  assert.match(component, /eyesOnAgentsStore\.openThread\(props\.thread\.sessionKey\)/);
  assert.match(
    component,
    /v-if="\['working', 'waiting_approval', 'waiting_input'\]\.includes\(thread\.runtimeState\)"[\s\S]*?class="thread-card__working"[\s\S]*?role="status"[\s\S]*?:aria-label="runtimeLabel"[\s\S]*?<a-spin :size="12"/
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
    /<a-tooltip v-if="canOpenThread" :content="openTooltip"[\s\S]*?<a-button[\s\S]*?<\/a-button>[\s\S]*?<\/a-tooltip>/
  );
  assert.ok(openAction, 'Missing localized Open tooltip and button');
  assert.match(openAction[0], /:title="openTooltip"/);
  assert.match(openAction[0], /:aria-label="openAriaLabel"/);
  assert.match(openAction[0], /:loading="eyesOnAgentsStore\.openingSessionKeys\.has\(thread\.sessionKey\)"/);
  assert.match(openAction[0], /:disabled="eyesOnAgentsStore\.openingSessionKeys\.has\(thread\.sessionKey\)"/);
  assert.match(openAction[0], /@click\.stop="handleOpen"/);
  assert.match(openAction[0], /<template #icon><IconExternalLink :size="9" \/><\/template>/);
  assert.doesNotMatch(
    openAction[0],
    /\{\{\s*i18nHelper\.eyesOnAgents\.actions\.open\s*\}\}/
  );
  assert.match(
    component,
    /import \{ isEyesOnAgentsTerminal \} from '@shared\/eyesOnAgents\/eyesOnAgents\.contract';/
  );
  assert.match(
    component,
    /const showUnreadDot = computed\(\(\) =>\s*props\.thread\.isUnread && isEyesOnAgentsTerminal\(props\.thread\.runtimeState\)\);/
  );
  assert.match(
    component,
    /const openAriaLabel = computed\(\(\) => showUnreadDot\.value[\s\S]*?openTooltip\.value[\s\S]*?thread\.new/
  );
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
    /:aria-label="moreAriaLabel"[\s\S]*?<IconDots :size="12" \/>/
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

test('Claude UI stays provider-qualified, compact, and content-boundary safe', () => {
  const card = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );
  const panel = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  const claudeCard = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue'
  );
  const panelStyles = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less'
  );
  const handler = read('src/main/xpc/eyesOnAgents.handler.ts');
  const sharedTypes = read('src/shared/eyesOnAgents/eyesOnAgents.type.ts');
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');
  const rendererSource = walk('src/renderer/eyesOnAgents')
    .filter((path) => /\.(?:ts|vue)$/.test(path))
    .map((path) => read(path))
    .join('\n');

  assert.match(card, /:data-session-key="thread\.sessionKey"/);
  assert.match(card, /:data-provider="thread\.provider"/);

  assert.match(
    card,
    /a-dropdown v-if="canPreviewTranscript"[\s\S]*actions\.previewTranscript/,
  );
  assert.match(
    card,
    /const canPreviewTranscript = computed\(\(\) => props\.thread\.provider === 'claude'\s*&& props\.thread\.canPreviewTranscript\);/,
  );
  assert.match(
    card,
    /eyesOnAgentsStore\.previewThread\(props\.thread\.sessionKey\)/,
  );
  assert.match(
    store,
    /async previewThread\(sessionKey: EyesOnAgentsSessionKey\): Promise<void>[\s\S]*thread\.provider !== 'claude'[\s\S]*!thread\.canPreviewTranscript[\s\S]*eyesOnAgentsEmitter\.previewThread\(\{ sessionKey \}\)/,
  );
  assert.doesNotMatch(store, /threadSearch|openThreadSearch|closeThreadSearch/);
  assert.doesNotMatch(rendererSource, /transcriptPath|\.jsonl|claude:\/\//);

  assert.match(panel, /<ClaudeObservationCard \/>/);
  assert.match(claudeCard, /snapshot\?\.claudeBridge/);
  assert.match(claudeCard, /bridge\?\.listeningSince/);
  assert.match(claudeCard, /bridge\?\.firstReceiptAt/);
  assert.match(claudeCard, /bridge\?\.lastReceiptAt/);
  assert.match(claudeCard, /bridge\?\.lastInspectedAt/);
  assert.match(claudeCard, /bridge\.value\?\.observationProof === 'receipt'/);
  assert.match(claudeCard, /state\.value === 'observing'/);
  assert.match(claudeCard, /claudeBridge\.proofPrevious/);
  assert.match(claudeCard, /state\.value === 'needs_review'/);
  assert.match(claudeCard, /bridge\.value\?\.setupAction \?\? 'enable'/);
  assert.match(claudeCard, /v-if="setupAction !== 'none'"/);
  assert.match(claudeCard, /v-if="setupAction === 'reload'"/);
  assert.match(claudeCard, /v-else-if="setupAction === 'retry'"/);
  assert.match(claudeCard, /case 'finish': return i18nHelper\.eyesOnAgents\.claudeBridge\.finishSetup/);
  assert.match(claudeCard, /case 'retry': return i18nHelper\.eyesOnAgents\.claudeBridge\.listenerPaused/);
  assert.match(claudeCard, /case 'repair': return i18nHelper\.eyesOnAgents\.claudeBridge\.repair/);
  assert.doesNotMatch(claudeCard, /claudeHookGuide|claudeHookGuideStep|hook-steps/);
  const claudeInstalledStatus = cssRule(
    panelStyles,
    '.eyes-connection-card--claude .eyes-connection-card__status--installed'
  );
  assert.match(claudeInstalledStatus, /color: #586077/);
  assert.match(claudeInstalledStatus, /background: #eef0f5/);
  assert.match(claudeCard, /eyesOnAgentsStore\.installClaudeBridge\(\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.refreshClaudeBridgeStatus\(\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.removeClaudeBridge\(\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.openNewClaudeSession\(\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.copyClaudeReloadCommand\(\)/);
  assert.match(
    claudeCard,
    /setupAction === 'retry'[\s\S]*@click="handleRefresh"[\s\S]*claudeBridge\.retryListener/,
  );
  assert.match(
    claudeCard,
    /v-if="setupAction !== 'retry'"[\s\S]*claudeBridge\.checkStatus/,
    'paused-listener setup must not duplicate Check status below the setup action',
  );
  assert.match(claudeCard, /<span aria-live="polite">\{\{ reloadCommandCopyLabel \}\}<\/span>/);
  assert.match(
    claudeCard,
    /await eyesOnAgentsStore\.copyClaudeReloadCommand\(\);[\s\S]*reloadCommandCopied\.value = true;[\s\S]*catch \{[\s\S]*reloadCommandCopied\.value = false;/,
  );
  assert.match(
    claudeCard,
    /if \(action !== 'reload'\) \{[\s\S]*reloadCommandCopied\.value = false;/,
  );
  assert.match(
    claudeCard,
    /v-if="troubleshootingVisible"[\s\S]*claudeBridge\.hooksDiagnostic[\s\S]*claudeBridge\.hooksCommand/,
  );
  assert.match(claudeCard, /providerError\.value !== null \|\|/);
  assert.match(
    store,
    /installClaudeBridge\(\)[\s\S]*refreshClaudeBridgeStatus\(\)[\s\S]*removeClaudeBridge\(\)/,
  );
  assert.match(
    store,
    /openNewClaudeSession\(\): Promise<void>[\s\S]*eyesOnAgentsEmitter\.openNewClaudeSession\(\)/,
  );
  assert.match(
    store,
    /copyClaudeReloadCommand\(\): Promise<void>[\s\S]*eyesOnAgentsEmitter\.copyClaudeReloadCommand\(\)/,
  );
  assert.match(claudeCard, /name="eyesOnAgents__connections__claudeDirectories"/);
  assert.match(
    claudeCard,
    /<a-input[\s\S]*:model-value="directoryPath"[\s\S]*readonly[\s\S]*\/>/,
    'the directory path must use a read-only Arco Input',
  );
  assert.match(claudeCard, /eyesOnAgentsStore\.changeClaudeDirectory\(\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.useAutomaticClaudeDirectory\(\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.retryClaudeDirectory\(\)/);
  assert.match(
    claudeCard,
    /const canUseAutomaticDirectory = computed\(\(\) => \([\s\S]*directory\.value\?\.mode === 'custom' \|\| directory\.value\?\.state === 'error'/,
    'a malformed saved directory must still expose Use automatic recovery',
  );
  assert.match(store, /eyesOnAgentsEmitter\.changeClaudeDirectory\(\)/);
  assert.match(store, /eyesOnAgentsEmitter\.useAutomaticClaudeDirectory\(\)/);
  assert.match(store, /eyesOnAgentsEmitter\.retryClaudeDirectory\(\)/);
  assert.match(handler, /dialog\.showOpenDialog\(\{[\s\S]*properties: \['openDirectory'\]/);
  assert.match(handler, /async changeClaudeDirectory\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.match(handler, /async useAutomaticClaudeDirectory\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.match(handler, /async retryClaudeDirectory\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.match(sharedTypes, /changeClaudeDirectory\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.doesNotMatch(sharedTypes, /changeClaudeDirectory\([^)]*(?:path|directory|url)/i,
    'the renderer contract must not accept a custom path');
  assert.doesNotMatch(rendererSource, /showOpenDialog|pickDirectory|configDirectory\s*:/);
  const directorySurface = cssRule(panelStyles, '.eyes-connection-card__directories');
  assert.match(directorySurface, /background:/);
  assert.doesNotMatch(directorySurface, /\bborder\s*:|box-shadow/,
    'the directory block must use background hierarchy without a decorative border');

  const setupSurface = cssRule(panelStyles, '.eyes-connection-card__setup');
  assert.match(setupSurface, /background:/);
  assert.doesNotMatch(setupSurface, /\bborder\s*:|box-shadow/,
    'the setup action must use background hierarchy without a decorative border');
  assert.match(english, /enable: 'Enable Claude observation'/);
  assert.match(english, /finishSetup: 'Finish setup'/);
  assert.match(english, /reloadInClaude: 'Reload in Claude'/);
  assert.match(english, /listenerPaused: 'Listener paused'/);
  assert.match(english, /retryListener: 'Retry listener'/);
  assert.match(english, /openNewSession: 'Open new Claude session'/);
  assert.match(english, /copyReloadCommand: 'Copy \/reload-plugins'/);
  assert.match(english, /copied: 'Copied'/);
  assert.match(english, /stillNotWorking: 'Still not working\?'/);
  assert.match(english, /hooksCommand: '\/hooks'/);
  assert.match(english, /updates automatically after the first event/);
  assert.match(chinese, /enable: '启用 Claude 观测'/);
  assert.match(chinese, /finishSetup: '完成设置'/);
  assert.match(chinese, /reloadInClaude: '在 Claude 中重新加载'/);
  assert.match(chinese, /listenerPaused: '监听已暂停'/);
  assert.match(chinese, /retryListener: '重试监听'/);
  assert.match(chinese, /copyReloadCommand: '复制 \/reload-plugins'/);
  assert.match(chinese, /copied: '已复制'/);
  assert.match(chinese, /hooksCommand: '\/hooks'/);
  assert.match(chinese, /previewTranscript: '预览对话文件'/);
  assert.match(english, /title: 'Session directories'/);
  assert.match(english, /useAutomatic: 'Use automatic'/);
  assert.match(chinese, /title: '会话目录'/);
  assert.match(chinese, /useAutomatic: '恢复自动发现'/);
});

test('thread cards disclose only the bounded latest-question projection', () => {
  const component = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  const prompt = component.match(
    /<p\s+v-if="promptDisplay !== null"\s+class="thread-card__prompt"[\s\S]*?<\/p>/
  );
  assert.ok(prompt, 'Missing optional latest-question row');
  assert.match(prompt[0], /:title="promptAriaLabel"/);
  assert.match(prompt[0], /:aria-label="promptAriaLabel"/);
  assert.match(prompt[0], /\{\{ promptDisplay \}\}/);
  assert.doesNotMatch(prompt[0], /<Icon|<a-spin|badge/);

  assert.match(
    component,
    /const storedPrompt = computed\(\(\) => props\.thread\.lastUserPrompt\.preview \?\? ''\)/
  );
  assert.match(
    component,
    /const hasAvailablePrompt = computed\(\(\) =>[\s\S]*lastUserPrompt\.state === 'available'[\s\S]*Boolean\(props\.thread\.lastUserPrompt\.preview\)\)/
  );
  assert.match(
    component,
    /lastUserPrompt\.state === 'pending'[\s\S]*latestQuestionPending[\s\S]*if \(!hasAvailablePrompt\.value\) return null;[\s\S]*storedPrompt\.value\.replace\(\/\\s\+\/gu, ' '\)\.trim\(\) \|\| null/
  );
  assert.match(
    component,
    /latestQuestion[\s\S]*?\.replace\('\{question\}', storedPrompt\.value\)[\s\S]*lastUserPrompt\.truncated[\s\S]*latestQuestionTruncated/
  );
  assert.match(
    component,
    /const cardAriaLabel = computed\(\(\) => \[[\s\S]*displayTitle\.value,[\s\S]*runtimeLabel\.value,[\s\S]*promptAriaLabel\.value,[\s\S]*\.filter\(Boolean\)\.join\(', '\)\)/
  );
  assert.doesNotMatch(component, /lastUserPrompt\.preview\s*=/);

  const promptStyles = cssRule(styles, '.thread-card__prompt');
  assert.match(promptStyles, /font-size: 11px/);
  assert.match(promptStyles, /line-height: 14px/);
  assert.match(promptStyles, /white-space: nowrap/);
  assert.match(promptStyles, /overflow: hidden/);
  assert.match(promptStyles, /text-overflow: ellipsis/);
  assert.match(promptStyles, /margin: 0/);
  assert.doesNotMatch(promptStyles, /\bborder\s*:|background|box-shadow|line-clamp/);

  assert.match(english, /latestQuestion: 'Latest user question: \{question\}'/);
  assert.match(english, /latestQuestionPending: 'Latest user question pending'/);
  assert.match(english, /latestQuestionTruncated: '[^']*8192-byte local limit[^']*'/);
  assert.match(chinese, /latestQuestion: '最后一个用户问题：\{question\}'/);
  assert.match(chinese, /latestQuestionPending: '最后一个用户问题待同步'/);
  assert.match(chinese, /latestQuestionTruncated: '[^']*本机 8192 字节上限[^']*'/);
});

test('Focus is the whole board and lists every visible thread', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const projectFilter = read(
    'src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.vue'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.equal(
    (board.match(/<DomainColumn/g) ?? []).length,
    1,
    'the board renders exactly one column'
  );
  assert.match(board, /:title="i18nHelper\.eyesOnAgents\.board\.focus"/);
  assert.match(board, /:threads="eyesOnAgentsStore\.filteredFocusThreads"/);
  assert.doesNotMatch(board, /board\.all|threadsForDomain|customDomains|total-count|totalCount/);

  const focusThreads = store.match(
    /  get focusThreads\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(focusThreads, 'Missing Focus projection');
  assert.match(
    focusThreads[0],
    /return sortThreads\(this\.threads\);/,
    'Focus must list every visible thread in comparator order'
  );
  assert.doesNotMatch(
    focusThreads[0],
    /isEyesOnAgentsFocused|thread\.isFocused/,
    'Focus membership is no longer an attention subset'
  );
  assert.match(store, /buildEyesOnAgentsProjectFilterOptions\(\s*this\.focusThreads,/);
  assert.match(store, /filterEyesOnAgentsThreadsByProject\(\s*this\.focusThreads,/);
  assert.doesNotMatch(
    store,
    /allThreads|filteredAllThreads|allTitleQuery|allProjectFilter|allProjectOptions/,
    'the retired All projection must leave no renderer state behind'
  );

  assert.match(domain, /<ProjectFilter \/>/);
  assert.match(projectFilter, /<label name="eyesOnAgents__projectFilter"/);
  assert.match(projectFilter, /class="project-filter__label"/);
  assert.match(projectFilter, /allow-search/);
  assert.match(projectFilter, /eyesOnAgentsStore\.projectFilterValue/);
  assert.match(projectFilter, /eyesOnAgentsStore\.projectOptions/);
  assert.match(projectFilter, /selectProjectFilter/);
  assert.match(projectFilter, /class="project-filter__count">\{\{ option\.count \}\}/);
  assert.match(projectFilter, /`\$\{optionLabel\(option\)\} \(\$\{option\.count\}\)`/);
  assert.match(english, /projectFilterLabel: 'Filter by Project'/);
  assert.match(chinese, /projectFilterLabel: '按 Project 筛选'/);
  assert.match(english, /noProject: 'No project'/);
  assert.match(chinese, /noProject: '无 Project'/);
});
test('Focus header exposes a compact parameter-free Read all action', () => {
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const sharedTypes = read('src/shared/eyesOnAgents/eyesOnAgents.type.ts');
  const mainHandler = read('src/main/xpc/eyesOnAgents.handler.ts');
  const mainService = read('src/main/eyesOnAgents/eyesOnAgents.service.ts');
  const repository = read('src/preload/sqlite/dao/eyesOnAgents.dao.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  const button = domain.match(
    /<a-button\s+name="eyesOnAgents__domainColumn__readAll"[\s\S]*?<\/a-button>/
  );
  assert.ok(button, 'Missing Focus-only Read all header action');
  assert.match(button[0], /class="agent-domain__read-all"/);
  assert.match(button[0], /size="mini"/);
  assert.match(button[0], /type="text"/);
  assert.match(button[0], /eyesOnAgentsStore\.readableFocusThreads\.length === 0/);
  assert.match(button[0], /Boolean\(eyesOnAgentsStore\.busyAction\)/);
  assert.match(button[0], /:loading="eyesOnAgentsStore\.busyAction === 'focus-read-all'"/);
  assert.match(button[0], /@click="markAllRead"/);
  assert.match(button[0], /i18nHelper\.eyesOnAgents\.actions\.readAll/);

  const readableFocusThreads = store.match(
    /  get readableFocusThreads\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(readableFocusThreads, 'Missing readable Focus projection');
  assert.match(readableFocusThreads[0], /this\.threads\.filter/);
  assert.match(readableFocusThreads[0], /thread\.isUnread/);
  assert.match(
    readableFocusThreads[0],
    /isEyesOnAgentsTerminal\(thread\.runtimeState\)/,
    'Read all eligibility must reuse the shared terminal allowlist'
  );
  assert.doesNotMatch(
    readableFocusThreads[0],
    /runtimeState !==/,
    'Read all eligibility must not re-derive a negative active list'
  );
  const storeAction = store.match(
    /  async markAllRead\(\): Promise<void> \{[\s\S]*?\n  \}/
  );
  assert.ok(storeAction, 'Missing renderer Read all action');
  assert.match(storeAction[0], /if \(this\.readableFocusThreads\.length === 0\) return/);
  assert.match(
    storeAction[0],
    /runSnapshotAction\('focus-read-all', \(\) => eyesOnAgentsEmitter\.markAllRead\(\)\)/
  );

  assert.match(
    sharedTypes,
    /markAllRead\(params: \{\s*providers: EyesOnAgentsProvider\[\];\s*\}\): Promise<EyesOnAgentsRepositoryMutationResult>/
  );
  assert.match(sharedTypes, /markAllRead\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.match(
    mainHandler,
    /async markAllRead\(\): Promise<EyesOnAgentsSnapshot> \{\s*return await eyesOnAgentsService\.markAllRead\(\);\s*\}/
  );
  const serviceAction = mainService.match(
    /  async markAllRead\(\): Promise<EyesOnAgentsSnapshot> \{[\s\S]*?\n  \}/
  );
  assert.ok(serviceAction, 'Missing Main Read all orchestration');
  assert.match(serviceAction[0], /isClaudeProviderAvailable\(\)/);
  assert.match(serviceAction[0], /repository\.markAllRead\(\{ providers: \[\.\.\.providers\] \}\)/);
  assert.match(serviceAction[0], /if \(result\.changed\) this\.notify\(\)/);
  assert.match(serviceAction[0], /return await this\.getSnapshot\(\)/);
  const repositoryAction = repository.match(
    /  async markAllRead\(params: \{[\s\S]*?Promise<EyesOnAgentsRepositoryMutationResult> \{[\s\S]*?\n  \}/
  );
  assert.ok(repositoryAction, 'Missing persistent Read all mutation');
  assert.match(repositoryAction[0], /archive_state <> 'archived'/);
  assert.match(repositoryAction[0], /is_unread = 1/);
  assert.match(repositoryAction[0], /provider IN \(\$\{placeholders\}\)/);
  assert.match(
    repositoryAction[0],
    /runtime_state IN \('idle', 'failed', 'ended'\)/,
    'Read all must use the positive terminal allowlist'
  );
  assert.doesNotMatch(repositoryAction[0], /last_opened_turn_id|last_opened_at|updated_at/);

  const headerStyle = cssRule(styles, '.agent-domain__header');
  assert.match(headerStyle, /justify-content: space-between/);
  const readAllStyle = cssRule(styles, '.agent-domain__read-all.arco-btn');
  assert.match(readAllStyle, /height: 20px/);
  assert.match(readAllStyle, /border: 0/);
  assert.match(readAllStyle, /background: transparent/);
  assert.match(readAllStyle, /box-shadow: none/);
  assert.match(readAllStyle, /font-size: 11px/);
  assert.match(english, /readAll: 'Read all'/);
  assert.match(chinese, /readAll: '全部已读'/);
});

test('Cmd+F activates the Focus title filter and no search modal remains', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.vue');
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');
  const rendererSource = walk('src/renderer/eyesOnAgents')
    .filter((path) => /\.(vue|less|ts|html)$/.test(path))
    .map(read)
    .join('\n');

  assert.doesNotMatch(
    rendererSource,
    /ThreadSearch|thread-search|a-modal/,
    'the global search modal must be gone from every renderer surface'
  );

  const keydown = app.match(
    /const handleWindowKeydown = \(event: KeyboardEvent\): void => \{[\s\S]*?\n\};/
  );
  assert.ok(keydown, 'Missing window keydown handler');
  assert.match(keydown[0], /\(event\.metaKey \|\| event\.ctrlKey\)/);
  assert.match(keydown[0], /event\.key\.toLocaleLowerCase\(\) === 'f'/);
  assert.match(keydown[0], /event\.preventDefault\(\)/);
  assert.match(keydown[0], /void openFocusTitleSearch\(\)/);
  assert.doesNotMatch(keydown[0], /threadSearchVisible|openThreadSearch/);

  const opener = app.match(
    /const openFocusTitleSearch = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  assert.ok(opener, 'Missing Focus filter activation');
  assert.match(opener[0], /await nextTick\(\)/);
  assert.match(opener[0], /agentBoardRef\.value\?\.openTitleSearch\(\)/);

  assert.match(app, /<AgentBoard v-else ref="agentBoardRef" \/>/);
  assert.match(app, /window\.addEventListener\('keydown', handleWindowKeydown\)/);
  assert.match(app, /window\.removeEventListener\('keydown', handleWindowKeydown\)/);
  assert.match(app, /eyesOnAgentsStore\.clearTitleQuery\(\)/);

  assert.match(board, /focusColumnRef\.value\?\.openTitleSearch\(\)/);
  assert.match(board, /defineExpose\(\{ openTitleSearch \}\)/);
  assert.match(domain, /defineExpose\(\{ openTitleSearch \}\)/);

  assert.doesNotMatch(
    store,
    /threadSearchVisible|threadSearchQuery|threadSearchResults|threadSearchSelectedSessionKey|moveThreadSearchSelection|hasThreadSearchQueryTokens/
  );
  assert.doesNotMatch(english, /Task search results|Type a title to search tasks/);
  assert.doesNotMatch(chinese, /任务搜索结果|输入任务标题开始搜索/);
});
test('the Focus title filter is token-based, transient, and lifecycle-safe', () => {
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  const toggle = domain.match(
    /<a-button\s+ref="titleSearchButtonRef"[\s\S]*?<\/a-button>/
  );
  assert.ok(toggle, 'Missing Focus search toggle');
  assert.match(toggle[0], /name="eyesOnAgents__domainColumn__titleSearchToggle"/);
  assert.match(toggle[0], /size="mini"/);
  assert.match(toggle[0], /type="text"/);
  assert.match(toggle[0], /:aria-expanded="titleSearchOpen"/);
  assert.match(toggle[0], /aria-controls="eyes-on-agents-focus-title-search"/);
  assert.match(toggle[0], /@click="toggleTitleSearch"/);
  assert.match(toggle[0], /actions\.searchTitles/);

  const row = domain.match(/<div\s+v-if="titleSearchOpen"[\s\S]*?<\/div>/);
  assert.ok(row, 'Missing Focus search row');
  assert.match(row[0], /id="eyes-on-agents-focus-title-search"/);
  assert.match(row[0], /name="eyesOnAgents__domainColumn__titleSearch"/);
  assert.match(row[0], /role="search"/);
  assert.match(row[0], /@keydown\.esc\.prevent\.stop="closeTitleSearch"/);
  assert.match(row[0], /v-model="eyesOnAgentsStore\.titleQuery"/);
  assert.match(row[0], /board\.titleSearchPlaceholder/);
  assert.match(row[0], /name="eyesOnAgents__domainColumn__clearTitleSearch"/);
  assert.match(row[0], /@click="clearTitleSearch"/);

  const open = domain.match(
    /const openTitleSearch = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  assert.ok(open, 'Missing Focus search opener');
  assert.match(open[0], /titleSearchOpen\.value = true/);
  assert.match(open[0], /focusTitleSearchInput\(\)/);

  const close = domain.match(
    /const closeTitleSearch = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  assert.ok(close, 'Missing Focus search close');
  assert.match(close[0], /eyesOnAgentsStore\.clearTitleQuery\(\)/);
  assert.match(close[0], /titleSearchOpen\.value = false/);
  assert.match(close[0], /titleSearchButtonRef\.value\?\.\$el\?\.focus\(\)/);

  const clear = domain.match(
    /const clearTitleSearch = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  assert.ok(clear, 'Missing Focus search clear');
  assert.match(clear[0], /eyesOnAgentsStore\.clearTitleQuery\(\)/);
  assert.match(clear[0], /focusTitleSearchInput\(\)/);
  assert.match(domain, /onBeforeUnmount\(\(\) => \{\s*eyesOnAgentsStore\.clearTitleQuery\(\);/);

  const filter = store.match(
    /  get filteredFocusThreads\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(filter, 'Missing Focus filter projection');
  assert.match(filter[0], /filterEyesOnAgentsThreadsByProject\(/);
  assert.match(filter[0], /tokenizeThreadTitle\(this\.titleQuery\)/);
  assert.match(filter[0], /queryTokens\.length === 0\) return projectThreads/);
  assert.match(filter[0], /if \(thread\.title === null\) return false/);
  assert.match(
    filter[0],
    /titleTokens\.some\(\(titleToken\) => titleToken\.includes\(queryToken\)\)/
  );
  assert.doesNotMatch(
    filter[0],
    /cwd|projectName|lastUserPrompt|threadId/,
    'the filter must read titles only'
  );
  const tokenizer = store.match(/const tokenizeThreadTitle = [\s\S]*?\.filter\(Boolean\);/);
  assert.ok(tokenizer, 'Missing shared tokenizer');
  assert.match(tokenizer[0], /normalize\('NFKC'\)/);
  assert.match(tokenizer[0], /toLocaleLowerCase\(\)/);
  assert.match(store, /const THREAD_TITLE_SEPARATOR_PATTERN = \/\[\\s\\-_\.\\\/\\\\:\|\]\+\/u;/);
  assert.match(
    store,
    /  get isTitleFiltered\(\): boolean \{\s*return tokenizeThreadTitle\(this\.titleQuery\)\.length > 0;/
  );

  const empty = domain.match(/const emptyLabel = computed\(\(\) => \{[\s\S]*?\n\}\);/);
  assert.ok(empty, 'Missing Focus empty state');
  assert.match(empty[0], /isTitleFiltered[\s\S]*emptyTitleSearch/);
  assert.match(empty[0], /isProjectFiltered[\s\S]*emptyFocus/);
  assert.match(empty[0], /emptyNoProject/);
  assert.match(empty[0], /emptyProject/);

  const searchRow = cssRule(styles, '.agent-domain__search-row');
  assert.match(searchRow, /background: oklch/);
  assert.doesNotMatch(searchRow, /\bborder\s*:\s*[^0]/);
  const searchInput = cssRule(styles, '.agent-domain__search-input.arco-input-wrapper');
  assert.match(searchInput, /border: 0/);
  assert.match(searchInput, /box-shadow: none/);

  assert.match(english, /titleSearchPlaceholder: 'Search titles'/);
  assert.match(chinese, /titleSearchPlaceholder: '搜索标题'/);
  assert.match(english, /searchTitles: 'Search thread titles'/);
  assert.match(english, /clearTitleSearch: 'Clear title search'/);
  assert.match(english, /emptyTitleSearch: 'No thread titles match this search'/);
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

test('the board renders one fixed 300px Focus column that fills its height', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const boardStyles = read(
    'src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.less'
  );
  const domainStyles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );

  assert.doesNotMatch(board, /<draggable|vuedraggable|handleDomainDragEnd|item-key/);

  const boardShell = cssRule(boardStyles, '.agent-board');
  assert.match(boardShell, /height: 100%/);
  assert.match(boardShell, /display: flex/);
  assert.match(boardShell, /padding: 12px/);
  assert.match(boardShell, /overflow: hidden/);
  assert.doesNotMatch(
    boardStyles,
    /flex-wrap|agent-board__columns|overflow-y: auto/,
    'a single column neither wraps nor scrolls the board'
  );

  const shell = cssRule(domainStyles, '.agent-domain');
  assert.match(shell, /width: 300px/);
  assert.match(shell, /min-width: 300px/);
  assert.match(shell, /max-width: 300px/);
  assert.match(shell, /height: 100%/);
  assert.match(shell, /flex: 0 0 300px/);
  assert.doesNotMatch(shell, /max-height/, 'the column fills the window instead of capping at 600px');

  const body = cssRule(domainStyles, '.agent-domain__body');
  assert.match(body, /min-height: 0/);
  assert.match(body, /overflow-y: auto/);
});
test('no Domain affordance remains in the EyesOnAgents renderer', () => {
  const rendererSource = walk('src/renderer/eyesOnAgents')
    .filter((path) => /\.(vue|less|ts|html)$/.test(path))
    .map(read)
    .join('\n');
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');
  const mainHandler = read('src/main/xpc/eyesOnAgents.handler.ts');
  const repositoryDao = read('src/preload/sqlite/dao/eyesOnAgents.dao.ts');

  assert.doesNotMatch(rendererSource, /AddDomainPopover|add-domain-popover/);
  assert.doesNotMatch(
    rendererSource,
    /createDomain|renameDomain|deleteDomain|reorderDomains|moveThread\(/
  );
  assert.doesNotMatch(rendererSource, /actions\.moveTo|board\.addDomain|eyesOnAgents\.domain\./);
  assert.doesNotMatch(menuBar, /Domain/);
  assert.doesNotMatch(
    domain,
    /beginRename|commitRename|confirmDelete|agent-domain__title-input|drag-handle|a-dropdown/
  );
  assert.doesNotMatch(
    store,
    /customDomains|uncategorizedDomain|threadsForDomain|customDomainTitle|EyesOnAgentsDomain/
  );
  const eyesNamespace = (catalog) => {
    const match = catalog.match(/\n  eyesOnAgents: \{[\s\S]*?\n  \},\n/);
    assert.ok(match, 'Missing eyesOnAgents i18n namespace');
    return match[0];
  };
  for (const catalog of [english, chinese]) {
    assert.doesNotMatch(
      eyesNamespace(catalog),
      /addDomain:|domainPlaceholder:|moveTo:|deleteTitle:|emptyDomain:|domain: \{/
    );
  }

  assert.match(
    mainHandler,
    /createDomain/,
    'Domain persistence stays available even though no UI calls it'
  );
  assert.match(repositoryDao, /eyes_on_agents_domain/);
});
test('Codex observation exposes explicit local latest-question retention', () => {
  const panel = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(panel, /name="eyesOnAgents__connections__promptRetention"/);
  assert.match(panel, /eyesOnAgents\.bridge\.promptRetentionLabel/);
  assert.match(panel, /eyesOnAgents\.bridge\.promptRetentionDescription/);
  const captureSwitch = panel.match(
    /<a-switch[\s\S]*?:model-value="lastUserPromptCaptureEnabled"[\s\S]*?\/>/
  );
  assert.ok(captureSwitch, 'Missing latest-question retention switch');
  assert.match(captureSwitch[0], /size="small"/);
  assert.match(
    captureSwitch[0],
    /:loading="eyesOnAgentsStore\.busyAction === 'prompt-retention'"/,
  );
  assert.match(
    captureSwitch[0],
    /:disabled="Boolean\(eyesOnAgentsStore\.busyAction\)"/,
  );
  assert.match(captureSwitch[0], /aria-labelledby="eyes-on-agents-prompt-retention-label"/);
  assert.match(captureSwitch[0], /aria-describedby="eyes-on-agents-prompt-retention-description"/);
  assert.match(
    panel,
    /const lastUserPromptCaptureEnabled = computed\([\s\S]*eyesOnAgentsStore\.snapshot\?\.lastUserPromptCaptureEnabled \?\? false/,
  );
  assert.match(
    panel,
    /handleLastUserPromptCaptureChange[\s\S]*eyesOnAgentsStore\.setLastUserPromptCaptureEnabled\(Boolean\(enabled\)\)/,
  );
  assert.match(
    store,
    /async setLastUserPromptCaptureEnabled\(enabled: boolean\): Promise<void> \{[\s\S]*this\.runSnapshotAction\('prompt-retention',[\s\S]*eyesOnAgentsEmitter\.setLastUserPromptCaptureEnabled\(\{ enabled \}\)/,
  );

  const settingRow = cssRule(styles, '.eyes-connection-card__setting-row');
  assert.match(settingRow, /min-height: 50px/);
  assert.match(settingRow, /border-bottom: 1px solid/);
  assert.doesNotMatch(settingRow, /box-shadow/);
  assert.match(english, /promptRetentionLabel: 'Store latest user question'/);
  assert.match(english, /promptRetentionDescription: 'Off by default · one local question preview'/);
  assert.match(chinese, /promptRetentionLabel: '保存最后一个用户问题'/);
  assert.match(chinese, /promptRetentionDescription: '默认关闭 · 仅保存一条本地问题预览'/);
});

test('Claude observation exposes independent Hook-only latest-question retention', () => {
  const card = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(card, /name="eyesOnAgents__connections__claudePromptRetention"/);
  assert.match(card, /eyesOnAgents\.claudeBridge\.promptRetentionLabel/);
  assert.match(card, /:model-value="lastUserPromptCaptureEnabled"/);
  assert.match(card, /busyAction === 'claude-prompt-retention'/);
  assert.match(card, /snapshot\?\.claudeLastUserPromptCaptureEnabled \?\? false/);
  assert.match(card, /setClaudeLastUserPromptCaptureEnabled\(enabled\)/);
  assert.match(
    store,
    /setClaudeLastUserPromptCaptureEnabled[\s\S]*runSnapshotAction\('claude-prompt-retention'[\s\S]*setClaudeLastUserPromptCaptureEnabled\(\{ enabled \}\)/,
  );
  assert.match(english, /promptRetentionDescription: 'Off by default · Hook keeps one local question preview'/);
  assert.match(chinese, /promptRetentionDescription: '默认关闭 · Hook 仅保存一条本地问题预览'/);
});

test('connection panel presents status-first Codex observation settings', () => {
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
  assert.match(panel, /const showHookSettingsAttention = computed\(\(\) => bridgeState\.value === 'needs_trust'\)/);
  assert.match(panel, /eyesOnAgentsStore\.refreshCodexBridgeStatus\(\)/);
  assert.match(panel, /bridgeReviewReason\.value === 'disabled'/);
  assert.match(panel, /bridge\.value\?\.listening[\s\S]*statusObserving[\s\S]*statusPaused/);
  assert.doesNotMatch(panel, /eyesOnAgentsStore\.reviewCodexBridge\(\)/);
  assert.doesNotMatch(panel, /lastInspectedAt|lastEventAt|listeningSince/);
  assert.doesNotMatch(panel, /!canDisconnect\.value/);
  assert.match(menuBar, /case 'needs_trust'/);
  assert.match(english, /title: 'Codex observation'/);
  assert.match(english, /Installed, paused/);
  assert.match(english, /Codex → Settings → Hooks/);
  assert.match(english, /SessionStart · UserPromptSubmit · PermissionRequest · Stop/);
  assert.match(chinese, /title: 'Codex 观测'/);
  assert.match(chinese, /已安装，监听暂停/);
  assert.match(chinese, /Codex → 设置 → Hooks/);
  assert.match(chinese, /SessionStart · UserPromptSubmit · PermissionRequest · Stop/);
  assert.doesNotMatch(english, /Managed by Connect/);
  assert.doesNotMatch(chinese, /由“连接”统一管理/);
});

test('Codex observation uses a flat action list without unsupported external controls', () => {
  const panel = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  const bridgeCard = panel.match(
    /<section\s+name="eyesOnAgents__connections__bridge"[\s\S]*?<\/section>/
  );
  assert.ok(bridgeCard, 'Missing Codex observation card');
  assert.match(
    bridgeCard[0],
    /eyes-connection-card__status[\s\S]*@click="handleRefreshBridge"[\s\S]*bridge\.checkStatus/
  );
  assert.doesNotMatch(
    bridgeCard[0].match(/@click="handleRefreshBridge"[\s\S]*?<\/a-button>/)?.[0] ?? '',
    /\bv-if=/
  );
  assert.match(bridgeCard[0], /class="eyes-connection-card__settings-list"/);
  assert.equal(
    (bridgeCard[0].match(/class="eyes-connection-card__setting-row(?: [^"]*)?"/g) ?? []).length,
    4
  );
  assert.match(
    bridgeCard[0],
    /v-if="canEnableBridge \|\| canRepairBridge"\s+name="eyesOnAgents__connections__installHooks"[\s\S]*v-if="canEnableBridge"[\s\S]*v-if="canRepairBridge"/
  );
  const externalRow = bridgeCard[0].match(
    /<div\s+v-if="showHookSettingsAttention"\s+name="eyesOnAgents__connections__codexHookSettings"[\s\S]*?<\/div>\s*<\/div>/
  );
  assert.ok(externalRow, 'Missing Codex Settings → Hooks instruction');
  assert.match(externalRow[0], /eyes-connection-card__setting-row--attention/);
  assert.match(externalRow[0], /codexHookSettingsDescription/);
  assert.doesNotMatch(externalRow[0], /<a-button|<a-switch|setting-action/);
  assert.match(
    bridgeCard[0],
    /v-if="canDisableBridge"\s+name="eyesOnAgents__connections__removeHooks"[\s\S]*@click="handleRemoveBridge"/
  );
  assert.doesNotMatch(
    bridgeCard[0],
    /hookGuide|hook-steps|trust-summary|eyes-connection-card__facts|eyes-connection-card__actions/
  );
  assert.doesNotMatch(panel, /handleReviewBridge|reviewActionLabel|showReviewGuidance/);
  assert.match(panel, /eyesOnAgentsStore\.refreshCodexBridgeStatus\(\)/);
  assert.match(panel, /eyesOnAgentsStore\.removeCodexBridge\(\)/);

  const settingsList = cssRule(styles, '.eyes-connection-card__settings-list');
  assert.match(settingsList, /border-top: 1px solid/);
  const settingRow = cssRule(styles, '.eyes-connection-card__setting-row');
  assert.match(settingRow, /min-height: 50px/);
  assert.match(settingRow, /border-bottom: 1px solid/);
  const attentionRow = cssRule(styles, '.eyes-connection-card__setting-row--attention');
  assert.match(attentionRow, /border-left: 2px solid/);
  assert.match(attentionRow, /background: #fff6e6/);
  assert.doesNotMatch(attentionRow, /box-shadow|border-radius/);
  assert.doesNotMatch(styles, /eyes-connection-card__(?:hook-guide|hook-steps|trust-summary|trust-boundary)/);

  for (const statusKey of [
    'statusNotInstalled',
    'statusDrifted',
    'statusNeedsReview',
    'statusDisabled',
    'statusModified',
    'statusObserving',
    'statusPaused',
    'statusError'
  ]) {
    assert.match(english, new RegExp(`${statusKey}:`));
    assert.match(chinese, new RegExp(`${statusKey}:`));
  }
  assert.match(english, /installHooks: 'Install Bitterless hooks'/);
  assert.match(english, /removeObservation: 'Remove Codex observation'/);
  assert.match(chinese, /installHooks: '安装 Bitterless hooks'/);
  assert.match(chinese, /removeObservation: '移除 Codex 观测'/);
});

test('title enrichment diagnostics stay bounded and drawer-only', () => {
  const panel = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less'
  );
  const app = read('src/renderer/eyesOnAgents/src/App.vue');
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const board = read(
    'src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue'
  );
  const sharedTypes = read('src/shared/eyesOnAgents/eyesOnAgents.type.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(
    sharedTypes,
    /titleEnrichmentDiagnostic: EyesOnAgentsTitleEnrichmentDiagnostic \| null/
  );
  assert.match(
    panel,
    /v-if="titleEnrichmentDiagnostic"[\s\S]*name="eyesOnAgents__connections__titleEnrichmentDiagnostic"[\s\S]*class="eyes-connection-card__diagnostic"[\s\S]*role="status"[\s\S]*eyesOnAgents\.connection\.titleEnrichment[\s\S]*titleEnrichmentDiagnosticLabel/
  );
  assert.match(
    panel,
    /eyesOnAgentsStore\.snapshot\?\.titleEnrichmentDiagnostic \?\? null/
  );
  assert.match(panel, /diagnostic\.threadId\.slice\(0, 8\)/);
  assert.match(panel, /case 'thread_read_rejected'/);
  assert.match(panel, /case 'unusable_response'/);
  assert.match(panel, /titleEnrichmentDeferred/);
  assert.doesNotMatch(panel, /titleEnrichmentDiagnostic\.(?:error|message|content|response)/);
  assert.doesNotMatch(`${app}\n${menuBar}\n${board}`, /titleEnrichmentDiagnostic/);
  const diagnostic = cssRule(styles, '.eyes-connection-card__diagnostic');
  assert.match(diagnostic, /background: oklch/);
  assert.doesNotMatch(diagnostic, /\bborder\s*:|box-shadow|#[\da-f]{3,8}\b|\brgba?\(/i);

  assert.match(english, /titleEnrichmentDeferred:\s*'[^']*\{thread\}[^']*App Server unavailable[^']*A later Refresh can retry\.'/);
  assert.match(english, /titleEnrichmentReadRejected:\s*'[^']*\{thread\}[^']*A later Refresh can retry\.'/);
  assert.match(english, /titleEnrichmentUnusable:\s*'[^']*\{thread\}[^']*A later Refresh can retry\.'/);
  assert.match(chinese, /titleEnrichmentDeferred:\s*'[^']*\{thread\}[^']*App Server 不可用[^']*稍后可通过刷新重试。'/);
  assert.match(chinese, /titleEnrichmentReadRejected:\s*'[^']*\{thread\}[^']*稍后可通过刷新重试。'/);
  assert.match(chinese, /titleEnrichmentUnusable:\s*'[^']*\{thread\}[^']*稍后可通过刷新重试。'/);
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
