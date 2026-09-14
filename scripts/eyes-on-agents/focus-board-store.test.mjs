import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-focus-board-store-'));
const sessionKey = (threadId, provider = 'codex') => `${provider}:${threadId}`;

const emitterPlugin = {
  name: 'eyes-on-agents-focus-board-emitter',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /eyesOnAgents\.emitter$/ },
      () => ({ path: 'emitter', namespace: 'eyes-focus-board-test' }),
    );
    buildApi.onLoad(
      { filter: /.*/, namespace: 'eyes-focus-board-test' },
      () => ({
        contents: `
          const harness = () => globalThis.__eyesOnAgentsFocusBoardHarness;
          export const eyesOnAgentsEmitter = {
            getSnapshot: () => harness().getSnapshot(),
            openThread: (params) => harness().openThread(params),
            archiveThread: (params) => harness().archiveThread(params),
            deleteThreadFromBitterless: (params) => harness().deleteThreadFromBitterless(params),
            refreshThreadPages: async () => ({ changed: false }),
            setThreadUnread: (params) => harness().setThreadUnread(params),
            markAllRead: () => harness().markAllRead()
          };
          export const subscribeEyesOnAgentsChanges = () => undefined;
        `,
        loader: 'js',
      }),
    );
  },
};

const createThread = ({
  threadId,
  title,
  provider = 'codex',
  desktopSessionId = null,
  iterm2SessionId = null,
  canCopySessionPath = false,
  domainId = 1,
  cwd = null,
  projectName = null,
  runtimeState = 'idle',
  isUnread = false,
  lastCompletedAt = null,
  statusObservedAt = null,
  lastActivityAt = null,
  lastUserPromptPreview = null,
}) => ({
  sessionKey: sessionKey(threadId, provider),
  provider,
  threadId,
  archiveState: 'active',
  desktopSessionId,
  iterm2SessionId,
  canCopySessionPath,
  domainId,
  title,
  cwd,
  projectKey: projectName ? `/projects/${projectName}` : null,
  projectRoot: projectName ? `/projects/${projectName}` : null,
  projectName,
  runtimeState,
  activeFlags: [],
  activeTurnId: null,
  lastCompletedTurnId: null,
  lastCompletedAt,
  lastOpenedTurnId: null,
  lastOpenedAt: null,
  statusSource: 'discovery',
  statusObservedAt,
  lastActivityAt,
  isUnread,
  isFocused: isUnread,
  lastUserPrompt: {
    state: lastUserPromptPreview === null ? 'unavailable' : 'available',
    preview: lastUserPromptPreview,
    turnId: null,
    observedAt: null,
    checkedAt: null,
    truncated: false,
  },
});

const createSnapshot = (threads, claudeDirectory = []) => ({
  domains: [],
  threads,
  connection: {
    state: 'disconnected',
    lastSyncedAt: null,
    error: null,
    autoConnectEnabled: false,
  },
  bridge: {
    state: 'not_installed',
    reviewReason: null,
    listening: false,
    listeningSince: null,
    lastEventAt: null,
    lastInspectedAt: null,
    error: null,
  },
  claudeBridge: {
    state: 'not_installed',
    setupAction: 'enable',
    configured: false,
    enabled: false,
    listening: false,
    listeningSince: null,
    firstReceiptAt: null,
    lastReceiptAt: null,
    lastInspectedAt: null,
    observationProof: 'none',
    restartRequired: false,
    error: null,
  },
  claudeDirectory,
  lastSyncedAt: null,
  lastUserPromptCaptureEnabled: false,
  titleEnrichmentDiagnostic: null,
});

// One configured Claude environment's status row, as snapshot.claudeDirectory carries it (task 085).
const createClaudeEnvironment = ({ id, label, configuredDirectory, mode = 'custom' }) => ({
  id,
  label,
  enabled: true,
  mode,
  configuredDirectory,
  effectiveDirectory: configuredDirectory,
  projectsDirectory: null,
  desktopDirectoryCount: 0,
  state: 'watching',
  watching: true,
  lastScanAt: null,
  lastSuccessfulScanAt: null,
  nextRetryAt: null,
  error: null,
  canRemove: true,
});

test('Focus board store contract', async (context) => {
  try {
    const outfile = join(buildRoot, 'eyesOnAgents.store.mjs');
    await build({
      entryPoints: [join(
        projectRoot,
        'src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts',
      )],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      tsconfig: join(projectRoot, 'tsconfig.web.json'),
      external: ['vue'],
      plugins: [emitterPlugin],
    });

    let currentSnapshot = createSnapshot([]);
    let openSnapshot = currentSnapshot;
    const openedThreadIds = [];
    const archivedSessionKeys = [];
    const deletedSessionKeys = [];
    const readStateCalls = [];
    const readAllCalls = [];
    const defaultOpenThread = async ({ sessionKey: openedSessionKey }) => {
      openedThreadIds.push(openedSessionKey);
      return { snapshot: openSnapshot };
    };
    let openThread = defaultOpenThread;
    const defaultArchiveThread = async ({ sessionKey: archivedSessionKey }) => {
      archivedSessionKeys.push(archivedSessionKey);
      const next = createSnapshot(currentSnapshot.threads.filter(
        (thread) => thread.sessionKey !== archivedSessionKey,
      ));
      currentSnapshot = next;
      return next;
    };
    let archiveThread = defaultArchiveThread;
    const defaultDeleteThread = async ({ sessionKey: deletedSessionKey }) => {
      deletedSessionKeys.push(deletedSessionKey);
      currentSnapshot = createSnapshot(currentSnapshot.threads.filter(
        (thread) => thread.sessionKey !== deletedSessionKey,
      ));
      return currentSnapshot;
    };
    let deleteThread = defaultDeleteThread;
    const defaultMarkAllRead = async () => {
      readAllCalls.push('read-all');
      currentSnapshot = createSnapshot(currentSnapshot.threads.map((thread) => ({
        ...thread, isUnread: false,
      })));
      return currentSnapshot;
    };
    let markAllRead = defaultMarkAllRead;
    const defaultGetSnapshot = async () => currentSnapshot;
    let getSnapshot = defaultGetSnapshot;
    globalThis.__eyesOnAgentsFocusBoardHarness = {
      getSnapshot: () => getSnapshot(),
      openThread: (params) => openThread(params),
      archiveThread: (params) => archiveThread(params),
      deleteThreadFromBitterless: (params) => deleteThread(params),
      markAllRead: () => markAllRead(),
      setThreadUnread: async (params) => {
        readStateCalls.push(params);
        const next = createSnapshot(currentSnapshot.threads.map((thread) =>
          thread.sessionKey === params.sessionKey
            ? { ...thread, isUnread: params.isUnread }
            : thread));
        currentSnapshot = next;
        return next;
      },
    };

    const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
    const store = module.eyesOnAgentsStore;
    const resetStore = (snapshot) => {
      store.configureTitleQueryScheduler(null);
      store.snapshot = snapshot;
      store.titleDraft = '';
      store.titleQuery = '';
      store.threadSearchVisible = false;
      store.threadSearchSelectedSessionKey = null;
      store.openingSessionKeys = new Set();
      store.actionError = null;
      store.busyAction = null;
      currentSnapshot = snapshot;
      openSnapshot = snapshot;
      openThread = defaultOpenThread;
      archiveThread = defaultArchiveThread;
      deleteThread = defaultDeleteThread;
      markAllRead = defaultMarkAllRead;
      getSnapshot = defaultGetSnapshot;
      openedThreadIds.length = 0;
      archivedSessionKeys.length = 0;
      deletedSessionKeys.length = 0;
      readStateCalls.length = 0;
      readAllCalls.length = 0;
    };
    const threadIds = (threads) => threads.map((thread) => thread.threadId);
    const focusIds = () => threadIds(store.focusThreads);
    const searchIds = () => threadIds(store.threadSearchResults);

    await context.test('Focus lists every visible thread, including read ones', () => {
      const working = createThread({
        threadId: 'working',
        title: 'Working task',
        runtimeState: 'working',
        statusObservedAt: '2026-07-30T06:00:00.000Z',
      });
      const unread = createThread({
        threadId: 'unread',
        title: 'Unread task',
        runtimeState: 'idle',
        isUnread: true,
        lastActivityAt: '2026-07-30T05:00:00.000Z',
      });
      const read = createThread({
        threadId: 'read',
        title: 'Read task',
        runtimeState: 'idle',
        lastActivityAt: '2026-07-30T04:00:00.000Z',
      });
      resetStore(createSnapshot([read, unread, working]));

      assert.deepEqual(focusIds(), ['unread', 'working', 'read']);
      assert.deepEqual(searchIds(), [], 'an empty modal query renders no result cards');
    });

    await context.test('Read all exposes non-active red dots, independent of query or provider', async () => {
      const threads = [
        createThread({
          threadId: 'terminal-unread',
          title: 'Terminal unread',
          runtimeState: 'failed',
          isUnread: true,
        }),
        createThread({
          threadId: 'working-unread',
          title: 'Working unread',
          runtimeState: 'working',
          isUnread: true,
          statusObservedAt: '2026-07-30T06:00:00.000Z',
        }),
        createThread({
          threadId: 'unknown-unread',
          title: 'Unknown unread',
          runtimeState: 'unknown',
          isUnread: true,
          provider: 'claude',
        }),
        createThread({ threadId: 'terminal-read', title: 'Terminal read' }),
      ];
      resetStore(createSnapshot(threads));

      assert.equal(store.focusThreads.length, 4);
      assert.deepEqual(threadIds(store.readableFocusThreads), ['unknown-unread', 'terminal-unread']);
      store.setTitleDraft('nothing-matches');
      assert.deepEqual(searchIds(), []);
      await store.markAllRead();
      assert.deepEqual(readAllCalls, ['read-all']);
      assert.equal(store.readableFocusThreads.length, 0);
      assert.equal(store.focusThreads.length, 4, 'acknowledged cards stay on Focus');
      assert.ok(store.threads.every((thread) => !thread.isUnread));
      assert.equal(store.threads.find((thread) => thread.threadId === 'working-unread').runtimeState, 'working');
      assert.equal(store.titleDraft, 'nothing-matches');
      await store.markAllRead();
      assert.equal(readAllCalls.length, 1, 'no visible unread is a no-op');
    });

    await context.test('Read all ignores empty or active-only snapshots and concurrent actions', async () => {
      for (const threads of [[], [createThread({
        threadId: 'working-only', title: 'Working', runtimeState: 'working', isUnread: true,
      })]]) {
        resetStore(createSnapshot(threads));
        assert.equal(store.readableFocusThreads.length, 0);
        await store.markAllRead();
        assert.equal(readAllCalls.length, 0);
      }
      const thread = createThread({ threadId: 'unread-busy', title: 'Unread', isUnread: true });
      resetStore(createSnapshot([thread]));
      store.busyAction = 'sync';
      await store.markAllRead();
      assert.equal(readAllCalls.length, 0);
      store.busyAction = null;
      let resolveWrite;
      markAllRead = () => {
        readAllCalls.push('read-all');
        return new Promise((resolvePromise) => { resolveWrite = resolvePromise; });
      };
      const pending = store.markAllRead();
      assert.equal(store.busyAction, 'read-all');
      assert.equal(store.threads[0].isUnread, true, 'pending writes do not optimistically clear');
      await store.markAllRead();
      assert.equal(readAllCalls.length, 1);
      resolveWrite(createSnapshot([{ ...thread, isUnread: false }]));
      await pending;
      assert.equal(store.busyAction, null);
      assert.equal(store.threads[0].isUnread, false);
    });

    await context.test('Read all failure retains unread rows and exposes the action error', async () => {
      const thread = createThread({ threadId: 'unread-failure', title: 'Unread', isUnread: true });
      resetStore(createSnapshot([thread]));
      markAllRead = async () => { throw new Error('Read all write failed'); };
      await assert.rejects(store.markAllRead(), /Read all write failed/);
      assert.equal(store.actionError, 'Read all write failed');
      assert.equal(store.busyAction, null);
      assert.equal(store.threads[0].isUnread, true);
    });

    for (const readPath of ['load', 'background', 'open']) {
      await context.test(`Read all rejects an older ${readPath} snapshot but accepts a later completion`, async () => {
        const thread = createThread({ threadId: 'read-all-race', title: 'Unread', isUnread: true });
        const stale = createSnapshot([thread]);
        resetStore(stale);
        let releaseRead;
        let readStarted;
        const started = new Promise((resolvePromise) => { readStarted = resolvePromise; });
        const oldSnapshot = new Promise((resolvePromise) => { releaseRead = resolvePromise; });
        getSnapshot = () => { readStarted(); return oldSnapshot; };
        openThread = () => { readStarted(); return oldSnapshot.then((snapshot) => ({ snapshot })); };
        const pendingRead = readPath === 'load'
          ? store.loadSnapshot(true)
          : readPath === 'background'
            ? store.performBackgroundThreadPagesRefresh()
            : store.openThread(thread.sessionKey);
        await started;
        await store.markAllRead();
        assert.equal(store.threads[0].isUnread, false);
        releaseRead(stale);
        await pendingRead;
        assert.equal(store.threads[0].isUnread, false, 'an older response must not restore the red dot');
        currentSnapshot = createSnapshot([{ ...thread, lastCompletedTurnId: 'next-turn' }]);
        getSnapshot = defaultGetSnapshot;
        await store.loadSnapshot(true);
        assert.equal(store.threads[0].isUnread, true, 'a later completion can add a new dot');
        assert.equal(store.threads[0].lastCompletedTurnId, 'next-turn');
      });
    }

    await context.test(
      'ordering keeps attention ranks and non-active activity semantics',
      () => {
        const threads = [
          createThread({
            threadId: 'ordinary-old',
            title: 'Task ordinary old',
            runtimeState: 'unknown',
            lastActivityAt: '2026-07-30T01:00:00.000Z',
          }),
          createThread({
            threadId: 'unread-old',
            title: 'Task unread old',
            runtimeState: 'idle',
            isUnread: true,
            lastActivityAt: '2026-07-30T03:00:00.000Z',
          }),
          createThread({
            threadId: 'working-old',
            title: 'Task working old',
            runtimeState: 'working',
            statusObservedAt: '2026-07-30T05:00:00.000Z',
            lastActivityAt: '2026-07-30T13:00:00.000Z',
          }),
          createThread({
            threadId: 'approval-old',
            title: 'Task approval old',
            runtimeState: 'waiting_approval',
            statusObservedAt: '2026-07-30T01:00:00.000Z',
            lastActivityAt: '2026-07-30T11:00:00.000Z',
          }),
          createThread({
            threadId: 'ordinary-completion',
            title: 'Task ordinary completion',
            runtimeState: 'failed',
            lastCompletedAt: '2026-07-30T02:00:00.000Z',
          }),
          createThread({
            threadId: 'input',
            title: 'Task input',
            runtimeState: 'waiting_input',
            statusObservedAt: '2026-07-30T05:00:00.000Z',
          }),
          createThread({
            threadId: 'unread-new',
            title: 'Task unread new',
            runtimeState: 'ended',
            isUnread: true,
            lastActivityAt: '2026-07-30T04:00:00.000Z',
          }),
          createThread({
            threadId: 'working-latent-unread',
            title: 'Task working latent unread',
            runtimeState: 'working',
            isUnread: true,
            statusObservedAt: '2026-07-30T06:00:00.000Z',
            lastActivityAt: '2026-07-30T01:00:00.000Z',
          }),
          createThread({
            threadId: 'approval-new',
            title: 'Task approval new',
            runtimeState: 'waiting_approval',
            statusObservedAt: '2026-07-30T02:00:00.000Z',
          }),
          createThread({
            threadId: 'ordinary-activity',
            title: 'Task ordinary activity',
            runtimeState: 'idle',
            lastActivityAt: '2026-07-30T03:00:00.000Z',
            lastCompletedAt: '2026-07-30T10:00:00.000Z',
          }),
        ];
        resetStore(createSnapshot(threads));

        const expected = [
          'approval-new',
          'approval-old',
          'input',
          'unread-new',
          'unread-old',
          'working-latent-unread',
          'working-old',
          'ordinary-activity',
          'ordinary-completion',
          'ordinary-old',
        ];
        assert.deepEqual(focusIds(), expected);

        store.titleQuery = 'task';
        assert.deepEqual(searchIds(), expected, 'searching must not reorder Focus');
      },
    );

    await context.test(
      'working order ignores reply activity and changes on a new state entry',
      async () => {
        const olderStart = createThread({
          threadId: 'older-start',
          title: 'Task older start',
          runtimeState: 'working',
          statusObservedAt: '2026-07-30T01:00:00.000Z',
          lastActivityAt: '2026-07-30T10:00:00.000Z',
        });
        const newerStart = createThread({
          threadId: 'newer-start',
          title: 'Task newer start',
          runtimeState: 'working',
          statusObservedAt: '2026-07-30T02:00:00.000Z',
          lastActivityAt: '2026-07-30T03:00:00.000Z',
        });
        resetStore(createSnapshot([olderStart, newerStart]));

        const initialOrder = ['newer-start', 'older-start'];
        assert.deepEqual(focusIds(), initialOrder);

        currentSnapshot = createSnapshot([
          { ...olderStart, lastActivityAt: '2026-07-30T11:00:00.000Z' },
          newerStart,
        ]);
        await store.loadSnapshot(true);
        assert.deepEqual(focusIds(), initialOrder, 'reply activity must not move a working card');

        currentSnapshot = createSnapshot([
          {
            ...olderStart,
            statusObservedAt: '2026-07-30T03:00:00.000Z',
            lastActivityAt: '2026-07-30T11:00:00.000Z',
          },
          newerStart,
        ]);
        await store.loadSnapshot(true);
        assert.deepEqual(focusIds(), ['older-start', 'newer-start']);
      },
    );

    await context.test(
      'invalid, missing, and equal active timestamps use the session key',
      () => {
        const threads = [
          createThread({
            threadId: 'z-invalid',
            title: 'Task invalid',
            runtimeState: 'working',
            statusObservedAt: 'not-a-timestamp',
            lastActivityAt: '2030-07-30T12:00:00.000Z',
          }),
          createThread({
            threadId: 'b-equal',
            title: 'Task equal B',
            runtimeState: 'working',
            statusObservedAt: '2026-07-30T01:00:00.000Z',
            lastActivityAt: '2026-07-30T12:00:00.000Z',
          }),
          createThread({
            threadId: 'y-missing',
            title: 'Task missing',
            runtimeState: 'working',
            statusObservedAt: null,
            lastActivityAt: '2030-07-30T13:00:00.000Z',
          }),
          createThread({
            threadId: 'a-equal',
            title: 'Task equal A',
            runtimeState: 'working',
            statusObservedAt: '2026-07-30T01:00:00.000Z',
            lastActivityAt: '2026-07-30T01:00:00.000Z',
          }),
        ];
        resetStore(createSnapshot(threads));

        assert.deepEqual(focusIds(), ['a-equal', 'b-equal', 'y-missing', 'z-invalid']);
      },
    );

    await context.test('empty, cleared, and separator-only modal queries show no results', () => {
      const thread = createThread({ threadId: 'ops', title: 'ops-git' });
      const other = createThread({ threadId: 'other', title: 'release notes' });
      resetStore(createSnapshot([thread, other]));

      assert.equal(store.hasThreadSearchQueryTokens, false);
      assert.deepEqual(searchIds(), []);

      store.titleQuery = 'ops';
      assert.equal(store.hasThreadSearchQueryTokens, true);
      assert.deepEqual(searchIds(), ['ops']);

      store.titleQuery = '';
      assert.equal(store.hasThreadSearchQueryTokens, false);
      assert.deepEqual(searchIds(), []);

      store.titleQuery = '  - _ . / \\ : | \t  ';
      assert.equal(store.hasThreadSearchQueryTokens, false);
      assert.deepEqual(searchIds(), []);

      store.titleQuery = 'ops';
      store.clearTitleQuery();
      assert.equal(store.titleQuery, '');
      assert.deepEqual(searchIds(), []);
    });

    await context.test('pending snapshot work and a busy action do not gate local Search', async () => {
      resetStore(createSnapshot([
        createThread({ threadId: 'ops', title: 'ops-git' }),
        createThread({ threadId: 'release', title: 'release notes' }),
      ]));
      let resolveSnapshot;
      getSnapshot = () => new Promise((resolve) => {
        resolveSnapshot = resolve;
      });
      const pendingSnapshot = store.loadSnapshot(true);
      store.busyAction = 'sync';
      try {
        for (const [query, expected] of [['ops', 'ops'], ['release', 'release'], ['git', 'ops']]) {
          store.openThreadSearch();
          store.setTitleDraft(query);
          assert.equal(store.titleDraft, query);
          assert.equal(store.titleQuery, query);
          assert.deepEqual(searchIds(), [expected]);
          assert.equal(store.threadSearchSelectedSessionKey, sessionKey(expected));
          store.closeThreadSearch();
          assert.equal(store.titleDraft, '');
          assert.equal(store.titleQuery, '');
        }
      } finally {
        store.busyAction = null;
        resolveSnapshot(currentSnapshot);
        await pendingSnapshot;
      }
    });

    await context.test('token matching ignores order and mixed supported separators', () => {
      const opsGit = createThread({
        threadId: 'ops-git',
        title: 'ops-git',
        lastActivityAt: '2026-07-30T03:00:00.000Z',
      });
      const gitOps = createThread({
        threadId: 'git-ops',
        title: 'git_ops release',
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      const mixedTitle = createThread({
        threadId: 'mixed-title',
        title: 'deploy.api/code\\release:ready|now',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([mixedTitle, gitOps, opsGit]));

      for (const query of ['ops git', 'git ops', '  ops   git  ', 'ops-_. /\\:|git']) {
        store.titleQuery = query;
        assert.deepEqual(searchIds(), ['ops-git', 'git-ops']);
      }

      store.titleQuery = 'ready deploy release';
      assert.deepEqual(searchIds(), ['mixed-title']);
    });

    await context.test('NFKC, locale case folding, and partial tokens remain convenient', () => {
      const ascii = createThread({
        threadId: 'ascii',
        title: 'OPS-GIT release',
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      const fullwidth = createThread({
        threadId: 'fullwidth',
        title: 'ＯＰＳ－ＧＩＴ',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([fullwidth, ascii]));

      store.titleQuery = 'ｏｐ　ＧＩ';
      assert.deepEqual(searchIds(), ['ascii', 'fullwidth']);

      store.titleQuery = 'ops missing';
      assert.deepEqual(searchIds(), []);
    });

    await context.test('matching reads title only and rejects unmatched tokens', () => {
      const titleMatch = createThread({
        threadId: 'title-match',
        title: 'Deploy ops-git task',
      });
      const idMatch = createThread({ threadId: 'ops-git-id-only', title: null });
      const cwdMatch = createThread({
        threadId: 'cwd-only',
        title: 'Unrelated',
        cwd: '/work/ops-git',
      });
      const projectMatch = createThread({
        threadId: 'project-only',
        title: 'Another task',
        projectName: 'ops-git',
      });
      const promptMatch = createThread({
        threadId: 'prompt-only',
        title: 'No title match',
        lastUserPromptPreview: 'ops git',
      });
      resetStore(createSnapshot([
        idMatch,
        cwdMatch,
        projectMatch,
        promptMatch,
        titleMatch,
      ]));

      store.titleQuery = 'ops git';
      assert.deepEqual(searchIds(), ['title-match']);

      store.titleQuery = 'ops missing';
      assert.deepEqual(searchIds(), []);
    });

    await context.test('the store keeps no Project selection state', () => {
      const thread = createThread({
        threadId: 'overmind-task',
        title: 'ops-git sync',
        projectName: 'overmind',
      });
      resetStore(createSnapshot([thread]));

      for (const member of [
        'projectFilter',
        'projectOptions',
        'projectFilterValue',
        'isProjectFiltered',
        'selectProjectFilter',
      ]) {
        assert.equal(
          store[member],
          undefined,
          `${member} must be gone with the retired Project filter`,
        );
      }
      store.titleQuery = 'ops';
      assert.deepEqual(searchIds(), ['overmind-task']);

      store.titleQuery = 'overmind';
      assert.deepEqual(
        searchIds(),
        [],
        'a Project name must never satisfy the title filter',
      );
    });

    await context.test(
      'a throttled draft commits the last input and never an earlier one',
      () => {
        const opsGit = createThread({
          threadId: 'ops-git',
          title: 'ops-git sync',
          lastActivityAt: '2026-07-30T02:00:00.000Z',
        });
        const release = createThread({
          threadId: 'release',
          title: 'release notes',
          lastActivityAt: '2026-07-30T01:00:00.000Z',
        });
        resetStore(createSnapshot([opsGit, release]));

        let scheduled = 0;
        store.configureTitleQueryScheduler(() => {
          scheduled += 1;
        });

        store.setTitleDraft('o');
        store.setTitleDraft('op');
        store.setTitleDraft('ops git');

        assert.equal(scheduled, 3, 'each keystroke asks the scheduler to run');
        assert.equal(store.titleDraft, 'ops git');
        assert.equal(store.titleQuery, '', 'typing must not update results before a commit');
        assert.deepEqual(searchIds(), []);

        store.commitTitleQuery();
        assert.equal(store.titleQuery, 'ops git', 'the trailing commit uses the newest draft');
        assert.deepEqual(searchIds(), ['ops-git']);

        const repeats = scheduled;
        store.setTitleDraft('ops git');
        assert.equal(scheduled, repeats, 'an unchanged draft schedules nothing');

        store.clearTitleQuery();
        assert.equal(store.titleDraft, '');
        assert.equal(store.titleQuery, '');
        store.commitTitleQuery();
        assert.deepEqual(
          searchIds(),
          [],
          'a late trailing commit after close can only re-apply the empty query',
        );
      },
    );

    await context.test('without a scheduler the draft commits synchronously', () => {
      const thread = createThread({ threadId: 'ops', title: 'ops-git' });
      const other = createThread({ threadId: 'other', title: 'release notes' });
      resetStore(createSnapshot([thread, other]));

      store.setTitleDraft('ops');
      assert.equal(store.titleQuery, 'ops');
      assert.deepEqual(searchIds(), ['ops']);
    });

    await context.test('programmatic drafts preserve raw text while matching normalized titles', () => {
      const ops = createThread({ threadId: 'ops', title: 'ops-git 中文' });
      const cafe = createThread({ threadId: 'cafe', title: 'CAFÉ résumé' });
      resetStore(createSnapshot([ops, cafe]));
      store.openThreadSearch();

      for (const [raw, expected, hasTokens] of [
        ['  OpS  ', ['ops'], true],
        ['\tＧＩＴ＿ＯＰＳ / 中文　', ['ops'], true],
        ['  Cafe\u0301 : RÉSUMÉ  ', ['cafe'], true],
        ['  中文  ', ['ops'], true],
        ['  - _ . / \\ : | \t　', [], false],
        ['  ＯＰＳ !?  ', [], true],
      ]) {
        store.setTitleDraft(raw);
        assert.equal(store.titleDraft, raw, 'the programmatic setter keeps every raw character');
        assert.equal(store.titleQuery, raw, 'committing never writes normalized tokens as text');
        assert.deepEqual(searchIds(), expected);
        assert.equal(store.hasThreadSearchQueryTokens, hasTokens);
        assert.equal(store.titleDraft, raw, 'reading computed matching state cannot rewrite input');
        assert.equal(store.titleQuery, raw);
      }
      assert.equal(focusIds().length, 2, 'raw title filtering does not filter the Focus board');
    });

    await context.test('the real 120ms scheduler publishes the newest raw replacement', (subtest) => {
      subtest.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
      resetStore(createSnapshot([
        createThread({ threadId: 'ops', title: 'ops-git 中文' }),
        createThread({ threadId: 'release', title: 'release notes' }),
      ]));
      store.configureTitleQueryScheduler(module.createEyesOnAgentsTitleQueryScheduler(
        (revision) => store.commitTitleQuery(revision),
      ));
      store.openThreadSearch();

      const leadingRaw = '  ReLeAsE  ';
      const trailingRaw = '\tＯＰＳ / GiT : 中文　';
      store.setTitleDraft(leadingRaw);
      assert.equal(store.titleQuery, leadingRaw);
      assert.deepEqual(searchIds(), ['release']);
      store.setTitleDraft('  replaced intermediate  ');
      store.setTitleDraft(trailingRaw);
      assert.equal(store.titleDraft, trailingRaw);
      subtest.mock.timers.tick(119);
      assert.equal(store.titleQuery, leadingRaw, 'the trailing publication remains throttled');
      assert.equal(store.titleDraft, trailingRaw);
      subtest.mock.timers.tick(1);
      assert.equal(store.titleQuery, trailingRaw);
      assert.deepEqual(searchIds(), ['ops']);
      assert.equal(store.hasThreadSearchQueryTokens, true);
      assert.equal(store.titleDraft, trailingRaw);
      store.closeThreadSearch();
    });

    await context.test('background snapshots preserve raw committed and pending Search input', async () => {
      const ops = createThread({ threadId: 'ops', title: 'ops-git 中文' });
      const release = createThread({ threadId: 'release', title: 'release notes' });
      resetStore(createSnapshot([ops, release]));
      store.openThreadSearch();
      const committedRaw = '  ＯＰＳ / 中文　';
      const pendingRaw = '\tReLeAsE : NoTeS  ';
      store.setTitleDraft(committedRaw);
      assert.deepEqual(searchIds(), ['ops']);

      const publications = [];
      store.configureTitleQueryScheduler((revision) => publications.push(revision));
      store.setTitleDraft(pendingRaw);
      currentSnapshot = createSnapshot([
        { ...ops, title: 'renamed task' },
        { ...release, runtimeState: 'working' },
      ]);
      await store.loadSnapshot(true);
      assert.equal(store.titleDraft, pendingRaw, 'a fresh snapshot cannot replace the pending draft');
      assert.equal(store.titleQuery, committedRaw, 'a snapshot does not publish pending typing');
      assert.deepEqual(searchIds(), [], 'search reacts to changed snapshot titles');
      assert.equal(store.hasThreadSearchQueryTokens, true);
      assert.equal(store.titleDraft, pendingRaw, 'reading rerender projections keeps raw input');

      store.commitTitleQuery(publications.at(-1));
      assert.equal(store.titleQuery, pendingRaw);
      assert.deepEqual(searchIds(), ['release']);
      currentSnapshot = createSnapshot([ops, { ...release, isUnread: true }]);
      await store.loadSnapshot(true);
      assert.deepEqual(searchIds(), ['release']);
      assert.equal(store.titleDraft, pendingRaw, 'later snapshots keep committed raw text too');
      assert.equal(store.titleQuery, pendingRaw);
    });

    await context.test('closing Search invalidates pending query publications', () => {
      const oldThread = createThread({ threadId: 'old', title: 'Old task' });
      const newThread = createThread({ threadId: 'new', title: 'New task' });
      resetStore(createSnapshot([oldThread, newThread]));
      const scheduledRevisions = [];
      store.configureTitleQueryScheduler((lifecycleRevision) => {
        scheduledRevisions.push(lifecycleRevision);
      });

      store.openThreadSearch();
      store.setTitleDraft('old');
      const oldLifecycleRevision = scheduledRevisions.at(-1);
      assert.equal(typeof oldLifecycleRevision, 'number');

      store.toggleThreadSearch();
      assert.equal(store.threadSearchVisible, false);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);

      store.openThreadSearch();
      store.setTitleDraft('new');
      const currentLifecycleRevision = scheduledRevisions.at(-1);
      assert.notEqual(currentLifecycleRevision, oldLifecycleRevision);

      store.commitTitleQuery(oldLifecycleRevision);
      assert.equal(store.titleDraft, 'new');
      assert.equal(store.titleQuery, '', 'an old trailing callback cannot publish into a new modal');
      assert.equal(store.threadSearchSelectedSessionKey, null);

      store.commitTitleQuery(currentLifecycleRevision);
      assert.equal(store.titleQuery, 'new');
      assert.equal(store.threadSearchSelectedSessionKey, newThread.sessionKey);

      store.closeThreadSearch();
      store.commitTitleQuery(currentLifecycleRevision);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '', 'a callback cannot restore a closed modal query');
      assert.equal(store.threadSearchSelectedSessionKey, null);
    });

    await context.test('sorting and tokenizing are memoized instead of recomputed', async () => {
      const working = createThread({
        threadId: 'working',
        title: 'ops-git sync',
        runtimeState: 'working',
        statusObservedAt: '2026-07-30T02:00:00.000Z',
      });
      const idle = createThread({
        threadId: 'idle',
        title: 'release notes',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([idle, working]));

      const first = store.focusThreads;
      assert.equal(store.focusThreads, first, 'one snapshot must reuse its sorted array');
      assert.deepEqual(threadIds(first), ['working', 'idle']);

      currentSnapshot = createSnapshot([idle, working]);
      await store.loadSnapshot(true);
      const second = store.focusThreads;
      assert.notEqual(second, first, 'a new snapshot re-sorts once');
      assert.deepEqual(threadIds(second), ['working', 'idle']);

      store.setTitleDraft('ops');
      assert.deepEqual(searchIds(), ['working']);

      const idleRow = store.snapshot.threads.find((row) => row.threadId === 'idle');
      idleRow.title = 'renamed release';
      store.setTitleDraft('renamed');
      assert.deepEqual(
        searchIds(),
        ['idle'],
        'a changed title must invalidate its cached tokens',
      );
    });

    await context.test('the manual read-state toggle is a no-op when nothing would change', async () => {
      const unread = createThread({
        threadId: 'unread-row',
        title: 'Unread row',
        isUnread: true,
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      const read = createThread({
        threadId: 'read-row',
        title: 'Read row',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([unread, read]));

      await store.setThreadUnread(sessionKey('unread-row'), true);
      assert.deepEqual(readStateCalls, [], 'the flag it already has is never written');

      await store.setThreadUnread(sessionKey('missing-row'), true);
      assert.deepEqual(readStateCalls, [], 'an unknown session key is refused locally');

      await store.setThreadUnread(sessionKey('unread-row'), false);
      assert.deepEqual(readStateCalls, [{ sessionKey: sessionKey('unread-row'), isUnread: false }]);
      assert.equal(
        store.threads.find((thread) => thread.threadId === 'unread-row').isUnread,
        false,
        'the row is acknowledged',
      );

      await store.setThreadUnread(sessionKey('read-row'), true);
      assert.deepEqual(readStateCalls[1], { sessionKey: sessionKey('read-row'), isUnread: true });
      assert.equal(
        store.threads.find((thread) => thread.threadId === 'read-row').isUnread,
        true,
        'a re-flagged terminal row remains available to per-card controls',
      );
      assert.deepEqual(focusIds(), ['read-row', 'unread-row'], 'and it moves into the unread tier');
    });

    await context.test('modal selection uses session keys, wraps, and reconciles snapshots', async () => {
      const first = createThread({
        threadId: 'same-id',
        title: 'Shared first task',
        provider: 'codex',
        lastActivityAt: '2026-07-30T03:00:00.000Z',
      });
      const second = createThread({
        threadId: 'same-id',
        title: 'Shared second task',
        provider: 'claude',
        desktopSessionId: 'desktop-same-id',
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      const third = createThread({
        threadId: 'third',
        title: 'Shared third task',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([third, second, first]));

      store.openThreadSearch();
      assert.equal(store.threadSearchVisible, true);
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);

      store.setTitleDraft('shared');
      assert.deepEqual(searchIds(), ['same-id', 'same-id', 'third']);
      assert.equal(store.threadSearchSelectedSessionKey, first.sessionKey);

      store.moveThreadSearchSelection(-1);
      assert.equal(store.threadSearchSelectedSessionKey, third.sessionKey, 'Up wraps to the end');
      store.moveThreadSearchSelection(1);
      assert.equal(store.threadSearchSelectedSessionKey, first.sessionKey, 'Down wraps to the start');
      store.selectThreadSearchResult(second.sessionKey);
      assert.equal(
        store.threadSearchSelectedSessionKey,
        second.sessionKey,
        'provider-qualified keys distinguish duplicate provider thread IDs',
      );

      currentSnapshot = createSnapshot([second, third, first]);
      await store.loadSnapshot(true);
      assert.equal(
        store.threadSearchSelectedSessionKey,
        second.sessionKey,
        'a snapshot keeps a selected session key that still matches',
      );

      currentSnapshot = createSnapshot([third, first]);
      await store.loadSnapshot(true);
      assert.equal(
        store.threadSearchSelectedSessionKey,
        first.sessionKey,
        'a removed selection falls back to the first current result',
      );

      store.toggleThreadSearch();
      assert.equal(store.threadSearchVisible, false);
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);
    });

    await context.test('Arrow and Enter flush the newest draft before navigation or Open', async () => {
      const codex = createThread({
        threadId: 'codex-open',
        title: 'Ops task',
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      const release = createThread({
        threadId: 'release-open',
        title: 'Release task',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([release, codex]));
      store.openThreadSearch();
      let scheduled = 0;
      store.configureTitleQueryScheduler(() => {
        scheduled += 1;
      });

      store.setTitleDraft('release');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);
      store.moveThreadSearchSelection(1);
      assert.equal(store.titleQuery, 'release');
      assert.equal(store.threadSearchSelectedSessionKey, release.sessionKey);

      store.setTitleDraft('ops');
      assert.equal(store.titleQuery, 'release', 'the configured throttle still holds the draft');
      await store.openSelectedThreadSearchResult();
      assert.deepEqual(openedThreadIds, [codex.sessionKey]);
      assert.equal(store.threadSearchVisible, false, 'a successful Enter Open closes Search');
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);
      assert.equal(scheduled, 2);
      assert.deepEqual(searchIds(), []);
    });

    await context.test('successful card Open closes only the Search lifecycle that started it', async () => {
      const first = createThread({
        threadId: 'first-open',
        title: 'First searchable task',
      });
      const second = createThread({
        threadId: 'second-open',
        title: 'Second searchable task',
      });
      resetStore(createSnapshot([first, second]));
      store.openThreadSearch();
      store.setTitleDraft('first');

      let resolveOpen;
      openThread = ({ sessionKey: openedSessionKey }) => {
        openedThreadIds.push(openedSessionKey);
        return new Promise((resolveOpenRequest) => {
          resolveOpen = resolveOpenRequest;
        });
      };
      const pendingOpen = store.openThread(first.sessionKey);

      store.closeThreadSearch();
      store.openThreadSearch();
      store.setTitleDraft('second');
      assert.equal(store.threadSearchSelectedSessionKey, second.sessionKey);

      resolveOpen({ snapshot: openSnapshot });
      await pendingOpen;
      assert.equal(store.threadSearchVisible, true, 'an old Open cannot close a new Search');
      assert.equal(store.titleDraft, 'second');
      assert.equal(store.titleQuery, 'second');
      assert.equal(store.threadSearchSelectedSessionKey, second.sessionKey);

      openThread = defaultOpenThread;
      await store.openThread(second.sessionKey);
      assert.equal(store.threadSearchVisible, false, 'the current Search closes after its Open');
      assert.equal(store.titleDraft, '');
      assert.equal(store.titleQuery, '');
      assert.equal(store.threadSearchSelectedSessionKey, null);
    });

    await context.test('failed or guarded Open preserves Search for retry', async () => {
      const codex = createThread({
        threadId: 'failed-open',
        title: 'Failed searchable task',
      });
      const claude = createThread({
        threadId: 'guarded-open',
        title: 'Guarded searchable task',
        provider: 'claude',
      });
      resetStore(createSnapshot([codex, claude]));
      store.openThreadSearch();
      store.setTitleDraft('failed');
      openThread = async ({ sessionKey: openedSessionKey }) => {
        openedThreadIds.push(openedSessionKey);
        throw new Error('provider Open failed');
      };

      await assert.rejects(store.openThread(codex.sessionKey), /provider Open failed/);
      assert.equal(store.threadSearchVisible, true);
      assert.equal(store.titleDraft, 'failed');
      assert.equal(store.titleQuery, 'failed');
      assert.equal(store.threadSearchSelectedSessionKey, codex.sessionKey);
      assert.equal(store.actionError, 'provider Open failed');

      store.clearTitleQuery();
      store.setTitleDraft('guarded');
      await store.openThread(claude.sessionKey);
      assert.deepEqual(openedThreadIds, [codex.sessionKey], 'an unopenable Claude task is local-only');
      assert.equal(store.threadSearchVisible, true);
      assert.equal(store.titleDraft, 'guarded');
      assert.equal(store.titleQuery, 'guarded');
      assert.equal(store.threadSearchSelectedSessionKey, claude.sessionKey);

      store.openingSessionKeys = new Set([codex.sessionKey]);
      store.clearTitleQuery();
      store.setTitleDraft('failed');
      await store.openThread(codex.sessionKey);
      assert.deepEqual(openedThreadIds, [codex.sessionKey], 'an already-opening task is a no-op');
      assert.equal(store.threadSearchVisible, true);
      assert.equal(store.titleDraft, 'failed');
      assert.equal(store.titleQuery, 'failed');
      assert.equal(store.threadSearchSelectedSessionKey, codex.sessionKey);
    });

    await context.test('Codex Archive applies success, retains failures, and guards duplicates', async () => {
      const codex = createThread({
        threadId: 'archive-codex',
        title: 'Archive Codex task',
      });
      const claude = createThread({
        threadId: 'archive-claude',
        title: 'Archive Claude task',
        provider: 'claude',
        desktopSessionId: 'desktop-archive-claude',
      });
      resetStore(createSnapshot([codex, claude]));

      await store.archiveThread(claude.sessionKey);
      assert.deepEqual(archivedSessionKeys, [], 'Claude Archive is not a renderer action');

      await store.archiveThread(codex.sessionKey);
      assert.deepEqual(archivedSessionKeys, [codex.sessionKey]);
      assert.deepEqual(threadIds(store.threads), ['archive-claude']);
      assert.equal(store.actionError, null);

      resetStore(createSnapshot([codex]));
      archiveThread = async ({ sessionKey: archivedSessionKey }) => {
        archivedSessionKeys.push(archivedSessionKey);
        throw new Error('provider archive failed');
      };
      await assert.rejects(store.archiveThread(codex.sessionKey), /provider archive failed/);
      assert.deepEqual(threadIds(store.threads), ['archive-codex']);
      assert.equal(store.actionError, 'provider archive failed');

      resetStore(createSnapshot([codex]));
      let releaseArchive;
      archiveThread = ({ sessionKey: archivedSessionKey }) => {
        archivedSessionKeys.push(archivedSessionKey);
        return new Promise((resolvePromise) => {
          releaseArchive = () => resolvePromise(createSnapshot([]));
        });
      };
      const firstArchive = store.archiveThread(codex.sessionKey);
      const duplicateArchive = store.archiveThread(codex.sessionKey);
      assert.equal(store.busyAction, `thread-archive:${codex.sessionKey}`);
      assert.deepEqual(archivedSessionKeys, [codex.sessionKey]);
      await duplicateArchive;
      assert.deepEqual(archivedSessionKeys, [codex.sessionKey]);
      releaseArchive();
      await firstArchive;
      assert.deepEqual(threadIds(store.threads), []);
      assert.equal(store.busyAction, null);
    });

    await context.test('local deletion is provider-independent, idempotent, and retains failure state', async () => {
      const codex = createThread({ threadId: 'local-delete', title: 'Codex zombie' });
      const claude = createThread({
        threadId: 'local-delete', title: 'Claude zombie', provider: 'claude',
        desktopSessionId: null, runtimeState: 'unknown',
      });
      resetStore(createSnapshot([codex, claude]));
      await store.deleteThreadFromBitterless(codex.sessionKey);
      assert.deepEqual(store.threads.map((thread) => thread.sessionKey), [claude.sessionKey]);
      await store.deleteThreadFromBitterless(claude.sessionKey);
      await store.deleteThreadFromBitterless(claude.sessionKey);
      assert.deepEqual(deletedSessionKeys, [codex.sessionKey, claude.sessionKey, claude.sessionKey]);
      assert.deepEqual(store.threads, []);

      resetStore(createSnapshot([claude]));
      deleteThread = async () => { throw new Error('local write failed'); };
      await assert.rejects(store.deleteThreadFromBitterless(claude.sessionKey), /local write failed/);
      assert.deepEqual(store.threads.map((thread) => thread.sessionKey), [claude.sessionKey]);
      assert.equal(store.actionError, 'local write failed');
      assert.equal(store.busyAction, null);

      resetStore(createSnapshot([codex]));
      let finishDelete;
      deleteThread = ({ sessionKey }) => {
        deletedSessionKeys.push(sessionKey);
        return new Promise((resolvePromise) => {
          finishDelete = () => resolvePromise(createSnapshot([]));
        });
      };
      const deletion = store.deleteThreadFromBitterless(codex.sessionKey);
      await store.deleteThreadFromBitterless(codex.sessionKey);
      assert.deepEqual(deletedSessionKeys, [codex.sessionKey]);
      assert.equal(store.busyAction, `thread-delete:${codex.sessionKey}`);
      finishDelete();
      await deletion;
      assert.deepEqual(store.threads, []);
    });

    for (const readPath of ['load', 'background', 'open']) {
      await context.test(`local delete rejects an earlier ${readPath} snapshot but accepts rediscovery`, async () => {
        const thread = createThread({ threadId: 'delete-race', title: 'Delete race' });
        const stale = createSnapshot([thread]);
        resetStore(stale);
        let releaseRead;
        let readStarted;
        const started = new Promise((resolvePromise) => { readStarted = resolvePromise; });
        const oldSnapshot = new Promise((resolvePromise) => { releaseRead = resolvePromise; });
        getSnapshot = () => { readStarted(); return oldSnapshot; };
        openThread = () => { readStarted(); return oldSnapshot.then((snapshot) => ({ snapshot })); };
        const pendingRead = readPath === 'load'
          ? store.loadSnapshot(true)
          : readPath === 'background'
            ? store.performBackgroundThreadPagesRefresh()
            : store.openThread(thread.sessionKey);
        await started;
        await store.deleteThreadFromBitterless(thread.sessionKey);
        assert.deepEqual(store.threads, []);
        releaseRead(stale);
        await pendingRead;
        assert.deepEqual(store.threads, [], 'late response must not restore the removed card');

        currentSnapshot = createSnapshot([{ ...thread, title: 'Fresh discovery' }]);
        getSnapshot = defaultGetSnapshot;
        await store.loadSnapshot(true);
        assert.deepEqual(threadIds(store.threads), ['delete-race']);
        assert.equal(store.threads[0].title, 'Fresh discovery');
      });
    }

    // Task 088 (review 1): direct coverage for the store's own matching/normalization logic. The
    // ThreadCard test stubs resolveClaudeEnvironmentLabel out through createStore overrides, so it
    // only exercises ThreadCard.vue's folderLabel branch, never this resolver.
    await context.test(
      'resolveClaudeEnvironmentLabel resolves a thread\'s claudeConfigDir against the snapshot',
      () => {
        resetStore(createSnapshot([], [
          // The automatic default row has no configuredDirectory and must be skipped, not treated
          // as a candidate — it is deliberately first so a missing null-filter would fail here.
          createClaudeEnvironment({
            id: '11111111-1111-4111-8111-111111111111',
            label: 'Default',
            mode: 'automatic',
            configuredDirectory: null,
          }),
          createClaudeEnvironment({
            id: '22222222-2222-4222-8222-222222222222',
            label: 'claude2',
            configuredDirectory: '/Users/ral/.claude2',
          }),
          createClaudeEnvironment({
            id: '33333333-3333-4333-8333-333333333333',
            label: 'claude3',
            configuredDirectory: '/Users/ral/.claude3/',
          }),
        ]));

        assert.equal(store.resolveClaudeEnvironmentLabel('/Users/ral/.claude2'), 'claude2',
          'an exact path match resolves that environment\'s label');
        assert.equal(store.resolveClaudeEnvironmentLabel('/Users/ral/.claude2/'), 'claude2',
          'a trailing slash on the thread side still matches');
        assert.equal(store.resolveClaudeEnvironmentLabel('/Users/ral/.claude3'), 'claude3',
          'a trailing slash on the configured side still matches');
        assert.equal(store.resolveClaudeEnvironmentLabel('/Users/ral/.claude9'), null,
          'a non-matching path resolves no label');
        assert.equal(store.resolveClaudeEnvironmentLabel(null), null,
          'a thread with no captured claudeConfigDir resolves no label');

        resetStore(createSnapshot([], [
          createClaudeEnvironment({
            id: '44444444-4444-4444-8444-444444444444',
            label: 'first',
            configuredDirectory: '/Users/ral/.claude-shared',
          }),
          createClaudeEnvironment({
            id: '55555555-5555-4555-8555-555555555555',
            label: 'second',
            configuredDirectory: '/Users/ral/.claude-shared/',
          }),
        ]));

        assert.equal(store.resolveClaudeEnvironmentLabel('/Users/ral/.claude-shared'), 'first',
          'the first configured environment wins when two normalize to the same directory');
      },
    );
  } finally {
    delete globalThis.__eyesOnAgentsFocusBoardHarness;
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
