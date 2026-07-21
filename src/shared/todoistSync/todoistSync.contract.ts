import type {
  TodoistSyncCanonicalReference,
  TodoistSyncCommandStatus,
  TodoistSyncDomainResource,
  TodoistSyncRequestError,
  TodoistSyncResourceBase,
  TodoistSyncResponse,
  TodoistSyncSubTodoResource,
  TodoistSyncTodoResource,
} from './todoistSync.type';

export const TODOIST_SYNC_PATH = '/todo/sync';
export const TODOIST_SYNC_TOKEN_HEADER = '-x-bl-token';
export const TODOIST_SYNC_MAX_COMMANDS = 100;
export const TODOIST_SYNC_MAX_FUTURE_MS = 180_000;
export const TODOIST_SYNC_INTERVAL_MIN_SECONDS = 10;
export const TODOIST_SYNC_INTERVAL_MAX_SECONDS = 180;
export const TODOIST_SYNC_ENTITY_ID_PATTERN = /^\d{20}$/;
export const TODOIST_SYNC_REVISION_PATTERN = /^(0|[1-9]\d*)$/;
export const TODOIST_SYNC_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertExactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${label}.${key} is required`);
  }
};

const assertInteger = (value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be a safe integer from ${minimum} to ${maximum}`);
  }
  return value as number;
};

const assertText = (value: unknown, label: string, maximum = 100_000): string => {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`${label} must be a string no longer than ${maximum}`);
  }
  return value;
};

const assertId = (value: unknown, label: string): string => {
  const text = assertText(value, label, 20);
  if (!TODOIST_SYNC_ENTITY_ID_PATTERN.test(text)) throw new Error(`${label} is not a 20-digit ID`);
  return text;
};

const assertRevision = (value: unknown, label: string): string => {
  const text = assertText(value, label, 19);
  if (!TODOIST_SYNC_REVISION_PATTERN.test(text) || BigInt(text) > 9223372036854775807n) {
    throw new Error(`${label} is not a canonical revision`);
  }
  return text;
};

const parseReference = (value: unknown, label: string): TodoistSyncCanonicalReference => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ['resource_type', 'id'], label);
  if (!['todo_domain', 'todo', 'sub_todo'].includes(String(value.resource_type))) {
    throw new Error(`${label}.resource_type is invalid`);
  }
  return {
    resource_type: value.resource_type as TodoistSyncCanonicalReference['resource_type'],
    id: assertId(value.id, `${label}.id`),
  };
};

const parseBase = (value: Record<string, unknown>, label: string): TodoistSyncResourceBase => ({
  id: assertId(value.id, `${label}.id`),
  created_at: assertInteger(value.created_at, `${label}.created_at`),
  client_updated_at: assertInteger(value.client_updated_at, `${label}.client_updated_at`),
  version_device_id: assertText(value.version_device_id, `${label}.version_device_id`, 64),
  version_client_sequence: assertInteger(value.version_client_sequence, `${label}.version_client_sequence`, 1, 2147483647),
  version_command_uuid: (() => {
    const uuid = assertText(value.version_command_uuid, `${label}.version_command_uuid`, 36);
    if (!TODOIST_SYNC_UUID_V4_PATTERN.test(uuid)) throw new Error(`${label}.version_command_uuid is invalid`);
    return uuid.toLowerCase();
  })(),
  sync_revision: assertRevision(value.sync_revision, `${label}.sync_revision`),
  deleted_flag: assertText(value.deleted_flag, `${label}.deleted_flag`, 64),
  deleted_at: value.deleted_at === null ? null : assertInteger(value.deleted_at, `${label}.deleted_at`),
});

const BASE_KEYS = ['id', 'created_at', 'client_updated_at', 'version_device_id', 'version_client_sequence', 'version_command_uuid', 'sync_revision', 'deleted_flag', 'deleted_at'] as const;
const assertFlag = (value: unknown, label: string): 0 | 1 => {
  if (value !== 0 && value !== 1) throw new Error(`${label} must be 0 or 1`);
  return value;
};
const nullableTime = (value: unknown, label: string): number | null => value === null ? null : assertInteger(value, label);

const parseDomain = (value: unknown, index: number): TodoistSyncDomainResource => {
  const label = `todo_domains[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, [...BASE_KEYS, 'title', 'description', 'archived', 'position'], label);
  return {
    ...parseBase(value, label),
    title: assertText(value.title, `${label}.title`, 512),
    description: assertText(value.description, `${label}.description`, 10_000),
    archived: assertFlag(value.archived, `${label}.archived`),
    position: assertInteger(value.position, `${label}.position`, -2147483648, 2147483647),
  };
};

const parseTodo = (value: unknown, index: number): TodoistSyncTodoResource => {
  const label = `todos[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const keys = [...BASE_KEYS, 'domain_id', 'title', 'status', 'important', 'due_at', 'repeat_type', 'repeat_interval', 'remind_at', 'last_remind_at', 'last_complete_at', 'week_day', 'monthly_day', 'yearly_day', 'note', 'source', 'position'];
  assertExactKeys(value, keys, label);
  if (value.repeat_type !== null && !['daily', 'weekly', 'monthly', 'yearly'].includes(String(value.repeat_type))) throw new Error(`${label}.repeat_type is invalid`);
  if (value.source !== 'human' && value.source !== 'ai') throw new Error(`${label}.source is invalid`);
  return {
    ...parseBase(value, label),
    domain_id: assertId(value.domain_id, `${label}.domain_id`),
    title: assertText(value.title, `${label}.title`, 512),
    status: assertFlag(value.status, `${label}.status`),
    important: assertFlag(value.important, `${label}.important`),
    due_at: nullableTime(value.due_at, `${label}.due_at`),
    repeat_type: value.repeat_type as TodoistSyncTodoResource['repeat_type'],
    repeat_interval: assertInteger(value.repeat_interval, `${label}.repeat_interval`, 1, 2147483647),
    remind_at: nullableTime(value.remind_at, `${label}.remind_at`),
    last_remind_at: nullableTime(value.last_remind_at, `${label}.last_remind_at`),
    last_complete_at: nullableTime(value.last_complete_at, `${label}.last_complete_at`),
    week_day: value.week_day === null ? null : assertInteger(value.week_day, `${label}.week_day`, 1, 7),
    monthly_day: value.monthly_day === null ? null : assertInteger(value.monthly_day, `${label}.monthly_day`, 1, 31),
    yearly_day: value.yearly_day === null ? null : assertInteger(value.yearly_day, `${label}.yearly_day`, 1, 31),
    note: assertText(value.note, `${label}.note`, 50_000),
    source: value.source,
    position: assertInteger(value.position, `${label}.position`, -2147483648, 2147483647),
  };
};

const parseSubTodo = (value: unknown, index: number): TodoistSyncSubTodoResource => {
  const label = `sub_todos[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, [...BASE_KEYS, 'todo_id', 'title', 'status', 'position'], label);
  return {
    ...parseBase(value, label),
    todo_id: assertId(value.todo_id, `${label}.todo_id`),
    title: assertText(value.title, `${label}.title`, 512),
    status: assertFlag(value.status, `${label}.status`),
    position: assertInteger(value.position, `${label}.position`, -2147483648, 2147483647),
  };
};

const parseCommandStatus = (value: unknown, label: string): TodoistSyncCommandStatus => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (value.status === 'ok') {
    assertExactKeys(value, ['status', 'applied', 'sync_revision', 'canonical_resource'], label);
    if (typeof value.applied !== 'boolean') throw new Error(`${label}.applied must be boolean`);
    return { status: 'ok', applied: value.applied, sync_revision: assertRevision(value.sync_revision, `${label}.sync_revision`), canonical_resource: parseReference(value.canonical_resource, `${label}.canonical_resource`) };
  }
  if (value.status === 'error') {
    assertExactKeys(value, ['status', 'error_code', 'error', 'sync_revision', 'canonical_resource'], label);
    const bothNull = value.sync_revision === null && value.canonical_resource === null;
    const bothPresent = value.sync_revision !== null && value.canonical_resource !== null;
    if (!bothNull && !bothPresent) throw new Error(`${label} projection fields must both be null or present`);
    return { status: 'error', error_code: assertText(value.error_code, `${label}.error_code`, 64), error: assertText(value.error, `${label}.error`, 1000), sync_revision: bothNull ? null : assertRevision(value.sync_revision, `${label}.sync_revision`), canonical_resource: bothNull ? null : parseReference(value.canonical_resource, `${label}.canonical_resource`) };
  }
  throw new Error(`${label}.status is invalid`);
};

export const parseTodoistSyncResponse = (value: unknown, submittedUuids: readonly string[]): TodoistSyncResponse => {
  if (!isRecord(value)) throw new Error('Todo sync response must be an object');
  assertExactKeys(value, ['sync_token', 'full_sync', 'sync_phase', 'has_more', 'server_time_ms', 'snowflake_node_id', 'sync_status', 'todo_domains', 'todos', 'sub_todos'], 'response');
  if (typeof value.full_sync !== 'boolean' || typeof value.has_more !== 'boolean') throw new Error('response boolean fields are invalid');
  if (!['working_set', 'reconcile', 'incremental'].includes(String(value.sync_phase))) throw new Error('response.sync_phase is invalid');
  if (!isRecord(value.sync_status)) throw new Error('response.sync_status must be an object');
  const expected = new Set(submittedUuids.map((uuid) => uuid.toLowerCase()));
  const syncStatus: Record<string, TodoistSyncCommandStatus> = {};
  for (const [uuidValue, status] of Object.entries(value.sync_status)) {
    const uuid = uuidValue.toLowerCase();
    if (!TODOIST_SYNC_UUID_V4_PATTERN.test(uuid) || !expected.delete(uuid)) throw new Error(`response.sync_status has unexpected UUID ${uuidValue}`);
    syncStatus[uuid] = parseCommandStatus(status, `response.sync_status.${uuid}`);
  }
  if (expected.size !== 0) throw new Error('response.sync_status omitted submitted UUIDs');
  if (!Array.isArray(value.todo_domains) || !Array.isArray(value.todos) || !Array.isArray(value.sub_todos)) throw new Error('response resources must be arrays');
  if (value.todo_domains.length + value.todos.length + value.sub_todos.length > 500) throw new Error('response contains more than 500 resources');
  return {
    sync_token: assertText(value.sync_token, 'response.sync_token', 8192),
    full_sync: value.full_sync,
    sync_phase: value.sync_phase as TodoistSyncResponse['sync_phase'],
    has_more: value.has_more,
    server_time_ms: assertInteger(value.server_time_ms, 'response.server_time_ms'),
    snowflake_node_id: assertInteger(value.snowflake_node_id, 'response.snowflake_node_id', 0, 1023),
    sync_status: syncStatus,
    todo_domains: value.todo_domains.map(parseDomain),
    todos: value.todos.map(parseTodo),
    sub_todos: value.sub_todos.map(parseSubTodo),
  };
};

export const parseTodoistSyncRequestError = (value: unknown, statusCode: number): TodoistSyncRequestError => {
  if (!isRecord(value)) throw new Error('Todo sync error response must be an object');
  const allowed = ['statusCode', 'code', 'message', 'server_time_ms', ...(value.code === 'CLOCK_SKEW' ? ['max_future_ms'] : [])];
  assertExactKeys(value, allowed, 'error');
  if (value.statusCode !== statusCode || ![400, 409, 503].includes(statusCode)) throw new Error('error.statusCode does not match HTTP status');
  const codes = ['CLOCK_SKEW', 'SYNC_TOKEN_INVALID', 'REQUEST_INVALID', 'DEVICE_LIMIT_REACHED', 'TODO_SYNC_UNAVAILABLE'];
  if (!codes.includes(String(value.code))) throw new Error('error.code is invalid');
  if (value.code === 'CLOCK_SKEW' && value.max_future_ms !== TODOIST_SYNC_MAX_FUTURE_MS) throw new Error('error.max_future_ms is invalid');
  return value as unknown as TodoistSyncRequestError;
};
