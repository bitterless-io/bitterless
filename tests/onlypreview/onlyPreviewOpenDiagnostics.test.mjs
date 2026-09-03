import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  createOnlyPreviewOpenDiagnostics,
  createOnlyPreviewWindowOpenCoordinator
} from '../../src/shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

test('OnlyPreview open diagnostics emit a fixed privacy-safe correlated schema', () => {
  let now = 100;
  const lines = [];
  const diagnostics = createOnlyPreviewOpenDiagnostics({ clock: () => now, write: (line) => lines.push(line) });
  const trace = diagnostics.trace('target', {
    kind: 'file',
    path: '/private/secret.md',
    workspaceId: 'secret-workspace',
    capability: 'secret-capability'
  }, 't');
  now = 125.9;
  trace.mark({
    phase: 'authority',
    authority: 'external',
    filename: 'secret.md',
    url: 'file:///private/secret.md',
    error: new Error('secret')
  });
  now = 151.2;
  trace.end({ outcome: 'accepted', token: 'secret-token' });

  assert.deepEqual(lines, [
    '[onlypreview-open] event=target-start tag=t1 kind=file',
    '[onlypreview-open] event=target-stage tag=t1 phase=authority authority=external elapsedMs=25 stageMs=25',
    '[onlypreview-open] event=target-terminal tag=t1 outcome=accepted elapsedMs=51'
  ]);
  assert.doesNotMatch(lines.join('\n'), /secret|path|filename|workspaceId|capability|token|url|error/i);
});

test('OnlyPreview open diagnostics clamp monotonic durations and terminate once', () => {
  let now = 50;
  const lines = [];
  const diagnostics = createOnlyPreviewOpenDiagnostics({ clock: () => now, write: (line) => lines.push(line) });
  const trace = diagnostics.trace('preview', { revision: 7, surface: 'vue' }, 'p');
  now = -20;
  trace.mark({ phase: 'workspace', revision: 7 });
  now = Number.POSITIVE_INFINITY;
  assert.equal(trace.end({ outcome: 'ready', revision: 7 }), true);
  assert.equal(trace.end({ outcome: 'error', revision: 7 }), false);
  assert.equal(trace.mark({ phase: 'published', revision: 7 }), false);
  assert.match(lines[1], /elapsedMs=0 stageMs=0$/);
  assert.match(lines[2], /outcome=ready elapsedMs=0$/);
  assert.equal(lines.filter((line) => line.includes('preview-terminal')).length, 1);
});

test('OnlyPreview open diagnostics swallow clock and writer failures', () => {
  const diagnostics = createOnlyPreviewOpenDiagnostics({
    clock: () => { throw new Error('clock failed'); },
    write: () => { throw new Error('writer failed'); }
  });
  const trace = diagnostics.trace('window', { route: 'api', mode: 'cold' }, 'w');
  assert.equal(trace.mark({ phase: 'native' }), false);
  assert.equal(trace.end({ outcome: 'failure' }), false);
  assert.equal(trace.end({ outcome: 'success' }), false);
  assert.equal(diagnostics.emit('unknown', { path: '/secret' }), false);
});

test('OnlyPreview open diagnostics reject unknown events and values', () => {
  const lines = [];
  const diagnostics = createOnlyPreviewOpenDiagnostics({
    clock: () => 0,
    write: (line) => lines.push(line)
  });
  assert.equal(diagnostics.emit('target-stage', {
    tag: 'INVALID/TAG',
    phase: 'raw-path',
    authority: 'host-token',
    elapsedMs: 99,
    stageMs: 5,
    query: 'private query'
  }), true);
  assert.equal(lines[0], '[onlypreview-open] event=target-stage elapsedMs=99 stageMs=5');
  assert.equal(diagnostics.emit('not-allowlisted', { tag: 'x1' }), false);
  assert.equal(lines.length, 1);
});

test('restored Project index grace diagnostics expose only fixed phases and bounded generation', () => {
  const lines = [];
  const diagnostics = createOnlyPreviewSearchDiagnostics({
    clock: () => 10,
    write: (line) => lines.push(line)
  });
  diagnostics.emit('restore-index-grace', {
    tag: 'g1',
    phase: 'scheduled',
    generation: 4,
    elapsedMs: 0,
    workspaceId: 'private-workspace',
    rootPath: '/private/root'
  });
  diagnostics.emit('restore-index-grace', {
    tag: 'g1',
    phase: 'start',
    generation: 4,
    elapsedMs: 750
  });
  assert.deepEqual(lines, [
    '[onlypreview-search] event=restore-index-grace tag=g1 phase=scheduled generation=4 elapsedMs=0',
    '[onlypreview-search] event=restore-index-grace tag=g1 phase=start generation=4 elapsedMs=750'
  ]);
  assert.doesNotMatch(lines.join('\n'), /workspace|root|private/i);
});

test('window open coordinator covers existing, cold mount, timeout, and supersede once-only', () => {
  const lines = [];
  const timers = [];
  const diagnostics = createOnlyPreviewOpenDiagnostics({ write: (line) => lines.push(line) });
  const coordinator = createOnlyPreviewWindowOpenCoordinator({
    diagnostics,
    setTimer: (run, delay) => (timers.push({ active: true, delay, run }), timers.at(-1)),
    clearTimer: (timer) => { timer.active = false; }
  });

  const cold = coordinator.begin('api', 'cold');
  coordinator.mark(cold.tag, { phase: 'shell-load-resolved' });
  assert.equal(coordinator.finish(cold.tag, 'success'), true);
  assert.equal(coordinator.finish(cold.tag, 'failure'), false);

  const first = coordinator.begin('explicit', 'cold');
  const second = coordinator.begin('explicit', 'cold');
  assert.equal(coordinator.mark(first.tag, { phase: 'renderer-mount' }), false);
  assert.equal(coordinator.finish(second.tag, 'success'), true);

  const timed = coordinator.begin('api', 'cold');
  assert.equal(timers.at(-1).delay, 300_000);
  timers.at(-1).run();
  assert.equal(coordinator.finish(timed.tag, 'success'), false);

  const existing = coordinator.begin('api', 'existing');
  assert.equal(coordinator.finish(existing.tag, 'success'), true);
  const terminals = lines.filter((line) => line.includes('window-terminal'));
  assert.equal(terminals.length, 5);
  assert.match(terminals[0], /outcome=success/);
  assert.match(terminals[1], /outcome=superseded/);
  assert.match(terminals[3], /outcome=timeout/);
  assert.match(terminals[3], /reason=diagnostic-timeout/);
  assert.match(terminals[4], /outcome=success/);
});

test('window close before renderer receipt is terminal and a late receipt is a no-op', () => {
  const lines = [];
  const timers = [];
  const diagnostics = createOnlyPreviewOpenDiagnostics({
    clock: () => 0,
    write: (line) => lines.push(line)
  });
  const coordinator = createOnlyPreviewWindowOpenCoordinator({
    diagnostics,
    setTimer: (run) => (timers.push({ active: true, run }), timers.at(-1)),
    clearTimer: (timer) => { timer.active = false; }
  });
  const trace = coordinator.begin('api', 'cold');
  assert.equal(coordinator.finish(trace.tag, 'failure', 'closed'), true);
  assert.equal(coordinator.mark(trace.tag, { phase: 'renderer-receipt' }), false);
  assert.equal(coordinator.finish(trace.tag, 'success', 'none'), false);
  timers[0].run();

  const terminals = lines.filter((line) => line.includes('window-terminal'));
  assert.deepEqual(terminals, [
    `[onlypreview-open] event=window-terminal tag=${trace.tag} outcome=failure reason=closed elapsedMs=0`
  ]);
});

test('dedicated OnlyPreview open log writes once without mirroring and swallows logger failures', () => {
  const source = readFileSync('src/main/logging/onlyPreviewLog.service.ts', 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const messages = [];
  let mirrors = 0;
  const logger = {
    variables: {},
    transports: { console: {}, ipc: {}, remote: {}, file: {} },
    hooks: [],
    processMessage: (message) => messages.push(message)
  };
  const dependencies = {
    'electron-log/main': { create: () => logger },
    '@main/logging/logPolicy.service': {
      APPLICATION_LOG_FILE_MAX_SIZE: 1,
      resolveOnlyPreviewLogFile: () => '/tmp/onlypreview.log'
    },
    '@main/logging/logSanitizer.service': {
      formatApplicationLogMessage: () => '',
      sanitizeApplicationLogMessage: () => undefined
    },
    '@main/logging/onlyPreviewLogRecord.service': {
      formatOnlyPreviewFailureLine: () => '[onlypreview] failure'
    }
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transpiled)(
    (specifier) => {
      if (!Object.hasOwn(dependencies, specifier)) throw new Error(`missing ${specifier}`);
      return dependencies[specifier];
    },
    module,
    module.exports
  );
  const service = new module.exports.OnlyPreviewLogService({
    getProfile: () => ({ id: 'preview', releaseChannel: 'preview', viteMode: 'release' }),
    mirror: () => { mirrors += 1; }
  });
  service.writeDiagnosticLine('[not-allowlisted] ignored');
  service.writeDiagnosticLine('[onlypreview-open] event=window-terminal tag=w1 outcome=success elapsedMs=1');
  assert.equal(messages.length, 1);
  assert.equal(mirrors, 0);
  logger.processMessage = () => { throw new Error('disk failed'); };
  assert.doesNotThrow(() => service.writeDiagnosticLine('[onlypreview-open] event=window-terminal'));
  assert.equal(mirrors, 0);
});

test('Shell mount acknowledgement is post-Vue, capability fenced, and never awaited by window open', () => {
  const shell = readFileSync('src/renderer/onlypreview/shell/src/main.ts', 'utf8');
  const handler = readFileSync('src/main/xpc/onlyPreview.handler.ts', 'utf8');
  const helper = readFileSync('src/main/windows/onlyPreviewWindow.helper.ts', 'utf8');
  const rendererTarget = readFileSync(
    'src/main/onlypreview/views/onlyPreviewRendererTarget.service.ts',
    'utf8'
  );
  assert.match(
    shell,
    /reportShellStage\('renderer-script'\)[\s\S]*initializeOnlyPreviewI18n\(\)[\s\S]*reportShellStage\('renderer-language'\)[\s\S]*import\('\.\/App\.vue'\)[\s\S]*reportShellStage\('renderer-import'\)[\s\S]*\.mount\('#app'\)[\s\S]*nextTick\(\)[\s\S]*reportShellStage\('renderer-mount'\)[\s\S]*reportShellStage\('renderer-receipt', 'success'\)/
  );
  assert.match(shell, /reportShellStage\('renderer-receipt', 'failure'\)/);
  assert.match(shell, /void onlyPreviewClient[\s\S]*\.reportShellMounted/);
  assert.match(handler, /onlyPreviewWindowHelper\.reportShellMounted/);
  assert.match(helper, /requireStandaloneHost\(hostToken\)[\s\S]*isCurrentShell\(hostToken, window, shellView\)/);
  assert.match(rendererTarget, /--onlypreview-open-tag=/);
  assert.doesNotMatch(helper, /await[^\n]*reportShellMounted/);
  assert.ok(
    helper.indexOf("if (mode === 'cold') this.destroyStandalone()") <
      helper.indexOf('this.windowOpenTraces.begin(route, mode)'),
    'cold teardown must supersede the old trace before beginning the replacement trace'
  );
  for (const phase of [
    'shell-create',
    'shell-load-start',
    'shell-dom-ready',
    'shell-did-finish',
    'shell-load-resolved'
  ]) {
    assert.match(helper, new RegExp(`phase: '${phase}'`));
  }
  assert.match(helper, /'render-gone'/);
  assert.match(helper, /'unresponsive'/);
  assert.match(
    helper,
    /window\.once\('closed'[\s\S]*this\.baseWindow !== window[\s\S]*this\.standaloneHost\?\.hostToken !== host\.hostToken[\s\S]*finishShellOpenTrace\(openTrace\.tag, 'failure', 'closed'\)/
  );
  assert.match(helper, /backgroundThrottling: true/);
});

test('OnlyPreview Shell alone runs unthrottled until a current successful renderer receipt', () => {
  const helper = readFileSync('src/main/windows/onlyPreviewWindow.helper.ts', 'utf8');
  const createView = helper.slice(helper.indexOf('private createView('), helper.indexOf('private async loadView('));
  const report = helper.slice(helper.indexOf('reportShellMounted('), helper.indexOf('minimizeWindow('));
  const standalone = helper.slice(
    helper.indexOf('private async createStandaloneWindow('),
    helper.indexOf('private createView(')
  );
  const attach = standalone.indexOf('window.contentView.addChildView(shellView)');
  const bounds = standalone.indexOf('this.applyInitialBounds()', attach);
  const show = standalone.indexOf('this.show()', bounds);
  const load = standalone.indexOf("await this.loadView(shellView, 'shell')", show);

  assert.match(createView, /backgroundThrottling: mode !== 'shell'/);
  assert.match(report, /shellView\.webContents\.isDestroyed\(\)[\s\S]*isCurrentShell\(hostToken, window, shellView\)/);
  assert.doesNotMatch(report.slice(0, report.indexOf(') return;')), /windowOpenTraces\.isActive/);
  assert.match(report, /phase === 'renderer-receipt' && outcome[\s\S]*settleShellStartupLease\(hostToken, window, shellView\)[\s\S]*phase,[\s\S]*getBackgroundThrottling\(\)[\s\S]*phase: 'interactive'/);
  assert.doesNotMatch(report, /this\.show\(\)|phase: 'first-visible'|wasVisible/);
  assert.ok(attach < bounds && bounds < show && show < load);
  assert.match(standalone.slice(show, load), /phase: 'first-visible'/);
  assert.doesNotMatch(
    standalone.slice(
      standalone.indexOf("shellView.webContents.once('did-finish-load'"),
      standalone.indexOf("shellView.webContents.once('did-fail-load'")
    ),
    /\.show\(\)|window\.focus\(\)|phase: 'first-visible'/
  );
  assert.match(report, /phase === 'renderer-receipt' && outcome[\s\S]*settleShellStartupLease\(hostToken, window, shellView\)/);
  assert.doesNotMatch(report, /outcome === 'failure'\) this\.show\(\)/);
  assert.match(helper, /shellStartupLease = \{ hostToken: host\.hostToken, window, view: shellView \}/);
  assert.match(helper, /private settleShellStartupLease\([\s\S]*isCurrentShell\(hostToken, window, view\)[\s\S]*lease\?\.hostToken !== hostToken[\s\S]*lease\.window !== window[\s\S]*lease\.view !== view[\s\S]*shellStartupLease = null[\s\S]*setBackgroundThrottling\(true\)/);
  assert.match(helper, /closeOnRendererFailure[\s\S]*isCurrentShell\(host\.hostToken, window, shellView\)[\s\S]*settleShellStartupLease\(host\.hostToken, window, shellView\)[\s\S]*finishShellOpenTrace/);
  for (const event of ['did-fail-load', 'unresponsive']) {
    const callback = helper.slice(helper.indexOf(`shellView.webContents.once('${event}'`), helper.indexOf(`});`, helper.indexOf(`shellView.webContents.once('${event}'`)) + 3);
    assert.match(callback, /isCurrentShell\(host\.hostToken, window, shellView\)[\s\S]*settleShellStartupLease\(host\.hostToken, window, shellView\)[\s\S]*finishShellOpenTrace/);
  }
  assert.match(helper, /window\.once\('closed'[\s\S]*settleShellStartupLease\(host\.hostToken, window, shellView\)[\s\S]*finishShellOpenTrace\(openTrace\.tag, 'failure', 'closed'\)/);
  assert.match(helper, /windowOpenTraces\.supersede\(\)[\s\S]*settleShellStartupLease\(this\.standaloneHost\.hostToken, window, shellView\)/);
});

test('a restored window lays its content out after the persisted bounds are applied', () => {
  const helper = readFileSync('src/main/windows/onlyPreviewWindow.helper.ts', 'utf8');
  const create = helper.slice(
    helper.indexOf('private async createStandaloneWindow('),
    helper.indexOf('private async loadView(')
  );
  assert.ok(create.length > 0);

  const listener = create.indexOf("window.on('resize'");
  const initial = create.indexOf('this.applyInitialBounds();');
  const show = create.indexOf('this.show();');
  const reapply = create.indexOf('this.applyInitialBounds();', show);

  // The constructor is not the authoritative restore: WindowStateController.show() applies the
  // persisted bounds and any saved maximize/full-screen. A listener registered after show() misses
  // that resize entirely and the content keeps the constructor-time layout.
  assert.ok(listener > 0 && listener < show, 'resize listener must be registered before show()');
  assert.ok(initial > listener && initial < show, 'first layout must precede show()');
  assert.ok(reapply > show, 'layout must be re-applied after show()');
});

test('restored Project dispatches its initial index without a renderer timer', () => {
  const store = readFileSync(
    'src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts',
    'utf8'
  );
  const deferred = readFileSync(
    'src/renderer/onlypreview/shell/src/onlyPreviewDeferredIndex.service.ts',
    'utf8'
  );
  const initialize = store.slice(store.indexOf('async initialize()'), store.indexOf('async chooseFolder()'));
  const restore = store.slice(store.indexOf('private async restoreWorkspace('), store.indexOf('private async syncSelection('));
  const refresh = store.slice(store.indexOf('async refresh()'), store.indexOf('dismissError()'));
  const subscribe = store.slice(store.indexOf('private subscribe()'), store.indexOf('private nativeFindSuppressesCharacterCount()'));

  assert.match(initialize, /this\.restoreWorkspace\(true\)/);
  assert.match(restore, /applyWorkspace\(workspace, deferInitialIndex\)[\s\S]*deferredIndex\.run\([\s\S]*deferInitialIndex[\s\S]*generation === this\.workspaceGeneration[\s\S]*initializeIndex\(\)/);
  assert.match(deferred, /globalThis\.queueMicrotask\(run\)[\s\S]*scheduleMicrotask\(\(\) => this\.drain\(generation, 'start'\)\)/);
  assert.match(deferred, /entry\.generation !== generation[\s\S]*phase: 'superseded'[\s\S]*if \(!isCurrent\(\)\)[\s\S]*phase: 'cancel'[\s\S]*action\(\)/);
  assert.doesNotMatch(deferred, /setTimeout|clearTimeout|RESTORED_INDEX_GRACE_MS/);
  assert.match(refresh, /deferredIndex\.cancel\(\) \? this\.initializeIndex\(\) : this\.refreshIndex\(\)/);
  assert.match(subscribe, /refresh: \(\) => void this\.refresh\(\)/);
  assert.doesNotMatch(subscribe, /refresh: \(\)[\s\S]{0,80}refreshIndex\(\)/);
  assert.match(deferred, /if \(!deferred\)[\s\S]*this\.cancel\(\)[\s\S]*await action\(\)[\s\S]*this\.schedule\(isCurrent/);
  assert.match(deferred, /this\.entry = null;[\s\S]*this\.generation \+= 1[\s\S]*phase: 'cancel'/);

  // A microtask alone is not a guarantee: a shell frozen right after `interactive` never drains it,
  // which is what left a restored Project with a MenuBar path and an empty tree. The store must
  // re-arm the pending index from a visible, interactive signal.
  assert.match(deferred, /resume\(\): void \{[\s\S]*this\.drain\(entry\.generation, 'resumed'\)/);
  // The service arms its own signals: the store had no part in the decision, and keeping the wiring
  // beside `resume()` is what makes the two impossible to drift apart.
  assert.match(deferred, /addEventListener\?\.\('focus', resume\)/);
  assert.match(deferred, /'visibilitychange'[\s\S]*visibilityState === 'visible'[\s\S]*resume\(\)/);
  assert.doesNotMatch(subscribe, /setTimeout|setInterval/);
});
