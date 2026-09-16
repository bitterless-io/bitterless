import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { stat, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ContentBlock, InitializeResponse, McpServer, PromptResponse, RequestPermissionResponse, SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpError } from './acpHost.type';
import type { AcpHost, AcpSession, AcpSessionSetup } from './acpHost.type';
import { acquireAcpEndpointLock, createAcpBindPath, ownSocketCleanup, prepareAcpEndpoint, publishAcpDescriptor, publishListeningSocket } from './acpEndpoint';
import type { AcpDescriptor, AcpEndpoint } from './acpEndpoint';
import { isRecord, JsonRpcPeer } from './jsonRpcPeer';

export interface AcpServerOptions {
  host: AcpHost;
  endpoint: AcpEndpoint;
  maxConnections?: number;
  permissionTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}
export interface AcpServerHandle { descriptor: AcpDescriptor; close(): Promise<void> }
const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new AcpError(-32602, `${label} must be a nonempty string`);
  return value;
};
const sessionState = (session: AcpSession): Record<string, unknown> => ({
  ...(session.modes ? { modes: session.modes } : {}),
  ...(session.configOptions ? { configOptions: session.configOptions.filter((option) => option.type === 'select') } : {})
});
const checkCwd = async (value: unknown): Promise<string> => {
  const cwd = requiredString(value, 'cwd');
  if (!isAbsolute(cwd)) throw new AcpError(-32602, 'cwd must be an absolute directory');
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error('not directory');
    return await realpath(cwd);
  } catch { throw new AcpError(-32602, 'cwd must be an existing directory'); }
};
const setupParams = async (params: Record<string, unknown>, host: AcpHost): Promise<AcpSessionSetup> => {
  if (!Array.isArray(params.mcpServers)) throw new AcpError(-32602, 'mcpServers must be an array');
  if (params.mcpServers.length && !host.supportsMcpServers) throw new AcpError(-32602, 'Client supplied MCP servers are not supported by this agent');
  if ('additionalDirectories' in params && (!Array.isArray(params.additionalDirectories) || params.additionalDirectories.length)) throw new AcpError(-32602, 'Additional workspace directories are not supported');
  for (const server of params.mcpServers) {
    if (!isRecord(server) || typeof server.name !== 'string') throw new AcpError(-32602, 'Invalid MCP server');
    if ('type' in server) {
      if ((server.type !== 'http' || !host.mcpCapabilities?.http) && (server.type !== 'sse' || !host.mcpCapabilities?.sse)) throw new AcpError(-32602, 'Unsupported MCP transport');
      if (typeof server.url !== 'string' || !Array.isArray(server.headers)) throw new AcpError(-32602, 'Invalid MCP server');
    } else if (typeof server.command !== 'string' || !isAbsolute(server.command) || !Array.isArray(server.args) || !server.args.every((arg) => typeof arg === 'string') || !Array.isArray(server.env) || !server.env.every((env) => isRecord(env) && typeof env.name === 'string' && typeof env.value === 'string')) throw new AcpError(-32602, 'Invalid stdio MCP server');
  }
  return { cwd: await checkCwd(params.cwd), mcpServers: params.mcpServers as McpServer[] };
};
const promptBlocks = (value: unknown, host: AcpHost): ContentBlock[] => {
  if (!Array.isArray(value) || !value.length) throw new AcpError(-32602, 'prompt must contain content blocks');
  for (const block of value) {
    if (!isRecord(block)) throw new AcpError(-32602, 'Invalid content block');
    const valid = (block.type === 'text' && typeof block.text === 'string')
      || (block.type === 'resource_link' && typeof block.uri === 'string' && typeof block.name === 'string')
      || (block.type === 'image' && host.promptCapabilities?.image && typeof block.data === 'string' && typeof block.mimeType === 'string')
      || (block.type === 'audio' && host.promptCapabilities?.audio && typeof block.data === 'string' && typeof block.mimeType === 'string')
      || (block.type === 'resource' && host.promptCapabilities?.embeddedContext && isRecord(block.resource) && typeof block.resource.uri === 'string' && (typeof block.resource.text === 'string' || typeof block.resource.blob === 'string'));
    if (!valid) throw new AcpError(-32602, `Unsupported or malformed prompt content: ${String(block.type)}`);
  }
  return value as ContentBlock[];
};

export const startAcpServer = async (options: AcpServerOptions): Promise<AcpServerHandle> => {
  const { host, endpoint } = options;
  const bindPath = createAcpBindPath(endpoint);
  const releaseLock = await acquireAcpEndpointLock(endpoint);
  try { await prepareAcpEndpoint(endpoint); } catch (error) { await releaseLock(); throw error; }
  const owners = new Map<string, JsonRpcPeer>();
  const peers = new Set<JsonRpcPeer>();
  const cleanups = new Set<Promise<void>>();
  let stopping = false;
  const descriptor: AcpDescriptor = { ...endpoint, version: 1, protocol: 'acp', protocolVersion: 1, pid: process.pid, instanceId: randomUUID(), agent: host.info };
  const server = createServer((socket) => {
    if (stopping || peers.size >= (options.maxConnections ?? 16)) { socket.destroy(); return; }
    const peer = new JsonRpcPeer(socket, socket);
    peers.add(peer);
    let initialized = false;
    const owned = new Set<string>();
    const operations = new Set<Promise<unknown>>();
    const controls = new Set<string>();
    const turns = new Map<string, { controller: AbortController; done: Promise<PromptResponse> }>();
    const claim = (sessionId: string): boolean => {
      if (peer.isClosed) throw new AcpError(-32603, 'Connection closed');
      const previous = owners.get(sessionId);
      if (previous && previous !== peer) throw new AcpError(-32600, 'Session is owned by another connection');
      owners.set(sessionId, peer);
      owned.add(sessionId);
      return !previous;
    };
    const requireOwned = (sessionId: string): void => {
      if (!owned.has(sessionId) || owners.get(sessionId) !== peer) throw new AcpError(-32002, 'Session is not loaded on this connection');
    };
    const release = (sessionId: string): void => {
      if (owners.get(sessionId) === peer) owners.delete(sessionId);
      owned.delete(sessionId);
    };
    const idle = (sessionId: string): void => {
      if (turns.has(sessionId) || controls.has(sessionId)) throw new AcpError(-32600, 'Session is busy');
    };
    const emit = async (sessionId: string, update: SessionUpdate): Promise<void> => {
      requireOwned(sessionId);
      await peer.notify('session/update', { sessionId, update });
    };
    const cancel = (sessionId: string): void => {
      requireOwned(sessionId);
      turns.get(sessionId)?.controller.abort();
    };
    const get = async (sessionId: string): Promise<AcpSession> => {
      const session = await host.getSession(sessionId);
      if (!session) throw new AcpError(-32002, 'Session not found');
      return session;
    };
    peer.onClose(() => {
      const cleanup = (async () => {
        for (const turn of turns.values()) turn.controller.abort();
        await Promise.allSettled([...operations]);
        for (const sessionId of owned) {
          try { await host.closeSession?.(sessionId); }
          catch { /* Release every owner even if one host cleanup fails. */ }
          finally { release(sessionId); }
        }
      })().catch(() => undefined).finally(() => { peers.delete(peer); cleanups.delete(cleanup); });
      cleanups.add(cleanup);
    });
    const handleMessage = async (method: string, raw: unknown, notification: boolean): Promise<unknown> => {
      const params = isRecord(raw) ? raw : {};
      if (notification) {
        if (initialized && method === 'session/cancel') cancel(requiredString(params.sessionId, 'sessionId'));
        return {};
      }
      if (method === 'initialize') {
        if (initialized) throw new AcpError(-32600, 'Connection is already initialized');
        if (typeof params.protocolVersion !== 'number' || !Number.isInteger(params.protocolVersion) || params.protocolVersion < 1 || (params.clientCapabilities !== undefined && !isRecord(params.clientCapabilities))) throw new AcpError(-32602, 'Invalid initialize parameters');
        initialized = true;
        const response: InitializeResponse = {
          protocolVersion: 1, agentInfo: host.info, authMethods: host.authMethods ?? [],
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { list: {}, resume: {}, close: {}, ...(host.deleteSession ? { delete: {} } : {}) },
            promptCapabilities: host.promptCapabilities ?? {},
            ...(host.supportsMcpServers && host.mcpCapabilities ? { mcpCapabilities: host.mcpCapabilities } : {})
          }
        };
        return response;
      }
      if (!initialized) throw new AcpError(-32600, 'initialize must be called first');
      if (method === 'authenticate') {
        const methodId = requiredString(params.methodId, 'methodId');
        if (!host.authenticate || !host.authMethods?.some((entry) => entry.id === methodId && (!('type' in entry) || entry.type !== 'terminal'))) throw new AcpError(-32602, 'Unsupported authentication method');
        await host.authenticate(methodId);
        return {};
      }
      if (method === 'session/cancel') throw new AcpError(-32600, 'session/cancel must be a notification');
      if (method === 'session/new') {
        await host.checkAccess();
        const setup = await setupParams(params, host);
        const session = await host.createSession(setup);
        if (peer.isClosed) { await host.closeSession?.(session.sessionId); throw new AcpError(-32603, 'Connection closed'); }
        claim(session.sessionId);
        return { sessionId: session.sessionId, ...sessionState(session) };
      }
      if (method === 'session/list') {
        await host.checkAccess();
        const cwd = params.cwd == null ? undefined : await checkCwd(params.cwd);
        const sessions = (await host.listSessions()).filter((session) => !cwd || session.cwd === cwd).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
        let after = ''; 
        const fingerprint = createHash('sha256').update(cwd ?? '').digest('hex').slice(0, 16);
        if (params.cursor !== undefined && params.cursor !== null) {
          try {
            const decoded: unknown = JSON.parse(Buffer.from(requiredString(params.cursor, 'cursor'), 'base64url').toString());
            if (!isRecord(decoded) || decoded.filter !== fingerprint || typeof decoded.after !== 'string') throw new Error('invalid cursor');
            after = decoded.after as string;
          } catch { throw new AcpError(-32602, 'Invalid session cursor'); }
        }
        const remaining = sessions.filter((session) => session.sessionId.localeCompare(after) > 0);
        const page = remaining.slice(0, 50).map(({ sessionId, cwd: directory, title, updatedAt }) => ({ sessionId, cwd: directory, ...(title ? { title } : {}), ...(updatedAt ? { updatedAt } : {}) }));
        return { sessions: page, ...(page.length < remaining.length ? { nextCursor: Buffer.from(JSON.stringify({ after: page[page.length - 1].sessionId, filter: fingerprint })).toString('base64url') } : {}) };
      }
      if (method === 'session/load' || method === 'session/resume') {
        const sessionId = requiredString(params.sessionId, 'sessionId');
        idle(sessionId);
        const acquired = claim(sessionId);
        controls.add(sessionId);
        try {
          await host.checkAccess();
          const setup = await setupParams(params, host);
          const previous = await get(sessionId);
          if (previous.cwd !== setup.cwd) throw new AcpError(-32602, 'cwd does not match the persisted session workspace');
          const loaded = await host.loadSession({ ...setup, sessionId });
          if (peer.isClosed) throw new AcpError(-32603, 'Connection closed');
          if (method === 'session/load') for (const update of loaded.history) await emit(sessionId, update);
          return sessionState(loaded.session);
        } catch (error) {
          if (acquired && !peer.isClosed) release(sessionId);
          throw error;
        }
        finally { controls.delete(sessionId); }
      }
      if (method === 'session/prompt') {
        const sessionId = requiredString(params.sessionId, 'sessionId');
        requireOwned(sessionId);
        idle(sessionId);
        const prompt = promptBlocks(params.prompt, host);
        const controller = new AbortController();
        let active = true;
        const done = Promise.resolve().then(async (): Promise<PromptResponse> => {
          await host.checkAccess();
          await get(sessionId);
          if (controller.signal.aborted) return { stopReason: 'cancelled' };
          const result = await host.prompt(sessionId, prompt, {
            signal: controller.signal,
            emit: async (update) => { if (active && !peer.isClosed) await emit(sessionId, update); },
            requestPermission: async (request) => {
              if (!active || controller.signal.aborted || peer.isClosed) return { outcome: { outcome: 'cancelled' } };
              try {
                const result = await peer.request<RequestPermissionResponse>('session/request_permission', { ...request, sessionId }, { signal: controller.signal, timeoutMs: options.permissionTimeoutMs ?? 120_000 });
                if (!isRecord(result) || !isRecord(result.outcome)) throw new AcpError(-32602, 'Invalid permission response');
                if (result.outcome.outcome === 'cancelled') return result;
                const selected = result.outcome;
                if (selected.outcome !== 'selected' || !request.options.some((option) => option.optionId === selected.optionId)) throw new AcpError(-32602, 'Unknown permission option');
                return result;
              } catch { return { outcome: { outcome: 'cancelled' } }; }
            }
          });
          if (!['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'].includes(result.stopReason)) throw new AcpError(-32603, 'Host returned invalid stop reason');
          return controller.signal.aborted ? { stopReason: 'cancelled' } : result;
        }).catch((error) => {
          if (controller.signal.aborted) return { stopReason: 'cancelled' } as PromptResponse;
          throw error;
        }).finally(() => { active = false; turns.delete(sessionId); });
        turns.set(sessionId, { controller, done });
        return done;
      }
      if (method === 'session/close' || (method === 'session/delete' && host.deleteSession) || (method === 'session/set_mode' && host.setMode) || (method === 'session/set_config_option' && host.setConfigOption)) {
        const sessionId = requiredString(params.sessionId, 'sessionId');
        requireOwned(sessionId);
        if (controls.has(sessionId)) throw new AcpError(-32600, 'Session is busy');
        controls.add(sessionId);
        try {
          await host.checkAccess();
          if (method === 'session/close' || method === 'session/delete') {
            cancel(sessionId);
            await turns.get(sessionId)?.done.catch(() => undefined);
            await host.closeSession?.(sessionId);
            if (method === 'session/delete') await host.deleteSession?.(sessionId);
            release(sessionId);
            return {};
          }
          if (turns.has(sessionId)) throw new AcpError(-32600, 'Session is busy');
          const session = method === 'session/set_mode'
            ? await host.setMode!(sessionId, requiredString(params.modeId, 'modeId'))
            : await host.setConfigOption!(sessionId, requiredString(params.configId, 'configId'), requiredString(params.value, 'value'));
          if (session.modes) await emit(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: session.modes.currentModeId });
          if (session.configOptions) await emit(sessionId, { sessionUpdate: 'config_option_update', configOptions: session.configOptions });
          return method === 'session/set_mode' ? {} : { configOptions: session.configOptions ?? [] };
        } finally { controls.delete(sessionId); }
      }
      throw new AcpError(-32601, `Method not found: ${method}`);
    };
    peer.onMessage((method, raw, notification) => {
      const operation = handleMessage(method, raw, notification);
      operations.add(operation);
      return operation.finally(() => { operations.delete(operation); });
    });
  });
  let socketCleanup: (() => Promise<void>) | undefined;
  let descriptorCleanup: (() => Promise<void>) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(bindPath, () => { server.off('error', reject); resolve(); });
    });
    await publishListeningSocket(bindPath, endpoint);
    socketCleanup = await ownSocketCleanup(endpoint.socketPath);
    descriptorCleanup = await publishAcpDescriptor(descriptor);
  } catch (error) {
    for (const peer of peers) await peer.close();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await socketCleanup?.();
    await releaseLock();
    throw error;
  }
  let closeTask: Promise<void> | undefined;
  return {
    descriptor,
    close: () => {
      if (closeTask) return closeTask;
      stopping = true;
      closeTask = (async () => {
        for (const peer of peers) await peer.close();
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          Promise.allSettled([...cleanups]),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, options.shutdownTimeoutMs ?? 5_000); })
        ]);
        if (timer) clearTimeout(timer);
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await descriptorCleanup?.();
        await socketCleanup?.();
        await releaseLock();
      })();
      return closeTask;
    }
  };
};
