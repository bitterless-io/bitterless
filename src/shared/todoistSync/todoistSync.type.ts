export type TodoistSyncResourceType = 'todo_domain' | 'todo' | 'sub_todo';

export type TodoistSyncCommandType =
  | 'domain_add'
  | 'domain_update'
  | 'domain_delete'
  | 'todo_add'
  | 'todo_update'
  | 'todo_delete'
  | 'sub_todo_add'
  | 'sub_todo_update'
  | 'sub_todo_delete';

export type TodoistSyncOutboxState =
  | 'pending'
  | 'in_flight'
  | 'acknowledged_waiting_resource'
  | 'error_waiting_resource'
  | 'clock_rejected'
  | 'permanent_failed'
  | 'blocked_by_failed_dependency'
  | 'superseded'
  | 'discarded';

export interface TodoistSyncCommand {
  uuid: string;
  type: TodoistSyncCommandType;
  args: Record<string, unknown> & {
    id: string;
    client_updated_at: number;
    client_sequence: number;
    base_revision: string;
  };
}

export interface TodoistSyncRequest {
  sync_token: string;
  commands: TodoistSyncCommand[];
}

export interface TodoistSyncResourceBase {
  id: string;
  created_at: number;
  client_updated_at: number;
  version_device_id: string;
  version_client_sequence: number;
  version_command_uuid: string;
  sync_revision: string;
  deleted_flag: string;
  deleted_at: number | null;
}

export interface TodoistSyncDomainResource extends TodoistSyncResourceBase {
  title: string;
  description: string;
  archived: 0 | 1;
  position: number;
}

export interface TodoistSyncTodoResource extends TodoistSyncResourceBase {
  domain_id: string;
  title: string;
  status: 0 | 1;
  important: 0 | 1;
  due_at: number | null;
  repeat_type: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  repeat_interval: number;
  remind_at: number | null;
  last_remind_at: number | null;
  last_complete_at: number | null;
  week_day: number | null;
  monthly_day: number | null;
  yearly_day: number | null;
  note: string;
  source: 'human' | 'ai';
  position: number;
}

export interface TodoistSyncSubTodoResource extends TodoistSyncResourceBase {
  todo_id: string;
  title: string;
  status: 0 | 1;
  position: number;
}

export interface TodoistSyncCanonicalReference {
  resource_type: TodoistSyncResourceType;
  id: string;
}

export type TodoistSyncCommandStatus =
  | {
      status: 'ok';
      applied: boolean;
      sync_revision: string;
      canonical_resource: TodoistSyncCanonicalReference;
    }
  | {
      status: 'error';
      error_code: TodoistSyncCommandErrorCode;
      error: string;
      sync_revision: string | null;
      canonical_resource: TodoistSyncCanonicalReference | null;
    };

export type TodoistSyncCommandErrorCode =
  | 'RESOURCE_ALREADY_EXISTS'
  | 'RESOURCE_DELETED'
  | 'RESOURCE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_DELETED'
  | 'SNOWFLAKE_NODE_MISMATCH'
  | 'COMMAND_UUID_REUSED'
  | 'COMMAND_UUID_DEVICE_MISMATCH';

export interface TodoistSyncResponse {
  sync_token: string;
  full_sync: boolean;
  sync_phase: 'working_set' | 'reconcile' | 'incremental';
  has_more: boolean;
  server_time_ms: number;
  snowflake_node_id: number;
  sync_status: Record<string, TodoistSyncCommandStatus>;
  todo_domains: TodoistSyncDomainResource[];
  todos: TodoistSyncTodoResource[];
  sub_todos: TodoistSyncSubTodoResource[];
}

export interface TodoistSyncRequestError {
  statusCode: 400 | 409 | 503;
  code:
    | 'CLOCK_SKEW'
    | 'SYNC_TOKEN_INVALID'
    | 'REQUEST_INVALID'
    | 'DEVICE_LIMIT_REACHED'
    | 'TODO_SYNC_UNAVAILABLE';
  message: string;
  server_time_ms: number;
  max_future_ms?: number;
}

export interface TodoistSyncActivateParams {
  coreToken: string;
  customerId: number;
  deviceId: string;
}

export interface TodoistSyncSessionApi {
  activate(params: TodoistSyncActivateParams): Promise<void>;
  deactivate(): Promise<void>;
}

export type TodoistSyncClockStatus = 'healthy' | 'clock_wrong';

export interface TodoistSyncClockState {
  status: TodoistSyncClockStatus;
  local_time_ms: number;
  trusted_time_ms: number;
  offset_ms: number;
  last_success_at: number;
  check_generation: number;
}

export interface TodoistSyncClockContext {
  session_generation: number;
  clock_state: TodoistSyncClockState | null;
}

export type TodoistSyncClockCheckResult =
  | { status: 'unreachable'; clock_state: TodoistSyncClockState | null }
  | { status: 'stale'; clock_state: TodoistSyncClockState | null }
  | { status: TodoistSyncClockStatus; clock_state: TodoistSyncClockState };

export interface TodoistSyncClockCheckParams {
  session_generation: number;
  request_generation: number;
}

export interface TodoistSyncClockApi {
  getContext(): Promise<TodoistSyncClockContext>;
  check(params: TodoistSyncClockCheckParams): Promise<TodoistSyncClockCheckResult>;
  openDateTimeSettings(): Promise<void>;
}

export interface TodoistSyncStatus {
  active: boolean;
  syncing: boolean;
  pull_only: boolean;
  pending_count: number;
  failed_count: number;
  last_success_at: number | null;
  last_error: string | null;
  clock_state: TodoistSyncClockState | null;
}

export interface TodoistSyncStatusApi {
  getStatus(): Promise<TodoistSyncStatus>;
  getFailures(): Promise<TodoistSyncFailure[]>;
  requestSync(): Promise<void>;
  retryFailed(params: { uuid: string }): Promise<void>;
  discardFailed(params: { uuid: string }): Promise<void>;
}

export interface TodoistSyncFailure {
  uuid: string;
  command_type: TodoistSyncCommandType;
  error_code: string | null;
  error_message: string | null;
}

export interface TodoistSyncClockCheckRequested {
  session_generation: number;
  request_generation: number;
}
