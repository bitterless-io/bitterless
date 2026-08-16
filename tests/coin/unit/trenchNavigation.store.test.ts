import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTrenchNavigationMenuItemHandler,
  TRENCH_NAVIGATION_KEYS,
  TrenchNavigationStore,
} from '../../../src/renderer/coin/src/views/navigation/trenchNavigation.store';

test('Trench navigation owns INDEX, Trenchers and Sniping scopes without a call boundary', () => {
  const store = new TrenchNavigationStore();
  assert.deepEqual(TRENCH_NAVIGATION_KEYS, [
    'index:solana',
    'index:bsc',
    'index:robinhood',
    'trenchers:all',
    'sniping:products',
    'sniping:activity',
  ]);
  assert.equal(store.module, 'index');
  assert.equal(store.selectedChain, 'solana');

  store.select('index:bsc');
  assert.equal(store.module, 'index');
  assert.equal(store.selectedChain, 'bsc');

  store.select('index:robinhood');
  assert.equal(store.selectedChain, 'robinhood');

  store.select('trenchers:all');
  assert.equal(store.module, 'trenchers');

  store.select('sniping:products');
  assert.equal(store.module, 'sniping');
  assert.equal(store.snipingScope, 'products');

  store.select('sniping:activity');
  assert.equal(store.module, 'sniping');
  assert.equal(store.snipingScope, 'activity');

  store.select('unsupported');
  assert.equal(store.selectedKey, 'sniping:activity');
});

test('Arco menu event dispatch retains the navigation receiver for every non-default route', () => {
  const store = new TrenchNavigationStore();
  const componentEventHandler = createTrenchNavigationMenuItemHandler(store);
  const dispatchDetached = componentEventHandler;

  Reflect.apply(dispatchDetached, undefined, ['index:bsc']);
  assert.equal(store.selectedChain, 'bsc');

  Reflect.apply(dispatchDetached, undefined, ['index:robinhood']);
  assert.equal(store.selectedChain, 'robinhood');

  Reflect.apply(dispatchDetached, undefined, ['trenchers:all']);
  assert.equal(store.module, 'trenchers');

  Reflect.apply(dispatchDetached, undefined, ['sniping:products']);
  assert.equal(store.module, 'sniping');
  assert.equal(store.snipingScope, 'products');

  Reflect.apply(dispatchDetached, undefined, ['sniping:activity']);
  assert.equal(store.snipingScope, 'activity');
});
