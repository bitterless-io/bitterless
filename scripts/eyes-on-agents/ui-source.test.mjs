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
    /  stopRefreshPolling\(\): void \{[\s\S]*?\n  \}(?=\n\n  threadsForDomain)/
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
  assert.match(source, /pull: 'clone', put: false/);
  assert.match(source, /eyesOnAgentsEmitter\.moveThread/);
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
    'src/renderer/eyesOnAgents/src/components/AddDomainPopover/AddDomainPopover.less'
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
  const addDomainForm = cssRule(addDomain, '.add-domain-popover__form');
  assert.match(addDomainForm, /border: 0/);
  assert.match(addDomainForm, /background: oklch/);
  const addDomainFocus = cssRule(addDomain, '.add-domain-popover__trigger:focus-visible');
  assert.match(addDomainFocus, /outline: 2px solid oklch/);
  assert.match(addDomainFocus, /outline-offset: 1px/);

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
    /v-if="thread\.provider === 'claude' && thread\.canPreviewTranscript"[\s\S]*actions\.previewTranscript/,
  );
  assert.match(
    card,
    /eyesOnAgentsStore\.previewThread\(props\.thread\.sessionKey\)/,
  );
  assert.match(
    store,
    /async previewThread\(sessionKey: EyesOnAgentsSessionKey\): Promise<void>[\s\S]*thread\.provider !== 'claude'[\s\S]*!thread\.canPreviewTranscript[\s\S]*eyesOnAgentsEmitter\.previewThread\(\{ sessionKey \}\)/,
  );
  assert.doesNotMatch(
    store,
    /openThreadSearchResult\([\s\S]*await this\.previewThread\(sessionKey\)/,
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
  const focusThreads = store.match(
    /  get focusThreads\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(focusThreads, 'Missing Focus projection');
  assert.match(
    focusThreads[0],
    /isEyesOnAgentsFocused\(thread\.runtimeState, thread\.isUnread\)/,
    'Focus membership must be derived in memory from runtime state and unread'
  );
  assert.doesNotMatch(
    focusThreads[0],
    /thread\.isFocused/,
    'Focus membership must not depend on a snapshot flag the renderer cannot recompute'
  );
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
    /<a-button\s+v-if="focus"[\s\S]*?name="eyesOnAgents__domainColumn__readAll"[\s\S]*?<\/a-button>/
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
  assert.match(readableFocusThreads[0], /this\.focusThreads\.filter/);
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

test('global title search is lifecycle-safe, accessible, and independently bounded', () => {
  const appPath = 'src/renderer/eyesOnAgents/src/App.vue';
  const searchPath =
    'src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue';
  const storePath = 'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts';
  const app = read(appPath);
  const search = read(searchPath);
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.less'
  );
  const store = read(storePath);
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.match(app, /<ThreadSearch ref="threadSearchRef" \/>/);
  assert.equal(
    (app.match(/window\.addEventListener\('keydown', handleWindowKeydown\)/g) ?? []).length,
    1,
  );
  assert.equal(
    (app.match(/window\.removeEventListener\('keydown', handleWindowKeydown\)/g) ?? []).length,
    1,
  );
  const shortcut = app.match(
    /const handleWindowKeydown = \(event: KeyboardEvent\): void => \{[\s\S]*?\n\};/
  );
  assert.ok(shortcut, 'Missing global Find shortcut handler');
  assert.match(shortcut[0], /!event\.altKey/);
  assert.match(shortcut[0], /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(shortcut[0], /event\.key\.toLocaleLowerCase\(\) === 'f'/);
  assert.match(shortcut[0], /event\.preventDefault\(\)/);
  assert.match(shortcut[0], /event\.stopPropagation\(\)/);
  assert.match(
    shortcut[0],
    /if \(!eyesOnAgentsStore\.threadSearchVisible\) \{\s*eyesOnAgentsStore\.openThreadSearch\(\);\s*\}[\s\S]*focusThreadSearchInput\(\)/
  );
  assert.match(
    app,
    /const focusThreadSearchInput = async \(\): Promise<void> => \{\s*await nextTick\(\);\s*await threadSearchRef\.value\?\.focusInput\(\)/
  );

  assert.match(search, /<a-modal[\s\S]*:visible="eyesOnAgentsStore\.threadSearchVisible"/);
  assert.match(search, /:footer="false"/);
  assert.match(search, /modal-class="thread-search-modal"/);
  assert.match(search, /@cancel="closeThreadSearch"/);
  assert.match(search, /@open="handleModalOpen"/);
  assert.match(search, /<a-input[\s\S]*?size="mini"[\s\S]*?:input-attrs="inputAttributes"/);
  assert.match(search, /@update:model-value="handleQueryUpdate"/);
  assert.doesNotMatch(
    search,
    /@update:model-value="eyesOnAgentsStore\.[^"]+"/,
    'Store class methods must not be passed as unbound Vue event callbacks'
  );
  const queryUpdate = search.match(
    /const handleQueryUpdate = \(query: string\): void => \{[\s\S]*?\n\};/
  );
  assert.ok(queryUpdate, 'Missing receiver-safe query update wrapper');
  assert.match(
    queryUpdate[0],
    /eyesOnAgentsStore\.setThreadSearchQuery\(query\)/,
    'Query wrapper must invoke the method through its owning store object'
  );
  assert.match(search, /autofocus: true/);
  assert.match(
    search,
    /'aria-label': i18nHelper\.eyesOnAgents\.search\.placeholder/,
    'The real combobox input needs a stable localized accessible name'
  );
  assert.match(search, /const focusInput = async \(\): Promise<void>/);
  assert.match(search, /inputRef\.value\?\.focus\(\)/);
  assert.match(search, /defineExpose\(\{ focusInput \}\)/);
  assert.match(search, /event\.key === 'Escape'[\s\S]*closeThreadSearch\(\)/);
  assert.match(search, /event\.key === 'ArrowDown'[\s\S]*moveThreadSearchSelection\(1\)/);
  assert.match(search, /event\.key === 'ArrowUp'[\s\S]*moveThreadSearchSelection\(-1\)/);
  assert.match(search, /event\.key === 'Enter'[\s\S]*openSelectedResult\(\)/);
  const searchResult = search.match(
    /<button\s+v-for="thread in eyesOnAgentsStore\.threadSearchResults"[\s\S]*?<\/button>/
  );
  assert.ok(searchResult, 'Missing global search result row');
  assert.match(searchResult[0], /role="option"/);
  assert.match(searchResult[0], /@click="handleResultClick\(thread\.sessionKey\)"/);
  const titlePosition = searchResult[0].indexOf('class="thread-search__result-title"');
  const domainPosition = searchResult[0].indexOf('class="thread-search__result-domain"');
  const statePosition = searchResult[0].indexOf('class="thread-search__result-state"');
  assert.ok(
    titlePosition >= 0 && titlePosition < domainPosition && domainPosition < statePosition,
    'Search result DOM must keep title first, then Domain and runtime state',
  );
  const resultDomain = searchResult[0].match(
    /<span\s+class="thread-search__result-domain"[\s\S]*?<\/span>/
  );
  assert.ok(resultDomain, 'Missing result Domain metadata');
  assert.match(
    resultDomain[0],
    /:title="customDomainTitle\(thread\) \?\? undefined"/,
    'Only a real custom Domain title may create the native tooltip',
  );
  assert.match(resultDomain[0], /\{\{ customDomainTitle\(thread\) \?\? '-' \}\}/);
  assert.match(search, /role="listbox"/);
  assert.match(search, /:aria-selected=/);
  assert.match(search, /'aria-activedescendant': selectedOptionId\.value/);
  assert.match(search, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.doesNotMatch(search, /ThreadCard/);
  assert.match(
    search,
    /const emptyMessage = computed\(\(\) =>\s*eyesOnAgentsStore\.hasThreadSearchQueryTokens\s*\? i18nHelper\.eyesOnAgents\.search\.empty\s*: i18nHelper\.eyesOnAgents\.search\.startTyping\s*\)/
  );
  assert.match(
    search,
    /v-if="eyesOnAgentsStore\.threadSearchResults\.length === 0"[\s\S]*\{\{ emptyMessage \}\}/
  );

  const modalStyle = cssRule(styles, '.thread-search-modal.arco-modal');
  assert.match(modalStyle, /min-height: 200px/);
  assert.match(modalStyle, /max-height: 80vh/);
  assert.match(modalStyle, /overflow: hidden/);
  const inputRegionStyle = cssRule(styles, '.thread-search__input-region');
  assert.match(inputRegionStyle, /flex: 0 0 auto/);
  const resultsStyle = cssRule(styles, '.thread-search__results');
  assert.match(resultsStyle, /min-height: 0/);
  assert.match(resultsStyle, /flex: 1/);
  assert.match(resultsStyle, /overflow-y: auto/);
  const resultStyle = cssRule(styles, '.thread-search__result');
  assert.match(resultStyle, /min-height: 47px/);
  assert.match(resultStyle, /display: grid/);
  assert.match(
    resultStyle,
    /grid-template-columns: minmax\(0, 1fr\) auto/
  );
  assert.match(resultStyle, /grid-template-rows: auto auto/);
  const resultHeadingStyle = cssRule(styles, '.thread-search__result-heading');
  assert.match(resultHeadingStyle, /grid-column: 1 \/ -1/);
  assert.match(resultHeadingStyle, /grid-row: 1/);
  assert.match(resultHeadingStyle, /display: flex/);
  const resultTitleStyle = cssRule(styles, '.thread-search__result-title');
  assert.match(resultTitleStyle, /overflow: hidden/);
  const resultDomainStyle = cssRule(styles, '.thread-search__result-domain');
  assert.match(resultDomainStyle, /grid-column: 1/);
  assert.match(resultDomainStyle, /grid-row: 2/);
  assert.match(resultDomainStyle, /overflow: hidden/);
  assert.match(resultDomainStyle, /text-overflow: ellipsis/);
  assert.match(resultDomainStyle, /white-space: nowrap/);
  const resultStateStyle = cssRule(styles, '.thread-search__result-state');
  assert.match(resultStateStyle, /grid-column: 2/);
  assert.match(resultStateStyle, /grid-row: 2/);
  assert.match(resultStateStyle, /justify-self: end/);
  assert.match(resultStateStyle, /text-align: right/);
  assert.match(
    cssRule(styles, '.thread-search__result:hover'),
    /background: var\(--thread-search-item-hover\)/
  );
  assert.match(
    styles,
    /\.thread-search__result--selected,\s*\.thread-search__result--selected:hover\s*\{[^}]*background: var\(--thread-search-item-focus\)/
  );

  const searchResults = store.match(
    /get threadSearchResults\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  const filteredAllThreads = store.match(
    /get filteredAllThreads\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(searchResults, 'Missing global title-search projection');
  assert.ok(filteredAllThreads, 'Missing All-column projection');
  assert.ok(
    store.includes(
      'const THREAD_SEARCH_SEPARATOR_PATTERN = /[\\s\\-_.\\/\\\\:|]+/u;'
    ),
    'Global title search must split every supported separator'
  );
  const tokenizeThreadSearchText = store.match(
    /const tokenizeThreadSearchText = \(value: string\): string\[\] =>[\s\S]*?\.filter\(Boolean\);/
  );
  assert.ok(tokenizeThreadSearchText, 'Missing global title-search tokenizer');
  assert.match(
    tokenizeThreadSearchText[0],
    /\.normalize\('NFKC'\)[\s\S]*\.toLocaleLowerCase\(\)[\s\S]*\.split\(THREAD_SEARCH_SEPARATOR_PATTERN\)[\s\S]*\.filter\(Boolean\)/
  );
  assert.match(
    searchResults[0],
    /const queryTokens = tokenizeThreadSearchText\(this\.threadSearchQuery\)/
  );
  assert.match(searchResults[0], /if \(queryTokens\.length === 0\) return \[\]/);
  assert.doesNotMatch(searchResults[0], /if \([^)]*\) return this\.allThreads/);
  assert.match(searchResults[0], /if \(thread\.title === null\) return false/);
  assert.match(
    searchResults[0],
    /const titleTokens = tokenizeThreadSearchText\(thread\.title\)[\s\S]*queryTokens\.every\(\(queryToken\) =>[\s\S]*titleTokens\.some\(\(titleToken\) => titleToken\.includes\(queryToken\)\)/
  );
  assert.match(
    store,
    /get hasThreadSearchQueryTokens\(\): boolean \{\s*return tokenizeThreadSearchText\(this\.threadSearchQuery\)\.length > 0/
  );
  assert.doesNotMatch(searchResults[0], /allProjectFilter|allTitleQuery|filteredAllThreads/);
  assert.doesNotMatch(
    searchResults[0],
    /thread\.(?:domainId|cwd|projectKey|projectRoot|projectName|lastUserPrompt|prompt|preview|response|content)/
  );
  assert.doesNotMatch(searchResults[0], /customDomainTitle|customDomains/);
  assert.doesNotMatch(filteredAllThreads[0], /threadSearch/);
  const customDomainTitleMethod = store.match(
    /customDomainTitle\(domainId: number\): string \| null \{[\s\S]*?\n  \}/
  );
  assert.ok(customDomainTitleMethod, 'Missing current custom Domain title resolver');
  assert.match(
    customDomainTitleMethod[0],
    /this\.customDomains\.find\(\(domain\) => domain\.id === domainId\)\?\.title\.trim\(\)/
  );
  assert.match(customDomainTitleMethod[0], /return title \|\| null/);
  assert.doesNotMatch(
    customDomainTitleMethod[0],
    /uncategorizedDomain|domainKey|new Map/
  );
  assert.match(
    search,
    /const customDomainTitle = \(thread: EyesOnAgentsThread\): string \| null =>\s*eyesOnAgentsStore\.customDomainTitle\(thread\.domainId\)/
  );
  assert.doesNotMatch(
    search,
    /\.\w+\(eyesOnAgentsStore\.customDomainTitle\)/,
    'Store Domain resolver must not be passed as an unbound callback'
  );
  const domainAriaLabel = search.match(
    /const domainAriaLabel = \(thread: EyesOnAgentsThread\): string => \{[\s\S]*?\n\};/
  );
  assert.ok(domainAriaLabel, 'Missing accessible Domain context');
  assert.match(domainAriaLabel[0], /customDomainTitle\(thread\)/);
  assert.match(domainAriaLabel[0], /i18nHelper\.eyesOnAgents\.search\.noDomain/);
  assert.match(
    domainAriaLabel[0],
    /i18nHelper\.eyesOnAgents\.search\.domainContext\.replace\('\{domain\}', title\)/
  );
  assert.match(
    search,
    /const resultAriaLabel[\s\S]*displayTitle\(thread\),\s*domainAriaLabel\(thread\),\s*runtimeLabel\(thread\)/
  );
  assert.match(
    store,
    /setThreadSearchQuery\(query: string\): void \{[\s\S]*this\.threadSearchSelectedSessionKey = this\.threadSearchResults\[0\]\?\.sessionKey \?\? null/
  );
  assert.match(
    store,
    /reconcileThreadSearchSelection\(\): void \{[\s\S]*thread\.sessionKey === this\.threadSearchSelectedSessionKey[\s\S]*this\.threadSearchSelectedSessionKey = results\[0\]\?\.sessionKey \?\? null/
  );
  const openSearchResult = store.match(
    /async openThreadSearchResult\(sessionKey: EyesOnAgentsSessionKey\): Promise<void> \{[\s\S]*?\n  \}/
  );
  assert.ok(openSearchResult, 'Missing global search Open path');
  assert.match(openSearchResult[0], /this\.threadSearchSelectedSessionKey = sessionKey/);
  assert.match(openSearchResult[0], /await this\.openThread\(sessionKey\)/);
  assert.doesNotMatch(openSearchResult[0], /closeThreadSearch|threadSearchQuery\s*=/);
  assert.match(
    store,
    /closeThreadSearch\(\): void \{\s*this\.threadSearchVisible = false;\s*this\.threadSearchQuery = '';\s*this\.threadSearchSelectedSessionKey = null/
  );

  const queryOwners = walk('src')
    .filter((path) => /\.(?:ts|vue)$/.test(path))
    .filter((path) => read(path).includes('threadSearchQuery'))
    .sort();
  assert.deepEqual(queryOwners, [searchPath, storePath].sort());

  assert.match(
    english,
    /search:\s*\{\s*title: 'Search tasks',\s*placeholder: 'Search thread titles',\s*results: 'Task search results',\s*empty: 'No task titles match this search',\s*startTyping: 'Type a title to search tasks',\s*domainContext: 'Domain: \{domain\}',\s*noDomain: 'No Domain'/
  );
  assert.match(
    chinese,
    /search:\s*\{\s*title: '搜索任务',\s*placeholder: '搜索任务标题',\s*results: '任务搜索结果',\s*empty: '没有匹配此搜索的任务标题',\s*startTyping: '输入任务标题开始搜索',\s*domainContext: 'Domain：\{domain\}',\s*noDomain: '无 Domain'/
  );
});

test('All title search is title-only, transient, and lifecycle-safe', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const domainPath = 'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue';
  const storePath = 'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts';
  const domain = read(domainPath);
  const styles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const store = read(storePath);
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  const searchTrigger = domain.match(
    /<a-button\s+v-if="all"[\s\S]*?name="eyesOnAgents__domainColumn__titleSearchToggle"[\s\S]*?<\/a-button>/
  );
  assert.ok(searchTrigger, 'Missing All-only title search trigger');
  assert.match(searchTrigger[0], /size="mini"/);
  assert.match(searchTrigger[0], /:aria-label="i18nHelper\.eyesOnAgents\.actions\.searchTitles"/);
  assert.match(searchTrigger[0], /:aria-expanded="titleSearchOpen"/);
  assert.match(searchTrigger[0], /aria-controls="eyes-on-agents-all-title-search"/);
  assert.match(searchTrigger[0], /<IconSearch :size="13" aria-hidden="true" \/>/);

  const searchRow = domain.match(
    /<div\s+v-if="all && titleSearchOpen"[\s\S]*?id="eyes-on-agents-all-title-search"[\s\S]*?<\/div>/
  );
  assert.ok(searchRow, 'Missing All-only title search row');
  assert.ok(
    domain.indexOf(searchRow[0]) < domain.indexOf('<ProjectFilter v-if="projectFilter" />'),
    'Title search row must render above the Project filter',
  );
  assert.match(searchRow[0], /role="search"/);
  assert.match(searchRow[0], /@keydown\.esc\.prevent\.stop="closeTitleSearch"/);
  assert.match(
    searchRow[0],
    /<a-input[\s\S]*?v-model="eyesOnAgentsStore\.allTitleQuery"[\s\S]*?size="mini"/
  );
  assert.match(searchRow[0], /titleSearchPlaceholder/);
  assert.match(
    searchRow[0],
    /name="eyesOnAgents__domainColumn__clearTitleSearch"[\s\S]*?size="mini"[\s\S]*?:aria-label="i18nHelper\.eyesOnAgents\.actions\.clearTitleSearch"[\s\S]*?@click="clearTitleSearch"/
  );
  assert.match(searchRow[0], /<IconX :size="12" aria-hidden="true" \/>/);

  const focusSearch = domain.match(
    /const focusTitleSearchInput = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  const closeSearch = domain.match(
    /const closeTitleSearch = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  const toggleSearch = domain.match(
    /const toggleTitleSearch = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  const clearSearch = domain.match(
    /const clearTitleSearch = async \(\): Promise<void> => \{[\s\S]*?\n\};/
  );
  assert.ok(focusSearch, 'Missing title search focus helper');
  assert.match(focusSearch[0], /await nextTick\(\)/);
  assert.match(focusSearch[0], /titleSearchInputRef\.value\?\.focus\?\.\(\)/);
  assert.match(
    domain,
    /const titleSearchButtonRef = ref<\{ \$el\?: HTMLElement \} \| null>\(null\)/
  );
  assert.ok(closeSearch, 'Missing title search close lifecycle');
  assert.match(
    closeSearch[0],
    /clearAllTitleQuery\(\);\s*titleSearchOpen\.value = false/
  );
  assert.match(
    closeSearch[0],
    /await nextTick\(\);\s*titleSearchButtonRef\.value\?\.\$el\?\.focus\(\)/
  );
  assert.doesNotMatch(closeSearch[0], /titleSearchButtonRef\.value\?\.focus/);
  assert.ok(toggleSearch, 'Missing title search toggle lifecycle');
  assert.match(
    toggleSearch[0],
    /if \(titleSearchOpen\.value\) \{\s*await closeTitleSearch\(\);\s*return;\s*\}[\s\S]*titleSearchOpen\.value = true;[\s\S]*await focusTitleSearchInput\(\)/
  );
  assert.ok(clearSearch, 'Missing explicit title search clear lifecycle');
  assert.match(clearSearch[0], /clearAllTitleQuery\(\);\s*await focusTitleSearchInput\(\)/);
  assert.doesNotMatch(clearSearch[0], /allProjectFilter|selectAllProjectFilter/);
  assert.match(
    domain,
    /onBeforeUnmount\(\(\) => \{\s*if \(props\.all\) eyesOnAgentsStore\.clearAllTitleQuery\(\);\s*\}\)/
  );

  const filteredAllThreads = store.match(
    /get filteredAllThreads\(\): EyesOnAgentsThread\[\] \{[\s\S]*?\n  \}/
  );
  assert.ok(filteredAllThreads, 'Missing composed All filters');
  assert.match(
    filteredAllThreads[0],
    /const projectThreads = filterEyesOnAgentsThreadsByProject\(\s*this\.allThreads,\s*this\.allProjectFilter,\s*\)/
  );
  assert.match(
    filteredAllThreads[0],
    /const query = this\.allTitleQuery\.trim\(\)\.toLocaleLowerCase\(\)/
  );
  assert.match(filteredAllThreads[0], /if \(!query\) return projectThreads/);
  const titlePredicate = filteredAllThreads[0].match(
    /return projectThreads\.filter\(\s*\(thread\) =>[\s\S]*?\n    \);/
  );
  assert.ok(titlePredicate, 'Missing title-only substring predicate');
  assert.match(
    titlePredicate[0],
    /thread\.title !== null[\s\S]*thread\.title\.toLocaleLowerCase\(\)\.includes\(query\)/
  );
  assert.doesNotMatch(
    titlePredicate[0],
    /thread\.(?:threadId|cwd|projectKey|projectRoot|projectName|lastUserPrompt|prompt|preview|response|content)/
  );
  assert.match(store, /allTitleQuery = ''/);
  assert.match(
    store,
    /get isAllTitleFiltered\(\): boolean \{\s*return Boolean\(this\.allTitleQuery\.trim\(\)\);\s*\}/
  );
  const storeClear = store.match(
    /clearAllTitleQuery\(\): void \{[\s\S]*?\n  \}/
  );
  assert.ok(storeClear, 'Missing renderer-store title query clear');
  assert.match(storeClear[0], /this\.allTitleQuery = ''/);
  assert.doesNotMatch(storeClear[0], /allProjectFilter|eyesOnAgentsEmitter/);
  const applySnapshot = store.match(
    /private applySnapshot\(snapshot: EyesOnAgentsSnapshot\): void \{[\s\S]*?\n  \}/
  );
  assert.ok(applySnapshot, 'Missing snapshot application boundary');
  assert.doesNotMatch(applySnapshot[0], /allTitleQuery/);
  const titleQueryOwners = walk('src')
    .filter((path) => /\.(?:ts|vue)$/.test(path))
    .filter((path) => read(path).includes('allTitleQuery'))
    .sort();
  assert.deepEqual(titleQueryOwners, [domainPath, storePath].sort());

  const emptyLabel = domain.match(
    /const emptyLabel = computed\(\(\) => \{[\s\S]*?\n\}\);/
  );
  assert.ok(emptyLabel, 'Missing Domain empty-label precedence');
  assert.match(
    emptyLabel[0],
    /props\.all && eyesOnAgentsStore\.isAllTitleFiltered[\s\S]*emptyTitleSearch[\s\S]*isAllProjectFiltered/
  );

  const searchStyles = styles.match(
    /\.agent-domain__search-trigger[\s\S]*?(?=\.agent-domain__body)/
  );
  assert.ok(searchStyles, 'Missing compact title search styles');
  assert.doesNotMatch(searchStyles[0], /#[\da-f]{3,8}\b|\brgba?\(/i);
  const triggerStyle = cssRule(styles, '.agent-domain__search-trigger.arco-btn');
  assert.match(triggerStyle, /width: 22px/);
  assert.match(triggerStyle, /border: 0/);
  assert.match(triggerStyle, /background: transparent/);
  assert.match(triggerStyle, /box-shadow: none/);
  const rowStyle = cssRule(styles, '.agent-domain__search-row');
  assert.match(rowStyle, /background: oklch/);
  assert.doesNotMatch(rowStyle, /\bborder\s*:|box-shadow/);
  const inputStyle = cssRule(styles, '.agent-domain__search-input.arco-input-wrapper');
  assert.match(inputStyle, /border: 0/);
  assert.match(inputStyle, /background: oklch/);
  assert.match(inputStyle, /box-shadow: none/);
  const inputFocus = cssRule(
    styles,
    '.agent-domain__search-input.arco-input-wrapper:focus-within'
  );
  assert.match(inputFocus, /outline: 2px solid var\(--eyes-focus-ring\)/);
  const clearStyle = cssRule(styles, '.agent-domain__search-clear.arco-btn');
  assert.match(clearStyle, /width: 20px/);
  assert.match(clearStyle, /border: 0/);
  assert.match(clearStyle, /background: transparent/);
  assert.match(clearStyle, /box-shadow: none/);

  assert.match(english, /searchTitles: 'Search thread titles'/);
  assert.match(english, /clearTitleSearch: 'Clear title search'/);
  assert.match(english, /titleSearchPlaceholder: 'Search titles'/);
  assert.match(english, /emptyTitleSearch: 'No thread titles match this search'/);
  assert.match(chinese, /searchTitles: '搜索任务标题'/);
  assert.match(chinese, /clearTitleSearch: '清除标题搜索'/);
  assert.match(chinese, /titleSearchPlaceholder: '搜索标题'/);
  assert.match(chinese, /emptyTitleSearch: '没有匹配此搜索的任务标题'/);

  assert.match(board, /:threads="eyesOnAgentsStore\.filteredAllThreads"[\s\S]*\sall\s+[\s\S]*project-filter/);
  assert.doesNotMatch(domain, /debounce|setTimeout/);
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

  assert.equal((board.match(/<draggable/g) ?? []).length, 1);
  assert.match(board, /<template #header>[\s\S]*eyesOnAgents__focusColumn[\s\S]*eyesOnAgents__allColumn[\s\S]*<template #item/);
  assert.doesNotMatch(board, /<template #footer>|AddDomainColumn|add-domain-column/);
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
  assert.match(domainStyles, /\.agent-domain\s*\{[^}]*min-width: 300px;/);
  assert.match(domainStyles, /\.agent-domain\s*\{[^}]*max-width: 500px;/);
  assert.match(domainStyles, /\.agent-domain\s*\{[^}]*flex: 1 1 300px;/);
  assert.doesNotMatch(domainStyles, /flex:\s*0 0 300px|min-width:\s*280px|flex-basis:\s*280px/);
  const domainBody = cssRule(domainStyles, '.agent-domain__body');
  assert.match(domainBody, /overflow-y: auto/);
  assert.match(domainBody, /padding: 0 9px 9px/);
  assert.doesNotMatch(domainBody, /padding:\s*9px\s*;/);
});

test('custom Domain titles edit on click with Todo-sized inputs and no Rename menu item', () => {
  const domain = read('src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue');
  const domainStyles = read(
    'src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less'
  );
  const addDomain = read(
    'src/renderer/eyesOnAgents/src/components/AddDomainPopover/AddDomainPopover.vue'
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

test('Add Domain is an anchored menubar form with the existing creation contract', () => {
  const board = read('src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue');
  const menuBar = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue'
  );
  const component = read(
    'src/renderer/eyesOnAgents/src/components/AddDomainPopover/AddDomainPopover.vue'
  );
  const rendererSource = walk('src/renderer/eyesOnAgents')
    .filter((path) => /\.(vue|less|ts|html)$/.test(path))
    .map(read)
    .join('\n');
  const rendererPaths = walk('src/renderer/eyesOnAgents').join('\n');

  assert.match(menuBar, /<AddDomainPopover \/>/);
  assert.match(menuBar, /import AddDomainPopover from '\.\.\/AddDomainPopover\/AddDomainPopover\.vue'/);
  assert.doesNotMatch(board, /<template #footer>|AddDomain/);
  assert.doesNotMatch(rendererSource, /AddDomainColumn|add-domain-column/);
  assert.doesNotMatch(rendererPaths, /AddDomainColumn|add-domain-column/);

  assert.match(component, /<Trigger[\s\S]*v-model:popup-visible="popupVisible"[\s\S]*trigger="click"[\s\S]*position="br"[\s\S]*:unmount-on-close="true"/);
  assert.match(component, /name="eyesOnAgents__menuBar__addDomain"/);
  assert.match(component, /<template #icon><IconPlus :size="14" aria-hidden="true" \/><\/template>/);
  assert.match(component, /:aria-expanded="popupVisible"/);
  assert.equal(
    (component.match(/:disabled="Boolean\(eyesOnAgentsStore\.busyAction\)"/g) ?? []).length,
    2
  );
  assert.match(component, /size="mini"/);
  assert.match(component, /role="dialog"[\s\S]*aria-labelledby="eyes-on-agents-add-domain-title"/);
  assert.match(component, /@keydown\.esc\.prevent\.stop="close"/);
  assert.match(component, /@click="close"/);
  assert.match(component, /watch\(popupVisible,[\s\S]*if \(!visible\)[\s\S]*reset\(\)[\s\S]*nextTick\(\)[\s\S]*inputRef\.value\?\.focus/);

  assert.match(component, /const normalizedTitle = computed\(\(\) => title\.value\.trim\(\)\)/);
  assert.match(component, /domain\.title\.trim\(\)\.toLocaleLowerCase\(\) === normalizedTitle\.value\.toLocaleLowerCase\(\)/);
  assert.match(component, /normalizedTitle\.value\.toLocaleLowerCase\(\) === 'all'/);
  assert.match(component, /const submit = async \(\): Promise<void> => \{\s*if \(eyesOnAgentsStore\.busyAction\) return;/);
  assert.match(component, /await eyesOnAgentsStore\.createDomain\(normalizedTitle\.value\)/);
  assert.match(component, /try \{[\s\S]*createDomain[\s\S]*close\(\);[\s\S]*\} catch \{/);

  const menuBarStyles = read(
    'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.less'
  );
  assert.match(
    menuBarStyles,
    /\.eyes-menu-bar__actions \.eyes-menu-bar__refresh,\s*\.eyes-menu-bar__actions \.add-domain-popover__trigger\s*\{[^}]*width: auto/
  );
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
