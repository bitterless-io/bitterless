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
            setThreadUnread: (params) => harness().setThreadUnread(params)
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

const createSnapshot = (threads) => ({
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
  lastSyncedAt: null,
  lastUserPromptCaptureEnabled: false,
  titleEnrichmentDiagnostic: null,
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
    const readStateCalls = [];
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
    globalThis.__eyesOnAgentsFocusBoardHarness = {
      getSnapshot: async () => currentSnapshot,
      openThread: (params) => openThread(params),
      archiveThread: (params) => archiveThread(params),
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
      openedThreadIds.length = 0;
      archivedSessionKeys.length = 0;
      readStateCalls.length = 0;
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

    await context.test('the renderer no longer exposes bulk Read all state or actions', () => {
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
        }),
        createThread({ threadId: 'terminal-read', title: 'Terminal read' }),
      ];
      resetStore(createSnapshot(threads));

      assert.equal(store.focusThreads.length, 4);
      assert.equal(store.readableFocusThreads, undefined);
      assert.equal(store.markAllRead, undefined);
    });

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
  } finally {
    delete globalThis.__eyesOnAgentsFocusBoardHarness;
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
