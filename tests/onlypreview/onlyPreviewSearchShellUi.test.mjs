/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  browseListing,
  progress,
  searchSnapshotEntry,
  searchSnapshotEvent,
  snapshot,
  source
} from './onlyPreviewSearchShellTest.helper.mjs';

test('snapshot guard accepts only exact, internally consistent nested snapshots', () => {
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(searchSnapshotEvent()), true);

  const rootEntry = searchSnapshotEvent();
  rootEntry.snapshot.state = 'building';
  rootEntry.snapshot.index.entries = [
    searchSnapshotEntry({
      relativePath: 'README.md',
      parentRelativePath: '',
      name: 'README.md'
    })
  ];
  for (const key of [
    'processRssBytes',
    'workerHeapUsedBytes',
    'workerExternalBytes',
    'treeMetadataEntryCount',
    'treeMetadataEstimatedBytes',
    'filenameTierEstimatedBytes',
    'diskIndexBytes'
  ]) {
    rootEntry.snapshot.memory[key] = null;
  }
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(rootEntry), true);

  const directoryEntry = searchSnapshotEvent();
  directoryEntry.snapshot.state = 'reconciling';
  directoryEntry.snapshot.index.entries = [
    searchSnapshotEntry({
      relativePath: 'docs',
      parentRelativePath: '',
      name: 'docs',
      nodeKind: 'directory',
      size: 0,
      previewHint: 'unsupported',
      mediaType: 'unknown',
      isText: false
    })
  ];
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(directoryEntry), true);

  for (const mutate of [
    (event) => Object.assign(event, { unexpected: true }),
    (event) => Object.assign(event.snapshot, { unexpected: true }),
    (event) => Object.assign(event.snapshot.index, { unexpected: true }),
    (event) => Object.assign(event.snapshot.index.entries[0], { unexpected: true }),
    (event) => Object.assign(event.snapshot.memory, { unexpected: true }),
    (event) => {
      event.snapshot.index.entries.unexpected = true;
    },
    (event) => {
      event.snapshot.index.entries = new Array(1);
    },
    (event) => {
      delete event.snapshot.memory.diskIndexBytes;
    }
  ]) {
    const event = searchSnapshotEvent();
    mutate(event);
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }
});

test('snapshot guard rejects hostile identifiers, index metadata, and entry values', () => {
  for (const mutate of [
    (event) => {
      event.hostId = 'short';
    },
    (event) => {
      event.snapshot.workspaceId = 'short';
    },
    (event) => {
      event.snapshot.index.workspaceId = 'different-workspace-id';
    },
    (event) => {
      event.snapshot.generation = -1;
    },
    (event) => {
      event.snapshot.generation = 1.5;
    },
    (event) => {
      event.snapshot.state = 'failed';
    },
    (event) => {
      event.snapshot.index.limit = -1;
    },
    (event) => {
      event.snapshot.index.limit = 0;
    },
    (event) => {
      event.snapshot.index.truncated = 'false';
    },
    (event) => {
      event.snapshot.index.entries[0].nodeKind = 'socket';
    },
    (event) => {
      event.snapshot.index.entries[0].size = -1;
    },
    (event) => {
      event.snapshot.index.entries[0].size = Number.POSITIVE_INFINITY;
    },
    (event) => {
      event.snapshot.index.entries[0].modifiedAt = Number.NaN;
    },
    (event) => {
      event.snapshot.index.entries[0].previewHint = 'html';
    },
    (event) => {
      event.snapshot.index.entries[0].mediaType = 'binary';
    },
    (event) => {
      event.snapshot.index.entries[0].isText = 1;
    },
    (event) => {
      event.snapshot.index.entries[0].mediaType = 'unknown';
    },
    (event) => {
      event.snapshot.index.entries[0].nodeKind = 'directory';
    }
  ]) {
    const event = searchSnapshotEvent();
    mutate(event);
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }
});

test('snapshot guard rejects absolute, traversing, unnormalized, and inconsistent paths', () => {
  for (const relativePath of [
    '',
    '/etc/passwd',
    '../secret.md',
    'docs/../secret.md',
    'docs/./secret.md',
    'docs//secret.md',
    'docs\\secret.md',
    'C:/secret.md'
  ]) {
    const event = searchSnapshotEvent();
    event.snapshot.index.entries[0].relativePath = relativePath;
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }

  for (const parentRelativePath of ['/docs', '..', 'docs/..', 'docs\\nested']) {
    const event = searchSnapshotEvent();
    event.snapshot.index.entries[0].parentRelativePath = parentRelativePath;
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }

  const wrongParent = searchSnapshotEvent();
  wrongParent.snapshot.index.entries[0].parentRelativePath = 'src';
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(wrongParent), false);

  const wrongName = searchSnapshotEvent();
  wrongName.snapshot.index.entries[0].name = 'other.md';
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(wrongName), false);
});

test('snapshot guard rejects malformed memory telemetry without coercion', () => {
  const numericKeys = [
    'processRssBytes',
    'workerHeapUsedBytes',
    'workerExternalBytes',
    'treeMetadataEntryCount',
    'treeMetadataEstimatedBytes',
    'filenameTierEstimatedBytes',
    'diskIndexBytes'
  ];
  for (const key of numericKeys) {
    for (const invalidValue of [-1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      const event = searchSnapshotEvent();
      event.snapshot.memory[key] = invalidValue;
      assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
    }
  }

  for (const key of ['measurementComplete', 'runtimeOneGiBWarning', 'runtimeTwoGiBLimitExceeded']) {
    const event = searchSnapshotEvent();
    event.snapshot.memory[key] = 0;
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }
});

const searchProgressEvent = (progressOverrides = {}) => ({
  hostId: 'host-search-shell',
  progress: {
    workspaceId: 'workspace-current',
    generation: 4,
    buildRevision: 1,
    phase: 'counting',
    ...progressOverrides
  }
});

test('progress guard accepts only exact path-free counting and indexing envelopes', () => {
  assert.equal(progress.isOnlyPreviewSearchProgressEvent(searchProgressEvent()), true);
  assert.equal(
    progress.isOnlyPreviewSearchProgressEvent(
      searchProgressEvent({ phase: 'indexing', completed: 10, total: 20 })
    ),
    true
  );

  for (const mutate of [
    (event) => Object.assign(event, { extra: true }),
    (event) => Object.assign(event.progress, { extra: true }),
    (event) => {
      event.hostId = '';
    },
    (event) => {
      event.progress.workspaceId = '';
    },
    (event) => {
      event.progress.generation = -1;
    },
    (event) => {
      event.progress.buildRevision = 0;
    },
    (event) => {
      event.progress.phase = 'ready';
    }
  ]) {
    const event = searchProgressEvent();
    mutate(event);
    assert.equal(progress.isOnlyPreviewSearchProgressEvent(event), false);
  }

  for (const mutate of [
    (event) => {
      event.progress.completed = -1;
    },
    (event) => {
      event.progress.completed = 21;
    },
    (event) => {
      event.progress.total = Number.POSITIVE_INFINITY;
    },
    (event) => {
      event.progress.relativePath = 'private/file.txt';
    },
    (event) => {
      delete event.progress.total;
    }
  ]) {
    const event = searchProgressEvent({ phase: 'indexing', completed: 10, total: 20 });
    mutate(event);
    assert.equal(progress.isOnlyPreviewSearchProgressEvent(event), false);
  }
});

test('progress reducer fences stale revisions, invalid phase order, and regressing totals', () => {
  const expected = { workspaceId: 'workspace-current', generation: 4 };
  let state = progress.createOnlyPreviewSearchProgressState();
  state = progress.reduceOnlyPreviewSearchProgress(state, searchProgressEvent().progress, expected);
  assert.equal(state.buildRevision, 1);
  assert.equal(state.progress.phase, 'counting');

  state = progress.reduceOnlyPreviewSearchProgress(
    state,
    searchProgressEvent({ phase: 'indexing', completed: 0, total: 20 }).progress,
    expected
  );
  assert.equal(state.progress.phase, 'indexing');
  const active = state;
  for (const rejected of [
    searchProgressEvent({ phase: 'counting' }).progress,
    searchProgressEvent({ phase: 'indexing', completed: 1, total: 21 }).progress,
    searchProgressEvent({ phase: 'indexing', completed: -1, total: 20 }).progress,
    searchProgressEvent({ buildRevision: 0, phase: 'indexing', completed: 10, total: 20 }).progress,
    searchProgressEvent({ buildRevision: 2, phase: 'indexing', completed: 0, total: 20 }).progress,
    searchProgressEvent({
      workspaceId: 'workspace-stale',
      buildRevision: 2,
      phase: 'counting'
    }).progress,
    searchProgressEvent({
      generation: 3,
      buildRevision: 2,
      phase: 'counting'
    }).progress
  ]) {
    assert.equal(progress.reduceOnlyPreviewSearchProgress(state, rejected, expected), state);
  }

  state = progress.reduceOnlyPreviewSearchProgress(
    state,
    searchProgressEvent({ phase: 'indexing', completed: 10, total: 20 }).progress,
    expected
  );
  assert.notEqual(state, active);
  assert.equal(state.progress.completed, 10);
  for (const rejected of [
    searchProgressEvent({ phase: 'indexing', completed: 9, total: 20 }).progress,
    searchProgressEvent({ phase: 'indexing', completed: 10, total: 19 }).progress
  ]) {
    assert.equal(progress.reduceOnlyPreviewSearchProgress(state, rejected, expected), state);
  }
  state = progress.settleOnlyPreviewSearchProgress(state);
  assert.equal(state.buildRevision, 1);
  assert.equal(state.progress, null);
  assert.equal(
    progress.reduceOnlyPreviewSearchProgress(
      state,
      searchProgressEvent({ phase: 'indexing', completed: 20, total: 20 }).progress,
      expected
    ),
    state,
    'a settled revision cannot revive its rail'
  );
  assert.equal(
    progress.reduceOnlyPreviewSearchProgress(
      state,
      searchProgressEvent({ buildRevision: 2, phase: 'indexing', completed: 0, total: 20 })
        .progress,
      expected
    ),
    state,
    'a newer revision must begin with counting'
  );
  state = progress.reduceOnlyPreviewSearchProgress(
    state,
    searchProgressEvent({ buildRevision: 2 }).progress,
    expected
  );
  assert.equal(state.buildRevision, 2);
  assert.equal(state.progress.phase, 'counting');
  assert.deepEqual(progress.resetOnlyPreviewSearchProgress(), {
    buildRevision: 0,
    progress: null
  });
});

const browseListingEvent = () => ({
  hostId: 'host-search-shell',
  listing: {
    workspaceId: 'workspace-current',
    generation: 4,
    directoryToken: 'root-directory-token',
    relativePath: '',
    entries: [
      {
        relativePath: 'docs',
        parentRelativePath: '',
        name: 'docs',
        nodeKind: 'directory',
        size: 0,
        modifiedAt: 1,
        previewHint: 'unsupported',
        mediaType: 'unknown',
        isText: false,
        directoryToken: 'docs-directory-token'
      },
      {
        relativePath: 'readme.md',
        parentRelativePath: '',
        name: 'readme.md',
        nodeKind: 'file',
        size: 10,
        modifiedAt: 1,
        previewHint: 'text',
        mediaType: 'text',
        isText: true,
        directoryToken: null
      }
    ]
  }
});

test('browse listing guard accepts only exact opaque-token directory metadata', () => {
  assert.equal(browseListing.isOnlyPreviewBrowseListingEvent(browseListingEvent()), true);
  for (const mutate of [
    (event) => Object.assign(event, { extra: true }),
    (event) => Object.assign(event.listing, { absolutePath: '/private/workspace' }),
    (event) => Object.assign(event.listing.entries[0], { extra: true }),
    (event) => {
      event.listing.relativePath = '../outside';
    },
    (event) => {
      event.listing.entries[0].parentRelativePath = 'other';
    },
    (event) => {
      event.listing.entries[0].directoryToken = null;
    },
    (event) => {
      event.listing.entries[1].directoryToken = 'file-token';
    },
    (event) => {
      event.listing.entries[1].relativePath = 'docs';
      event.listing.entries[1].name = 'docs';
    },
    (event) => {
      event.listing.entries[1].nodeKind = 'directory';
      event.listing.entries[1].size = 0;
      event.listing.entries[1].previewHint = 'unsupported';
      event.listing.entries[1].mediaType = 'unknown';
      event.listing.entries[1].isText = false;
      event.listing.entries[1].directoryToken = 'docs-directory-token';
    },
    (event) => {
      delete event.listing.entries[0];
    }
  ]) {
    const event = structuredClone(browseListingEvent());
    mutate(event);
    assert.equal(browseListing.isOnlyPreviewBrowseListingEvent(event), false);
  }
});

test('Shell Project Search source preserves exact narrow client, UI, and lifecycle boundaries', () => {
  const clientSource = source('src/renderer/onlypreview/shell/src/onlyPreviewSearch.client.ts');
  const storeSource = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts'
  );
  const shellSource = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellEventsSource = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts'
  );
  const snapshotSource = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewSearchSnapshot.service.ts'
  );
  const batchSource = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewSearchBatch.service.ts'
  );
  const appSource = source('src/renderer/onlypreview/shell/src/App.vue');
  const appStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const i18nSource = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  const resultsSource = source(
    'src/renderer/onlypreview/shell/src/components/ProjectSearchResults/ProjectSearchResults.vue'
  );
  const resultsStyle = source(
    'src/renderer/onlypreview/shell/src/components/ProjectSearchResults/ProjectSearchResults.less'
  );

  assert.match(clientSource, /createXpcRendererEmitter<OnlyPreviewSearchRuntimeApi>/);
  assert.match(clientSource, /'OnlyPreviewSearchRuntimeHandler'/);
  assert.match(storeSource, /useThrottleFn\([\s\S]*?120,[\s\S]*?true,[\s\S]*?true/);
  assert.match(
    storeSource,
    /beginComposition\(\)[\s\S]*?inputGeneration \+= 1;[\s\S]*?cancelActive\(\)/
  );
  assert.match(storeSource, /maxResults: ONLY_PREVIEW_SEARCH_MAX_RESULTS/);
  assert.match(storeSource, /scopeKind: OnlyPreviewSearchScope\['kind'\] = 'directory'/);
  assert.match(storeSource, /scope[\s\S]*?kind: 'directory'[\s\S]*?directoryRelativePath/);
  assert.match(
    storeSource,
    /focusedNodeKind === 'directory'[\s\S]*?focusedNodeKind === 'file'[\s\S]*?selectedRelativePath/
  );
  assert.match(storeSource, /currentContext\?\.workspaceId !== context\.workspaceId/);
  assert.match(storeSource, /currentContext\.generation !== context\.generation/);
  assert.match(storeSource, /this\.activeRequestId !== requestId/);
  assert.match(storeSource, /ONLY_PREVIEW_SEARCH_BATCH_EVENT/);
  assert.match(storeSource, /this\.activeRequestInputGeneration !== this\.inputGeneration/);
  assert.match(storeSource, /this\.resultIndexByPath\.get\(result\.relativePath\)/);
  assert.match(storeSource, /areOnlyPreviewSearchResultsEqual\(this\.results, finalResults\)/);
  assert.match(batchSource, /Object\.keys\(value\)\.sort\(\)/);
  assert.match(batchSource, /ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS/);
  assert.match(snapshotSource, /Reflect\.ownKeys\(value\)/);
  assert.match(snapshotSource, /normalizeOnlyPreviewRelativePath/);
  assert.match(snapshotSource, /isOnlyPreviewIndexEntryArray\(value\.index\.entries\)/);
  assert.match(snapshotSource, /MEMORY_NUMBER_KEYS\.every/);
  assert.ok(shellSource.split(/\r?\n/).length < 800);
  assert.match(shellSource, /subscribeOnlyPreviewShellEvents\(onlyPreviewEnv\.hostId/);
  assert.match(shellEventsSource, /value\.hostId === hostId/);
  assert.match(
    shellEventsSource,
    /isOnlyPreviewBrowseListingEvent\(params\) && isCurrentHost\(params\)[\s\S]*handlers\.browseListing\(params\.listing\)/
  );
  assert.match(
    shellEventsSource,
    /isOnlyPreviewSearchProgressEvent\(params\) && isCurrentHost\(params\)[\s\S]*handlers\.searchProgress\(params\.progress\)/
  );
  assert.match(shellSource, /snapshot\.workspaceId !== workspace\.workspaceId/);
  assert.match(shellSource, /snapshot\.generation !== this\.searchWorkspaceGeneration/);
  assert.doesNotMatch(shellSource, /suspendForIndex|stopWaitingForIndex|resumeForReadyIndex/);
  assert.match(shellSource, /ready: this\.projectionReady/);
  assert.doesNotMatch(shellSource, /ready: this\.projectionReady\s*&&\s*!this\.indexLoading/);
  const applySearchProgress = shellSource.slice(
    shellSource.indexOf('private applySearchProgress('),
    shellSource.indexOf('private async runWindowCommand(')
  );
  assert.match(applySearchProgress, /this\.indexProgressState = next/);
  assert.doesNotMatch(applySearchProgress, /onlyPreviewProjectSearchStore|cancel|clear/);
  assert.match(shellSource, /onlyPreviewProjectSearchStore\.resumeForAvailableRuntime\(\)/);
  const localFilterTransition = shellSource.slice(
    shellSource.indexOf('setSearchQuery(value: string)'),
    shellSource.indexOf('clearSearch()')
  );
  assert.match(
    localFilterTransition,
    /onlyPreviewTreeFilter\.transition\([\s\S]*this\.searchQuery, value\)[\s\S]*this\.searchQuery = value/
  );
  const directoryToggle = shellSource.slice(
    shellSource.indexOf('toggleDirectory(relativePath: string)'),
    shellSource.indexOf('setProjectWidth(value: number)')
  );
  assert.match(
    directoryToggle,
    /onlyPreviewTreeFilter\.toggleDirectory\([\s\S]*this\.searchQuery[\s\S]*void this\.loadDirectory\(relativePath\)/
  );
  assert.match(
    shellSource,
    /focusSearch: \(\) => \{[\s\S]*onlyPreviewTreeFilter\.clearRevealRoots\(\);[\s\S]*onlyPreviewProjectSearchStore\.enter\(\)/
  );
  const applySearchSnapshot = shellSource.slice(
    shellSource.indexOf('private async applySearchSnapshot('),
    shellSource.indexOf('private applyBrowseListing(')
  );
  assert.match(applySearchSnapshot, /snapshot\.state !== 'ready'/);
  assert.match(applySearchSnapshot, /settleOnlyPreviewSearchProgress\(this\.indexProgressState\)/);
  assert.doesNotMatch(applySearchSnapshot, /this\.index\s*=|clearBrowseProjection/);
  const refreshSettings = shellSource.slice(
    shellSource.indexOf('private async refreshSettings()'),
    shellSource.indexOf('private async activateEntry(')
  );
  assert.doesNotMatch(refreshSettings, /showHiddenFiles|refreshIndex/);
  assert.match(shellEventsSource, /isOnlyPreviewPresentationNudge\(params\)/);
  assert.match(
    shellSource,
    /previewPresentation:\s*\(\) => void this\.syncPreviewPresentation\(\)/
  );
  assert.match(shellSource, /previewPresentationFetchGeneration/);
  assert.match(shellSource, /onlyPreviewClient\.getPreviewPresentation\(\{ hostToken \}\)/);
  assert.doesNotMatch(shellSource, /previewControl:|crypto\.randomUUID\(\)/);

  assert.match(appSource, /@compositionstart="handleSearchCompositionStart"/);
  assert.match(appSource, /@compositionend="handleSearchCompositionEnd"/);
  assert.match(appSource, /<ProjectSearchResults/);
  assert.match(
    appSource,
    /onlyPreviewProjectSearchStore\.exit\(\)[\s\S]*?searchInputRef\.value\?\.focus/
  );
  assert.match(appSource, /event\.altKey && event\.code === 'Digit1'/);
  const projectCopyShortcut = appSource.slice(
    appSource.indexOf('const handleProjectItemCopyShortcut'),
    appSource.indexOf('const handleShellKeydown')
  );
  assert.match(projectCopyShortcut, /event\.repeat \|\| event\.isComposing/);
  assert.match(projectCopyShortcut, /event\.key\.toLowerCase\(\) !== 'c'/);
  assert.match(projectCopyShortcut, /event\.metaKey && !event\.ctrlKey/);
  assert.match(projectCopyShortcut, /event\.ctrlKey && !event\.metaKey/);
  assert.match(
    projectCopyShortcut,
    /target\.matches\('input, textarea, select, \[contenteditable="true"\], \[role="textbox"\]'\)/
  );
  assert.match(
    projectCopyShortcut,
    /button\[name="onlypreview__treeRow"\],[\s\S]*button\[name="onlypreview__projectSearchResult"\]/
  );
  assert.doesNotMatch(projectCopyShortcut, /\.closest\(/);
  assert.match(projectCopyShortcut, /'absolute-path'[\s\S]*'name'[\s\S]*'item'/);
  assert.doesNotMatch(projectCopyShortcut, /relative-path/);
  assert.match(
    projectCopyShortcut,
    /event\.preventDefault\(\)[\s\S]*onlyPreviewShellStore\.copyProjectItem\(relativePath, copyKind\)/
  );
  assert.match(appSource, /if \(handleProjectItemCopyShortcut\(event\)\) return/);
  assert.doesNotMatch(appSource, /navigator\.clipboard/);
  assert.match(shellSource, /onlyPreviewClient\.copyProjectItem\(/);
  const scopeMarkup = appSource.slice(
    appSource.indexOf('name="onlypreview__projectSearchScope"'),
    appSource.indexOf('name="onlypreview__indexError"')
  );
  assert.match(scopeMarkup, /<select/);
  assert.match(scopeMarkup, /name="onlypreview__projectSearchScopeSelect"/);
  assert.match(scopeMarkup, /<option value="directory">/);
  assert.match(scopeMarkup, /<option value="project">/);
  assert.match(scopeMarkup, /name="onlypreview__projectSearchScopeTarget"/);
  assert.doesNotMatch(scopeMarkup, /displayPath|absolutePath/);
  assert.match(appSource, /onlyPreviewProjectSearchStore\.directoryLabel/);
  assert.match(appSource, /onlyPreviewShellStore\.workspace\?\.rootName/);
  assert.match(i18nSource, /projectSearchInDirectory: 'In Directory'/);
  assert.match(i18nSource, /projectSearchInProject: 'In Project'/);
  assert.match(i18nSource, /projectSearchInDirectory: '当前目录'/);
  assert.match(i18nSource, /projectSearchInProject: '整个项目'/);
  assert.doesNotMatch(resultsSource, /v-html/);
  assert.match(resultsSource, /<mark/);
  assert.match(resultsSource, /row\.result\.fileName/);
  assert.match(resultsSource, /row\.result\.relativePath/);
  assert.match(resultsSource, /:data-relative-path="row\.result\.relativePath"/);
  assert.match(resultsSource, /row\.result\.mediaType/);
  assert.match(
    resultsSource,
    /@contextmenu\.prevent\.stop="[\s\S]*?onlyPreviewShellStore\.showFileContextMenu/
  );
  assert.doesNotMatch(resultsSource, /summary|placeholder/i);

  assert.match(appStyle, /onlypreview-shell__tree::-webkit-scrollbar\s*\{[\s\S]*?width: 8px/);
  assert.match(
    appStyle,
    /\.onlypreview-shell__scope-select \{[\s\S]*?background: var\(--onlypreview-royal-soft\)/
  );
  assert.match(appStyle, /\.onlypreview-shell__scope-select:focus-visible/);
  assert.match(
    resultsStyle,
    /onlypreview-project-search__list::-webkit-scrollbar\s*\{[\s\S]*?width: 8px/
  );
  assert.match(appSource, /name="onlypreview__resizeHandle"/);
});
