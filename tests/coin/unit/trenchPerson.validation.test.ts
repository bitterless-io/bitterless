import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTrenchXHandle,
  parseTrenchPersonAttachWalletInput,
  parseTrenchPersonImportInput,
  parseTrenchPersonListInput,
  parseTrenchPersonUpdateProfileInput,
} from '../../../src/shared/trench/trenchPerson.validation';

const personId = '11111111-1111-4111-8111-111111111111';
const walletId = '22222222-2222-4222-8222-222222222222';

test('normalizes one leading X marker with NFC and ASCII lowercase only', () => {
  assert.equal(normalizeTrenchXHandle(' @Some_User '), 'some_user');
  assert.equal(normalizeTrenchXHandle('@@double'), null);
  assert.equal(normalizeTrenchXHandle('sixteen_characters'), null);
  assert.equal(normalizeTrenchXHandle('中文'), null);
});

test('person list and profile edits are exact, bounded, and preserve omitted fields', () => {
  assert.deepEqual(parseTrenchPersonListInput(undefined), { query: '', cursor: '', limit: 50 });
  assert.equal(parseTrenchPersonListInput({ query: ' Alice ', limit: 100 }).query, 'Alice');
  assert.throws(() => parseTrenchPersonListInput({ limit: 101 }), /limit/);
  assert.throws(() => parseTrenchPersonListInput({ extra: true }), /unknown field/);
  assert.deepEqual(parseTrenchPersonUpdateProfileInput({
    personId,
    expectedRevision: 2,
    displayName: ' Alice ',
    note: null,
  }), {
    personId,
    expectedRevision: 2,
    displayName: 'Alice',
    note: null,
  });
  assert.throws(() => parseTrenchPersonUpdateProfileInput({ personId, expectedRevision: 2 }),
    /At least one/);
  assert.throws(() => parseTrenchPersonUpdateProfileInput({
    personId,
    expectedRevision: 2,
    avatarUrl: 'http://example.com/avatar.png',
  }), /HTTPS/);
});

test('manual wallet attachment requires exact revision and current membership CAS', () => {
  assert.deepEqual(parseTrenchPersonAttachWalletInput({
    personId,
    walletId,
    expectedRevision: 4,
    expectedCurrentPersonId: null,
  }), { personId, walletId, expectedRevision: 4, expectedCurrentPersonId: null });
  assert.throws(() => parseTrenchPersonAttachWalletInput({
    personId,
    walletId,
    expectedRevision: 4,
  }), /expectedCurrentPersonId/);
});

test('person import requires an exact explicit bounded user chunk and UUIDv4 identities', () => {
  const input = {
    schema: 'bl-trench-person-import-v1',
    importId: '33333333-3333-4333-8333-333333333333',
    requestId: '44444444-4444-4444-8444-444444444444',
    sourceSha256: 'a'.repeat(64),
    contentSha256: 'b'.repeat(64),
    normalizationVersion: 'trench-person-import-v1',
    chain: 'bsc',
    walletKind: 'user',
    chunkIndex: 0,
    chunkCount: 1,
    chunkHash: 'c'.repeat(64),
    rowCount: 1,
    rows: [{
      address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      name: 'Imported',
      displayEmoji: null,
    }],
    finalize: true,
  };
  const parsed = parseTrenchPersonImportInput(input);
  assert.equal(parsed.rows[0]?.address, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(parsed.walletKind, 'user');
  assert.throws(() => parseTrenchPersonImportInput({ ...input, chain: undefined }), /chain/);
  assert.throws(() => parseTrenchPersonImportInput({ ...input, walletKind: 'amm' }), /wallet kind/);
  assert.throws(() => parseTrenchPersonImportInput({ ...input, path: '/tmp/source.json' }), /unknown field/);
  assert.throws(() => parseTrenchPersonImportInput({ ...input, importId: 'not-v4' }), /UUID v4/);
  assert.throws(() => parseTrenchPersonImportInput({
    ...input,
    chunkCount: 2,
    chunkIndex: 0,
    finalize: true,
  }), /final chunk/);
  assert.throws(() => parseTrenchPersonImportInput({
    ...input,
    rows: Array.from({ length: 251 }, () => input.rows[0]),
  }), /1 to 250/);
});
