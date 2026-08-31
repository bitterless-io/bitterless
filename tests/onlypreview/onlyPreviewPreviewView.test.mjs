/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeCurrentVue,
  bounds,
  createHarness,
  deferred,
  descriptorFor,
  fileRef,
  host,
  source,
  state,
  tick,
  withFakeTimeouts
} from './onlyPreviewPreviewRegionTest.helper.mjs';

test('Vue Preview View exposes no legacy whole-text read and delegates text bytes to Preview Read', () => {
  const { service } = createHarness();
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const viewService = source('src/main/onlypreview/views/onlyPreviewPreviewView.service.ts');
  const readBroker = source('src/main/onlypreview/views/onlyPreviewPreviewReadBroker.service.ts');

  assert.equal(typeof service.readText, 'undefined');
  assert.doesNotMatch(viewService, /\breadText\s*\(/);
  assert.doesNotMatch(region, /onlyPreviewClassifierService\.readText/);
  assert.match(region, /this\.viewService\.getPreviewReadBrokerCapability\(\)/);
  assert.match(region, /this\.readBroker\.setPreviewAuthority\(brokerCapability, prepared\)/);
  assert.match(readBroker, /async openCurrentPreviewText\(/);
  assert.match(readBroker, /fileSearchWindowService\.openPreviewRead\(\{/);
  assert.match(readBroker, /async readCurrentPreviewTextChunk\(/);
  assert.match(readBroker, /fileSearchWindowService\.readNextPreviewChunk\(\{/);
});

test('Chrome setup failure revokes authority and falls back to a truthful Vue error', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  state.protocolError = new Error('protocol setup failed');

  await service.present(host.hostToken, fileRef('page.html'));
  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.surface, 'vue');
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(snapshot.selectionRevision, 2);
  assert.match(snapshot.error.message, /protocol setup failed/);
  assert.equal(state.chromeViews[0].webContents.destroyed, true);
  assert.equal(children.has(state.vueViews[0]), false);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[0]), true);
  assert.ok(state.assetRevocations > 0);
  assert.ok(state.documentRevocations > 0);
});

test('a delayed proxy setup cannot install stale protocol state after a newer selection', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const proxy = { started: deferred(), completion: deferred() };
  state.nextProxyDeferred = proxy;
  state.describe = async () => descriptorFor('page.html', 'text');
  const stalePresentation = service.present(host.hostToken, fileRef('page.html'));
  await proxy.started.promise;
  const staleChrome = state.chromeViews[0];

  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  proxy.completion.resolve();
  await stalePresentation;

  assert.equal(state.protocolInstalls.length, 0);
  assert.equal(staleChrome.webContents.destroyed, true);
  assert.equal(service.snapshot(host.hostToken).surface, 'vue');
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[0]), true);
});

test('same-kind Chrome transitions and Chrome to Vue keep exactly one view and clean session state', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const present = async (relativePath, kind) => {
    state.describe = async () => descriptorFor(relativePath, kind);
    await service.present(host.hostToken, fileRef(relativePath));
    assert.equal(children.size, 1);
    return state.chromeViews.at(-1);
  };

  const firstHtml = await present('first.html', 'text');
  const chromeSession = firstHtml.webContents.session;
  assert.equal(firstHtml.partition, 'persist:onlypreview-chrome');
  assert.equal(chromeSession.listenerCount('will-download'), 1);
  const secondHtml = await present('second.html', 'text');
  assert.equal(firstHtml.webContents.destroyed, true);
  // One persistent partition means one shared session: its hardening is installed once and survives
  // every per-selection teardown, so a later view can never run unhardened.
  assert.equal(secondHtml.webContents.session, chromeSession);
  assert.equal(chromeSession.listenerCount('will-download'), 1);
  assert.equal(state.proxyCalls.length, 1);
  assert.equal(chromeSession.clearStorageDataCalls, 1);
  assert.equal(chromeSession.clearCacheCalls, 1);
  assert.equal(chromeSession.closeAllConnectionsCalls, 1);
  assert.equal(state.protocolCleanups, 1);
  firstHtml.webContents.emit('did-finish-load');
  firstHtml.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);
  assert.equal(service.snapshot(host.hostToken).fileRef.relativePath, 'second.html');
  assert.equal(service.snapshot(host.hostToken).status, 'loading');
  secondHtml.webContents.emit('did-finish-load');
  assert.equal(service.snapshot(host.hostToken).status, 'ready');

  const firstPdf = await present('first.pdf', 'pdf');
  assert.equal(secondHtml.webContents.destroyed, true);
  assert.equal(firstPdf.webContents.session, chromeSession);
  assert.equal(chromeSession.listenerCount('will-download'), 1);
  assert.equal(state.protocolCleanups, 2);

  const secondPdf = await present('second.pdf', 'pdf');
  assert.equal(firstPdf.webContents.destroyed, true);
  assert.equal(secondPdf.webContents.session, chromeSession);
  assert.equal(chromeSession.listenerCount('will-download'), 1);
  assert.equal(state.protocolCleanups, 3);

  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  assert.equal(secondPdf.webContents.destroyed, true);
  assert.equal(chromeSession.listenerCount('will-download'), 1);
  // Every teardown discards that selection's data from the shared session.
  assert.equal(chromeSession.clearStorageDataCalls, 4);
  assert.equal(state.proxyCalls.length, 1);
  assert.equal(state.protocolCleanups, 4);
  assert.equal(state.protocolInstalls.length, 4);
  assert.equal(children.size, 0);
  acknowledgeCurrentVue(service);
  assert.equal([...children][0].kind, 'vue');
});

test('manual Chrome refresh replaces the raw view and destroy removes protocol and download listeners', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  const firstChrome = state.chromeViews[0];
  assert.deepEqual(
    state.findBinds.map(({ surface, generation }) => ({ surface, generation })),
    [
      { surface: 'vue', generation: 1 },
      { surface: 'chrome', generation: 1 }
    ]
  );

  await service.refresh(host.hostToken);
  const refreshedChrome = state.chromeViews[1];
  assert.deepEqual(
    state.findBinds.map(({ surface, generation }) => ({ surface, generation })),
    [
      { surface: 'vue', generation: 1 },
      { surface: 'chrome', generation: 1 },
      { surface: 'chrome', generation: 2 }
    ]
  );
  assert.equal(
    state.findUnbinds.some(
      ({ surface, webContents }) => surface === 'chrome' && webContents === firstChrome.webContents
    ),
    true
  );
  assert.equal(firstChrome.webContents.destroyed, true);
  assert.equal(refreshedChrome.webContents.session, firstChrome.webContents.session);
  assert.equal(firstChrome.webContents.session.listenerCount('will-download'), 1);
  assert.equal(state.protocolCleanups, 1);
  assert.equal(children.size, 1);

  service.destroy();
  assert.equal(
    state.findUnbinds.some(
      ({ surface, webContents }) =>
        surface === 'chrome' && webContents === refreshedChrome.webContents
    ),
    true
  );
  assert.equal(refreshedChrome.webContents.destroyed, true);
  assert.equal(refreshedChrome.webContents.session.listenerCount('will-download'), 1);
  assert.equal(refreshedChrome.webContents.session.clearStorageDataCalls, 2);
  assert.equal(state.protocolCleanups, 2);
  assert.equal(state.protocolInstalls.length, 2);
  assert.equal(children.size, 0);
});

test('Chrome crash increments revision, tears down the raw view, and rejects its old revision', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const vueToken = state.vueViews[0].previewRuntimeToken;
  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  const chrome = state.chromeViews[0];
  assert.equal(chrome.webContents.webRTCIPHandlingPolicy, 'disable_non_proxied_udp');
  assert.equal(chrome.webContents.session.proxyConfig.proxyBypassRules, '<-loopback>');

  chrome.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  const snapshot = service.snapshot(host.hostToken);
  assert.equal(snapshot.selectionRevision, 2);
  assert.equal(snapshot.surface, 'vue');
  assert.equal(snapshot.status, 'unavailable');
  assert.equal(chrome.webContents.destroyed, true);
  assert.equal(children.has(state.vueViews[0]), false);
  assert.throws(
    () => service.reportVueReady(host.hostToken, 1, vueToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[0]), true);
});

test('Vue crash rotates runtime capability and revision; same-revision error clears text ability', async () => {
  const { service, children } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const originalVue = state.vueViews[0];
  const originalToken = originalVue.previewRuntimeToken;
  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  acknowledgeCurrentVue(service);
  service.reportVueReady(host.hostToken, 1, originalToken);
  assert.equal(service.snapshot(host.hostToken).selectedTextAvailable, true);
  service.reportVueError(host.hostToken, 1, originalToken, 'OPERATION_FAILED');
  assert.equal(service.snapshot(host.hostToken).selectedTextAvailable, false);

  originalVue.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  const replacementVue = state.vueViews[1];
  assert.ok(replacementVue);
  assert.notEqual(replacementVue.previewRuntimeToken, originalToken);
  assert.equal(service.snapshot(host.hostToken).selectionRevision, 2);
  assert.equal(children.has(replacementVue), false);
  assert.throws(
    () => service.reportVueReady(host.hostToken, 2, originalToken),
    (error) => error.code === 'HOST_ROLE_DENIED'
  );
  assert.throws(
    () => service.reportVueReady(host.hostToken, 1, replacementVue.previewRuntimeToken),
    (error) => error.code === 'INVALID_INPUT'
  );
  acknowledgeCurrentVue(service);
  assert.equal(children.has(replacementVue), true);
});

test('Vue bundle load failure publishes unavailable without an automatic recreate loop', async () => {
  const { service, children } = createHarness();
  state.nextVueLoadError = new Error('bundle unavailable');
  service.updateBounds(host.hostToken, bounds);
  await tick();

  assert.equal(state.vueViews.length, 1);
  assert.equal(state.vueViews[0].webContents.destroyed, true);
  assert.equal(children.size, 0);
  assert.equal(service.snapshot(host.hostToken).status, 'unavailable');
  assert.match(service.snapshot(host.hostToken).error.message, /bundle unavailable/);

  state.describe = async () => descriptorFor('notes/readme.md', 'text');
  await service.present(host.hostToken, fileRef('notes/readme.md'));
  assert.equal(state.vueViews.length, 2);
  assert.equal(children.has(state.vueViews[1]), false);
  acknowledgeCurrentVue(service);
  assert.equal(children.has(state.vueViews[1]), true);
});

test('PDF readiness waits for the viewer document frame and reports a truthful timeout', async () => {
  await withFakeTimeouts(async (timers) => {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    state.describe = async () => descriptorFor('paper.pdf', 'pdf');
    await service.present(host.hostToken, fileRef('paper.pdf'));
    const chrome = state.chromeViews.at(-1);
    const navigationUrl = chrome.webContents.loadedUrls.at(-1);

    // A blank viewer still finishes loading, so the navigation alone must not publish ready.
    chrome.webContents.emit('did-finish-load');
    assert.equal(service.snapshot(host.hostToken).status, 'loading');

    const runPendingPoll = () => {
      const pending = timers.filter((timer) => timer.active).at(-1);
      assert.ok(pending, 'a document-frame poll must be scheduled');
      pending.active = false;
      pending.callback(...pending.args);
    };

    runPendingPoll();
    assert.equal(service.snapshot(host.hostToken).status, 'loading');

    chrome.webContents.addSubframe(
      'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'
    );
    runPendingPoll();
    assert.equal(service.snapshot(host.hostToken).status, 'loading');

    chrome.webContents.addSubframe(navigationUrl);
    runPendingPoll();
    const ready = service.snapshot(host.hostToken);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.adapterId, 'chromium-pdf');
    assert.equal(ready.error, null);
  });

  await withFakeTimeouts(async (timers) => {
    const { service } = createHarness();
    service.updateBounds(host.hostToken, bounds);
    state.describe = async () => descriptorFor('paper.pdf', 'pdf');
    await service.present(host.hostToken, fileRef('paper.pdf'));
    const chrome = state.chromeViews.at(-1);
    chrome.webContents.emit('did-finish-load');
    chrome.webContents.addSubframe(
      'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'
    );

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const pending = timers.filter((timer) => timer.active).at(-1);
      if (!pending) break;
      pending.active = false;
      pending.callback(...pending.args);
    }

    const snapshot = service.snapshot(host.hostToken);
    assert.equal(snapshot.status, 'unavailable');
    assert.equal(snapshot.surface, 'vue');
    assert.equal(snapshot.error.code, 'PDF_VIEWER_UNAVAILABLE');
    assert.equal(chrome.webContents.destroyed, true);
  });
});

test('HTML readiness stays on the navigation and needs no document frame', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  state.describe = async () => descriptorFor('page.html', 'text');
  await service.present(host.hostToken, fileRef('page.html'));
  const chrome = state.chromeViews.at(-1);

  chrome.webContents.emit('did-finish-load');
  assert.equal(service.snapshot(host.hostToken).status, 'ready');
  assert.equal(service.snapshot(host.hostToken).adapterId, 'html-page');
});

test('a superseded Chrome mount cannot clear the shared session under a newer view', async () => {
  const { service } = createHarness();
  service.updateBounds(host.hostToken, bounds);
  const proxy = { started: deferred(), completion: deferred() };
  state.nextProxyDeferred = proxy;
  state.describe = async () => descriptorFor('first.pdf', 'pdf');
  const stalePresentation = service.present(host.hostToken, fileRef('first.pdf'));
  await proxy.started.promise;
  const staleChrome = state.chromeViews[0];

  state.describe = async () => descriptorFor('second.pdf', 'pdf');
  await service.present(host.hostToken, fileRef('second.pdf'));
  const liveChrome = state.chromeViews.at(-1);
  const chromeSession = liveChrome.webContents.session;
  const clearsBeforeStaleCleanup = chromeSession.clearStorageDataCalls;
  assert.equal(state.protocolInstalls.length, 1);

  proxy.completion.resolve();
  await stalePresentation;

  assert.equal(staleChrome.webContents.destroyed, true);
  assert.equal(liveChrome.webContents.destroyed, false);
  assert.equal(chromeSession.clearStorageDataCalls, clearsBeforeStaleCleanup);
  assert.equal(state.protocolInstalls.length, 1);
  assert.equal(service.snapshot(host.hostToken).fileRef.relativePath, 'second.pdf');
});

test('raw Chrome sibling and window helper keep the hardened topology contract', () => {
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const viewService = source('src/main/onlypreview/views/onlyPreviewPreviewView.service.ts');
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const chromePreferences = viewService.slice(
    viewService.indexOf('private createChromePreviewView('),
    viewService.indexOf('private async configureChromeSession(')
  );

  // A per-selection in-memory partition is exactly what stopped Chromium's PDF viewer from creating
  // its document frame, and a per-selection `persist:` name would leak a Partitions directory each
  // time, so this partition must stay one constant persistent string.
  assert.match(chromePreferences, /partition:\s*ONLY_PREVIEW_CHROME_PARTITION/);
  assert.match(viewService, /ONLY_PREVIEW_CHROME_PARTITION = 'persist:onlypreview-chrome'/);
  assert.doesNotMatch(chromePreferences, /partition:\s*`/);
  assert.match(chromePreferences, /sandbox:\s*true/);
  assert.match(chromePreferences, /contextIsolation:\s*true/);
  assert.match(chromePreferences, /nodeIntegration:\s*false/);
  assert.match(chromePreferences, /webSecurity:\s*true/);
  assert.match(chromePreferences, /plugins:\s*true/);
  assert.doesNotMatch(chromePreferences, /preload|additionalArguments/);
  assert.match(viewService, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(viewService, /setProxy\(/);
  assert.match(viewService, /disable_non_proxied_udp/);
  assert.match(viewService, /closeAllConnections/);
  assert.doesNotMatch(region, /new WebContentsView|setProxy\(|installOnlyPreviewSessionProtocol/);
  assert.match(region, /private readonly findService = new OnlyPreviewFindService\(\)/);
  assert.match(region, /private selectionRevision = 0/);
  assert.match(helper, /PREVIEW_TOOLBAR_HEIGHT = 43/);
  assert.match(helper, /MENU_BAR_HEIGHT \+ PREVIEW_TOOLBAR_HEIGHT/);
  assert.match(helper, /onlyPreviewPreviewRegionService\.updateBounds/);
  assert.match(helper, /onlyPreviewPreviewRegionService\.destroy/);
});
