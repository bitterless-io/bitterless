import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCoinIpcSender,
  type CoinInvokeEvent,
  type CoinSenderWindow,
} from '../../../src/main/coin/coinSender.guard';

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
