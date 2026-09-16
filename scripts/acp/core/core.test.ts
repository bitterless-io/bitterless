import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, writeFile, mkdir, lstat, unlink, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnection, createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { SessionUpdate, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { AcpError } from '../../../src/main/acp/core/acpHost.type';
import type { AcpHost, AcpSession } from '../../../src/main/acp/core/acpHost.type';
import { createAcpEndpoint } from '../../../src/main/acp/core/acpEndpoint';
import { startAcpServer } from '../../../src/main/acp/core/acpServer';
import { JsonRpcPeer } from '../../../src/main/acp/core/jsonRpcPeer';

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let count = 0; count < 100; count += 1) { if (condition()) return; await delay(10); }
  throw new Error('Condition did not become true');
};
const makeHost = async (directory: string): Promise<AcpHost> => {
  const file = join(directory, 'sessions.json');
  let data: Array<AcpSession & { history: SessionUpdate[] }> = [];
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch { /* first start */ }
  const persist = async (): Promise<void> => { await writeFile(file, JSON.stringify(data)); };
  const find = (id: string): typeof data[number] => { const session = data.find((entry) => entry.sessionId === id); if (!session) throw new AcpError(-32002, 'missing'); return session; };
  return {
    info: { name: 'test-host', version: '1' },
    checkAccess: async () => undefined,
    createSession: async ({ cwd }) => {
      const session = { sessionId: `test-${data.length.toString().padStart(4, '0')}`, cwd, history: [] as SessionUpdate[] };
      data.push(session); await persist(); return session;
    },
    getSession: async (id) => data.find((entry) => entry.sessionId === id),
    listSessions: async () => data,
    loadSession: async ({ sessionId }) => ({ session: find(sessionId), history: find(sessionId).history }),
    prompt: async (id, blocks, context) => {
      const session = find(id);
      const text = blocks.map((block) => block.type === 'text' ? block.text : block.type === 'resource_link' ? block.uri : '').join('');
      session.history.push({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });
      if (text === 'wait') {
        await new Promise<void>((resolve) => { if (context.signal.aborted) resolve(); else context.signal.addEventListener('abort', () => resolve(), { once: true }); });
        await persist(); return { stopReason: 'cancelled' };
      }
      if (text === 'permission') {
        await context.emit({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Sensitive test operation', status: 'pending' });
        const permission = await context.requestPermission({ toolCall: { toolCallId: 'tool-1' }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject', kind: 'reject_once' }] });
        if (permission.outcome.outcome === 'cancelled') return { stopReason: 'cancelled' };
        const granted = permission.outcome.optionId === 'allow';
        await context.emit({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: granted ? 'completed' : 'failed' });
      }
      const update: SessionUpdate = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Reply: ${text} 世界` } };
      await context.emit(update); session.history.push(update); await persist();
      return { stopReason: 'end_turn' };
    },
    closeSession: async () => undefined,
    deleteSession: async (id) => { data = data.filter((entry) => entry.sessionId !== id); await persist(); }
  };
};
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'acp-test-'));
  const endpoint = createAcpEndpoint({ appId: 'test', environment: 'debug', userData: directory, socketPath: join(directory, 'agent.sock') });
  const host = await makeHost(directory);
  const server = await startAcpServer({ host, endpoint });
  return { directory, endpoint, host, server, cleanup: async () => { await server.close(); await rm(directory, { recursive: true, force: true }); } };
};
const connect = async (socketPath: string): Promise<{ peer: JsonRpcPeer; socket: ReturnType<typeof createConnection> }> => {
  const socket = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const peer = new JsonRpcPeer(socket, socket);
  peer.onMessage(async () => ({}));
  return { peer, socket };
};
const initialize = (peer: JsonRpcPeer) => peer.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
const newSession = (peer: JsonRpcPeer, cwd: string) => peer.request<{ sessionId: string }>('session/new', { cwd, mcpServers: [] });

test('official ACP SDK: stable handshake, create, stream, persistence across restart and load replay', async () => {
  const f = await fixture();
  let restarted: Awaited<ReturnType<typeof startAcpServer>> | undefined;
  const updates: SessionUpdate[] = [];
  const socket = createConnection(f.endpoint.socketPath);
  const sdk = new ClientSideConnection(() => ({ sessionUpdate: async ({ update }) => { updates.push(update); }, requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }) }), ndJsonStream(Writable.toWeb(socket), Readable.toWeb(socket)));
  try {
    const init = await sdk.initialize({ protocolVersion: 1, clientCapabilities: {} });
    assert.equal(init.protocolVersion, 1);
    assert.deepEqual(init.agentCapabilities?.sessionCapabilities?.list, {});
    const session = await sdk.newSession({ cwd: f.directory, mcpServers: [] });
    const result = await sdk.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hello' }, { type: 'resource_link', uri: 'file:///tmp/example.md', name: 'example.md' }] });
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(updates[0].sessionUpdate, 'agent_message_chunk');
    socket.destroy();
    await f.server.close();
    restarted = await startAcpServer({ host: await makeHost(f.directory), endpoint: f.endpoint });
    const { peer } = await connect(f.endpoint.socketPath);
    const replay: unknown[] = [];
    peer.onMessage(async (method, params) => { if (method === 'session/update') replay.push(params); return {}; });
    await initialize(peer);
    await peer.request('session/load', { sessionId: session.sessionId, cwd: f.directory, mcpServers: [] });
    assert.equal(replay.length, 2);
    await peer.close();
  } finally { socket.destroy(); await restarted?.close(); await f.cleanup(); }
});

test('malformed messages, pre-init, notification silence and split UTF-8 frames', async () => {
  const f = await fixture();
  const { peer, socket } = await connect(f.endpoint.socketPath);
  try {
    await assert.rejects(newSession(peer, f.directory), (error: unknown) => error instanceof AcpError && error.code === -32600);
    await initialize(peer);
    await assert.rejects(initialize(peer), /already initialized/);
    await assert.rejects(peer.request('unknown', {}), (error: unknown) => error instanceof AcpError && error.code === -32601);
    await assert.rejects(peer.request('session/new', { cwd: 'relative', mcpServers: [] }), /absolute/);
    await assert.rejects(peer.request('session/new', { cwd: f.directory, mcpServers: [{}] }), /MCP/);
    await peer.close();
    const raw = createConnection(f.endpoint.socketPath);
    const received: Array<Record<string, unknown>> = [];
    let pending = '';
    raw.on('data', (chunk) => { pending += chunk.toString(); let newline: number; while ((newline = pending.indexOf('\n')) >= 0) { received.push(JSON.parse(pending.slice(0, newline))); pending = pending.slice(newline + 1); } });
    raw.write('{bad}\n{"jsonrpc":"2.0","id":1,"method":5}\n{"jsonrpc":"2.0","method":"unknown"}\n');
    await waitFor(() => received.length === 2);
    assert.equal((received[0].error as { code: number }).code, -32700);
    assert.equal((received[1].error as { code: number }).code, -32600);
    const utf = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: 1, clientInfo: { name: '世界', version: '1' } } }) + '\n');
    const index = utf.indexOf(Buffer.from('世')) + 1;
    raw.write(utf.subarray(0, index)); raw.write(utf.subarray(index));
    await waitFor(() => received.length === 3);
    assert.equal((received[2].result as { protocolVersion: number }).protocolVersion, 1);
    raw.destroy();
  } finally { socket.destroy(); await f.cleanup(); }
});

test('prompt delegates durable validation to the host without an unreserved session read', async () => {
  const f = await fixture();
  const { peer } = await connect(f.endpoint.socketPath);
  try {
    await initialize(peer);
    const { sessionId } = await newSession(peer, f.directory);
    f.host.getSession = async () => { throw new Error('Unreserved durable read before prompt'); };
    const prompt = () => peer.request<{ stopReason: string }>('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'hello' }] });
    assert.equal((await prompt()).stopReason, 'end_turn');
    await f.host.deleteSession!(sessionId);
    await assert.rejects(prompt(), (error: unknown) => error instanceof AcpError && error.code === -32002);
  } finally { await peer.close(); await f.cleanup(); }
});

test('permission allow/deny/cancel, session exclusivity, cancellation and disconnect release', async () => {
  const f = await fixture();
  const a = await connect(f.endpoint.socketPath); const b = await connect(f.endpoint.socketPath);
  let decision: 'allow' | 'deny' | 'invalid' | 'wait' = 'allow';
  let permissionSeen = false;
  a.peer.onMessage(async (method) => {
    if (method === 'session/request_permission') {
      permissionSeen = true;
      if (decision === 'wait') return new Promise<RequestPermissionResponse>(() => undefined);
      return { outcome: { outcome: 'selected', optionId: decision } };
    }
    return {};
  });
  try {
    await initialize(a.peer); await initialize(b.peer);
    const { sessionId } = await newSession(a.peer, f.directory);
    await assert.rejects(b.peer.request('session/load', { sessionId, cwd: f.directory, mcpServers: [] }), /owned/);
    const prompt = () => a.peer.request<{ stopReason: string }>('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'permission' }] });
    assert.equal((await prompt()).stopReason, 'end_turn');
    decision = 'deny'; assert.equal((await prompt()).stopReason, 'end_turn');
    decision = 'invalid'; assert.equal((await prompt()).stopReason, 'cancelled');
    decision = 'wait'; permissionSeen = false;
    const pending = prompt(); await waitFor(() => permissionSeen);
    await assert.rejects(prompt(), /busy/);
    await a.peer.notify('session/cancel', { sessionId });
    assert.equal((await pending).stopReason, 'cancelled');
    const turn = a.peer.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'wait' }] }).catch(() => undefined);
    await delay(10); await a.peer.close(); await turn;
    await delay(20);
    await b.peer.request('session/load', { sessionId, cwd: f.directory, mcpServers: [] });
    assert.equal((await b.peer.request<{ stopReason: string }>('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'again' }] })).stopReason, 'end_turn');
  } finally { await a.peer.close(); await b.peer.close(); await f.cleanup(); }
});

test('endpoint lock, concurrent startup, unsafe paths, stale socket and descriptor replacement ownership', async () => {
  const f = await fixture();
  try {
    const attempts = await Promise.allSettled([startAcpServer({ host: f.host, endpoint: f.endpoint }), startAcpServer({ host: f.host, endpoint: f.endpoint })]);
    assert.ok(attempts.every((entry) => entry.status === 'rejected'));
    assert.equal((await lstat(f.endpoint.socketPath)).mode & 0o777, 0o600);
    const descriptor = JSON.parse(await readFile(f.endpoint.descriptorPath, 'utf8'));
    await unlink(f.endpoint.descriptorPath); await writeFile(f.endpoint.descriptorPath, JSON.stringify({ replacement: true }));
    await f.server.close();
    assert.deepEqual(JSON.parse(await readFile(f.endpoint.descriptorPath, 'utf8')), { replacement: true });
    await writeFile(f.endpoint.socketPath, 'do not remove');
    await assert.rejects(startAcpServer({ host: f.host, endpoint: f.endpoint }), /non-socket/);
    assert.equal(await readFile(f.endpoint.socketPath, 'utf8'), 'do not remove');
    await unlink(f.endpoint.socketPath);
    await symlink(f.endpoint.descriptorPath, f.endpoint.socketPath);
    await assert.rejects(startAcpServer({ host: f.host, endpoint: f.endpoint }), /non-socket/);
    await unlink(f.endpoint.socketPath);
    await writeFile(f.endpoint.descriptorPath, JSON.stringify(descriptor));
    const envA = createAcpEndpoint({ appId: 'test', userData: f.directory, environment: 'release' });
    const envB = createAcpEndpoint({ appId: 'test', userData: f.directory, environment: 'debug' });
    assert.notEqual(envA.socketPath, envB.socketPath);
    assert.ok(Buffer.byteLength(envA.socketPath) < 104);
  } finally { await f.cleanup(); }
});

const helper = async (kind: 'mcp' | 'stdio', socketPath: string) => {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/acp/core/bridge.entry.ts'), kind, '--socket', socketPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const peer = new JsonRpcPeer(child.stdout, child.stdin);
  peer.onMessage(async () => ({}));
  const stop = async (): Promise<void> => {
    child.stdin.end();
    await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(3_000)]);
    if (child.exitCode === null) child.kill('SIGTERM');
    assert.equal(stderr, '');
  };
  return { peer, child, stop };
};

test('real stdio helper subprocess preserves ACP request/notification streams and EOF', async () => {
  const f = await fixture(); const h = await helper('stdio', f.endpoint.socketPath);
  try {
    await initialize(h.peer);
    const session = await newSession(h.peer, f.directory);
    let count = 0; h.peer.onMessage(async (method) => { if (method === 'session/update') count += 1; return {}; });
    const result = await h.peer.request<{ stopReason: string }>('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'stdio' }] });
    assert.equal(result.stopReason, 'end_turn'); assert.equal(count, 1);
  } finally { await h.stop(); await f.cleanup(); }
});

test('real MCP subprocess accepts immediate initialize, asynchronous prompts, permissions, cancel and replay', async () => {
  const f = await fixture(); const h = await helper('mcp', f.endpoint.socketPath);
  const call = async (name: string, args: unknown = {}): Promise<Record<string, any>> => {
    const result = await h.peer.request<{ isError?: boolean; content: Array<{ text: string }> }>('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  try {
    const init = await h.peer.request<{ protocolVersion: string }>('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.protocolVersion, '2025-06-18');
    await h.peer.notify('notifications/initialized');
    const listed = await h.peer.request<{ tools: Array<{ name: string }> }>('tools/list');
    assert.ok(listed.tools.some((entry) => entry.name === 'acp_prompt_start'));
    assert.ok(!listed.tools.some((entry) => entry.name === 'acp_session_set_config'));
    await assert.rejects(call('acp_session_cancel', { sessionId: 'missing' }), /not loaded/);
    await assert.rejects(call('acp_session_new', { cwd: f.directory, unsupported: true }), /Invalid argument/);
    const session = await call('acp_session_new', { cwd: f.directory });
    const first = await call('acp_prompt_start', { sessionId: session.sessionId, text: 'permission' });
    let poll = await call('acp_prompt_poll', { runId: first.runId, waitMs: 1000 });
    if (!poll.pendingPermissions.length) poll = await call('acp_prompt_poll', { runId: first.runId, cursor: poll.cursor, waitMs: 1000 });
    assert.equal(poll.pendingPermissions.length, 1);
    const requestId = poll.pendingPermissions[0].requestId;
    await assert.rejects(call('acp_permission_respond', { runId: first.runId, requestId, optionId: 'invalid' }), /Unknown permission/);
    await call('acp_permission_respond', { runId: first.runId, requestId, optionId: 'allow' });
    for (let i = 0; i < 5 && poll.status === 'running'; i += 1) poll = await call('acp_prompt_poll', { runId: first.runId, cursor: poll.cursor, waitMs: 1000 });
    assert.equal(poll.result.stopReason, 'end_turn');
    const second = await call('acp_prompt_start', { sessionId: session.sessionId, text: 'wait' });
    await call('acp_session_cancel', { sessionId: session.sessionId });
    let cancelled = await call('acp_prompt_poll', { runId: second.runId, waitMs: 1000 });
    if (cancelled.status === 'running') cancelled = await call('acp_prompt_poll', { runId: second.runId, cursor: cancelled.cursor, waitMs: 1000 });
    assert.equal(cancelled.result.stopReason, 'cancelled');
    await call('acp_session_close', { sessionId: session.sessionId });
    const loaded = await call('acp_session_load', { sessionId: session.sessionId, cwd: f.directory });
    assert.ok(loaded.history.length >= 2);
  } finally { await h.stop(); await f.cleanup(); }
});

test('socket shutdown preserves a replacement live socket', async () => {
  const f = await fixture();
  const replacement = createServer((socket) => socket.end('replacement'));
  try {
    await unlink(f.endpoint.socketPath);
    await new Promise<void>((resolve, reject) => { replacement.once('error', reject); replacement.listen(f.endpoint.socketPath, resolve); });
    await f.server.close();
    assert.ok((await lstat(f.endpoint.socketPath)).isSocket());
    const socket = createConnection(f.endpoint.socketPath);
    const received = await new Promise<string>((resolve, reject) => { socket.once('data', (data) => resolve(data.toString())); socket.once('error', reject); });
    assert.equal(received, 'replacement'); socket.destroy();
  } finally { await new Promise<void>((resolve) => replacement.close(() => resolve())); await f.cleanup(); }
});

test('stale process lock and stale UNIX socket are recovered without touching unrelated descriptors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'acp-stale-'));
  const endpoint = createAcpEndpoint({ appId: 'stale', userData: directory, environment: 'debug', socketPath: join(directory, 'agent.sock') });
  const child = spawn(process.execPath, ['-e', 'const net=require("node:net");net.createServer().listen(process.argv[1],()=>process.stdout.write("ready"));', endpoint.socketPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); });
  child.kill('SIGKILL'); await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await mkdir(`${endpoint.socketPath}.lock`, { mode: 0o700 });
  await writeFile(join(`${endpoint.socketPath}.lock`, 'owner.json'), JSON.stringify({ protocol: 'acp-lock', pid: child.pid, token: 'old' }));
  let server: Awaited<ReturnType<typeof startAcpServer>> | undefined;
  try {
    assert.ok((await lstat(endpoint.socketPath)).isSocket());
    server = await startAcpServer({ endpoint, host: await makeHost(directory) });
    const { peer } = await connect(endpoint.socketPath); await initialize(peer); await peer.close();
    await server.close();
    await writeFile(endpoint.descriptorPath, '{}');
    await assert.rejects(startAcpServer({ endpoint, host: await makeHost(directory) }), /unrelated/);
    assert.equal(await readFile(endpoint.descriptorPath, 'utf8'), '{}');
    await assert.rejects(lstat(endpoint.socketPath), { code: 'ENOENT' });
  } finally { await server?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('disconnect waits for pending load and releases every owner despite host cleanup failures', async () => {
  const f = await fixture();
  const a = await connect(f.endpoint.socketPath); const b = await connect(f.endpoint.socketPath);
  let releaseLoad: (() => void) | undefined;
  let loading = false;
  const baseLoad = f.host.loadSession;
  const closed: string[] = [];
  try {
    await initialize(a.peer); await initialize(b.peer);
    const first = await newSession(a.peer, f.directory); const second = await newSession(a.peer, f.directory);
    await a.peer.request('session/close', { sessionId: first.sessionId });
    f.host.loadSession = async (params) => { loading = true; await new Promise<void>((resolve) => { releaseLoad = resolve; }); return baseLoad(params); };
    f.host.closeSession = async (id) => { closed.push(id); if (id === second.sessionId) throw new Error('cleanup failure'); };
    const loadingRequest = a.peer.request('session/load', { sessionId: first.sessionId, cwd: f.directory, mcpServers: [] }).catch(() => undefined);
    await waitFor(() => loading); await a.peer.close(); await loadingRequest;
    await assert.rejects(b.peer.request('session/load', { sessionId: first.sessionId, cwd: f.directory, mcpServers: [] }), /owned/);
    releaseLoad?.(); await waitFor(() => closed.length === 2);
    f.host.loadSession = baseLoad;
    await b.peer.request('session/load', { sessionId: first.sessionId, cwd: f.directory, mcpServers: [] });
    await b.peer.request('session/load', { sessionId: second.sessionId, cwd: f.directory, mcpServers: [] });
  } finally { releaseLoad?.(); await a.peer.close(); await b.peer.close(); await f.cleanup(); }
});

test('pagination uses a stable last-key cursor and streams only to the session owner', async () => {
  const f = await fixture(); const a = await connect(f.endpoint.socketPath); const b = await connect(f.endpoint.socketPath);
  try {
    await initialize(a.peer); await initialize(b.peer);
    for (let index = 0; index < 52; index += 1) await newSession(a.peer, f.directory);
    const page = await a.peer.request<{ sessions: Array<{ sessionId: string }>; nextCursor: string }>('session/list');
    assert.equal(page.sessions.length, 50);
    const originalList = f.host.listSessions;
    f.host.listSessions = async () => [{ sessionId: 'aaa-new', cwd: f.directory }, ...await originalList()];
    const next = await a.peer.request<{ sessions: Array<{ sessionId: string }> }>('session/list', { cursor: page.nextCursor });
    assert.deepEqual(next.sessions.map((entry) => entry.sessionId), ['test-0050', 'test-0051']);
    let receivedByB = 0; b.peer.onMessage(async () => { receivedByB += 1; return {}; });
    await a.peer.request('session/prompt', { sessionId: page.sessions[0].sessionId, prompt: [{ type: 'text', text: 'isolated' }] });
    assert.equal(receivedByB, 0);
  } finally { await a.peer.close(); await b.peer.close(); await f.cleanup(); }
});

test('MCP subprocess pages >4 MiB replay and reconstructs a heavily escaped oversized live event', async () => {
  const f = await fixture();
  const session = await f.host.createSession({ cwd: await realpath(f.directory), mcpServers: [] });
  const history: SessionUpdate[] = Array.from({ length: 6 }, (_, index) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${index}:` + 'a'.repeat(800_000) } }));
  f.host.loadSession = async () => ({ session, history });
  const escaped = '\\"\n\t'.repeat(350_000);
  const largeEvent: SessionUpdate = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: escaped } };
  assert.ok(Buffer.byteLength(JSON.stringify(largeEvent)) < 4 * 1024 * 1024);
  f.host.prompt = async (_id, _blocks, context) => { await context.emit(largeEvent); return { stopReason: 'end_turn' }; };
  const h = await helper('mcp', f.endpoint.socketPath);
  const call = async (name: string, args: unknown = {}): Promise<Record<string, any>> => {
    const result = await h.peer.request<{ isError?: boolean; content: Array<{ text: string }> }>('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  try {
    await h.peer.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'size-regression', version: '1' } });
    let page = await call('acp_session_load', { sessionId: session.sessionId, cwd: f.directory });
    const replayId = page.replayId;
    const restored: SessionUpdate[] = [];
    let pages = 0;
    for (;;) {
      assert.equal(page.eventReferences.length, 0);
      for (let index = 0; index < page.history.length; index += 1) restored[page.historyIndices[index]] = page.history[index];
      pages += 1;
      if (!page.hasMore) break;
      page = await call('acp_session_history', { replayId, cursor: page.cursor });
    }
    assert.ok(pages > 1); assert.deepEqual(restored, history);
    const started = await call('acp_prompt_start', { sessionId: session.sessionId, text: 'oversized' });
    let poll = await call('acp_prompt_poll', { runId: started.runId, waitMs: 1000 });
    if (!poll.eventReferences.length) poll = await call('acp_prompt_poll', { runId: started.runId, cursor: poll.cursor, waitMs: 1000 });
    assert.equal(poll.events.length, 0); assert.equal(poll.eventReferences.length, 1); assert.equal(poll.eventReferences[0].index, 0); assert.equal(poll.cursor, 1);
    const bytes: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const fragment = await call('acp_event_read', { eventId: poll.eventReferences[0].eventId, offset });
      assert.equal(fragment.encoding, 'base64'); bytes.push(Buffer.from(fragment.data, 'base64'));
      if (!fragment.hasMore) break;
      assert.ok(fragment.nextOffset > offset); offset = fragment.nextOffset;
    }
    assert.deepEqual(JSON.parse(Buffer.concat(bytes).toString('utf8')), largeEvent);
    assert.deepEqual(await h.peer.request('ping'), {});
  } finally { await h.stop(); await f.cleanup(); }
});

test('MCP replay event-count and byte overflow fail explicitly after draining without killing the helper', async () => {
  const f = await fixture();
  const session = await f.host.createSession({ cwd: await realpath(f.directory), mcpServers: [] });
  let mode: 'count' | 'bytes' | 'small' = 'count';
  f.host.loadSession = async () => ({ session, history: mode === 'count'
    ? Array.from({ length: 20_001 }, () => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'small' } }))
    : mode === 'bytes' ? Array.from({ length: 10 }, () => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a'.repeat(900_000) } }))
    : [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'recovered' } }] });
  const h = await helper('mcp', f.endpoint.socketPath);
  const call = (name: string, args: unknown = {}) => h.peer.request<{ isError?: boolean; content: Array<{ text: string }> }>('tools/call', { name, arguments: args });
  try {
    await h.peer.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'overflow-regression', version: '1' } });
    for (const current of ['count', 'bytes'] as const) {
      mode = current;
      const result = await call('acp_session_load', { sessionId: session.sessionId, cwd: f.directory });
      assert.equal(result.isError, true); assert.match(result.content[0].text, /No partial history/);
      assert.deepEqual(await h.peer.request('ping'), {});
    }
    mode = 'small';
    const recovered = await call('acp_session_load', { sessionId: session.sessionId, cwd: f.directory });
    assert.equal(recovered.isError, undefined); assert.equal(JSON.parse(recovered.content[0].text).history[0].content.text, 'recovered');
  } finally { await h.stop(); await f.cleanup(); }
});
