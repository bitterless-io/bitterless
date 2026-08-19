/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  SUBMODULES_HANDLER_NAME,
  SUBMODULES_SNAPSHOT_EVENT
} from '../../src/shared/submodules/submodules.type.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const at = (path) => new URL(`../../${path}`, import.meta.url);

test('the shared contract names one broadcast event and drops the renderer store channel', () => {
  const shared = read('src/shared/submodules/submodules.type.ts');
  assert.equal(SUBMODULES_SNAPSHOT_EVENT, 'submodules/snapshot');
  assert.equal(SUBMODULES_HANDLER_NAME, 'SubmodulesHandler');
  assert.doesNotMatch(shared, /SUBMODULES_STORE_HANDLER_NAME|SubmodulesStoreApi/);
});

test('preload no longer reads, watches, or persists anything', () => {
  const preloadDir = readdirSync(at('src/preload/submodules'));
  assert.deepEqual(preloadDir, ['submodules.preload.ts']);

  const preload = read('src/preload/submodules/submodules.preload.ts');
  assert.doesNotMatch(preload, /submodules\.handler|Runtime|Scanner|Watcher/);
  assert.doesNotMatch(preload, /node:fs|readFileSync|watch\(/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('submodulesEnv', submodulesEnvApi\)/);
});

test('Main owns the scanner, the watcher, and the runtime, and registers the XPC handler', () => {
  for (const path of [
    'src/main/submodules/submoduleScanner.service.ts',
    'src/main/submodules/submoduleWatcher.service.ts',
    'src/main/submodules/submodulesRuntime.service.ts',
    'src/main/xpc/submodules.handler.ts'
  ]) {
    assert.equal(existsSync(at(path)), true, `${path} must exist in Main`);
  }

  const handler = read('src/main/xpc/submodules.handler.ts');
  assert.match(handler, /class SubmodulesHandler extends XpcMainHandler implements SubmodulesApi/);
  for (const method of ['initialize', 'setRoot', 'refresh', 'clearRoot']) {
    assert.match(handler, new RegExp(`async ${method}\\(`), `${method} must stay on the channel`);
  }
  assert.match(read('src/main/xpc/xpc.helper.ts'), /import '\.\/submodules\.handler';/);

  // The channel name is unchanged, so renderer emitters were not touched by the move.
  const emitter = read('src/renderer/submodules/src/emitter/submodules.emitter.ts');
  assert.match(emitter, /createXpcRendererEmitter<SubmodulesApi>\(\s*SUBMODULES_HANDLER_NAME/);
});

test('the Main runtime holds exactly one watcher and one interval, and broadcasts on change only', () => {
  const runtime = read('src/main/submodules/submodulesRuntime.service.ts');

  assert.equal(
    [...runtime.matchAll(/new SubmoduleWatcher\(/g)].length,
    1,
    'one watcher for the whole application'
  );
  assert.equal(
    [...runtime.matchAll(/setInterval\(/g)].length,
    1,
    'one safety interval for the whole application'
  );
  assert.match(runtime, /createXpcMainEmitter<SettingDao>\('SettingDao'\)/);

  // The broadcast is the single publication path and it sits behind the changed fingerprint.
  const publish = runtime.slice(runtime.indexOf('private publish('));
  assert.match(
    publish,
    /const changed = fingerprint !== this\.fingerprint;[\s\S]*if \(changed\) xpcMain\.broadcast\(SUBMODULES_SNAPSHOT_EVENT, snapshot\);/
  );
  assert.equal([...runtime.matchAll(/xpcMain\.broadcast\(/g)].length, 1);
  // The scan timestamp must stay out of the fingerprint or every safety rescan would broadcast.
  const fingerprint = runtime.slice(
    runtime.indexOf('const snapshotFingerprint'),
    runtime.indexOf('class SubmodulesRuntime')
  );
  assert.doesNotMatch(fingerprint, /scannedAt/);
});

test('initialize is idempotent across views and never restores twice', () => {
  const runtime = read('src/main/submodules/submodulesRuntime.service.ts');
  const initialize = runtime.slice(
    runtime.indexOf('async initialize('),
    runtime.indexOf('async open(')
  );
  assert.match(initialize, /if \(this\.restored\) return this\.rescan\(\);/);
  assert.match(initialize, /if \(!this\.restorePromise\)/);
  assert.match(initialize, /return await this\.restorePromise;/);
});

test('watching disarms when no live Submodules surface remains, keeping the persisted root', () => {
  const runtime = read('src/main/submodules/submodulesRuntime.service.ts');

  assert.match(
    runtime,
    /private hasLiveSurface\(\): boolean \{[\s\S]*submodulesWindowHandler\._hasLiveWindow\(\)[\s\S]*omniWindowHelper\.hasLiveMiniApp\('submodules'\)/
  );
  for (const scope of ['private scheduleRescan(', 'private startPolling(']) {
    const body = runtime.slice(runtime.indexOf(scope));
    assert.match(
      body.slice(0, body.indexOf('\n  }')),
      /if \(!this\.hasLiveSurface\(\)\) \{\s*this\.stopWatching\(\);\s*return;\s*\}/,
      `${scope} must disarm instead of rescanning for nobody`
    );
  }
  // Disarming releases OS resources only; the root stays in SQLite for the next view.
  const stopWatching = runtime.slice(runtime.indexOf('private stopWatching('));
  assert.doesNotMatch(
    stopWatching.slice(0, stopWatching.indexOf('\n  }')),
    /rootPath|settingEmitter/
  );

  const omniHelper = read('src/main/windows/omniWindow.helper.ts');
  assert.match(omniHelper, /hasLiveMiniApp\(miniAppId: OmniMiniAppId\): boolean/);
  const windowHandler = read('src/main/xpc/submodulesWindow.handler.ts');
  assert.match(windowHandler, /_hasLiveWindow\(\): boolean/);
});

test('every renderer is a pure view over the broadcast', () => {
  const store = read('src/renderer/submodules/src/store/submodules.store.ts');
  assert.match(
    store,
    /xpcRenderer\.subscribe\(SUBMODULES_SNAPSHOT_EVENT, \(payload\) => \{[\s\S]*applySnapshot\(payload\.params/
  );
  assert.doesNotMatch(store, /XpcRendererHandler|SubmodulesStoreHandler/);
  assert.doesNotMatch(store, /node:fs|scanSubmodules|SubmoduleWatcher/);
  // A null or shape-invalid payload must still land in the designed error state.
  assert.match(store, /applySnapshot\(snapshot: SubmodulesSnapshot \| null\)/);
});
