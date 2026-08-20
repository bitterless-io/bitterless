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
            previewThread: (params) => harness().previewThread(params),
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
  canPreviewTranscript = false,
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
  canPreviewTranscript,
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
    const previewedThreadIds = [];
    const readStateCalls = [];
    globalThis.__eyesOnAgentsFocusBoardHarness = {
      getSnapshot: async () => currentSnapshot,
      openThread: async ({ sessionKey: openedSessionKey }) => {
        openedThreadIds.push(openedSessionKey);
        return { snapshot: openSnapshot };
      },
      previewThread: async ({ sessionKey: previewedSessionKey }) => {
        previewedThreadIds.push(previewedSessionKey);
      },
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
      currentSnapshot = snapshot;
      openSnapshot = snapshot;
      openedThreadIds.length = 0;
      previewedThreadIds.length = 0;
      readStateCalls.length = 0;
    };
    const threadIds = (threads) => threads.map((thread) => thread.threadId);
    const focusIds = () => threadIds(store.focusThreads);
    const filteredIds = () => threadIds(store.filteredFocusThreads);

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

      assert.deepEqual(focusIds(), ['working', 'unread', 'read']);
      assert.deepEqual(filteredIds(), ['working', 'unread', 'read']);
      assert.deepEqual(threadIds(store.readableFocusThreads), ['unread']);
    });

    await context.test('Read all stays limited to terminal unread rows', () => {
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

      assert.deepEqual(
        threadIds(store.readableFocusThreads).sort(),
        ['terminal-unread'],
      );
      assert.equal(store.focusThreads.length, 4);
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
            threadId: 'working',
            title: 'Task working',
            runtimeState: 'working',
            statusObservedAt: '2026-07-30T06:00:00.000Z',
            lastActivityAt: '2026-07-30T12:00:00.000Z',
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
          'working',
          'unread-new',
          'unread-old',
          'ordinary-activity',
          'ordinary-completion',
          'ordinary-old',
        ];
        assert.deepEqual(focusIds(), expected);

        store.titleQuery = 'task';
        assert.deepEqual(filteredIds(), expected, 'filtering must not reorder Focus');
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

    await context.test('an empty, cleared, or separator-only query is not a filter', () => {
      const thread = createThread({ threadId: 'ops', title: 'ops-git' });
      const other = createThread({ threadId: 'other', title: 'release notes' });
      resetStore(createSnapshot([thread, other]));

      assert.equal(store.isTitleFiltered, false);
      assert.deepEqual(filteredIds().sort(), ['ops', 'other']);

      store.titleQuery = 'ops';
      assert.equal(store.isTitleFiltered, true);
      assert.deepEqual(filteredIds(), ['ops']);

      store.titleQuery = '';
      assert.equal(store.isTitleFiltered, false);
      assert.deepEqual(filteredIds().sort(), ['ops', 'other']);

      store.titleQuery = '  - _ . / \\ : | \t  ';
      assert.equal(store.isTitleFiltered, false);
      assert.deepEqual(filteredIds().sort(), ['ops', 'other']);

      store.titleQuery = 'ops';
      store.clearTitleQuery();
      assert.equal(store.titleQuery, '');
      assert.deepEqual(filteredIds().sort(), ['ops', 'other']);
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
        assert.deepEqual(filteredIds(), ['ops-git', 'git-ops']);
      }

      store.titleQuery = 'ready deploy release';
      assert.deepEqual(filteredIds(), ['mixed-title']);
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
      assert.deepEqual(filteredIds(), ['ascii', 'fullwidth']);

      store.titleQuery = 'ops missing';
      assert.deepEqual(filteredIds(), []);
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
      assert.deepEqual(filteredIds(), ['title-match']);

      store.titleQuery = 'ops missing';
      assert.deepEqual(filteredIds(), []);
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
      assert.deepEqual(filteredIds(), ['overmind-task']);

      store.titleQuery = 'overmind';
      assert.deepEqual(
        filteredIds(),
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
        assert.equal(store.titleQuery, '', 'typing must not filter before a commit');
        assert.deepEqual(filteredIds(), ['ops-git', 'release']);

        store.commitTitleQuery();
        assert.equal(store.titleQuery, 'ops git', 'the trailing commit uses the newest draft');
        assert.deepEqual(filteredIds(), ['ops-git']);

        const repeats = scheduled;
        store.setTitleDraft('ops git');
        assert.equal(scheduled, repeats, 'an unchanged draft schedules nothing');

        store.clearTitleQuery();
        assert.equal(store.titleDraft, '');
        assert.equal(store.titleQuery, '');
        store.commitTitleQuery();
        assert.deepEqual(
          filteredIds(),
          ['ops-git', 'release'],
          'a late trailing commit after a close can only re-apply the empty query',
        );
      },
    );

    await context.test('without a scheduler the draft commits synchronously', () => {
      const thread = createThread({ threadId: 'ops', title: 'ops-git' });
      const other = createThread({ threadId: 'other', title: 'release notes' });
      resetStore(createSnapshot([thread, other]));

      store.setTitleDraft('ops');
      assert.equal(store.titleQuery, 'ops');
      assert.deepEqual(filteredIds(), ['ops']);
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
      assert.deepEqual(filteredIds(), ['working']);

      const idleRow = store.snapshot.threads.find((row) => row.threadId === 'idle');
      idleRow.title = 'renamed release';
      store.setTitleDraft('renamed');
      assert.deepEqual(
        filteredIds(),
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
      assert.deepEqual(threadIds(store.readableFocusThreads), [], 'the row is acknowledged');

      await store.setThreadUnread(sessionKey('read-row'), true);
      assert.deepEqual(readStateCalls[1], { sessionKey: sessionKey('read-row'), isUnread: true });
      assert.deepEqual(
        threadIds(store.readableFocusThreads),
        ['read-row'],
        'a re-flagged terminal row becomes Read all eligible again'
      );
      assert.deepEqual(focusIds(), ['read-row', 'unread-row'], 'and it moves into the unread tier');
    });

    await context.test('a filtered card keeps the established Open contract', async () => {
      const codex = createThread({ threadId: 'codex-open', title: 'Shared Codex task' });
      const claudeCli = createThread({
        threadId: 'claude-cli',
        title: 'Shared Claude task',
        provider: 'claude',
        canPreviewTranscript: true,
      });
      resetStore(createSnapshot([codex, claudeCli]));
      store.titleQuery = 'shared';
      assert.deepEqual(filteredIds().sort(), ['claude-cli', 'codex-open']);

      await store.openThread(sessionKey('claude-cli', 'claude'));
      assert.deepEqual(openedThreadIds, [], 'a CLI-only Claude row still refuses to open');

      await store.openThread(sessionKey('codex-open'));
      assert.deepEqual(openedThreadIds, [sessionKey('codex-open')]);
      assert.equal(store.titleQuery, 'shared', 'opening a card preserves the active filter');
    });
  } finally {
    delete globalThis.__eyesOnAgentsFocusBoardHarness;
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
