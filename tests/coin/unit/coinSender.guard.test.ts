import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCoinIpcSender,
  type CoinInvokeEvent,
  type CoinSenderWindow,
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

test('registerCoinIpc routes every invoke handler through the scoped guard', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/main/coin/coinIpc.service.ts'),
    'utf8',
  );
  const directRegistrations = source.match(/ipcMain\.handle\(/g) ?? [];

  assert.equal(directRegistrations.length, 1);
  for (const channelName of Object.keys(COIN_IPC_CHANNELS).filter(
    (name) => ![
      'codexDeviceCode',
      'dataMonitorEvent',
      'dataDiscoverEvent',
      'languageChanged',
    ].includes(name),
  )) {
    assert.match(source, new RegExp(`scopedHandle\\(COIN_IPC_CHANNELS\\.${channelName}`));
  }
});
