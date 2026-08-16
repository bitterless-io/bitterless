import type {
  MonitoringAnomalyFilterState,
  MonitoringAnomalyListInput,
  MonitoringIdentityInput,
  MonitoringListInput,
  MonitoringRevisionInput,
  MonitoringSampleListInput,
  MonitoringSaveInput
} from '@shared/monitoring/monitoringBridge.type';
import { assertSafeSnipingFreeText } from '../sniping/snipingRequest.validation';

const CONFIG_ID = /^[1-9]\d{0,18}$/;
const BUCKET_SEQUENCE = /^(0|[1-9]\d{0,18})$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const ANOMALY_STATES = new Set<MonitoringAnomalyFilterState>([
  'WARMING',
  'BASELINE_FLAT',
  'HIGH',
  'LOW',
  'INCOMPLETE_RANGE',
  'REGION_MISMATCH',
  'SINGLE_REGION'
]);

export class MonitoringInputError extends Error {
  readonly code = 'MONITORING_BRIDGE_INPUT_INVALID';
}

const object = (
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = []
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MonitoringInputError();
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new MonitoringInputError();
  const row = value as Record<string, unknown>;
  const allowedSet = new Set(allowed);
  if (
    Object.keys(row).some((key) => !allowedSet.has(key)) ||
    required.some((key) => !(key in row))
  ) {
    throw new MonitoringInputError();
  }
  return row;
};

const integer = (value: unknown, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new MonitoringInputError();
  }
  return Number(value);
};

const configId = (value: unknown): string => {
  if (typeof value !== 'string' || !CONFIG_ID.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new MonitoringInputError();
  }
  return value;
};

const bucketSequence = (value: unknown): string => {
  if (typeof value !== 'string' || !BUCKET_SEQUENCE.test(value) || BigInt(value) > MAX_BIGINT) {
    throw new MonitoringInputError();
  }
  return value;
};

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const text = (value: unknown, maximum: number): string => {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length < 1 ||
    [...value].length > maximum ||
    hasControlCharacter(value) ||
    /(?:^|[\s=])(\.\.?\/|\/[^\s]+|[A-Za-z]:\\)[^\s]*/.test(value) ||
    /\b(?:select\s+.+\s+from|drop\s+table|delete\s+from|insert\s+into|update\s+\S+\s+set)\b/i.test(
      value
    )
  ) {
    throw new MonitoringInputError();
  }
  try {
    assertSafeSnipingFreeText(value);
  } catch {
    throw new MonitoringInputError();
  }
  return value;
};

export const parseMonitoringListInput = (value: unknown): MonitoringListInput => {
  const row = object(value, ['page', 'page_size', 'search_text']);
  return {
    ...(row.page === undefined ? {} : { page: integer(row.page, 1, 1_000_000) }),
    ...(row.page_size === undefined ? {} : { page_size: integer(row.page_size, 1, 100) }),
    ...(row.search_text === undefined ? {} : { search_text: text(row.search_text, 128) })
  };
};

export const parseMonitoringIdentityInput = (value: unknown): MonitoringIdentityInput => {
  const row = object(value, ['config_id'], ['config_id']);
  return { config_id: configId(row.config_id) };
};

export const parseMonitoringSaveInput = (value: unknown): MonitoringSaveInput => {
  const row = object(
    value,
    ['config_id', 'name', 'token_address', 'zscore_threshold', 'expected_revision'],
    ['token_address', 'zscore_threshold', 'expected_revision']
  );
  const id = row.config_id === undefined ? undefined : configId(row.config_id);
  const revision = integer(row.expected_revision, 0, 2_147_483_647);
  if (
    (!id && revision !== 0) ||
    (id && revision < 1) ||
    typeof row.token_address !== 'string' ||
    !ADDRESS.test(row.token_address) ||
    row.token_address === '0x0000000000000000000000000000000000000000' ||
    typeof row.zscore_threshold !== 'number' ||
    !Number.isFinite(row.zscore_threshold) ||
    row.zscore_threshold < 2 ||
    row.zscore_threshold > 10 ||
    Number(row.zscore_threshold.toFixed(2)) !== row.zscore_threshold
  ) {
    throw new MonitoringInputError();
  }
  return {
    ...(id ? { config_id: id } : {}),
    ...(row.name === undefined ? {} : { name: text(row.name, 128) }),
    token_address: row.token_address,
    zscore_threshold: row.zscore_threshold,
    expected_revision: revision
  };
};

export const parseMonitoringRevisionInput = (value: unknown): MonitoringRevisionInput => {
  const row = object(value, ['config_id', 'expected_revision'], ['config_id', 'expected_revision']);
  return {
    config_id: configId(row.config_id),
    expected_revision: integer(row.expected_revision, 1, 2_147_483_647)
  };
};

export const parseMonitoringSampleListInput = (value: unknown): MonitoringSampleListInput => {
  const row = object(
    value,
    ['config_id', 'config_revision', 'before_bucket_sequence', 'page_size'],
    ['config_id', 'config_revision']
  );
  return {
    config_id: configId(row.config_id),
    config_revision: integer(row.config_revision, 1, 2_147_483_647),
    ...(row.before_bucket_sequence === undefined
      ? {}
      : { before_bucket_sequence: bucketSequence(row.before_bucket_sequence) }),
    ...(row.page_size === undefined ? {} : { page_size: integer(row.page_size, 1, 250) })
  };
};

export const parseMonitoringAnomalyListInput = (value: unknown): MonitoringAnomalyListInput => {
  const row = object(value, ['config_id', 'states', 'cursor', 'page_size']);
  let states: MonitoringAnomalyFilterState[] | undefined;
  if (row.states !== undefined) {
    if (
      !Array.isArray(row.states) ||
      row.states.length < 1 ||
      row.states.length > 7 ||
      row.states.some((state) => !ANOMALY_STATES.has(state as MonitoringAnomalyFilterState)) ||
      new Set(row.states).size !== row.states.length
    )
      throw new MonitoringInputError();
    states = [...row.states] as MonitoringAnomalyFilterState[];
  }
  let cursor: MonitoringAnomalyListInput['cursor'];
  if (row.cursor !== undefined) {
    const valueRow = object(
      row.cursor,
      ['bucket_sequence', 'config_id', 'config_revision'],
      ['bucket_sequence', 'config_id', 'config_revision']
    );
    cursor = {
      bucket_sequence: bucketSequence(valueRow.bucket_sequence),
      config_id: configId(valueRow.config_id),
      config_revision: integer(valueRow.config_revision, 1, 2_147_483_647)
    };
  }
  return {
    ...(row.config_id === undefined ? {} : { config_id: configId(row.config_id) }),
    ...(states ? { states } : {}),
    ...(cursor ? { cursor } : {}),
    ...(row.page_size === undefined ? {} : { page_size: integer(row.page_size, 1, 100) })
  };
};
