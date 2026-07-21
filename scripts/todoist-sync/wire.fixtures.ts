export const TODOIST_SYNC_WIRE_IDS = {
  domain: '00000000004194373632',
  todo: '00000000004194373633',
  subTodo: '00000000004194373634',
} as const;

export const TODOIST_SYNC_WIRE_UUIDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000009',
] as const;

const version = {
  client_updated_at: 1_704_067_201_000,
  client_sequence: 1,
  base_revision: '0',
} as const;

export const TODOIST_SYNC_WIRE_REQUEST_FIXTURE = {
  sync_token: '*',
  commands: [
    { uuid: TODOIST_SYNC_WIRE_UUIDS[0], type: 'domain_add', args: { id: TODOIST_SYNC_WIRE_IDS.domain, title: 'Work', ...version } },
    { uuid: TODOIST_SYNC_WIRE_UUIDS[1], type: 'domain_update', args: { id: TODOIST_SYNC_WIRE_IDS.domain, description: 'Notes', ...version } },
    { uuid: TODOIST_SYNC_WIRE_UUIDS[2], type: 'domain_delete', args: { id: TODOIST_SYNC_WIRE_IDS.domain, ...version } },
    { uuid: TODOIST_SYNC_WIRE_UUIDS[3], type: 'todo_add', args: { id: TODOIST_SYNC_WIRE_IDS.todo, domain_id: TODOIST_SYNC_WIRE_IDS.domain, title: 'Task', ...version } },
    {
      uuid: TODOIST_SYNC_WIRE_UUIDS[4],
      type: 'todo_update',
      args: {
        id: TODOIST_SYNC_WIRE_IDS.todo,
        due_at: null,
        repeat_type: null,
        remind_at: null,
        last_remind_at: null,
        last_complete_at: null,
        week_day: null,
        monthly_day: null,
        yearly_day: null,
        ...version,
      },
    },
    { uuid: TODOIST_SYNC_WIRE_UUIDS[5], type: 'todo_delete', args: { id: TODOIST_SYNC_WIRE_IDS.todo, ...version } },
    { uuid: TODOIST_SYNC_WIRE_UUIDS[6], type: 'sub_todo_add', args: { id: TODOIST_SYNC_WIRE_IDS.subTodo, todo_id: TODOIST_SYNC_WIRE_IDS.todo, title: 'Step', ...version } },
    { uuid: TODOIST_SYNC_WIRE_UUIDS[7], type: 'sub_todo_update', args: { id: TODOIST_SYNC_WIRE_IDS.subTodo, status: 1, ...version } },
    { uuid: TODOIST_SYNC_WIRE_UUIDS[8], type: 'sub_todo_delete', args: { id: TODOIST_SYNC_WIRE_IDS.subTodo, ...version } },
  ],
} as const;

const resourceBase = {
  created_at: 1_704_067_201_000,
  client_updated_at: 1_704_067_201_000,
  version_device_id: 'wire-fixture-device',
  version_client_sequence: 1,
  deleted_flag: '',
  deleted_at: null,
} as const;

export const TODOIST_SYNC_HTTP_OK_FIXTURE = {
  sync_token: 'fixture-token-v1',
  full_sync: false,
  sync_phase: 'incremental',
  has_more: false,
  server_time_ms: 1_704_067_201_123,
  snowflake_node_id: 17,
  sync_status: {
    [TODOIST_SYNC_WIRE_UUIDS[0]]: {
      status: 'ok',
      applied: true,
      sync_revision: '42',
      canonical_resource: { resource_type: 'todo_domain', id: TODOIST_SYNC_WIRE_IDS.domain },
    },
    [TODOIST_SYNC_WIRE_UUIDS[1]]: {
      status: 'error',
      error_code: 'RESOURCE_NOT_FOUND',
      error: 'Resource was not found',
      sync_revision: null,
      canonical_resource: null,
    },
  },
  todo_domains: [{
    ...resourceBase,
    id: TODOIST_SYNC_WIRE_IDS.domain,
    version_command_uuid: TODOIST_SYNC_WIRE_UUIDS[0],
    sync_revision: '42',
    title: 'Work',
    description: 'Notes',
    archived: 0,
    position: 0,
  }],
  todos: [{
    ...resourceBase,
    id: TODOIST_SYNC_WIRE_IDS.todo,
    version_command_uuid: TODOIST_SYNC_WIRE_UUIDS[3],
    sync_revision: '43',
    domain_id: TODOIST_SYNC_WIRE_IDS.domain,
    title: 'Task',
    status: 0,
    important: 0,
    due_at: null,
    repeat_type: null,
    repeat_interval: 1,
    remind_at: null,
    last_remind_at: null,
    last_complete_at: null,
    week_day: null,
    monthly_day: null,
    yearly_day: null,
    note: '',
    source: 'human',
    position: 0,
  }],
  sub_todos: [{
    ...resourceBase,
    id: TODOIST_SYNC_WIRE_IDS.subTodo,
    version_command_uuid: TODOIST_SYNC_WIRE_UUIDS[6],
    sync_revision: '44',
    todo_id: TODOIST_SYNC_WIRE_IDS.todo,
    title: 'Step',
    status: 0,
    position: 0,
  }],
} as const;

export const TODOIST_SYNC_HTTP_ERROR_FIXTURES = {
  requestInvalid: {
    statusCode: 400,
    code: 'REQUEST_INVALID',
    message: 'Todo sync request is invalid',
    server_time_ms: 1_704_067_201_123,
  },
  clockSkew: {
    statusCode: 409,
    code: 'CLOCK_SKEW',
    message: 'A command timestamp is more than 180000 ms ahead of Core time',
    server_time_ms: 1_704_067_201_123,
    max_future_ms: 180_000,
  },
  unavailable: {
    statusCode: 503,
    code: 'TODO_SYNC_UNAVAILABLE',
    message: 'Todo sync is temporarily unavailable',
    server_time_ms: 1_704_067_201_123,
  },
} as const;
