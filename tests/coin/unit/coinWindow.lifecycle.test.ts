import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CoinWindowLifecycle,
  type CoinWindowPort,
} from '../../../src/main/coin/coinWindow.lifecycle';

interface FakeWindow {
  id: number;
  destroyed: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createFakePort = () => {
  let current: FakeWindow | null = null;
  let createCount = 0;
  let showCount = 0;
  let destroyCount = 0;
  const pendingCreate = deferred<FakeWindow>();
  const port: CoinWindowPort<FakeWindow> = {
    getCurrent: () => current,
    isDestroyed: (window) => window.destroyed,
    create: async (signal) => {
      createCount += 1;
      const window = { id: createCount, destroyed: false };
      current = window;
      signal.addEventListener(
        'abort',
        () => {
          window.destroyed = true;
          if (current === window) current = null;
          pendingCreate.reject(new Error('aborted'));
        },
        { once: true },
      );
      return await pendingCreate.promise;
    },
    showAndFocus: () => {
      showCount += 1;
    },
    destroy: async (window) => {
      if (window && !window.destroyed) {
        window.destroyed = true;
        destroyCount += 1;
      }
      if (current === window) current = null;
    },
  };
  return {
    port,
    pendingCreate,
    get current() {
      return current;
    },
    get createCount() {
      return createCount;
    },
    get showCount() {
      return showCount;
    },
    get destroyCount() {
      return destroyCount;
    },
  };
};

test('requires activation and shares one boot across repeated Open calls', async () => {
  const fake = createFakePort();
  const lifecycle = new CoinWindowLifecycle(fake.port);
  await assert.rejects(lifecycle.open(), /not authenticated/);

  await lifecycle.prepareForAuthenticatedSession();
  const firstOpen = lifecycle.open();
  await Promise.resolve();
  assert.equal(fake.createCount, 1);

  const repeatedOpen = lifecycle.open();
  let repeatedOpenSettled = false;
  void repeatedOpen.then(
    () => {
      repeatedOpenSettled = true;
    },
    () => {
      repeatedOpenSettled = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fake.createCount, 1);
  assert.equal(fake.showCount, 0);
  assert.equal(repeatedOpenSettled, false);

  const window = fake.current!;
  fake.pendingCreate.resolve(window);
  await Promise.all([firstOpen, repeatedOpen]);
  assert.equal(repeatedOpenSettled, true);
  assert.equal(fake.showCount, 2);

  await lifecycle.open();
  assert.equal(fake.createCount, 1);
  assert.equal(fake.showCount, 3);
});

test('auth invalidation aborts an active boot and locks later opens', async () => {
  const fake = createFakePort();
  const lifecycle = new CoinWindowLifecycle(fake.port);
  await lifecycle.prepareForAuthenticatedSession();

  const opening = lifecycle.open();
  await Promise.resolve();
  const cleanup = lifecycle.destroyForAuth();
  await assert.rejects(opening, /aborted/);
  await cleanup;
  assert.equal(fake.current, null);
  await assert.rejects(lifecycle.open(), /not authenticated/);
});

test('host cleanup destroys the live window and permanently blocks new opens', async () => {
  const fake = createFakePort();
  const lifecycle = new CoinWindowLifecycle(fake.port);
  await lifecycle.prepareForAuthenticatedSession();

  const opening = lifecycle.open();
  await Promise.resolve();
  const window = fake.current!;
  fake.pendingCreate.resolve(window);
  await opening;
  await lifecycle.destroyForHostQuit();

  assert.equal(fake.destroyCount, 1);
  assert.equal(fake.current, null);
  await assert.rejects(lifecycle.open(), /host cleanup has started/);
});
