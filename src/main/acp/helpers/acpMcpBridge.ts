import { randomUUID } from 'node:crypto';
import type { PromptResponse, RequestPermissionRequest, RequestPermissionResponse, SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpError } from '../core/acpHost.type';
import { isRecord, JsonRpcPeer } from '../core/jsonRpcPeer';
import { connectBridgeSocket } from './bridgeOptions';
import type { AcpBridgeOptions } from './bridgeOptions';
import { eventPage, readEventFragment, toolWireBytes, MCP_EVENT_BYTES, MCP_EVENT_COUNT, MCP_TOOL_BYTES } from './mcpEventPage';

interface PendingPermission { request: RequestPermissionRequest; resolve(value: RequestPermissionResponse): void }
interface Run {
  runId: string; sessionId: string; status: 'running' | 'completed' | 'failed';
  events: SessionUpdate[]; eventBytes: number; permissions: Map<string, PendingPermission>;
  result?: PromptResponse; error?: string; waiters: Set<() => void>;
}
interface Replay { replayId: string; sessionId: string; events: SessionUpdate[]; bytes: number; error?: string }
const propertyString = { type: 'string', minLength: 1 };
const tool = (name: string, options: { description: string; properties: Record<string, unknown>; required?: string[] }): Record<string, unknown> => ({
  name, description: options.description, inputSchema: { type: 'object', properties: options.properties, required: options.required ?? [], additionalProperties: false }
});
const sessionProperty = { sessionId: propertyString };
const tools = [
  tool('acp_session_new', { description: 'Create a durable agent session in an absolute existing working directory.', properties: { cwd: propertyString }, required: ['cwd'] }),
  tool('acp_session_list', { description: 'List saved external sessions. Follow nextCursor for another page.', properties: { cwd: propertyString, cursor: propertyString } }),
  tool('acp_session_load', { description: 'Load a saved session. Returns a bounded first history page, replayId and cursor; read all remaining pages with acp_session_history. Large events use acp_event_read references.', properties: { ...sessionProperty, cwd: propertyString }, required: ['sessionId', 'cwd'] }),
  tool('acp_session_history', { description: 'Page a loaded transcript by replayId/cursor. historyIndices and eventReferences.index are absolute positions; merge them in order. Follow hasMore/cursor.', properties: { replayId: propertyString, cursor: { type: 'integer', minimum: 0 } }, required: ['replayId'] }),
  tool('acp_event_read', { description: 'Read a referenced event as base64 JSON UTF-8 bytes. Concatenate decoded bytes in offset order until hasMore=false, then JSON.parse the complete UTF-8 document.', properties: { eventId: propertyString, offset: { type: 'integer', minimum: 0 } }, required: ['eventId'] }),
  tool('acp_prompt_start', { description: 'Start an asynchronous prompt; then poll its runId. Never wait for completion in this call.', properties: { ...sessionProperty, text: propertyString }, required: ['sessionId', 'text'] }),
  tool('acp_prompt_poll', { description: 'Read streamed updates and pending permission requests. Permission requests require an explicit decision via acp_permission_respond. Cursor is the next event offset. Follow hasMore even after completion; large eventReferences are read with acp_event_read.', properties: { runId: propertyString, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 0, maximum: 25000 } }, required: ['runId'] }),
  tool('acp_permission_respond', { description: 'Resolve one pending tool permission using an advertised optionId, or cancel it. Choose only an option authorized by the user.', properties: { runId: propertyString, requestId: propertyString, optionId: propertyString, cancelled: { type: 'boolean' } }, required: ['runId', 'requestId'] }),
  tool('acp_session_cancel', { description: 'Cancel current work and pending permissions; poll the run for its cancelled stopReason.', properties: sessionProperty, required: ['sessionId'] }),
  tool('acp_session_close', { description: 'Cancel current work and release this connection while retaining saved history.', properties: sessionProperty, required: ['sessionId'] }),
  tool('acp_session_delete', { description: 'Delete a loaded external session when supported by the agent.', properties: sessionProperty, required: ['sessionId'] }),
  tool('acp_session_set_config', { description: 'Set an advertised session configuration option by its ID and value.', properties: { ...sessionProperty, configId: propertyString, value: propertyString }, required: ['sessionId', 'configId', 'value'] })
];
const required = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new AcpError(-32602, `${key} must be a nonempty string`);
  return value;
};
const wake = (run: Run): void => { for (const resolve of run.waiters) resolve(); run.waiters.clear(); };
const cancelPermissions = (run: Run): void => {
  for (const pending of run.permissions.values()) pending.resolve({ outcome: { outcome: 'cancelled' } });
  run.permissions.clear();
  wake(run);
};

/** MCP translates to ACP over the real socket; it has no access to native host/storage internals. */
export const runAcpMcpBridge = async (options: AcpBridgeOptions = {}): Promise<void> => {
  const socket = await connectBridgeSocket(options);
  const acp = new JsonRpcPeer(socket, socket);

  const runs = new Map<string, Run>();
  const active = new Map<string, Run>();
  const replay = new Map<string, Replay>();
  const savedReplays = new Map<string, Replay>();
  const loaded = new Map<string, Record<string, unknown>>();
  let initialized = false;
  acp.onMessage(async (method, raw, notification) => {
    if (!isRecord(raw)) throw new AcpError(-32602, 'Invalid agent message');
    const sessionId = required(raw, 'sessionId');
    if (method === 'session/update' && notification) {
      if (!isRecord(raw.update)) throw new AcpError(-32602, 'Invalid session update');
      const update = raw.update as SessionUpdate;
      const history = replay.get(sessionId);
      if (history) {
        if (!history.error) {
          const bytes = Buffer.byteLength(JSON.stringify(update));
          if (history.events.length >= MCP_EVENT_COUNT || history.bytes + bytes > MCP_EVENT_BYTES) {
            history.error = 'Session loaded, but replay exceeds the bridge limit (8 MiB / 20,000 events). No partial history is returned. Use the ACP stdio bridge to stream the complete transcript.';
            history.events = [];
          } else { history.events.push(update); history.bytes += bytes; }
        }
      }
      const run = active.get(sessionId);
      if (run) {
        run.eventBytes += Buffer.byteLength(JSON.stringify(update));
        if (run.eventBytes > MCP_EVENT_BYTES || run.events.length >= MCP_EVENT_COUNT) {
          run.error = 'Run output exceeded bridge limit; turn was cancelled';
          await acp.notify('session/cancel', { sessionId });
        } else run.events.push(update);
        wake(run);
      }
      return {};
    }
    if (method === 'session/request_permission' && !notification) {
      const run = active.get(sessionId);
      if (!run || !Array.isArray(raw.options) || !isRecord(raw.toolCall)) return { outcome: { outcome: 'cancelled' } };
      if (run.permissions.size >= 32) return { outcome: { outcome: 'cancelled' } };
      const requestId = randomUUID();
      return new Promise<RequestPermissionResponse>((resolve) => {
        run.permissions.set(requestId, { request: raw as unknown as RequestPermissionRequest, resolve });
        wake(run);
      });
    }
    throw new AcpError(-32601, `Unsupported agent method: ${method}`);
  });
  const agent = await acp.request<{ agentCapabilities?: { sessionCapabilities?: { delete?: object } } }>('initialize', { protocolVersion: 1, clientInfo: { name: 'local-acp-mcp-bridge', version: '1.0.0' }, clientCapabilities: {} });
  const mcp = new JsonRpcPeer(process.stdin, process.stdout);
  const availableTools = (): Record<string, unknown>[] => tools.filter((entry) => entry.name !== 'acp_session_delete' || !!agent.agentCapabilities?.sessionCapabilities?.delete).filter((entry) => entry.name !== 'acp_session_set_config' || [...loaded.values()].some((session) => Array.isArray(session.configOptions) && session.configOptions.length));
  const remember = async (sessionId: string, session: Record<string, unknown>): Promise<void> => { loaded.set(sessionId, session); await mcp.notify('notifications/tools/list_changed'); };
  const invoke = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name === 'acp_session_new') {
      const session = await acp.request<Record<string, unknown>>('session/new', { cwd: required(args, 'cwd'), mcpServers: [] });
      await remember(required(session, 'sessionId'), session);
      return session;
    }
    if (name === 'acp_session_list') return acp.request('session/list', { ...(args.cwd ? { cwd: required(args, 'cwd') } : {}), ...(args.cursor ? { cursor: required(args, 'cursor') } : {}) });
    if (name === 'acp_session_load') {
      const sessionId = required(args, 'sessionId');
      if (replay.has(sessionId) || active.has(sessionId)) throw new AcpError(-32600, 'Session is busy');
      const history: Replay = { replayId: randomUUID(), sessionId, events: [], bytes: 0 };
      replay.set(sessionId, history);
      try {
        const session = await acp.request<Record<string, unknown>>('session/load', { sessionId, cwd: required(args, 'cwd'), mcpServers: [] });
        await remember(sessionId, session);
        if (history.error) throw new AcpError(-32603, history.error);
        if (savedReplays.size >= 8) savedReplays.delete(savedReplays.keys().next().value!);
        savedReplays.set(history.replayId, history);
        const page = eventPage(history.events, { cursor: 0, sourceId: `replay:${history.replayId}` });
        const { events, eventIndices, ...metadata } = page;
        return { ...session, replayId: history.replayId, history: events, historyIndices: eventIndices, ...metadata };
      }
      finally { replay.delete(sessionId); }
    }
    if (name === 'acp_session_history') {
      const history = savedReplays.get(required(args, 'replayId'));
      if (!history) throw new AcpError(-32002, 'Replay not found or expired');
      const page = eventPage(history.events, { cursor: (args.cursor ?? 0) as number, sourceId: `replay:${history.replayId}` });
      const { events, eventIndices, ...metadata } = page;
      return { replayId: history.replayId, history: events, historyIndices: eventIndices, ...metadata };
    }
    if (name === 'acp_event_read') {
      const eventId = required(args, 'eventId');
      const [kind, sourceId, index, extra] = eventId.split(':');
      if (extra !== undefined) throw new AcpError(-32602, 'Invalid event reference');
      let event: unknown;
      if (kind === 'permission') event = runs.get(sourceId)?.permissions.get(index)?.request;
      else if (kind === 'run' || kind === 'replay') {
        if (!/^(0|[1-9][0-9]*)$/.test(index)) throw new AcpError(-32602, 'Invalid event reference');
        const source = kind === 'run' ? runs.get(sourceId)?.events : savedReplays.get(sourceId)?.events;
        event = source?.[Number(index)];
      }
      if (event === undefined) throw new AcpError(-32002, 'Event not found or expired');
      return { eventId, ...readEventFragment(event, args.offset) };
    }
    if (name === 'acp_prompt_start') {
      const sessionId = required(args, 'sessionId');
      const text = required(args, 'text');
      if (!loaded.has(sessionId)) throw new AcpError(-32002, 'Session is not loaded');
      if (active.has(sessionId) || replay.has(sessionId)) throw new AcpError(-32600, 'Session is busy');
      if (runs.size >= 64) {
        const finished = [...runs.values()].find((run) => run.status !== 'running');
        if (!finished) throw new AcpError(-32600, 'Too many active runs');
        runs.delete(finished.runId);
      }
      const run: Run = { runId: randomUUID(), sessionId, status: 'running', events: [], eventBytes: 0, permissions: new Map(), waiters: new Set() };
      runs.set(run.runId, run);
      active.set(sessionId, run);
      // Prompt lifetime is controlled by session/cancel or connection closure, never a generic RPC timeout.
      void acp.request<PromptResponse>('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, { timeoutMs: 0 }).then((result) => {
        run.result = result; run.status = run.error ? 'failed' : 'completed';
      }, (error: Error) => { run.error = error.message; run.status = 'failed'; }).finally(() => {
        active.delete(sessionId); cancelPermissions(run); wake(run);
      });
      return { runId: run.runId, sessionId, status: run.status };
    }
    if (name === 'acp_prompt_poll' || name === 'acp_permission_respond') {
      const run = runs.get(required(args, 'runId'));
      if (!run) throw new AcpError(-32002, 'Run not found or expired');
      if (name === 'acp_permission_respond') {
        const requestId = required(args, 'requestId');
        const pending = run.permissions.get(requestId);
        if (!pending) throw new AcpError(-32002, 'Permission request is no longer pending');
        if (args.cancelled === true) {
          if (args.optionId !== undefined) throw new AcpError(-32602, 'Choose optionId or cancelled');
          pending.resolve({ outcome: { outcome: 'cancelled' } });
        } else {
          const optionId = required(args, 'optionId');
          if (!pending.request.options.some((option) => option.optionId === optionId)) throw new AcpError(-32602, 'Unknown permission option');
          pending.resolve({ outcome: { outcome: 'selected', optionId } });
        }
        run.permissions.delete(requestId);
        wake(run);
        return { resolved: true };
      }
      const cursor = args.cursor ?? 0;
      const waitMs = args.waitMs ?? 0;
      if (!Number.isSafeInteger(cursor) || (cursor as number) < 0 || (cursor as number) > run.events.length || !Number.isSafeInteger(waitMs) || (waitMs as number) < 0 || (waitMs as number) > 25_000) throw new AcpError(-32602, 'Invalid cursor or waitMs');
      if (cursor === run.events.length && run.status === 'running' && !run.permissions.size && (waitMs as number) > 0) {
        await new Promise<void>((resolve) => {
          const ready = (): void => { clearTimeout(timer); run.waiters.delete(ready); resolve(); };
          const timer = setTimeout(ready, waitMs as number);
          run.waiters.add(ready);
        });
      }
      const page = eventPage(run.events, { cursor: cursor as number, sourceId: `run:${run.runId}` });
      const pendingPermissions = [...run.permissions].map(([requestId, pending]) => {
        const request = { requestId, ...pending.request };
        return toolWireBytes(request) <= 16 * 1024 ? request : { requestId, sessionId: run.sessionId, requestReference: { eventId: `permission:${run.runId}:${requestId}`, byteLength: Buffer.byteLength(JSON.stringify(pending.request)) } };
      });
      return { runId: run.runId, sessionId: run.sessionId, status: run.status, ...page, pendingPermissions, ...(run.result ? { result: run.result } : {}), ...(run.error ? { error: run.error } : {}) };
    }
    if (name === 'acp_session_cancel') {
      const sessionId = required(args, 'sessionId');
      if (!loaded.has(sessionId)) throw new AcpError(-32002, 'Session is not loaded');
      await acp.notify('session/cancel', { sessionId });
      const run = active.get(sessionId);
      if (run) cancelPermissions(run);
      return { cancellationRequested: true };
    }
    if (name === 'acp_session_close' || name === 'acp_session_delete') {
      const sessionId = required(args, 'sessionId');
      if (!loaded.has(sessionId)) throw new AcpError(-32002, 'Session is not loaded');
      const result = await acp.request(name === 'acp_session_close' ? 'session/close' : 'session/delete', { sessionId });
      loaded.delete(sessionId);
      await mcp.notify('notifications/tools/list_changed');
      return result;
    }
    if (name === 'acp_session_set_config') return acp.request('session/set_config_option', { sessionId: required(args, 'sessionId'), configId: required(args, 'configId'), value: required(args, 'value') });
    throw new AcpError(-32601, `Unknown tool: ${name}`);
  };
  mcp.onMessage(async (method, raw, notification) => {
    if (notification) return {};
    const params = isRecord(raw) ? raw : {};
    if (method === 'initialize') {
      if (initialized) throw new AcpError(-32600, 'MCP is already initialized');
      if (typeof params.protocolVersion !== 'string' || !isRecord(params.capabilities) || !isRecord(params.clientInfo)) throw new AcpError(-32602, 'Invalid MCP initialization');
      initialized = true;
      return { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18', serverInfo: { name: 'local-acp-bridge', version: '1.0.0' }, capabilities: { tools: { listChanged: true } }, instructions: 'After session_load, consume history pages using replayId/cursor while hasMore. Reconstruct eventReferences with acp_event_read (base64 JSON UTF-8 fragments). Start prompts with acp_prompt_start, then poll runId until completed/failed. Streamed updates and pending permission requests appear in poll. Resolve permissions explicitly with acp_permission_respond only when authorized. Never infer user approval. Cancellation is acp_session_cancel, followed by polling its final stop reason.' };
    }
    if (!initialized) throw new AcpError(-32600, 'MCP initialize must be called first');
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: availableTools() };
    if (method === 'tools/call') {
      const name = required(params, 'name');
      if (!isRecord(params.arguments ?? {})) throw new AcpError(-32602, 'Invalid tool arguments');
      try {
        const spec = availableTools().find((entry) => entry.name === name);
        if (!spec) throw new AcpError(-32601, 'Tool is not available');
        const schema = spec.inputSchema as { properties: Record<string, { type?: string; minLength?: number; minimum?: number; maximum?: number }>; required: string[] };
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        for (const key of schema.required) if (!(key in args)) throw new AcpError(-32602, `Missing argument: ${key}`);
        for (const [key, value] of Object.entries(args)) {
          const property = schema.properties[key];
          if (!property || (property.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== property.type) || (typeof value === 'string' && property.minLength && value.length < property.minLength) || (typeof value === 'number' && ((property.minimum !== undefined && value < property.minimum) || (property.maximum !== undefined && value > property.maximum)))) throw new AcpError(-32602, `Invalid argument: ${key}`);
        }
        const result = await invoke(name, args);
        if (toolWireBytes(result) > MCP_TOOL_BYTES) throw new AcpError(-32603, 'Tool result exceeds the bounded MCP response limit. Use event/history paging or the ACP stdio bridge.');
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message.slice(0, 8192) : 'Tool failed' }] }; }
    }
    throw new AcpError(-32601, `Unsupported MCP method: ${method}`);
  });
  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      for (const run of runs.values()) cancelPermissions(run);
      void acp.close();
      process.off('SIGINT', cleanup);
      process.off('SIGTERM', cleanup);
      resolve();
    };
    mcp.onClose(cleanup);
    acp.onClose(() => { void mcp.close(); cleanup(); });
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
};
