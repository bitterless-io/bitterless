// Runtime owner: the hidden Core SQLite preload process.
import {
  TODOIST_SYNC_PATH,
  TODOIST_SYNC_TOKEN_HEADER,
  parseTodoistSyncRequest,
  parseTodoistSyncRequestError,
  parseTodoistSyncResponse,
} from '@shared/todoistSync/todoistSync.contract';
import type {
  TodoistSyncCommand,
  TodoistSyncRequestError,
  TodoistSyncResponse,
} from '@shared/todoistSync/todoistSync.type';

const DEFAULT_PROD_CORE_URL = 'https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run';
const DEFAULT_DEV_CORE_URL = 'https://bl-test-api.terncloud.com';
const REQUEST_TIMEOUT_MS = 15_000;

const resolveBaseUrl = (): string => {
  const configured = import.meta.env.VITE_BITTERLESS_CORE_URL;
  const fallback = import.meta.env.VITE_ENV === 'prod' ? DEFAULT_PROD_CORE_URL : DEFAULT_DEV_CORE_URL;
  return (configured || fallback).replace(/\/+$/, '');
};

export class TodoistSyncHttpError extends Error {
  constructor(readonly status: number, readonly envelope: TodoistSyncRequestError) {
    super(envelope.message);
    this.name = 'TodoistSyncHttpError';
  }
}

export interface TodoistSyncClientOptions {
  coreToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class TodoistSyncClient {
  private readonly coreToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly controllers = new Set<AbortController>();
  private disposed = false;

  constructor(options: TodoistSyncClientOptions) {
    if (!options.coreToken.trim()) throw new Error('[todoist sync] Core token is required');
    this.coreToken = options.coreToken;
    this.baseUrl = (options.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async sync(syncToken: string, commands: TodoistSyncCommand[]): Promise<TodoistSyncResponse> {
    this.assertActive();
    const request = parseTodoistSyncRequest({ sync_token: syncToken, commands });
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${TODOIST_SYNC_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [TODOIST_SYNC_TOKEN_HEADER]: this.coreToken,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const text = await response.text();
      let value: unknown;
      try {
        value = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('[todoist sync] Core returned invalid JSON');
      }
      if (!response.ok) {
        throw new TodoistSyncHttpError(response.status, parseTodoistSyncRequestError(value, response.status));
      }
      return parseTodoistSyncResponse(value, commands.map((command) => command.uuid));
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('[todoist sync] HTTP client is disposed');
  }
}
