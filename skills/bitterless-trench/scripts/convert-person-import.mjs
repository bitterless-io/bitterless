#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';

const SCHEMA = 'bl-trench-person-import-v1';
const NORMALIZATION_VERSION = 'trench-person-import-v1';
const MAX_ROWS_PER_CHUNK = 250;
const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const fail = (message) => {
  process.stderr.write(`bitterless-trench person import: ${message}\n`);
  process.exitCode = 1;
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const stableUuidV4 = (label, value) => {
  const bytes = createHash('sha256').update(`${label}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const parseArguments = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--input', '--output', '--chain'].includes(key)) {
      throw new Error(`unknown argument: ${key ?? ''}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || values.has(key)) {
      throw new Error(`${key} must be supplied exactly once`);
    }
    values.set(key, value);
    index += 1;
  }
  for (const key of ['--input', '--output', '--chain']) {
    if (!values.has(key)) throw new Error(`${key} is required`);
  }
  const chain = values.get('--chain');
  if (!['bsc', 'solana', 'robinhood'].includes(chain)) {
    throw new Error('--chain must be bsc, solana, or robinhood');
  }
  return {
    inputPath: resolve(values.get('--input')),
    outputPath: resolve(values.get('--output')),
    chain,
  };
};

const normalizeOptional = (value, label, max) => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.normalize('NFC').trim();
  if (!normalized) return null;
  if (Array.from(normalized).length > max || /[\0\r\n]/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
};

const decodeBase58 = (value) => {
  let numericValue = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error('Solana address contains a non-Base58 character');
    numericValue = numericValue * 58n + BigInt(digit);
  }
  const payload = [];
  while (numericValue > 0n) {
    payload.push(Number(numericValue & 0xffn));
    numericValue >>= 8n;
  }
  payload.reverse();
  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === '1') leadingZeros += 1;
  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(payload)]);
};

const encodeBase58 = (bytes) => {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  let numericValue = 0n;
  for (const byte of bytes) numericValue = (numericValue << 8n) + BigInt(byte);
  let encoded = '';
  while (numericValue > 0n) {
    encoded = BASE58_ALPHABET[Number(numericValue % 58n)] + encoded;
    numericValue /= 58n;
  }
  return `${'1'.repeat(leadingZeros)}${encoded}`;
};

const canonicalizeSolanaAddress = (value, index) => {
  if (!SOLANA.test(value)) throw new Error(`row ${index} address is invalid for solana`);
  const decoded = decodeBase58(value);
  if (decoded.length !== 32 || encodeBase58(decoded) !== value) {
    throw new Error(`row ${index} address is invalid for solana`);
  }
  return value;
};

const normalizeRow = (value, index, chain) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`row ${index} must be an object`);
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'address,emoji,rename') {
    throw new Error(`row ${index} must contain exactly address, rename, and emoji`);
  }
  if (typeof value.address !== 'string') throw new Error(`row ${index} address must be a string`);
  const address = value.address.normalize('NFC').trim();
  const canonicalAddress = chain === 'solana'
    ? canonicalizeSolanaAddress(address, index)
    : address.toLowerCase();
  if (chain !== 'solana' && !EVM.test(address)) {
    throw new Error(`row ${index} address is invalid for ${chain}`);
  }
  return {
    address: canonicalAddress,
    name: normalizeOptional(value.rename, `row ${index} rename`, 200),
    displayEmoji: normalizeOptional(value.emoji, `row ${index} emoji`, 16),
  };
};

const prepareOutput = (outputPath) => {
  mkdirSync(outputPath, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(outputPath, 0o700);
  if (readdirSync(outputPath).length !== 0) {
    throw new Error('--output must be an empty directory');
  }
};

const main = () => {
  const { inputPath, outputPath, chain } = parseArguments(process.argv.slice(2));
  const sourceBytes = readFileSync(inputPath);
  const sourceText = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  let source;
  try {
    source = JSON.parse(sourceText);
  } catch {
    throw new Error('input must be valid JSON');
  }
  if (!Array.isArray(source) || source.length < 1) {
    throw new Error('input must be a non-empty JSON array');
  }
  const normalized = source.map((row, index) => normalizeRow(row, index, chain));
  const byAddress = new Map();
  let collapsedDuplicates = 0;
  for (const row of normalized) {
    const prior = byAddress.get(row.address);
    if (!prior) {
      byAddress.set(row.address, row);
      continue;
    }
    if (prior.name !== row.name || prior.displayEmoji !== row.displayEmoji) {
      throw new Error('duplicate address has conflicting name or emoji');
    }
    collapsedDuplicates += 1;
  }
  const rows = [...byAddress.values()].sort((left, right) =>
    left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
  const sourceSha256 = sha256(sourceBytes);
  const contentSha256 = sha256(JSON.stringify(rows));
  const stableIdentity = `${NORMALIZATION_VERSION}:${chain}:${sourceSha256}:${contentSha256}`;
  const importId = stableUuidV4('import', stableIdentity);
  const requestId = stableUuidV4('request', stableIdentity);
  const chunks = Array.from(
    { length: Math.ceil(rows.length / MAX_ROWS_PER_CHUNK) },
    (_, index) => rows.slice(index * MAX_ROWS_PER_CHUNK, (index + 1) * MAX_ROWS_PER_CHUNK),
  );
  prepareOutput(outputPath);
  for (const [chunkIndex, chunkRows] of chunks.entries()) {
    const chunkHash = sha256(JSON.stringify(chunkRows));
    const call = {
      schema: SCHEMA,
      importId,
      requestId,
      sourceSha256,
      contentSha256,
      normalizationVersion: NORMALIZATION_VERSION,
      chain,
      walletKind: 'user',
      chunkIndex,
      chunkCount: chunks.length,
      chunkHash,
      rowCount: rows.length,
      rows: chunkRows,
      finalize: chunkIndex === chunks.length - 1,
    };
    writeFileSync(
      resolve(outputPath, `chunk-${String(chunkIndex).padStart(5, '0')}.json`),
      `${JSON.stringify(call)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
  }
  const manifest = {
    schema: 'bl-trench-person-import-conversion-v1',
    normalizationVersion: NORMALIZATION_VERSION,
    chain,
    walletKind: 'user',
    importId,
    requestId,
    sourceSha256,
    contentSha256,
    inputRowCount: source.length,
    rowCount: rows.length,
    collapsedDuplicates,
    chunkCount: chunks.length,
    namedRowCount: rows.filter(({ name }) => name !== null).length,
    displayEmojiRowCount: rows.filter(({ displayEmoji }) => displayEmoji !== null).length,
  };
  writeFileSync(resolve(outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : 'conversion failed');
}
