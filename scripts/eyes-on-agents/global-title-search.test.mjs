import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(projectRoot, '.eyes-global-title-search-'));

const emitterPlugin = {
  name: 'eyes-on-agents-global-title-search-emitter',
  setup(buildApi) {
    buildApi.onResolve(
      { filter: /eyesOnAgents\.emitter$/ },
      () => ({ path: 'emitter', namespace: 'eyes-global-title-search-test' }),
    );
    buildApi.onLoad(
      { filter: /.*/, namespace: 'eyes-global-title-search-test' },
      () => ({
        contents: `
          const harness = () => globalThis.__eyesOnAgentsGlobalTitleSearchHarness;
          export const eyesOnAgentsEmitter = {
            getSnapshot: () => harness().getSnapshot(),
            openThread: (params) => harness().openThread(params)
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
  domainId = 1,
  cwd = null,
  projectName = null,
  runtimeState = 'idle',
  isUnread = false,
  lastActivityAt = null,
  lastUserPromptPreview = null,
}) => ({
  threadId,
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
  lastCompletedAt: null,
  lastOpenedTurnId: null,
  lastOpenedAt: null,
  statusSource: 'discovery',
  statusObservedAt: null,
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

const createDomain = ({
  id,
  domainKey,
  title,
  sortIndex = id,
  isSystem = false,
}) => ({
  id,
  domainKey,
  title,
  sortIndex,
  isSystem,
});

const createSnapshot = (threads, domains = []) => ({
  domains,
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
  lastSyncedAt: null,
  lastUserPromptCaptureEnabled: false,
  titleEnrichmentDiagnostic: null,
});

test('global title search store contract', async (context) => {
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
    globalThis.__eyesOnAgentsGlobalTitleSearchHarness = {
      getSnapshot: async () => currentSnapshot,
      openThread: async ({ threadId }) => {
        openedThreadIds.push(threadId);
        return { snapshot: openSnapshot };
      },
    };

    const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
    const store = module.eyesOnAgentsStore;
    const resetStore = (snapshot) => {
      store.closeThreadSearch();
      store.snapshot = snapshot;
      store.allProjectFilter = { type: 'all' };
      store.allTitleQuery = '';
      currentSnapshot = snapshot;
      openSnapshot = snapshot;
      openedThreadIds.length = 0;
    };

    await context.test('open, clear, and separator-only queries keep results gated', () => {
      const thread = createThread({ threadId: 'ops', title: 'ops-git' });
      resetStore(createSnapshot([thread]));
      store.allProjectFilter = { type: 'none' };
      store.allTitleQuery = 'does not compose';

      store.openThreadSearch();

      assert.equal(store.threadSearchVisible, true);
      assert.equal(store.hasThreadSearchQueryTokens, false);
      assert.deepEqual(store.threadSearchResults, []);
      assert.equal(store.threadSearchSelectedThreadId, null);

      store.setThreadSearchQuery('ops');
      assert.equal(store.hasThreadSearchQueryTokens, true);
      assert.deepEqual(
        store.threadSearchResults.map((item) => item.threadId),
        ['ops'],
      );
      assert.equal(store.threadSearchSelectedThreadId, 'ops');

      store.setThreadSearchQuery('');
      assert.equal(store.hasThreadSearchQueryTokens, false);
      assert.deepEqual(store.threadSearchResults, []);
      assert.equal(store.threadSearchSelectedThreadId, null);

      store.setThreadSearchQuery('  - _ . / \\ : | \t  ');
      assert.equal(store.hasThreadSearchQueryTokens, false);
      assert.deepEqual(store.threadSearchResults, []);
      assert.equal(store.threadSearchSelectedThreadId, null);

      store.setThreadSearchQuery('ops');
      assert.equal(store.threadSearchSelectedThreadId, 'ops');
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
      store.openThreadSearch();

      for (const query of ['ops git', 'git ops', '  ops   git  ', 'ops-_. /\\:|git']) {
        store.setThreadSearchQuery(query);
        assert.deepEqual(
          store.threadSearchResults.map((thread) => thread.threadId),
          ['ops-git', 'git-ops'],
        );
      }

      store.setThreadSearchQuery('ready deploy release');
      assert.deepEqual(
        store.threadSearchResults.map((thread) => thread.threadId),
        ['mixed-title'],
      );
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
      store.openThreadSearch();

      store.setThreadSearchQuery('ｏｐ　ＧＩ');
      assert.deepEqual(
        store.threadSearchResults.map((thread) => thread.threadId),
        ['ascii', 'fullwidth'],
      );

      store.setThreadSearchQuery('ops missing');
      assert.deepEqual(store.threadSearchResults, []);
      assert.equal(store.threadSearchSelectedThreadId, null);
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
      const domainMatch = createThread({
        threadId: 'domain-only',
        title: 'Still unrelated',
        domainId: 2,
      });
      resetStore(createSnapshot([
        idMatch,
        cwdMatch,
        projectMatch,
        promptMatch,
        domainMatch,
        titleMatch,
      ], [
        createDomain({ id: 2, domainKey: 'operations', title: 'ops git' }),
      ]));
      store.allProjectFilter = { type: 'none' };
      store.allTitleQuery = 'unrelated';
      store.openThreadSearch();

      store.setThreadSearchQuery('ops git');

      assert.deepEqual(
        store.threadSearchResults.map((thread) => thread.threadId),
        ['title-match'],
      );
      assert.equal(store.threadSearchSelectedThreadId, 'title-match');

      store.setThreadSearchQuery('ops missing');
      assert.deepEqual(store.threadSearchResults, []);
      assert.equal(store.threadSearchSelectedThreadId, null);
    });

    await context.test('custom Domain titles resolve live with null classification fallbacks', async () => {
      const uncategorized = createDomain({
        id: 1,
        domainKey: 'uncategorized',
        title: 'Uncategorized',
        isSystem: true,
      });
      const operations = createDomain({
        id: 2,
        domainKey: 'operations',
        title: '  Operations  ',
      });
      const blank = createDomain({
        id: 3,
        domainKey: 'blank',
        title: '   ',
      });
      const thread = createThread({
        threadId: 'domain-task',
        title: 'Domain task',
        domainId: 2,
      });
      resetStore(createSnapshot([thread], [uncategorized, operations, blank]));

      assert.equal(store.customDomainTitle(2), 'Operations');
      assert.equal(store.customDomainTitle(1), null);
      assert.equal(store.customDomainTitle(404), null);
      assert.equal(store.customDomainTitle(3), null);

      currentSnapshot = createSnapshot([thread], [
        uncategorized,
        { ...operations, title: '  Delivery  ' },
        blank,
      ]);
      await store.loadSnapshot(true);

      assert.equal(store.customDomainTitle(2), 'Delivery');
    });

    await context.test('query changes, clearing, and arrows maintain first/null selection', () => {
      const first = createThread({
        threadId: 'first',
        title: 'Task one',
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      const second = createThread({
        threadId: 'second',
        title: 'Task two',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([second, first]));
      store.openThreadSearch();
      assert.equal(store.threadSearchSelectedThreadId, null);

      store.setThreadSearchQuery('task');
      assert.equal(store.threadSearchSelectedThreadId, 'first');
      store.selectThreadSearchResult('second');
      store.setThreadSearchQuery('ta');
      assert.equal(store.threadSearchSelectedThreadId, 'first');

      store.moveThreadSearchSelection(-1);
      assert.equal(store.threadSearchSelectedThreadId, 'first');
      store.moveThreadSearchSelection(1);
      assert.equal(store.threadSearchSelectedThreadId, 'second');
      store.moveThreadSearchSelection(1);
      assert.equal(store.threadSearchSelectedThreadId, 'second');
      store.moveThreadSearchSelection(-1);
      assert.equal(store.threadSearchSelectedThreadId, 'first');

      store.setThreadSearchQuery('');
      assert.deepEqual(store.threadSearchResults, []);
      assert.equal(store.threadSearchSelectedThreadId, null);
      store.setThreadSearchQuery('task');
      assert.equal(store.threadSearchSelectedThreadId, 'first');
    });

    await context.test('a valid query set before a snapshot selects, preserves, then falls back', async () => {
      const first = createThread({
        threadId: 'first',
        title: 'ops-git first',
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      const selected = createThread({
        threadId: 'selected',
        title: 'ops_git selected',
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      resetStore(createSnapshot([]));
      store.openThreadSearch();
      store.setThreadSearchQuery('git ops');
      assert.equal(store.hasThreadSearchQueryTokens, true);
      assert.deepEqual(store.threadSearchResults, []);
      assert.equal(store.threadSearchSelectedThreadId, null);

      currentSnapshot = createSnapshot([selected, first]);
      await store.loadSnapshot(true);
      assert.equal(store.threadSearchSelectedThreadId, 'first');
      store.selectThreadSearchResult('selected');

      currentSnapshot = createSnapshot([
        { ...selected, lastActivityAt: '2026-07-30T04:00:00.000Z' },
        { ...first, lastActivityAt: '2026-07-30T03:00:00.000Z' },
      ]);
      await store.loadSnapshot(true);
      assert.equal(store.threadSearchSelectedThreadId, 'selected');

      const replacement = createThread({
        threadId: 'replacement',
        title: 'replacement ops/git',
        lastActivityAt: '2026-07-30T05:00:00.000Z',
      });
      currentSnapshot = createSnapshot([first, replacement]);
      await store.loadSnapshot(true);
      assert.equal(store.threadSearchSelectedThreadId, 'replacement');
    });

    await context.test('Open preserves modal, query, and ID through attention reorder', async () => {
      const first = createThread({
        threadId: 'first',
        title: 'Task first',
        isUnread: true,
        lastActivityAt: '2026-07-30T01:00:00.000Z',
      });
      const selected = createThread({
        threadId: 'selected',
        title: 'Task selected',
        isUnread: true,
        lastActivityAt: '2026-07-30T02:00:00.000Z',
      });
      resetStore(createSnapshot([first, selected]));
      store.openThreadSearch();
      store.setThreadSearchQuery('task');
      assert.equal(store.threadSearchSelectedThreadId, 'selected');

      openSnapshot = createSnapshot([
        { ...selected, isUnread: false },
        { ...first, lastActivityAt: '2026-07-30T03:00:00.000Z' },
      ]);
      await store.openSelectedThreadSearchResult();

      assert.deepEqual(openedThreadIds, ['selected']);
      assert.equal(store.threadSearchVisible, true);
      assert.equal(store.threadSearchQuery, 'task');
      assert.equal(store.threadSearchSelectedThreadId, 'selected');
      assert.deepEqual(
        store.threadSearchResults.map((thread) => thread.threadId),
        ['first', 'selected'],
      );
    });

    await context.test('empty, separator-only, and unmatched Enter are no-ops', async () => {
      resetStore(createSnapshot([
        createThread({ threadId: 'only', title: 'Only task' }),
      ]));
      store.openThreadSearch();

      await store.openSelectedThreadSearchResult();
      store.setThreadSearchQuery('-_./\\:|');
      await store.openSelectedThreadSearchResult();
      store.setThreadSearchQuery('missing');
      await store.openSelectedThreadSearchResult();

      assert.deepEqual(openedThreadIds, []);
      assert.equal(store.threadSearchSelectedThreadId, null);
      store.closeThreadSearch();
      assert.equal(store.threadSearchVisible, false);
      assert.equal(store.threadSearchQuery, '');
      assert.equal(store.threadSearchSelectedThreadId, null);
    });
  } finally {
    delete globalThis.__eyesOnAgentsGlobalTitleSearchHarness;
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
