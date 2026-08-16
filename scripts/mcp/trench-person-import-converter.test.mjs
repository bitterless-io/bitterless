import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const converter = resolve(root, 'skills/bitterless-trench/scripts/convert-person-import.mjs');
const suppliedFixture = '/Users/ral/Downloads/message.txt';

const run = (input, output, chain = 'bsc') => JSON.parse(execFileSync(
  process.execPath,
  [converter, '--input', input, '--output', output, '--chain', chain],
  { encoding: 'utf8' },
));

test('person converter normalizes, deduplicates, hashes, chunks, and is stable without stdout rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trench-person-converter-'));
  try {
    const input = join(directory, 'source.json');
    const firstOutput = join(directory, 'first');
    const secondOutput = join(directory, 'second');
    writeFileSync(input, JSON.stringify([
      { address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', rename: ' A\u0301lice ', emoji: ' 🧭 ' },
      { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', rename: 'Álice', emoji: '🧭' },
      { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', rename: '', emoji: '' },
    ]));
    const first = run(input, firstOutput);
    const second = run(input, secondOutput);
    assert.deepEqual(first, second);
    assert.deepEqual({
      rowCount: first.rowCount,
      collapsedDuplicates: first.collapsedDuplicates,
      chunkCount: first.chunkCount,
      namedRowCount: first.namedRowCount,
      displayEmojiRowCount: first.displayEmojiRowCount,
    }, {
      rowCount: 2,
      collapsedDuplicates: 1,
      chunkCount: 1,
      namedRowCount: 1,
      displayEmojiRowCount: 1,
    });
    assert.match(first.importId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.doesNotMatch(JSON.stringify(first), /0x[a-f0-9]{40}|Alice|Álice|🧭/i);
    const call = JSON.parse(readFileSync(join(firstOutput, 'chunk-00000.json'), 'utf8'));
    assert.equal(call.finalize, true);
    assert.equal(call.rows[0].address, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(call.rows[0].name, 'Álice');
    assert.equal(call.rows[1].name, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('person converter rejects unknown fields, conflicting duplicates, wrong chains, and nonempty output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trench-person-converter-invalid-'));
  let fixtureIndex = 0;
  const attempt = (source, chain = 'bsc') => {
    fixtureIndex += 1;
    const input = join(directory, `${fixtureIndex}.json`);
    const output = join(directory, `${fixtureIndex}-output`);
    writeFileSync(input, JSON.stringify(source));
    return spawnSync(process.execPath, [
      converter, '--input', input, '--output', output, '--chain', chain,
    ], { encoding: 'utf8' });
  };
  try {
    assert.notEqual(attempt([{ address: '0x' + '1'.repeat(40), rename: '', emoji: '', note: '' }]).status, 0);
    assert.notEqual(attempt([
      { address: '0x' + '2'.repeat(40), rename: 'one', emoji: '' },
      { address: '0x' + '2'.repeat(40), rename: 'two', emoji: '' },
    ]).status, 0);
    assert.notEqual(attempt([
      { address: 'So11111111111111111111111111111111111111112', rename: '', emoji: '' },
    ], 'bsc').status, 0);
    assert.notEqual(attempt([
      { address: '0x' + '3'.repeat(40), rename: 3, emoji: '' },
    ]).status, 0);
    assert.notEqual(attempt([
      { address: '0x' + '4'.repeat(40), rename: 'x'.repeat(201), emoji: '' },
    ]).status, 0);

    const invalidUtf8 = join(directory, 'invalid-utf8.json');
    writeFileSync(invalidUtf8, Buffer.from([0xff, 0xfe, 0xfd]));
    const invalidUtf8Result = spawnSync(process.execPath, [
      converter, '--input', invalidUtf8, '--output', join(directory, 'invalid-utf8-output'),
      '--chain', 'bsc',
    ], { encoding: 'utf8' });
    assert.notEqual(invalidUtf8Result.status, 0);

    const occupiedInput = join(directory, 'occupied-source.json');
    const occupiedOutput = join(directory, 'occupied-output');
    writeFileSync(occupiedInput, JSON.stringify([
      { address: '0x' + '5'.repeat(40), rename: '', emoji: '' },
    ]));
    const occupied = run(occupiedInput, occupiedOutput);
    assert.equal(occupied.rowCount, 1);
    const occupiedResult = spawnSync(process.execPath, [
      converter, '--input', occupiedInput, '--output', occupiedOutput, '--chain', 'bsc',
    ], { encoding: 'utf8' });
    assert.notEqual(occupiedResult.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('person converter requires a canonical Base58 encoding of exactly 32 Solana bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trench-person-converter-solana-'));
  try {
    const input = join(directory, 'valid.json');
    const output = join(directory, 'valid-output');
    const addresses = ['1'.repeat(32), 'So11111111111111111111111111111111111111112'];
    writeFileSync(input, JSON.stringify(addresses.map((address) => ({
      address,
      rename: '',
      emoji: '',
    }))));
    const manifest = run(input, output, 'solana');
    assert.equal(manifest.rowCount, 2);
    const call = JSON.parse(readFileSync(join(output, 'chunk-00000.json'), 'utf8'));
    assert.deepEqual(call.rows.map(({ address }) => address), addresses);

    for (const [index, address] of [
      '1'.repeat(31),
      '1'.repeat(33),
      'z'.repeat(44),
    ].entries()) {
      const invalidInput = join(directory, `invalid-${index}.json`);
      writeFileSync(invalidInput, JSON.stringify([{ address, rename: '', emoji: '' }]));
      const result = spawnSync(process.execPath, [
        converter,
        '--input', invalidInput,
        '--output', join(directory, `invalid-${index}-output`),
        '--chain', 'solana',
      ], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${address} must not be emitted as a Solana address`);
      assert.match(result.stderr, /address is invalid for solana/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('supplied read-only aggregate fixture converts to the documented bounded receipt without leaking rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trench-person-converter-supplied-'));
  try {
    const manifest = run(suppliedFixture, join(directory, 'chunks'));
    assert.deepEqual({
      chain: manifest.chain,
      rowCount: manifest.rowCount,
      chunkCount: manifest.chunkCount,
      namedRowCount: manifest.namedRowCount,
      displayEmojiRowCount: manifest.displayEmojiRowCount,
    }, {
      chain: 'bsc',
      rowCount: 3_120,
      chunkCount: 13,
      namedRowCount: 3_120,
      displayEmojiRowCount: 0,
    });
    assert.doesNotMatch(JSON.stringify(manifest), /0x[0-9a-f]{40}/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
