import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSnipingHomeSender,
  assertSnipingRendererSender,
  createSnipingRendererTargets,
  createSnipingOmniTrenchTargets,
  type SnipingInvokeEvent,
  type SnipingWindowLike,
} from '../../../src/main/sniping/snipingSender.guard';

const windowAt = (url: string): SnipingWindowLike => {
  const mainFrame = {};
  return {
    isDestroyed: () => false,
    webContents: {
      mainFrame,
      getURL: () => url,
      isDestroyed: () => false,
    },
  };
};

const eventFor = (window: SnipingWindowLike): SnipingInvokeEvent => ({
  sender: window.webContents,
  senderFrame: window.webContents.mainFrame,
});

test('Home session IPC accepts only the exact live Home main frame', () => {
  const targets = createSnipingRendererTargets('/Applications/Bitterless.app/Contents/Resources/app.asar');
  const home = windowAt(targets.home);
  assert.doesNotThrow(() => assertSnipingHomeSender(eventFor(home), home, targets.home));
  assert.throws(() => assertSnipingHomeSender(eventFor(home), null, targets.home), /non-Home/);
  assert.throws(
    () => assertSnipingHomeSender({ ...eventFor(home), senderFrame: {} }, home, targets.home),
    /non-Home/,
  );
  const remote = windowAt('https://example.com/home/index.html');
  assert.throws(() => assertSnipingHomeSender(eventFor(remote), remote, targets.home), /non-Home/);
  const coin = windowAt('http://localhost:5173/coin/index.html');
  assert.throws(() => assertSnipingHomeSender(eventFor(coin), coin, targets.home), /non-Home/);
  const wrongRoot = windowAt('file:///tmp/out/renderer/home/index.html');
  assert.throws(() => assertSnipingHomeSender(eventFor(wrongRoot), wrongRoot, targets.home), /non-Home/);
  const devTargets = createSnipingRendererTargets('/unused', 'http://localhost:5173');
  for (const url of [
    'http://localhost:5174/home/index.html',
    'http://127.0.0.1:5173/home/index.html',
    'http://localhost:5173/other/home/index.html',
  ]) {
    const wrong = windowAt(url);
    assert.throws(() => assertSnipingHomeSender(
      eventFor(wrong), wrong, devTargets.home,
    ), /non-Home/);
  }
});

test('Trench IPC accepts the live standalone or exact live Omni Trench main frame only', () => {
  const standalone = windowAt('http://localhost:5173/coin/index.html');
  const targets = createSnipingRendererTargets('/unused', 'http://localhost:5173');
  const omniTargets = createSnipingOmniTrenchTargets('/unused', 'http://localhost:5173');
  assert.deepEqual(omniTargets, ['http://localhost:5173/coin/index.html']);
  assert.doesNotThrow(() => assertSnipingRendererSender(
    eventFor(standalone),
    standalone,
    () => false,
    targets.coin,
  ));

  const omni = windowAt(omniTargets[0]);
  assert.doesNotThrow(() => assertSnipingRendererSender(
    eventFor(omni),
    null,
    (sender) => sender === omni.webContents,
    targets.coin,
    omniTargets,
  ));
  assert.throws(() => assertSnipingRendererSender(
    eventFor(omni),
    null,
    () => false,
    targets.coin,
    omniTargets,
  ), /non-live Trench/);
  assert.throws(() => assertSnipingRendererSender(
    { ...eventFor(omni), senderFrame: {} },
    null,
    () => true,
    targets.coin,
    omniTargets,
  ), /non-live Trench/);
  const browser = windowAt('https://example.com/coin/index.html');
  assert.throws(() => assertSnipingRendererSender(
    eventFor(browser),
    browser,
    () => false,
    targets.coin,
    omniTargets,
  ), /non-live Trench/);
  for (const url of [
    'http://localhost:5174/coin/index.html',
    'http://127.0.0.1:5173/coin/index.html',
    'http://localhost:5173/other/coin/index.html',
    'file:///tmp/out/renderer/coin/index.html',
    'http://localhost:5173/omni/coin/index.html',
  ]) {
    const wrong = windowAt(url);
    assert.throws(() => assertSnipingRendererSender(
      eventFor(wrong), wrong, () => false, targets.coin,
    ), /non-live Trench/);
    assert.throws(() => assertSnipingRendererSender(
      eventFor(wrong), null, () => true, targets.coin, omniTargets,
    ), /non-live Trench/);
  }
});
