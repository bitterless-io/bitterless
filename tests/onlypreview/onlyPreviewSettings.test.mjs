/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const servicePath = join(projectRoot, 'src/main/onlypreview/onlyPreviewSettings.service.ts');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-settings-unit-'));
const bundlePath = join(buildRoot, 'settings.mjs');

globalThis.__onlyPreviewSettingsHarness = {
  getStored: async () => null,
  upsert: async () => null,
  broadcasts: []
};

await build({
  entryPoints: [servicePath],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'onlypreview-settings-xpc-harness',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^electron-xpc\/main$/ }, () => ({
          path: 'electron-xpc/main',
          namespace: 'onlypreview-settings-harness'
        }));
        buildContext.onLoad({ filter: /.*/, namespace: 'onlypreview-settings-harness' }, () => ({
          contents: `
              const harness = () => globalThis.__onlyPreviewSettingsHarness;
              export const createXpcMainEmitter = () => ({
                getStored: (...args) => harness().getStored(...args),
                upsert: (...args) => harness().upsert(...args),
              });
              export const xpcMain = {
                broadcast: (...args) => harness().broadcasts.push(args),
              };
            `,
          loader: 'js'
        }));
      }
    }
  ]
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => {
  delete globalThis.__onlyPreviewSettingsHarness;
  rmSync(buildRoot, { recursive: true, force: true });
});

const defaultSettings = {
  theme: 'light',
  editorFontSize: 13,
  wordWrap: false,
  showHiddenFiles: false,
  openFilesWithSingleClick: true
};

const savedSettings = {
  ...defaultSettings,
  editorFontSize: 18,
  wordWrap: true,
  openFilesWithSingleClick: false
};

const resetHarness = () => {
  globalThis.__onlyPreviewSettingsHarness = {
    getStored: async () => null,
    upsert: async () => null,
    broadcasts: []
  };
  return globalThis.__onlyPreviewSettingsHarness;
};

const withoutRetryDelay = async (operation) => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, _delay, ...args) => {
    queueMicrotask(() => callback(...args));
    return 0;
  };
  try {
    return await operation();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
};

test('settings retry constants and bounded loop remain explicit in source', () => {
  const source = readFileSync(servicePath, 'utf8');
  assert.match(source, /const SETTINGS_STORAGE_RETRY_ATTEMPTS = 26;/);
  assert.match(source, /const SETTINGS_STORAGE_RETRY_INTERVAL_MS = 200;/);
  assert.match(source, /attempt < SETTINGS_STORAGE_RETRY_ATTEMPTS && !isReady\(value\)/);
  assert.match(source, /setTimeout\(resolve, SETTINGS_STORAGE_RETRY_INTERVAL_MS\)/);
  assert.match(source, /waitForSettingsStorage<SettingStoredValue \| null>/);
  assert.match(source, /waitForSettingsStorage<string \| null>/);
  assert.match(source, /\(stored\) => stored !== null/);
  assert.match(
    source,
    /if \(this\.settingsReadPromise\) return \{ \.\.\.\(?await this\.settingsReadPromise\)? \}/
  );
  assert.match(source, /const generation = this\.cacheGeneration/);
  assert.match(
    source,
    /if \(generation === this\.cacheGeneration\) this\.cachedSettings = settings/
  );
  assert.match(source, /async hydrateFromStorage\(\): Promise<void>/);
  assert.match(
    source,
    /await this\.get\(\);[\s\S]*const settings = this\.cachedSettings;[\s\S]*settings: \{ \.\.\.settings \}/
  );
});

test('settings storage retries null results until get and save become ready', async () => {
  const harness = resetHarness();
  let getCalls = 0;
  harness.getStored = async () => {
    getCalls += 1;
    return getCalls < 3
      ? null
      : { exists: false, valid: false, value: null, serializedValue: null };
  };
  const getService = new runtime.OnlyPreviewSettingsService();
  assert.deepEqual(await withoutRetryDelay(() => getService.get()), defaultSettings);
  assert.equal(getCalls, 3);

  let saveCalls = 0;
  harness.upsert = async () => {
    saveCalls += 1;
    return saveCalls < 3 ? null : 'ok';
  };
  const saveService = new runtime.OnlyPreviewSettingsService();
  assert.deepEqual(await withoutRetryDelay(() => saveService.save(savedSettings)), savedSettings);
  assert.equal(saveCalls, 3);
  assert.deepEqual(harness.broadcasts, [
    ['onlypreview/settingsChanged', { settings: savedSettings }]
  ]);
});

test('settings storage stops after 26 unavailable results', async () => {
  const harness = resetHarness();
  let getCalls = 0;
  harness.getStored = async () => {
    getCalls += 1;
    return null;
  };
  const getService = new runtime.OnlyPreviewSettingsService();
  assert.deepEqual(await withoutRetryDelay(() => getService.get()), defaultSettings);
  assert.equal(getCalls, 26);

  let saveCalls = 0;
  harness.upsert = async () => {
    saveCalls += 1;
    return null;
  };
  const saveService = new runtime.OnlyPreviewSettingsService();
  await assert.rejects(
    withoutRetryDelay(() => saveService.save(savedSettings)),
    (error) =>
      error instanceof Error &&
      error.name === 'OnlyPreviewContractError' &&
      error.code === 'OPERATION_FAILED'
  );
  assert.equal(saveCalls, 26);
  assert.deepEqual(harness.broadcasts, []);
});

test('settings storage does not retry a non-null invalid upsert response', async () => {
  const harness = resetHarness();
  let saveCalls = 0;
  harness.upsert = async () => {
    saveCalls += 1;
    return 'unexpected';
  };
  const service = new runtime.OnlyPreviewSettingsService();
  await assert.rejects(
    service.save(savedSettings),
    (error) => error instanceof Error && error.code === 'OPERATION_FAILED'
  );
  assert.equal(saveCalls, 1);
  assert.deepEqual(harness.broadcasts, []);
});

test('concurrent settings reads share one storage request', async () => {
  const harness = resetHarness();
  let resolveStored;
  let getCalls = 0;
  harness.getStored = async () => {
    getCalls += 1;
    return await new Promise((resolveValue) => {
      resolveStored = resolveValue;
    });
  };
  const service = new runtime.OnlyPreviewSettingsService();
  const first = service.get();
  const second = service.get();
  assert.equal(getCalls, 1);
  resolveStored({
    exists: true,
    valid: true,
    value: savedSettings,
    serializedValue: JSON.stringify(savedSettings)
  });
  assert.deepEqual(await first, savedSettings);
  assert.deepEqual(await second, savedSettings);
  assert.equal(getCalls, 1);
});

test('hydration broadcasts only after storage supplies a cacheable value', async () => {
  const harness = resetHarness();
  harness.getStored = async () => null;
  const service = new runtime.OnlyPreviewSettingsService();
  await withoutRetryDelay(() => service.hydrateFromStorage());
  assert.deepEqual(harness.broadcasts, []);

  harness.getStored = async () => ({
    exists: false,
    valid: false,
    value: null,
    serializedValue: null
  });
  await service.hydrateFromStorage();
  assert.deepEqual(harness.broadcasts, [
    ['onlypreview/settingsChanged', { settings: defaultSettings }]
  ]);
});

test('a stale storage read cannot overwrite a newer save', async () => {
  const harness = resetHarness();
  let resolveStored;
  harness.getStored = async () =>
    await new Promise((resolveValue) => {
      resolveStored = resolveValue;
    });
  harness.upsert = async () => 'ok';
  const service = new runtime.OnlyPreviewSettingsService();
  const staleRead = service.get();
  assert.deepEqual(await service.save(savedSettings), savedSettings);
  resolveStored({
    exists: true,
    valid: true,
    value: defaultSettings,
    serializedValue: JSON.stringify(defaultSettings)
  });
  assert.deepEqual(await staleRead, savedSettings);
  assert.deepEqual(await service.get(), savedSettings);
  assert.deepEqual(harness.broadcasts, [
    ['onlypreview/settingsChanged', { settings: savedSettings }]
  ]);
});

test('hydration overlapping a save never broadcasts the stale stored value', async () => {
  const harness = resetHarness();
  let resolveStored;
  harness.getStored = async () =>
    await new Promise((resolveValue) => {
      resolveStored = resolveValue;
    });
  harness.upsert = async () => 'ok';
  const service = new runtime.OnlyPreviewSettingsService();
  const hydration = service.hydrateFromStorage();
  assert.deepEqual(await service.save(savedSettings), savedSettings);
  resolveStored({
    exists: true,
    valid: true,
    value: defaultSettings,
    serializedValue: JSON.stringify(defaultSettings)
  });
  await hydration;
  assert.equal(harness.broadcasts.length, 2);
  for (const broadcast of harness.broadcasts) {
    assert.deepEqual(broadcast, ['onlypreview/settingsChanged', { settings: savedSettings }]);
  }
});

test('settings storage promise exceptions are not retried', async () => {
  const harness = resetHarness();
  let getCalls = 0;
  harness.getStored = async () => {
    getCalls += 1;
    throw new Error('storage rejected');
  };
  const getService = new runtime.OnlyPreviewSettingsService();
  assert.deepEqual(await getService.get(), defaultSettings);
  assert.equal(getCalls, 1);

  let saveCalls = 0;
  harness.upsert = async () => {
    saveCalls += 1;
    throw new Error('storage rejected');
  };
  const saveService = new runtime.OnlyPreviewSettingsService();
  await assert.rejects(saveService.save(savedSettings), /storage rejected/);
  assert.equal(saveCalls, 1);
});
