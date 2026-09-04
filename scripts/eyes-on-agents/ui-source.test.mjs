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
  assert.match(source, /minWidth: 480/);
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
    /  stopRefreshPolling\(\): void \{[\s\S]*?\n  \}(?=\n\n  clearTitleQuery)/
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
  assert.doesNotMatch(source, /createDomain|renameDomain|deleteDomain|reorderDomains/);
  assert.doesNotMatch(
    source,
    /ProjectFilter|project-filter|projectFilter/,
    'the Project filter is retired from the renderer'
  );
});

test('observation surfaces use Todo-style background hierarchy without decorative borders', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.less');
  const domain = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const thread = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less'
  );

  assert.match(app, /--eyes-canvas: oklch\(0\.985 0 0\)/);
  assert.match(app, /--eyes-item: oklch\(1 0 0\)/);
  assert.match(
    app,
    /--eyes-accent: #606b9d;/,
    'the text-action ink is theme.ts arcoblue-5'
  );
  assert.match(
    app,
    /--eyes-hover-surface: #e2e4eb;/,
    'the text-button hover surface is theme.ts arcoblue-2'
  );
  assert.doesNotMatch(
    app,
    /--eyes-column/,
    'the board has no column surface token left to paint'
  );

  const domainShell = cssRule(domain, '.agent-domain');
  assert.match(
    domainShell,
    /background: transparent/,
    'the column paints nothing: cards sit straight on the board canvas'
  );
  assert.doesNotMatch(domainShell, /border-radius/);

  const appSource = read('src/renderer/eyesOnAgents/src/App.vue');
  assert.doesNotMatch(
    appSource,
    /windowActive|handleWindowBlur|eyes-on-agents--inactive/,
    'the activation tint retired with the surface it painted'
  );
  assert.doesNotMatch(domainShell, /\bborder\s*:/);
  assert.doesNotMatch(domainShell, /box-shadow/);

  assert.doesNotMatch(domain, /agent-domain--focus/);

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
});

test('thread cards use compact title and action rows with accessible status marks', () => {
  const component = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );
  const menu = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCardMenu.vue'
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
    /v-if="isActiveRuntime"[\s\S]*?class="thread-card__status"[\s\S]*?role="status"[\s\S]*?:aria-label="runtimeLabel"[\s\S]*?<a-spin :size="12"/,
    'the active spinner owns the title status slot'
  );
  assert.match(
    component,
    /const isActiveRuntime = computed\(\(\) =>\s*\['working', 'waiting_approval', 'waiting_input'\]\.includes\(props\.thread\.runtimeState\)\);/
  );
  assert.match(
    component,
    /v-else-if="showUnreadDot"[\s\S]*?class="thread-card__status"[\s\S]*?role="img"[\s\S]*?thread\.new[\s\S]*?class="thread-card__unread-dot"/,
    'the unread dot shares that one slot, so spinner and dot can never both show'
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
    /<div class="thread-card__actions">\s*<span class="thread-card__time">[\s\S]*?<div class="thread-card__controls"[\s\S]*?class="thread-card__folder"[\s\S]*?<a-dropdown/
  );
  assert.doesNotMatch(
    component,
    /thread-card__open-control|IconExternalLink :size="9"/,
    'the icon-only Open button is retired from the action row'
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

  const openOption = menu.match(
    /<a-doption\s+v-if="canOpenThread"[\s\S]*?<\/a-doption>/
  );
  assert.ok(openOption, 'Missing provider-named open menu item');
  assert.match(openOption[0], /:disabled="eyesOnAgentsStore\.openingSessionKeys\.has\(thread\.sessionKey\)"/);
  assert.match(openOption[0], /@click="emit\('open'\)"/);
  assert.match(openOption[0], /<IconExternalLink :size="13" aria-hidden="true" \/>/);
  assert.match(openOption[0], /\{\{ openLabel \}\}/);
  assert.match(openOption[0], /actions\.doubleClickHint/);
  assert.match(
    menu,
    /const openLabel = computed\(\(\) => props\.thread\.provider === 'claude'\s*\? i18nHelper\.eyesOnAgents\.actions\.openInClaude\s*: i18nHelper\.eyesOnAgents\.actions\.openInCodex\);/,
    'the open item names the provider it will launch'
  );
  assert.match(english, /openInCodex: 'Open in Codex'/);
  assert.match(english, /openInClaude: 'Open in Claude'/);
  assert.match(english, /doubleClickHint: '\(double click\)'/);
  assert.match(chinese, /openInCodex: '在 Codex 中打开'/);
  assert.match(chinese, /openInClaude: '在 Claude 中打开'/);
  assert.match(chinese, /doubleClickHint: '（双击）'/);

  const readStateOption = menu.match(
    /name="eyesOnAgents__threadCardMenu__readState"[\s\S]*?<\/a-doption>/
  );
  assert.ok(readStateOption, 'Missing manual read-state menu item');
  assert.match(readStateOption[0], /@click="emit\('toggleReadState'\)"/);
  assert.match(readStateOption[0], /\{\{ readStateLabel \}\}/);
  assert.match(
    menu,
    /const readStateLabel = computed\(\(\) => props\.thread\.isUnread\s*\? i18nHelper\.eyesOnAgents\.actions\.markRead\s*: i18nHelper\.eyesOnAgents\.actions\.markUnread\);/,
    'the label follows the stored unread flag'
  );
  assert.match(
    component,
    /const handleToggleReadState = async \(\): Promise<void> => \{[\s\S]*?setThreadUnread\(props\.thread\.sessionKey, !props\.thread\.isUnread\)/
  );
  assert.match(english, /markRead: 'Mark as read'/);
  assert.match(english, /markUnread: 'Mark as unread'/);
  assert.match(chinese, /markRead: '标为已读'/);
  assert.match(chinese, /markUnread: '标为未读'/);

  assert.match(
    component,
    /const showUnreadDot = computed\(\(\) =>\s*props\.thread\.isUnread && !isActiveRuntime\.value\);/,
    'every non-active unread row shows the dot, including an authority-lost one'
  );
  assert.doesNotMatch(
    component,
    /previewThread|previewTranscript|previewingSessionKeys|IconFileText/,
    'transcript preview left the card with its icon and store call'
  );
  assert.match(
    component,
    /const handleCopySessionPath = async \(\): Promise<void> => \{[\s\S]*?copySessionPath\(props\.thread\.sessionKey\)/
  );
  assert.match(english, /copySessionPath: 'Copy session path'/);
  assert.match(chinese, /copySessionPath: '复制会话路径'/);
  assert.doesNotMatch(
    component,
    /openAriaLabel|openTooltip|moreAriaLabel|thread-card__unread-marker|more-control--unread/,
    'the retired Open button takes its labels and dot fallbacks with it'
  );
  assert.match(
    component,
    /<span class="thread-card__unread-dot" aria-hidden="true" \/>/
  );
  const unreadDot = cssRule(styles, '.thread-card__unread-dot');
  assert.match(unreadDot, /background: #ef4444/);
  assert.doesNotMatch(unreadDot, /position: absolute/, 'the dot now sits in flow inside its slot');
  assert.doesNotMatch(
    styles,
    /thread-card__working|unread-marker|more-control--unread/,
    'the retired status and dot styles are gone'
  );

  assert.match(
    component,
    /:aria-label="i18nHelper\.eyesOnAgents\.actions\.more"[\s\S]*?<IconDots :size="12" \/>/
  );
  assert.match(component, /aria-haspopup="menu"/);
  assert.match(component, /:aria-expanded="moreMenuVisible"/);
  const optionRow = cssRule(styles, ".thread-card__option.arco-dropdown-option");
  assert.match(optionRow, /display: flex/);
  assert.match(
    optionRow,
    /align-items: center/,
    "menu icons must center against their label instead of sitting on its baseline"
  );
  const moreHover = cssRule(
    styles,
    '.thread-card__controls .thread-card__more-control.arco-btn:hover'
  );
  assert.match(
    moreHover,
    /background: var\(--eyes-hover-surface\)/,
    'the overflow text button gets the same hover surface as Search'
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
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.thread-card__status \.arco-icon-loading\s*\{[\s\S]*?animation: none/
  );
});

test('thread cards share one viewport-fitted menu across More and right-click', () => {
  const component = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );
  const menu = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCardMenu.vue'
  );
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const service = read('src/main/eyesOnAgents/eyesOnAgents.service.ts');
  const supervisor = read('src/main/eyesOnAgents/codexAppServer.supervisor.ts');
  const handler = read('src/main/xpc/eyesOnAgents.handler.ts');
  const sharedTypes = read('src/shared/eyesOnAgents/eyesOnAgents.type.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.equal(
    (component.match(/<ThreadCardMenu/g) ?? []).length,
    2,
    'More and right-click render the same menu component'
  );
  assert.match(
    component,
    /:popup-visible="contextMenuVisible"[\s\S]*trigger="contextMenu"[\s\S]*position="bottom"[\s\S]*:align-point="true"[\s\S]*:auto-fit-position="true"[\s\S]*:scroll-to-close="true"[\s\S]*popup-container="body"/
  );
  assert.match(
    component,
    /:popup-visible="moreMenuVisible"[\s\S]*trigger="click"[\s\S]*position="br"[\s\S]*popup-container="body"/
  );
  assert.match(
    component,
    /handleMoreMenuVisibleChange[\s\S]*moreMenuVisible\.value = visible;[\s\S]*if \(visible\) contextMenuVisible\.value = false;/
  );
  assert.match(
    component,
    /handleContextMenuVisibleChange[\s\S]*contextMenuVisible\.value = visible;[\s\S]*if \(visible\) moreMenuVisible\.value = false;/
  );
  for (const handlerName of [
    'handleOpen',
    'handleCopySessionPath',
    'handleToggleReadState',
    'handleArchive',
  ]) {
    assert.match(component, new RegExp(`const ${handlerName}[\\s\\S]*?closeMenus\\(\\)`));
  }

  const archiveOption = menu.match(
    /<a-doption\s+v-if="thread\.provider === 'codex'"[\s\S]*?name="eyesOnAgents__threadCardMenu__archive"[\s\S]*?<\/a-doption>/
  );
  assert.ok(archiveOption, 'Archive must be a Codex-only shared-menu item');
  assert.match(archiveOption[0], /thread-card__option--archive/);
  assert.match(archiveOption[0], /<IconArchive :size="13" aria-hidden="true" \/>/);
  assert.match(archiveOption[0], /@click="emit\('archive'\)"/);
  assert.match(styles, /\.thread-card__option--archive\.arco-dropdown-option[\s\S]*border-top:/);
  assert.match(store, /async archiveThread\(sessionKey: EyesOnAgentsSessionKey\): Promise<void>/);
  assert.match(store, /eyesOnAgentsEmitter\.archiveThread\(\{ sessionKey \}\)/);
  assert.match(service, /async archiveThread\(params: \{[\s\S]*sessionKey: EyesOnAgentsSessionKey;/);
  assert.match(service, /await this\.dependencies\.appServer\.archiveThread\(threadId\)[\s\S]*repository\.setThreadArchived/);
  assert.match(supervisor, /this\.request\(connection, 'thread\/archive', \{ threadId \}\)/);
  assert.match(handler, /eyesOnAgentsService\.archiveThread\(parseEyesOnAgentsSessionKeyParams\(params\)\)/);
  assert.match(sharedTypes, /archiveThread\(params: \{[\s\S]*sessionKey: EyesOnAgentsSessionKey;[\s\S]*Promise<EyesOnAgentsSnapshot>/);
  assert.match(english, /archive: 'Archive'/);
  assert.match(chinese, /archive: '归档'/);
});

test('Claude UI stays provider-qualified, compact, and content-boundary safe', () => {
  const card = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );
  const menu = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCardMenu.vue'
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
    menu,
    /<a-doption\s+v-if="thread\.canCopySessionPath"[\s\S]*actions\.copySessionPath/,
  );
  assert.match(
    card,
    /eyesOnAgentsStore\.copySessionPath\(props\.thread\.sessionKey\)/,
  );
  assert.match(
    store,
    /async copySessionPath\(sessionKey: EyesOnAgentsSessionKey\): Promise<void> \{[\s\S]*?!thread\?\.canCopySessionPath\) return;[\s\S]*?runCommandAction\('session-path-copy'/,
    'the renderer refuses to ask for a path the snapshot says does not exist'
  );
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
    /<a-input[\s\S]*:model-value="environmentPath\(environment\)"[\s\S]*readonly[\s\S]*\/>/,
    'each environment row must expose its resolved path in a read-only Arco Input',
  );
  // Task 088: environments[0] recovers via the same legacy zero-arg store methods (an empty id
  // fails { id }-scoped UUID validation before ever reaching the recovery-aware
  // ClaudeDirectoryConfigService methods) — the single-directory "malformed value" recovery
  // contract stays reachable through the new environment list's default row.
  assert.match(claudeCard, /if \(id === ''\) \{[\s\S]*eyesOnAgentsStore\.changeClaudeDirectory\(\)/);
  assert.match(
    claudeCard,
    /if \(id === ''\) \{[\s\S]*eyesOnAgentsStore\.useAutomaticClaudeDirectory\(\)/,
  );
  assert.match(
    claudeCard,
    /const isEligibleForAutomatic = \(environment: EyesOnAgentsClaudeEnvironmentStatus\): boolean =>[\s\S]*environment\.mode === 'custom' \|\| environment\.state === 'error'/,
    'a malformed saved directory must still expose Use automatic recovery on the default row',
  );
  // The last-remaining-environment rule is surfaced from the service as
  // EyesOnAgentsClaudeEnvironmentStatus.canRemove (mirroring
  // ClaudeDirectoryConfigService.removeEnvironment's own guard), not re-derived from the row count.
  assert.match(
    claudeCard,
    /:disabled="!environment\.canRemove/,
    'remove must be disabled from the service-surfaced canRemove flag',
  );
  assert.doesNotMatch(
    claudeCard,
    /environmentRows\.length <= 1/,
    'the renderer must not re-derive the last-remaining-environment guard',
  );
  // The Add-environment busy key is one exported literal in the store, not a duplicate in the card.
  assert.match(
    store,
    /export const ADD_CLAUDE_ENVIRONMENT_KEY = '__add__';/,
    'the Add-environment busy key must be exported from the store',
  );
  assert.match(
    claudeCard,
    /import \{ ADD_CLAUDE_ENVIRONMENT_KEY, eyesOnAgentsStore \} from '\.\.\/\.\.\/store\/eyesOnAgents\.store';/,
    'the card must import the shared Add-environment busy key instead of redeclaring it',
  );
  assert.doesNotMatch(claudeCard, /= '__add__'/,
    'the card must not declare its own copy of the Add-environment busy key');
  assert.match(claudeCard, /eyesOnAgentsStore\.chooseClaudeEnvironmentDirectory\(id\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.useAutomaticClaudeEnvironment\(id\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.removeClaudeEnvironment\(id\)/);
  // Task 091: the add form sends the pasted absolute CLAUDE_CONFIG_DIR, not a label — the label
  // is derived from the directory on the Main side.
  assert.match(claudeCard, /eyesOnAgentsStore\.addClaudeEnvironment\(configDirectory\)/);
  assert.doesNotMatch(claudeCard, /addEnvironmentLabel/,
    'the add form must no longer carry a label field');
  assert.match(claudeCard, /eyesOnAgentsStore\.renameClaudeEnvironment\(id, label\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.setClaudeEnvironmentEnabled\(id, enabled\)/);
  // Gap 1 (post-088 review): the manual per-environment Retry action falls back to the legacy
  // zero-arg store method for the empty-id sentinel row, exactly like Change directory/Use automatic.
  assert.match(claudeCard, /if \(id === ''\) \{[\s\S]*eyesOnAgentsStore\.retryClaudeDirectory\(\)/);
  assert.match(claudeCard, /eyesOnAgentsStore\.retryClaudeDirectoryForEnvironment\(id\)/);
  assert.match(claudeCard, /environmentDesktopLabel\(environment\)/);
  assert.match(claudeCard, /environmentLastScanLabel\(environment\)/);
  assert.match(claudeCard, /environment\.desktopDirectoryCount/);
  assert.match(claudeCard, /environment\.lastSuccessfulScanAt/);
  assert.match(claudeCard, /canRetryEnvironment\(environment\)/);
  assert.match(store, /eyesOnAgentsEmitter\.changeClaudeDirectory\(\)/);
  assert.match(store, /eyesOnAgentsEmitter\.useAutomaticClaudeDirectory\(\)/);
  assert.match(store, /eyesOnAgentsEmitter\.retryClaudeDirectory\(\)/);
  assert.match(store, /eyesOnAgentsEmitter\.retryClaudeDirectory\(\{ environmentId: id \}\)/,
    'the per-environment retry sibling must forward the row id');
  assert.match(handler, /dialog\.showOpenDialog\(\{[\s\S]*properties: \['openDirectory'\]/);
  assert.match(handler, /async changeClaudeDirectory\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.match(handler, /async useAutomaticClaudeDirectory\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.match(
    handler,
    /async retryClaudeDirectory\(\s*params\?: \{ environmentId\?: string \}\s*\): Promise<EyesOnAgentsSnapshot>/,
    'gap 1: retryClaudeDirectory must accept an optional { environmentId } like the 4 bridge methods',
  );
  assert.match(sharedTypes, /changeClaudeDirectory\(\): Promise<EyesOnAgentsSnapshot>/);
  assert.doesNotMatch(sharedTypes, /changeClaudeDirectory\([^)]*(?:path|directory|url)/i,
    'the renderer contract must not accept a custom path');
  // The renderer must never open a native dialog itself, and must never own a directory path for
  // any EXISTING environment: Change directory / Use automatic stay path-free, so Main remains the
  // only side that can repoint a configured environment.
  assert.doesNotMatch(rendererSource, /showOpenDialog|pickDirectory/);
  // Task 091 narrows, deliberately, the one case where the renderer does carry a path: ADDING an
  // environment now sends the absolute CLAUDE_CONFIG_DIR the user pasted, because a Claude config
  // directory is hidden and the native picker made it awkward to reach. Main still validates it
  // through requireCanonicalClaudeConfigDirectory (absolute, existing, non-symlink, not a
  // filesystem root) before it is persisted or watched — the renderer proposes, Main disposes.
  assert.match(store, /addClaudeEnvironment\(configDirectory: string\)/,
    'add is the only renderer path that carries a directory, and it is explicitly typed');
  assert.doesNotMatch(
    store,
    /(?:changeClaudeDirectory|chooseClaudeEnvironmentDirectory|useAutomaticClaudeEnvironment)\([^)]*(?:path|directory|Directory)/,
    'repointing an existing environment must not accept a renderer-supplied path',
  );
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
  assert.match(chinese, /copySessionPath: '复制会话路径'/);
  // The block's own title is claudeEnvironment.title since task 088 replaced the single
  // "Session directories" block with the environment list; claudeDirectory.title is gone.
  assert.match(english, /title: 'Claude environments'/);
  assert.match(english, /useAutomatic: 'Use automatic'/);
  assert.match(chinese, /title: 'Claude 环境'/);
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
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.equal(
    (board.match(/<DomainColumn/g) ?? []).length,
    1,
    'the board renders exactly one column'
  );
  assert.match(board, /:threads="eyesOnAgentsStore\.focusThreads"/);
  assert.doesNotMatch(board, /filteredFocusThreads|titleDraft|titleQuery/);
  assert.doesNotMatch(board, /:title=|board\.focus/);
  assert.doesNotMatch(board, /board\.all|threadsForDomain|customDomains|total-count|totalCount/);

  const focusThreads = store.match(
    /  get focusThreads\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(focusThreads, 'Missing Focus projection');
  assert.match(
    focusThreads[0],
    /return sortedSnapshotThreads\(this\.snapshot, this\.threads\);/,
    'Focus must list every visible thread in comparator order'
  );
  assert.doesNotMatch(
    focusThreads[0],
    /isEyesOnAgentsFocused|thread\.isFocused/,
    'Focus membership is no longer an attention subset'
  );
  assert.doesNotMatch(
    store,
    /allThreads|filteredAllThreads|allTitleQuery|allProjectFilter|allProjectOptions/,
    'the retired All projection must leave no renderer state behind'
  );

  assert.doesNotMatch(domain, /ProjectFilter/);
  assert.doesNotMatch(
    store,
    /projectFilter|projectOptions|selectProjectFilter|filterEyesOnAgentsThreadsByProject/,
    'no Project selection state survives in the store'
  );
  for (const catalog of [english, chinese]) {
    const namespace = catalog.match(/\n  eyesOnAgents: \{[\s\S]*?\n  \},\n/);
    assert.ok(namespace, 'Missing eyesOnAgents i18n namespace');
    assert.doesNotMatch(
      namespace[0],
      /projectFilterLabel|allProjects|noProject|emptyProject|emptyNoProject/
    );
  }
});
test('Focus header exposes only Search while bulk Read all stays below renderer', () => {
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const sharedTypes = read('src/shared/eyesOnAgents/eyesOnAgents.type.ts');
  const mainHandler = read('src/main/xpc/eyesOnAgents.handler.ts');
  const mainService = read('src/main/eyesOnAgents/eyesOnAgents.service.ts');
  const repository = read('src/preload/sqlite/dao/eyesOnAgents.dao.ts');
  const button = domain.match(
    /<a-button\s+name="eyesOnAgents__domainColumn__search"[\s\S]*?<\/a-button>/
  );
  assert.ok(button, 'Missing Focus Search action');
  assert.match(button[0], /class="agent-domain__search"/);
  assert.match(button[0], /size="mini"/);
  assert.match(button[0], /type="text"/);
  assert.match(button[0], /:aria-label="i18nHelper\.eyesOnAgents\.actions\.searchTitles"/);
  assert.match(button[0], /aria-haspopup="dialog"/);
  assert.match(button[0], /aria-controls="eyes-on-agents-thread-search-dialog"/);
  assert.match(button[0], /:aria-expanded="eyesOnAgentsStore\.threadSearchVisible"/);
  assert.match(button[0], /@click="openThreadSearch"/);
  assert.doesNotMatch(button[0], /@click="eyesOnAgentsStore\./);
  assert.match(
    domain,
    /const openThreadSearch = \(\): void => \{\s*eyesOnAgentsStore\.openThreadSearch\(\);\s*\};/,
  );
  assert.match(button[0], /<IconSearch :size="14" aria-hidden="true"/);
  assert.match(domain, /const searchTooltip = computed\(\(\) => uaHelper\.isMac/);
  assert.doesNotMatch(domain, /<a-input|readAll|markAllRead|readableFocusThreads/);
  assert.doesNotMatch(store, /readableFocusThreads|async markAllRead/);

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
  assert.match(headerStyle, /justify-content: flex-end/);
  const searchStyle = cssRule(styles, '.agent-domain__search.arco-btn');
  assert.match(searchStyle, /width: 26px/);
  assert.match(searchStyle, /height: 24px/);
  assert.match(searchStyle, /border: 0/);
  assert.match(searchStyle, /background: transparent/);
  assert.match(searchStyle, /box-shadow: none/);
  assert.match(
    searchStyle,
    /color: var\(--eyes-accent\)/,
    'Search uses the themed text-action ink'
  );
  const searchHover = cssRule(styles, '.agent-domain__search.arco-btn:hover');
  assert.match(
    searchHover,
    /background: var\(--eyes-hover-surface\)/,
    'the icon action must show a hover surface, not just a color shift'
  );
  assert.match(searchHover, /color: var\(--eyes-primary-deep\)/);
});

test('Cmd/Ctrl+F toggles one card-result search modal contained by EyesOnAgents', () => {
  const app = read('src/renderer/eyesOnAgents/src/App.vue');
  const search = read(
    'src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue'
  );
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.less'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  const keydown = app.match(
    /const handleWindowKeydown = \(event: KeyboardEvent\): void => \{[\s\S]*?\n\};/
  );
  assert.ok(keydown, 'Missing window keydown handler');
  assert.match(keydown[0], /\(event\.metaKey \|\| event\.ctrlKey\)/);
  assert.match(keydown[0], /event\.key\.toLocaleLowerCase\(\) === 'f'/);
  assert.match(keydown[0], /event\.preventDefault\(\)/);
  assert.match(keydown[0], /event\.stopPropagation\(\)/);
  assert.match(keydown[0], /eyesOnAgentsStore\.toggleThreadSearch\(\)/);

  assert.match(app, /import ThreadSearch from '.\/components\/ThreadSearch\/ThreadSearch\.vue'/);
  assert.match(app, /<AgentBoard v-else \/>\s*<ThreadSearch \/>/);
  assert.match(app, /window\.addEventListener\('keydown', handleWindowKeydown\)/);
  assert.match(app, /window\.removeEventListener\('keydown', handleWindowKeydown\)/);
  assert.match(app, /eyesOnAgentsStore\.closeThreadSearch\(\)/);

  assert.match(search, /<a-modal/);
  assert.match(search, /:visible="eyesOnAgentsStore\.threadSearchVisible"/);
  assert.match(search, /popup-container="\.eyes-on-agents__main"/);
  assert.match(search, /:mask-closable="true"/);
  assert.match(search, /@cancel="closeThreadSearch"/);
  assert.match(search, /@open="handleModalOpen"/);
  assert.match(search, /id="eyes-on-agents-thread-search-dialog"/);
  assert.match(search, /eyesOnAgentsStore\.closeThreadSearch\(\)/);
  assert.match(search, /inputRef\.value\?\.focus\?\.\(\)/);
  assert.match(
    search,
    /lifecycleRevision !== eyesOnAgentsStore\.threadSearchRevision[\s\S]*?return;[\s\S]*?inputRef\.value\?\.focus\?\.\(\)/,
    'a stale modal lifecycle must not focus the input'
  );
  assert.match(
    search,
    /watch\([\s\S]*?eyesOnAgentsStore\.threadSearchVisible[\s\S]*?if \(visible\) void focusInput\(eyesOnAgentsStore\.threadSearchRevision\)/,
    'shortcut and button opens share the reactive focus path'
  );
  assert.match(search, /@clear="handleQueryClear"/);
  assert.match(search, /@update:model-value="handleTitleInput"/);
  assert.doesNotMatch(search, /@update:model-value="eyesOnAgentsStore\./);
  assert.match(
    search,
    /const handleTitleInput = \(value: string\): void => \{\s*eyesOnAgentsStore\.setTitleDraft\(value\);\s*\};/,
  );
  assert.match(search, /handleQueryClear[\s\S]*eyesOnAgentsStore\.clearTitleQuery\(\)/);
  assert.match(search, /role: 'combobox'/);
  assert.match(search, /'aria-activedescendant': selectedOptionId\.value/);
  assert.match(search, /role="listbox"/);
  assert.match(search, /role="option"/);
  assert.match(search, /@mousedown\.prevent/);
  assert.match(search, /@click\.capture="eyesOnAgentsStore\.selectThreadSearchResult\(thread\.sessionKey\)"/);
  assert.match(search, /<ThreadCard :thread="thread" \/>/);
  assert.doesNotMatch(search, /ProviderGlyph|result-title|result-domain|runtimeLabel/);
  assert.match(search, /event\.key === 'ArrowDown'[\s\S]*moveThreadSearchSelection\(1\)/);
  assert.match(search, /event\.key === 'ArrowUp'[\s\S]*moveThreadSearchSelection\(-1\)/);
  assert.match(search, /event\.key === 'Enter'[\s\S]*openSelectedResult\(\)/);
  assert.match(search, /event\.key === 'Escape'[\s\S]*closeThreadSearch\(\)/);
  const openSelected = search.match(
    /const openSelectedResult = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  assert.ok(openSelected, 'Missing modal Enter Open handler');
  assert.doesNotMatch(
    openSelected[0],
    /focusInput/,
    'an async provider Open must not steal focus back from the opened agent app'
  );
  assert.match(search, /resultsRef\.value[\s\S]*querySelector<HTMLElement>\('\.thread-search__result--selected'\)[\s\S]*scrollIntoView/);
  assert.doesNotMatch(search, /document\.getElementById/);

  const modalStyle = cssRule(styles, '.thread-search-modal.arco-modal');
  assert.match(modalStyle, /height: min\(520px, 80vh\)/);
  assert.match(modalStyle, /max-height: 80vh/);
  assert.match(modalStyle, /overflow: hidden/);
  const resultStyle = cssRule(styles, '.thread-search__results');
  assert.match(resultStyle, /overflow-y: auto/);
  assert.match(resultStyle, /overscroll-behavior: contain/);
  assert.match(
    styles,
    /\.thread-search__result--selected \.thread-card,[\s\S]*background: var\(--eyes-item-focus\);[\s\S]*box-shadow: 0 0 0 2px var\(--eyes-focus-ring\)/
  );

  assert.match(english, /title: 'Search threads'/);
  assert.match(english, /results: 'Thread search results'/);
  assert.match(english, /startTyping: 'Type a thread title to start searching'/);
  assert.match(chinese, /title: '搜索任务'/);
  assert.match(chinese, /results: '任务搜索结果'/);
  assert.match(chinese, /startTyping: '输入任务标题开始搜索'/);
});
test('modal search is query-gated, token-based, reconciled, and stale-draft safe', () => {
  const store = read('src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts');
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  const results = store.match(
    /  get threadSearchResults\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(results, 'Missing modal search projection');
  assert.match(results[0], /tokenizeThreadTitle\(this\.titleQuery\)/);
  assert.match(results[0], /queryTokens\.length === 0\) return \[\]/);
  assert.match(results[0], /if \(thread\.title === null\) return false/);
  assert.match(
    results[0],
    /titleTokens\.some\(\(titleToken\) => titleToken\.includes\(queryToken\)\)/
  );
  assert.doesNotMatch(
    results[0],
    /cwd|projectName|lastUserPrompt|threadId/,
    'search must read titles only'
  );
  const tokenizer = store.match(/const tokenizeThreadTitle = [\s\S]*?\.filter\(Boolean\);/);
  assert.ok(tokenizer, 'Missing shared tokenizer');
  assert.match(tokenizer[0], /normalize\('NFKC'\)/);
  assert.match(tokenizer[0], /toLocaleLowerCase\(\)/);
  assert.match(store, /const THREAD_TITLE_SEPARATOR_PATTERN = \/\[\\s\\-_\.\\\/\\\\:\|\]\+\/u;/);
  assert.match(
    store,
    /  get hasThreadSearchQueryTokens\(\): boolean \{\s*return tokenizeThreadTitle\(this\.titleQuery\)\.length > 0;/
  );

  assert.match(store, /import \{ useThrottleFn \} from '@vueuse\/core';/);
  assert.match(
    store,
    /useThrottleFn\(run, TITLE_QUERY_THROTTLE_MS, true, true\)/,
    'the shared leading-plus-trailing throttle keeps the last keystroke authoritative'
  );
  assert.match(store, /const TITLE_QUERY_THROTTLE_MS = 120;/);
  const commit = store.match(
    /  commitTitleQuery\(lifecycleRevision\?: number\): void \{[\s\S]*?\n  \}/
  );
  assert.ok(commit, 'Missing throttled commit');
  assert.match(commit[0], /!this\.threadSearchVisible/);
  assert.match(commit[0], /lifecycleRevision !== this\.threadSearchLifecycleRevision/);
  assert.match(commit[0], /this\.titleQuery = this\.titleDraft;/);
  assert.match(commit[0], /this\.reconcileThreadSearchSelection\(\)/);
  const setDraft = store.match(/  setTitleDraft\(value: string\): void \{[\s\S]*?\n  \}/);
  assert.ok(setDraft, 'Missing draft setter');
  assert.match(setDraft[0], /if \(this\.titleDraft === value\) return;/);
  assert.match(setDraft[0], /this\.titleQueryScheduler === null/);
  assert.match(
    setDraft[0],
    /this\.titleQueryScheduler\(this\.threadSearchLifecycleRevision\);/
  );
  const clear = store.match(/  clearTitleQuery\(\): void \{[\s\S]*?\n  \}/);
  assert.ok(clear, 'Missing clear');
  assert.match(clear[0], /this\.titleDraft = '';/);
  assert.match(clear[0], /this\.titleQuery = '';/);
  assert.match(store, /threadSearchSelectedSessionKey: EyesOnAgentsSessionKey \| null = null/);
  assert.match(store, /openThreadSearch\(\): void/);
  assert.match(store, /closeThreadSearch\(\): void/);
  assert.match(store, /toggleThreadSearch\(\): void/);
  assert.match(
    store,
    /createEyesOnAgentsTitleQueryScheduler\(\(lifecycleRevision\) => \{\s*eyesOnAgentsStore\.commitTitleQuery\(lifecycleRevision\);/
  );
  assert.match(
    store,
    /const nextIndex = \(currentIndex \+ delta \+ results\.length\) % results\.length/,
    'Up and Down must wrap the result list'
  );
  const openSelected = store.match(
    /  async openSelectedThreadSearchResult\(\): Promise<void> \{[\s\S]*?\n  \}/
  );
  assert.ok(openSelected, 'Missing keyboard Open path');
  assert.match(openSelected[0], /this\.commitTitleQuery\(\)/);
  assert.match(openSelected[0], /await this\.openThread\(sessionKey\)/);
  assert.doesNotMatch(openSelected[0], /closeThreadSearch/);
  assert.match(
    store,
    /this\.snapshot = snapshot;[\s\S]*this\.reconcileThreadSearchSelection\(\)/,
    'snapshot updates must reconcile the provider-qualified selected key'
  );
  assert.match(store, /const sortedThreadsBySnapshot = new WeakMap</);
  assert.match(store, /const titleTokensByThread = new WeakMap</);
  const memoizedTokens = store.match(
    /const threadTitleTokens = \(thread: EyesOnAgentsThread\): string\[\] => \{[\s\S]*?\n\};/
  );
  assert.ok(memoizedTokens, 'Missing memoized tokenizer');
  assert.match(memoizedTokens[0], /cached\.title === title/);
  assert.match(
    store,
    /  get focusThreads\(\): EyesOnAgentsThread\[\] \{\s*return sortedSnapshotThreads\(this\.snapshot, this\.threads\);/
  );

  for (const catalog of [english, chinese]) {
    const namespace = catalog.match(/\n  eyesOnAgents: \{[\s\S]*?\n  \},\n/);
    assert.ok(namespace, 'Missing eyesOnAgents i18n namespace');
    assert.doesNotMatch(
      namespace[0],
      /readAll:|emptyTitleSearch|projectFilterLabel|allProjects/
    );
  }
  assert.match(english, /searchTitlesMac: 'Search titles \(⌘F\)'/);
  assert.match(english, /searchTitlesWindows: 'Search titles \(Ctrl\+F\)'/);
  assert.match(chinese, /searchTitlesMac: '搜索标题（⌘F）'/);
  assert.match(chinese, /searchTitlesWindows: '搜索标题（Ctrl\+F）'/);
  assert.match(english, /empty: 'No thread titles match this search'/);
  assert.match(chinese, /empty: '没有匹配此搜索的任务标题'/);
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

test('the board renders one full-width Focus column that fills its height', () => {
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
  assert.match(boardShell, /overflow: hidden/);
  assert.doesNotMatch(
    boardShell,
    /padding/,
    'the board has no padding: the list runs edge to edge'
  );
  assert.doesNotMatch(
    cssRule(domainStyles, '.agent-domain__header'),
    /padding/,
    'the header runs edge to edge with it'
  );
  assert.doesNotMatch(
    boardStyles,
    /flex-wrap|agent-board__columns|overflow-y: auto/,
    'a single column neither wraps nor scrolls the board'
  );

  const shell = cssRule(domainStyles, '.agent-domain');
  assert.match(
    shell,
    /gap: 8px/,
    'the header and the scrolling list keep air between them'
  );
  assert.match(shell, /width: auto/);
  assert.match(shell, /min-width: 0/);
  assert.match(shell, /height: 100%/);
  assert.match(shell, /flex: 1 1 auto/);
  assert.doesNotMatch(shell, /max-width/, 'the column stretches to the board width');
  assert.doesNotMatch(shell, /max-height/, 'the column fills the window instead of capping at 600px');

  const menuBarStyles = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.less'
  );
  const identity = cssRule(menuBarStyles, '.eyes-menu-bar__identity');
  assert.match(identity, /min-width: 0/, 'a 480px window must not push the action cluster off-screen');
  assert.match(identity, /flex: 0 1 auto/);
  const identityTitle = cssRule(menuBarStyles, '.eyes-menu-bar__title');
  assert.match(identityTitle, /text-overflow: ellipsis/);
  const actions = cssRule(menuBarStyles, '.eyes-menu-bar__actions');
  assert.match(actions, /flex: 0 0 auto/);

  const body = cssRule(domainStyles, '.agent-domain__body');
  assert.match(body, /min-height: 0/);
  assert.match(body, /overflow-y: auto/);
  assert.doesNotMatch(body, /padding/, 'the scrolling body carries no inset either');

  const appStyles = read('src/renderer/eyesOnAgents/src/App.less');
  const root = cssRule(appStyles, '.eyes-on-agents');
  assert.match(root, /width: 100vw/);
  assert.match(root, /height: 100vh/);
  assert.match(root, /min-width: 0/);
  assert.match(root, /min-height: 0/);
  assert.doesNotMatch(
    appStyles,
    /min-width: [1-9]/,
    'a renderer width floor stops the board reflowing inside a smaller window'
  );
  const mainRegion = cssRule(appStyles, '.eyes-on-agents__main');
  assert.match(
    mainRegion,
    /padding: 8px/,
    'the board region owns the inset the column gave up'
  );
  assert.match(mainRegion, /position: relative/);

  const cardStyles = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less'
  );
  assert.doesNotMatch(cardStyles, /cursor: grab/, 'cards are not draggable any more');

  const drawer = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue'
  );
  assert.match(
    drawer,
    /popup-container="\.eyes-on-agents__main"/,
    'the connections drawer must stay inside the board region'
  );
  const drawerStyles = read(
    'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less'
  );
  assert.doesNotMatch(drawerStyles, /max-width: 100vw/);
  assert.match(drawerStyles, /\.eyes-connection-panel \.arco-drawer \{[^}]*max-width: 100%/);
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

test('the bridge glyph toggles the connections drawer', () => {
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const app = read('src/renderer/eyesOnAgents/src/App.vue');

  const bridgeButton = menuBar.match(
    /<a-button\s+name="eyesOnAgents__menuBar__bridge"[\s\S]*?<\/a-button>/
  );
  assert.ok(bridgeButton, 'Missing bridge glyph button');
  assert.match(
    bridgeButton[0],
    /@click="\$emit\('toggle-connections'\)"/,
    'the plug glyph toggles the drawer instead of only opening it'
  );
  assert.match(
    bridgeButton[0],
    /:aria-expanded="connectionsOpen"/,
    'a toggle must report its expanded state'
  );
  assert.match(menuBar, /defineProps<\{ connectionsOpen: boolean \}>\(\);/);
  assert.match(menuBar, /\(event: 'toggle-connections'\): void;/);
  assert.match(
    app,
    /:connections-open="connectionsVisible"/,
    'the drawer state flows down so the glyph can reflect it'
  );
  assert.match(
    app,
    /@toggle-connections="connectionsVisible = !connectionsVisible"/
  );
  assert.match(
    app,
    /@open-connections="connectionsVisible = true"/,
    'the status pill still just opens the drawer'
  );
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
