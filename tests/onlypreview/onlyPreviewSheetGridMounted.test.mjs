/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { buildRoot } from './onlyPreviewSheetGridTest.helper.mjs';

test('mounted SheetPreview keeps DOM bounded and fences resize, sheet, and search races', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://onlypreview.test/'
  });
  const { window } = dom;
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window)
  });
  Object.defineProperties(window.HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 320 },
    clientHeight: { configurable: true, get: () => 240 }
  });
  window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
    this.scrollLeft = Number(options?.left ?? 0);
    this.scrollTop = Number(options?.top ?? 0);
  };
  const animationFrames = new Map();
  let animationFrameId = 0;
  const requestAnimationFrame = (callback) => {
    const id = ++animationFrameId;
    animationFrames.set(
      id,
      setImmediate(() => callback(Date.now()))
    );
    return id;
  };
  const cancelAnimationFrame = (id) => {
    const handle = animationFrames.get(id);
    if (handle) clearImmediate(handle);
    animationFrames.delete(id);
  };
  Object.assign(globalThis, {
    requestAnimationFrame,
    cancelAnimationFrame,
    matchMedia: () => ({ matches: true })
  });
  Object.assign(window, { requestAnimationFrame, cancelAnimationFrame });

  class TestResizeObserver {
    static instances = [];

    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      TestResizeObserver.instances.push(this);
    }

    observe(element) {
      this.observed.add(element);
    }

    unobserve(element) {
      this.observed.delete(element);
    }

    disconnect() {
      this.observed.clear();
    }

    trigger() {
      this.callback([], this);
    }
  }
  globalThis.ResizeObserver = TestResizeObserver;
  window.ResizeObserver = TestResizeObserver;

  const deferred = () => {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolveValue, rejectValue) => {
      resolvePromise = resolveValue;
      rejectPromise = rejectValue;
    });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
  };
  const nextTurn = () => new Promise((resolveTurn) => setImmediate(resolveTurn));
  const waitUntil = async (predicate, label) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      await nextTurn();
    }
    assert.fail(`Timed out waiting for ${label}`);
  };
  const coverage = { kind: 'complete' };
  const manifest = {
    sheets: [
      { id: 0, name: 'Alpha', rowCount: 100_000, columnCount: 512 },
      { id: 1, name: 'Beta', rowCount: 100_000, columnCount: 512 },
      { id: 2, name: 'Gamma', rowCount: 100_000, columnCount: 512 }
    ],
    acceptedCells: 3,
    coverage
  };
  const layoutFor = (sheetId) => ({
    sheetId,
    rowCount: 100_000,
    columnCount: 512,
    defaultRowHeight: 24,
    defaultColumnWidth: 88,
    rowHeights: [],
    columnWidths: []
  });
  const emptySearch = { total: 0, active: 0, coverage, target: null };
  const layoutQueues = new Map();
  const viewportQueues = new Map();
  const queryQueue = [];
  const session = {
    layoutCalls: [],
    viewportCalls: [],
    disposed: false,
    queueLayout(sheetId, operation) {
      const queue = layoutQueues.get(sheetId) ?? [];
      queue.push(operation);
      layoutQueues.set(sheetId, queue);
    },
    queueViewport(sheetId, operation) {
      const queue = viewportQueues.get(sheetId) ?? [];
      queue.push(operation);
      viewportQueues.set(sheetId, queue);
    },
    requestLayout(sheetId) {
      this.layoutCalls.push(sheetId);
      const queued = layoutQueues.get(sheetId)?.shift();
      return queued?.promise ?? Promise.resolve(layoutFor(sheetId));
    },
    requestViewport(sheetId, rowStart, rowEnd, columnStart, columnEnd) {
      const request = { sheetId, rowStart, rowEnd, columnStart, columnEnd };
      this.viewportCalls.push(request);
      const queued = viewportQueues.get(sheetId)?.shift();
      return (
        queued?.promise ??
        Promise.resolve({
          ...request,
          cells: [
            {
              row: rowStart,
              column: columnStart,
              text: `Sheet ${sheetId}`,
              style: { horizontal: 'left' }
            },
            {
              row: rowStart,
              column: columnStart + 1,
              text: 'Centered',
              style: { horizontal: 'center' }
            },
            {
              row: rowStart,
              column: columnStart + 2,
              text: 'Right aligned',
              style: { horizontal: 'right' }
            }
          ],
          merges: []
        })
      );
    },
    query() {
      const queued = queryQueue.shift();
      assert.ok(queued, 'each component query must have a controlled response');
      return queued.promise;
    },
    next: async () => emptySearch,
    previous: async () => emptySearch,
    clear: async () => emptySearch,
    reveal: async () => emptySearch,
    dispose() {
      this.disposed = true;
    }
  };

  const sheetPreviewRuntime = await import(pathToFileURL(join(buildRoot, 'sheetPreview.mjs')).href);
  const { createApp, nextTick } = sheetPreviewRuntime;
  const SheetPreview = sheetPreviewRuntime.default;
  const container = window.document.querySelector('#app');
  let readyCount = 0;
  let cellsWhenReady = 0;
  const app = createApp(SheetPreview, {
    session,
    manifest,
    reportingRevision: '1',
    onReady: () => {
      readyCount += 1;
      cellsWhenReady = container.querySelectorAll('[name="onlypreview__sheetCell"]').length;
    }
  });
  const preview = app.mount(container);
  const tab = (name) =>
    [...container.querySelectorAll('[name="onlypreview__sheetTab"]')].find(
      (element) => element.textContent.trim() === name
    );
  const clickTab = async (name) => {
    const element = tab(name);
    assert.ok(element, `sheet tab ${name} must exist`);
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await nextTick();
  };
  const activeTabName = () =>
    container
      .querySelector('[name="onlypreview__sheetTab"][aria-selected="true"]')
      ?.textContent.trim();
  const matchId = () => container.querySelector('.onlypreview-sheet__cell--match')?.id ?? null;
  const gridFocusOwner = () =>
    container.querySelector('[name="onlypreview__sheetViewport"][role="grid"]');
  const pressTabKey = async (name, key) => {
    const element = tab(name);
    assert.ok(element, `sheet tab ${name} must exist`);
    element.focus();
    element.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key }));
    await nextTick();
  };
  const resolveViewport = (operation, request) =>
    operation.resolve({
      ...request,
      cells: [
        { row: request.rowStart, column: request.columnStart, text: `Sheet ${request.sheetId}` }
      ],
      merges: []
    });

  try {
    await waitUntil(() => readyCount === 1, 'the first viewport DOM commit');
    assert.ok(cellsWhenReady > 0, 'ready must follow the first rendered viewport cells');
    assert.ok(cellsWhenReady < 200, '100,000 x 512 sheets must keep the mounted DOM bounded');
    assert.equal(
      container.querySelectorAll('[name="onlypreview__sheetCell"]').length,
      cellsWhenReady
    );
    assert.equal(TestResizeObserver.instances[0]?.observed.size, 1);
    assert.equal(
      window.document.getElementById('onlypreview-sheet-0-1-1')?.style.justifyContent,
      'flex-start'
    );
    assert.equal(
      window.document.getElementById('onlypreview-sheet-0-1-2')?.style.justifyContent,
      'center'
    );
    assert.equal(
      window.document.getElementById('onlypreview-sheet-0-1-3')?.style.justifyContent,
      'flex-end'
    );

    const grid = gridFocusOwner();
    assert.ok(grid, 'the scrollable keyboard owner must also own the ARIA grid role');
    assert.equal(grid.getAttribute('tabindex'), '0');
    assert.equal(grid.getAttribute('aria-rowcount'), '100000');
    assert.equal(grid.getAttribute('aria-colcount'), '512');
    grid.focus();
    assert.equal(window.document.activeElement, grid);
    const activeDescendant = grid.getAttribute('aria-activedescendant');
    assert.ok(activeDescendant, 'the focused grid must identify its active cell');
    const activeGridCell = window.document.getElementById(activeDescendant);
    assert.equal(activeGridCell?.getAttribute('role'), 'gridcell');
    const activeGridRow = activeGridCell?.parentElement;
    assert.equal(activeGridRow?.getAttribute('role'), 'row');
    assert.equal(activeGridRow?.getAttribute('aria-rowindex'), '1');

    await pressTabKey('Alpha', 'ArrowRight');
    await waitUntil(
      () => activeTabName() === 'Beta' && window.document.activeElement === tab('Beta'),
      'ArrowRight activation and focus on Beta'
    );
    await pressTabKey('Beta', 'ArrowRight');
    await waitUntil(
      () => activeTabName() === 'Gamma' && window.document.activeElement === tab('Gamma'),
      'second ArrowRight activation and focus on Gamma'
    );
    await pressTabKey('Gamma', 'ArrowLeft');
    await waitUntil(
      () => activeTabName() === 'Beta' && window.document.activeElement === tab('Beta'),
      'ArrowLeft activation and focus on Beta'
    );
    await pressTabKey('Beta', 'End');
    await waitUntil(
      () => activeTabName() === 'Gamma' && window.document.activeElement === tab('Gamma'),
      'End activation and focus on Gamma'
    );
    await pressTabKey('Gamma', 'Home');
    await waitUntil(
      () => activeTabName() === 'Alpha' && window.document.activeElement === tab('Alpha'),
      'Home activation and focus on Alpha'
    );

    const staleBetaLayout = deferred();
    session.queueLayout(1, staleBetaLayout);
    const viewportCallsBeforeSwitch = session.viewportCalls.length;
    await clickTab('Beta');
    assert.equal(
      container.querySelectorAll('[name="onlypreview__sheetCell"]').length,
      0,
      'switching sheets must synchronously clear old cells'
    );
    TestResizeObserver.instances[0].trigger();
    await nextTurn();
    assert.equal(
      session.viewportCalls.length,
      viewportCallsBeforeSwitch,
      'resize during layout loading must not reuse the previous sheet axes'
    );
    await clickTab('Alpha');
    await waitUntil(
      () => container.querySelector('[name="onlypreview__sheetCell"]')?.textContent === 'Sheet 0',
      'Alpha viewport after a rapid switch'
    );
    staleBetaLayout.resolve(layoutFor(1));
    await nextTurn();
    assert.equal(activeTabName(), 'Alpha');
    assert.equal(
      container.querySelector('[name="onlypreview__sheetCell"]')?.textContent,
      'Sheet 0'
    );

    const resizeRaceLayout = deferred();
    const resizeRaceViewportOne = deferred();
    const resizeRaceViewportTwo = deferred();
    session.queueLayout(1, resizeRaceLayout);
    session.queueViewport(1, resizeRaceViewportOne);
    session.queueViewport(1, resizeRaceViewportTwo);
    const resizeRaceQuery = deferred();
    queryQueue.push(resizeRaceQuery);
    const viewportCallsBeforeResizeRace = session.viewportCalls.length;
    const resizeRacePromise = preview.query('resize-race', false);
    resizeRaceQuery.resolve({
      total: 1,
      active: 1,
      coverage,
      target: { sheetId: 1, row: 80, column: 12 }
    });
    await waitUntil(() => activeTabName() === 'Beta', 'resize-race Beta activation');
    resizeRaceLayout.resolve(layoutFor(1));
    await waitUntil(
      () => session.viewportCalls.length === viewportCallsBeforeResizeRace + 1,
      'resize-race first Beta viewport request'
    );
    const resizeRaceFirstRequest = session.viewportCalls.at(-1);
    TestResizeObserver.instances[0].trigger();
    await nextTurn();
    assert.equal(
      session.viewportCalls.length,
      viewportCallsBeforeResizeRace + 1,
      'resize must coalesce behind the current-sheet viewport request'
    );
    resolveViewport(resizeRaceViewportOne, resizeRaceFirstRequest);
    await waitUntil(
      () => session.viewportCalls.length === viewportCallsBeforeResizeRace + 2,
      'resize-race successor Beta viewport request'
    );
    const resizeRaceSecondRequest = session.viewportCalls.at(-1);
    resolveViewport(resizeRaceViewportTwo, resizeRaceSecondRequest);
    await resizeRacePromise;
    const resizedGrid = gridFocusOwner();
    assert.equal(activeTabName(), 'Beta');
    assert.equal(resizedGrid.scrollTop, 79 * 24);
    assert.equal(resizedGrid.scrollLeft, 11 * 88);
    assert.equal(matchId(), 'onlypreview-sheet-1-80-12');
    assert.ok(
      container.querySelectorAll('[name="onlypreview__sheetCell"]').length < 200,
      'search reveal after a coalesced resize must keep the DOM bounded'
    );

    await clickTab('Alpha');
    await waitUntil(() => activeTabName() === 'Alpha', 'return to Alpha after resize race');

    const betaLayoutForQueries = deferred();
    session.queueLayout(1, betaLayoutForQueries);
    const firstQuery = deferred();
    queryQueue.push(firstQuery);
    const firstQueryPromise = preview.query('first', false);
    firstQuery.resolve({
      total: 2,
      active: 1,
      coverage,
      target: { sheetId: 1, row: 2, column: 2 }
    });
    const betaLayoutCallCount = session.layoutCalls.filter((sheetId) => sheetId === 1).length;
    await waitUntil(
      () => session.layoutCalls.filter((sheetId) => sheetId === 1).length > betaLayoutCallCount,
      'search-driven Beta activation'
    );

    const secondQuery = deferred();
    queryQueue.push(secondQuery);
    const secondQueryPromise = preview.query('second', false);
    secondQuery.resolve({
      total: 2,
      active: 2,
      coverage,
      target: { sheetId: 1, row: 5, column: 5 }
    });
    await nextTurn();
    betaLayoutForQueries.resolve(layoutFor(1));
    await Promise.all([firstQueryPromise, secondQueryPromise]);
    assert.equal(matchId(), 'onlypreview-sheet-1-5-5');

    await clickTab('Alpha');
    await waitUntil(() => activeTabName() === 'Alpha', 'manual return to Alpha');
    const betaLayoutBeforeClear = deferred();
    session.queueLayout(1, betaLayoutBeforeClear);
    const clearRaceQuery = deferred();
    queryQueue.push(clearRaceQuery);
    const clearRacePromise = preview.query('clear-race', false);
    clearRaceQuery.resolve({
      total: 1,
      active: 1,
      coverage,
      target: { sheetId: 1, row: 7, column: 7 }
    });
    await waitUntil(() => activeTabName() === 'Beta', 'clear-race Beta activation');
    await preview.clear();
    betaLayoutBeforeClear.resolve(layoutFor(1));
    await clearRacePromise;
    assert.equal(matchId(), null, 'clear must invalidate a pending search reveal');

    await clickTab('Alpha');
    const betaLayoutBeforeManualTab = deferred();
    session.queueLayout(1, betaLayoutBeforeManualTab);
    const manualRaceQuery = deferred();
    queryQueue.push(manualRaceQuery);
    const manualRacePromise = preview.query('manual-race', false);
    manualRaceQuery.resolve({
      total: 1,
      active: 1,
      coverage,
      target: { sheetId: 1, row: 9, column: 9 }
    });
    await waitUntil(() => activeTabName() === 'Beta', 'manual-race Beta activation');
    await clickTab('Alpha');
    betaLayoutBeforeManualTab.resolve(layoutFor(1));
    await manualRacePromise;
    await nextTurn();
    assert.equal(activeTabName(), 'Alpha');
    assert.equal(matchId(), null, 'manual sheet selection must invalidate the stale search reveal');
    assert.equal(readyCount, 1, 'ready must only be emitted for the first installed viewport');
  } finally {
    app.unmount();
    assert.equal(session.disposed, true);
    dom.window.close();
  }
});
