import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadMottoItems,
  MOTTO_STORAGE_KEY,
  MottoStorageError,
  parseMottoItems,
  persistMottoItems
} from '../../src/renderer/motto/src/store/mottoStorage.service.ts';

const expectStorageError = (code) => (error) =>
  error instanceof MottoStorageError && error.code === code;

test('a missing Motto storage key loads the explicit empty collection', () => {
  const reads = [];
  const storage = {
    getItem: (key) => {
      reads.push(key);
      return null;
    },
    setItem: () => assert.fail('load must not rewrite a missing key')
  };

  assert.deepEqual(loadMottoItems(storage), []);
  assert.deepEqual(reads, [MOTTO_STORAGE_KEY]);
});

test('valid Motto storage loads the ordered collection and trims every field', () => {
  const storage = {
    getItem: () =>
      JSON.stringify([
        { id: ' first ', title: ' Important ', subtitle: ' Keep going ' },
        { id: 'second', title: 'Rest', subtitle: 'Recovery matters' }
      ]),
    setItem: () => undefined
  };

  assert.deepEqual(loadMottoItems(storage), [
    { id: 'first', title: 'Important', subtitle: 'Keep going' },
    { id: 'second', title: 'Rest', subtitle: 'Recovery matters' }
  ]);
});

test('Motto storage loads and trims an optional empty subtitle', () => {
  const storage = {
    getItem: () => JSON.stringify([{ id: ' one ', title: ' Important ', subtitle: '   ' }]),
    setItem: () => undefined
  };

  assert.deepEqual(loadMottoItems(storage), [{ id: 'one', title: 'Important', subtitle: '' }]);
});

test('malformed JSON fails closed without rewriting the persisted payload', () => {
  let writes = 0;
  const storage = {
    getItem: () => '[not-json',
    setItem: () => {
      writes += 1;
    }
  };

  assert.throws(() => loadMottoItems(storage), expectStorageError('invalid-payload'));
  assert.equal(writes, 0);
});

test('duplicate IDs are rejected after trimming', () => {
  assert.throws(
    () =>
      parseMottoItems([
        { id: 'same', title: 'First', subtitle: 'One' },
        { id: ' same ', title: 'Second', subtitle: 'Two' }
      ]),
    expectStorageError('invalid-payload')
  );
});

test('invalid Motto item fields and extra fields are rejected', async (t) => {
  const invalidValues = [
    {},
    [{ id: 'a', title: '   ', subtitle: 'Subtitle' }],
    [{ id: 1, title: 'Title', subtitle: 'Subtitle' }],
    [{ id: 'a', title: 'Title', subtitle: null }],
    [{ id: 'a', title: 'Title', subtitle: 'Subtitle', extra: true }]
  ];

  for (const value of invalidValues) {
    await t.test(JSON.stringify(value), () => {
      assert.throws(() => parseMottoItems(value), expectStorageError('invalid-payload'));
    });
  }
});

test('storage read failures are typed and remain distinct from invalid payloads', () => {
  const storage = {
    getItem: () => {
      throw new Error('unavailable');
    },
    setItem: () => undefined
  };

  assert.throws(() => loadMottoItems(storage), expectStorageError('read-failed'));
});

test('every persistence operation writes one complete validated array', () => {
  const writes = [];
  const storage = {
    getItem: () => null,
    setItem: (key, value) => {
      writes.push({ key, value });
    }
  };
  const input = [
    { id: ' one ', title: ' First ', subtitle: '   ' },
    { id: 'two', title: 'Second', subtitle: 'Remember that' }
  ];

  const persisted = persistMottoItems(storage, input);

  assert.deepEqual(persisted, [
    { id: 'one', title: 'First', subtitle: '' },
    { id: 'two', title: 'Second', subtitle: 'Remember that' }
  ]);
  assert.deepEqual(writes, [
    {
      key: MOTTO_STORAGE_KEY,
      value: JSON.stringify(persisted)
    }
  ]);
  assert.deepEqual(input, [
    { id: ' one ', title: ' First ', subtitle: '   ' },
    { id: 'two', title: 'Second', subtitle: 'Remember that' }
  ]);
});

test('a failed whole-array write raises a typed error', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    }
  };

  assert.throws(
    () => persistMottoItems(storage, [{ id: 'one', title: 'First', subtitle: 'Remember this' }]),
    expectStorageError('write-failed')
  );
});
