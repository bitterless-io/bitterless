import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCoinIpcSender,
  assertTrenchResourceIpcSender,
  type CoinInvokeEvent,
  type CoinSenderWindow,
  type TrenchResourceInvokeEvent,
} from '../../../src/main/coin/coinSender.guard';
import { COIN_IPC_CHANNELS } from '../../../src/shared/coin/coinBridge.type';

const INVOKE_CHANNELS = Object.entries(COIN_IPC_CHANNELS)
  .filter(([name]) => ![
    'codexDeviceCode',
    'dataMonitorEvent',
    'dataDiscoverEvent',
    'languageChanged',
  ].includes(name))
  .map(([, channel]) => channel);

const createOwner = (): CoinSenderWindow => {
  const mainFrame = {};
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      mainFrame,
    },
  };
};

test('accepts only the live Coin main frame', () => {
  const owner = createOwner();
  const event: CoinInvokeEvent = {
    sender: owner.webContents,
    senderFrame: owner.webContents.mainFrame,
  };
  assert.equal(assertCoinIpcSender('coin:test', event, owner), owner);
});

test('rejects missing, destroyed, foreign, and subframe senders', () => {
  const owner = createOwner();
  const validEvent: CoinInvokeEvent = {
    sender: owner.webContents,
    senderFrame: owner.webContents.mainFrame,
  };
  const expected = /sender is not the live Coin window/;

  assert.throws(() => assertCoinIpcSender('coin:test', validEvent, null), expected);
  assert.throws(
    () =>
      assertCoinIpcSender('coin:test', validEvent, {
        ...owner,
        isDestroyed: () => true,
      }),
    expected,
  );
  assert.throws(
    () =>
      assertCoinIpcSender(
        'coin:test',
        { sender: {}, senderFrame: owner.webContents.mainFrame },
        owner,
      ),
    expected,
  );
  assert.throws(
    () =>
      assertCoinIpcSender(
        'coin:test',
        { sender: owner.webContents, senderFrame: {} },
        owner,
      ),
    expected,
  );
});

test('rejects foreign senders on every Coin invoke channel', () => {
  const owner = createOwner();
  const foreignEvent: CoinInvokeEvent = {
    sender: {},
    senderFrame: {},
  };

  assert.equal(INVOKE_CHANNELS.includes(COIN_IPC_CHANNELS.aiAnalyze), true);
  assert.equal(INVOKE_CHANNELS.includes(COIN_IPC_CHANNELS.aiCancel), true);
  for (const channel of INVOKE_CHANNELS) {
    assert.throws(
      () => assertCoinIpcSender(channel, foreignEvent, owner),
      new RegExp(`rejected ${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  }
});

test('accepts only built or loopback Trench main frames for the GMGN resource bridge', () => {
  const createEvent = (url: string): TrenchResourceInvokeEvent => {
    const mainFrame = {};
    return {
      sender: {
        isDestroyed: () => false,
        mainFrame,
        getURL: () => url,
      },
      senderFrame: mainFrame,
    };
  };
  assert.doesNotThrow(() => assertTrenchResourceIpcSender(
    COIN_IPC_CHANNELS.gmgnDetect,
    createEvent('file:///Applications/Bitterless.app/Contents/Resources/app.asar/out/renderer/coin/index.html'),
  ));
  assert.doesNotThrow(() => assertTrenchResourceIpcSender(
    COIN_IPC_CHANNELS.gmgnDetect,
    createEvent('http://localhost:5173/coin/index.html'),
  ));
  for (const url of [
    'file:///Applications/Bitterless.app/Contents/Resources/app.asar/out/renderer/home/index.html',
    'https://example.com/coin/index.html',
    'http://localhost:5173/home/index.html',
  ]) {
    assert.throws(
      () => assertTrenchResourceIpcSender(COIN_IPC_CHANNELS.gmgnDetect, createEvent(url)),
      /sender is not a live Trench main frame/,
    );
  }
  const subframe = createEvent('file:///tmp/out/renderer/coin/index.html');
  assert.throws(
    () => assertTrenchResourceIpcSender(
      COIN_IPC_CHANNELS.gmgnDetect,
      { ...subframe, senderFrame: {} },
    ),
    /sender is not a live Trench main frame/,
  );
});

test('registerCoinIpc routes every invoke handler through the scoped guard', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/main/coin/coinIpc.service.ts'),
    'utf8',
  );
  const directRegistrations = source.match(/ipcMain\.handle\(/g) ?? [];

  assert.equal(directRegistrations.length, 2);
  const trenchResourceChannels = new Set([
    'gmgnDetect',
    'gmgnSaveApiKey',
    'gmgnVerify',
    'gmgnOpenOfficialLink',
  ]);
  for (const channelName of Object.keys(COIN_IPC_CHANNELS).filter(
    (name) => ![
      'codexDeviceCode',
      'dataMonitorEvent',
      'dataDiscoverEvent',
      'languageChanged',
    ].includes(name),
  )) {
    assert.match(
      source,
      new RegExp(
        `${trenchResourceChannels.has(channelName) ? 'trenchResourceHandle' : 'scopedHandle'}\\(COIN_IPC_CHANNELS\\.${channelName}`,
      ),
    );
  }
  assert.match(source, /assertTrenchResourceIpcSender\(channel, event\)/);
});

test('foreground startup registers only the idempotent four-channel Trench GMGN subset', () => {
  const ipcSource = readFileSync(
    join(process.cwd(), 'src/main/coin/coinIpc.service.ts'),
    'utf8',
  );
  const appSource = readFileSync(
    join(process.cwd(), 'src/main/app.main.ts'),
    'utf8',
  );
  const subset = ipcSource.slice(
    ipcSource.indexOf('export const registerTrenchGmgnIpc'),
    ipcSource.indexOf('export const registerCoinIpc'),
  );

  assert.match(appSource, /if \(!isHelperMode\) \{[\s\S]*registerTrenchGmgnIpc\(coinResourceService\)/);
  assert.match(subset, /if \(trenchGmgnRegistered\) return/);
  assert.match(ipcSource, /registerCoinIpc[\s\S]*registerTrenchGmgnIpc\(dependencies\.resources\)/);
  assert.deepEqual(
    [...subset.matchAll(/COIN_IPC_CHANNELS\.(\w+)/g)].map((match) => match[1]),
    ['gmgnDetect', 'gmgnSaveApiKey', 'gmgnVerify', 'gmgnOpenOfficialLink'],
  );
});
