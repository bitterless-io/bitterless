import {
  TRENCH_PERSON_IMPORT_MAX_CHUNKS,
  TRENCH_PERSON_IMPORT_MAX_ROWS_PER_CHUNK,
  TRENCH_PERSON_IMPORT_NORMALIZATION_VERSION,
  TRENCH_PERSON_IMPORT_SCHEMA,
  TRENCH_PERSON_DEFAULT_PAGE_SIZE,
  TRENCH_PERSON_MAX_PAGE_SIZE,
  type TrenchPersonAttachWalletInput,
  type TrenchPersonGetInput,
  type TrenchPersonImportInput,
  type TrenchPersonImportRow,
  type TrenchPersonListInput,
  type TrenchPersonUpdateProfileInput,
} from './trenchPerson.type';
import { canonicalizeTrenchAddress } from './trench.validation';
import { TRENCH_CHAINS, type TrenchChain } from './trench.type';

export interface TrenchNormalizedXIdentity {
  canonicalValue: string;
  displayValue: string;
}

export class TrenchPersonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrenchPersonValidationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new TrenchPersonValidationError(`${label} contains unknown field: ${unexpected}.`);
};

const uuid = (value: unknown, label: string): string => {
  if (typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TrenchPersonValidationError(`${label} must be a UUID v4.`);
  }
  return value.toLowerCase();
};

const revision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TrenchPersonValidationError('expectedRevision must be a non-negative safe integer.');
  }
  return value as number;
};

const sha256 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TrenchPersonValidationError(`${label} must be a lowercase SHA-256 hex digest.`);
  }
  return value;
};

const integer = (value: unknown, label: string, min: number, max: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new TrenchPersonValidationError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
};

const importText = (value: unknown, label: string, max: number): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || value !== value.normalize('NFC') || value !== value.trim() ||
    !value || Array.from(value).length > max || /[\0\r\n]/.test(value)) {
    throw new TrenchPersonValidationError(`${label} is invalid.`);
  }
  return value;
};

const nullableText = (
  value: unknown,
  label: string,
  max: number,
  allowNewline: boolean,
): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TrenchPersonValidationError(`${label} must be text or null.`);
  const text = value.trim();
  if (!text) return null;
  if (Array.from(text).length > max || text.includes('\0') || (!allowNewline && /[\r\n]/.test(text))) {
    throw new TrenchPersonValidationError(`${label} is invalid or too long.`);
  }
  return text;
};

const nullableHttpsUrl = (value: unknown): string | null => {
  const text = nullableText(value, 'avatarUrl', 2_048, false);
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid');
    return url.href;
  } catch {
    throw new TrenchPersonValidationError('avatarUrl must be a bounded HTTPS URL or null.');
  }
};

export const normalizeTrenchXHandle = (value: unknown): string | null => {
  const identity = normalizeTrenchXIdentity(value);
  return identity?.canonicalValue ?? null;
};

export const normalizeTrenchXIdentity = (value: unknown): TrenchNormalizedXIdentity | null => {
  if (typeof value !== 'string') return null;
  const displayValue = value.trim().normalize('NFC');
  const normalized = displayValue.replace(/^@/, '').replace(/[A-Z]/g, (letter) =>
    letter.toLowerCase());
  return /^[a-z0-9_]{1,15}$/.test(normalized)
    ? { canonicalValue: normalized, displayValue }
    : null;
};

export const parseTrenchPersonListInput = (value: unknown): Required<TrenchPersonListInput> => {
  const input = value === undefined ? {} : value;
  if (!isRecord(input)) throw new TrenchPersonValidationError('input must be an object.');
  exactKeys(input, ['query', 'cursor', 'limit'], 'input');
  const query = input.query === undefined ? '' : nullableText(input.query, 'query', 200, false) ?? '';
  const cursor = input.cursor === undefined ? '' : nullableText(input.cursor, 'cursor', 2_048, false) ?? '';
  const limit = input.limit === undefined ? TRENCH_PERSON_DEFAULT_PAGE_SIZE : input.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > TRENCH_PERSON_MAX_PAGE_SIZE) {
    throw new TrenchPersonValidationError(`limit must be an integer from 1 to ${TRENCH_PERSON_MAX_PAGE_SIZE}.`);
  }
  return { query, cursor, limit: limit as number };
};

export const parseTrenchPersonGetInput = (value: unknown): TrenchPersonGetInput => {
  if (!isRecord(value)) throw new TrenchPersonValidationError('input must be an object.');
  exactKeys(value, ['personId'], 'input');
  return { personId: uuid(value.personId, 'personId') };
};

export const parseTrenchPersonUpdateProfileInput = (
  value: unknown,
): TrenchPersonUpdateProfileInput => {
  if (!isRecord(value)) throw new TrenchPersonValidationError('input must be an object.');
  exactKeys(value, ['personId', 'expectedRevision', 'displayName', 'avatarUrl', 'note'], 'input');
  const hasDisplayName = Object.hasOwn(value, 'displayName');
  const hasAvatarUrl = Object.hasOwn(value, 'avatarUrl');
  const hasNote = Object.hasOwn(value, 'note');
  if (!hasDisplayName && !hasAvatarUrl && !hasNote) {
    throw new TrenchPersonValidationError('At least one profile field is required.');
  }
  return {
    personId: uuid(value.personId, 'personId'),
    expectedRevision: revision(value.expectedRevision),
    ...(hasDisplayName
      ? { displayName: nullableText(value.displayName, 'displayName', 200, false) }
      : {}),
    ...(hasAvatarUrl ? { avatarUrl: nullableHttpsUrl(value.avatarUrl) } : {}),
    ...(hasNote ? { note: nullableText(value.note, 'note', 2_000, true) } : {}),
  };
};

export const parseTrenchPersonAttachWalletInput = (
  value: unknown,
): TrenchPersonAttachWalletInput => {
  if (!isRecord(value)) throw new TrenchPersonValidationError('input must be an object.');
  exactKeys(value, ['personId', 'walletId', 'expectedRevision', 'expectedCurrentPersonId'], 'input');
  if (value.expectedCurrentPersonId !== null && typeof value.expectedCurrentPersonId !== 'string') {
    throw new TrenchPersonValidationError('expectedCurrentPersonId must be a UUID v4 or null.');
  }
  return {
    personId: uuid(value.personId, 'personId'),
    walletId: uuid(value.walletId, 'walletId'),
    expectedRevision: revision(value.expectedRevision),
    expectedCurrentPersonId: value.expectedCurrentPersonId === null
      ? null
      : uuid(value.expectedCurrentPersonId, 'expectedCurrentPersonId'),
  };
};

export const parseTrenchPersonImportInput = (value: unknown): TrenchPersonImportInput => {
  if (!isRecord(value)) throw new TrenchPersonValidationError('input must be an object.');
  exactKeys(value, [
    'schema', 'importId', 'requestId', 'sourceSha256', 'contentSha256',
    'normalizationVersion', 'chain', 'walletKind', 'chunkIndex', 'chunkCount', 'chunkHash',
    'rowCount', 'rows', 'finalize',
  ], 'input');
  if (value.schema !== TRENCH_PERSON_IMPORT_SCHEMA ||
    value.normalizationVersion !== TRENCH_PERSON_IMPORT_NORMALIZATION_VERSION ||
    value.walletKind !== 'user') {
    throw new TrenchPersonValidationError('import schema, normalization version, or wallet kind is invalid.');
  }
  if (typeof value.chain !== 'string' || !TRENCH_CHAINS.includes(value.chain as TrenchChain)) {
    throw new TrenchPersonValidationError('chain is invalid.');
  }
  const chain = value.chain as TrenchChain;
  const chunkCount = integer(value.chunkCount, 'chunkCount', 1, TRENCH_PERSON_IMPORT_MAX_CHUNKS);
  const chunkIndex = integer(value.chunkIndex, 'chunkIndex', 0, chunkCount - 1);
  const rowCount = integer(value.rowCount, 'rowCount', 1,
    TRENCH_PERSON_IMPORT_MAX_CHUNKS * TRENCH_PERSON_IMPORT_MAX_ROWS_PER_CHUNK);
  if (!Array.isArray(value.rows) || value.rows.length < 1 ||
    value.rows.length > TRENCH_PERSON_IMPORT_MAX_ROWS_PER_CHUNK) {
    throw new TrenchPersonValidationError(
      `rows must contain 1 to ${TRENCH_PERSON_IMPORT_MAX_ROWS_PER_CHUNK} items.`,
    );
  }
  const rows = value.rows.map((raw, index): TrenchPersonImportRow => {
    if (!isRecord(raw)) throw new TrenchPersonValidationError(`rows[${index}] must be an object.`);
    exactKeys(raw, ['address', 'name', 'displayEmoji'], `rows[${index}]`);
    let address: string;
    try {
      address = canonicalizeTrenchAddress(raw.address, chain, `rows[${index}].address`);
    } catch {
      throw new TrenchPersonValidationError(`rows[${index}].address is invalid.`);
    }
    return {
      address,
      name: importText(raw.name, `rows[${index}].name`, 200),
      displayEmoji: importText(raw.displayEmoji, `rows[${index}].displayEmoji`, 16),
    };
  });
  const importId = uuid(value.importId, 'importId');
  const requestId = uuid(value.requestId, 'requestId');
  if (typeof value.finalize !== 'boolean') {
    throw new TrenchPersonValidationError('finalize must be a boolean.');
  }
  if (value.finalize && chunkIndex !== chunkCount - 1) {
    throw new TrenchPersonValidationError('Only the final chunk may request finalization.');
  }
  return {
    schema: TRENCH_PERSON_IMPORT_SCHEMA,
    importId,
    requestId,
    sourceSha256: sha256(value.sourceSha256, 'sourceSha256'),
    contentSha256: sha256(value.contentSha256, 'contentSha256'),
    normalizationVersion: TRENCH_PERSON_IMPORT_NORMALIZATION_VERSION,
    chain,
    walletKind: 'user',
    chunkIndex,
    chunkCount,
    chunkHash: sha256(value.chunkHash, 'chunkHash'),
    rowCount,
    rows,
    finalize: value.finalize,
  };
};
