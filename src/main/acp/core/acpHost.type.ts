import type {
  AuthMethod,
  ContentBlock,
  McpServer,
  PromptCapabilities,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate
} from '@agentclientprotocol/sdk';

export interface AcpSession {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  modes?: SessionModeState;
  configOptions?: SessionConfigOption[];
}

export interface AcpSessionSetup {
  cwd: string;
  mcpServers: McpServer[];
}

export interface AcpPromptContext {
  signal: AbortSignal;
  /** Resolves only after the update has been accepted by the transport. */
  emit(update: SessionUpdate): Promise<void>;
  /** The host keeps its normal permission policy; this relays required decisions. */
  requestPermission(request: Omit<RequestPermissionRequest, 'sessionId'>): Promise<RequestPermissionResponse>;
}

/** Host owns durable storage, namespace isolation, auth and application-wide GUI/external turn exclusion.
 * Core owns per-connection initialization, session ownership, request validation, cancellation and transport.
 * All session methods must only access sessions created by this integration.
 * prompt must persist user/reply history and settle promptly when signal aborts, retaining partial history.
 */
export interface AcpHost {
  info: { name: string; version: string; title?: string };
  authMethods?: AuthMethod[];
  promptCapabilities?: PromptCapabilities;
  /** Reject nonempty mcpServers unless the host implements these supplied servers end to end. */
  supportsMcpServers?: boolean;
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  /** Throws AcpError(-32000, ...) when app/provider login is required. Called before session operations. */
  checkAccess(): Promise<void>;
  authenticate?(methodId: string): Promise<void>;
  createSession(params: AcpSessionSetup): Promise<AcpSession>;
  getSession(sessionId: string): Promise<AcpSession | undefined>;
  listSessions(): Promise<AcpSession[]>;
  /** Reconstruct runtime context and return the complete replayable persisted transcript. */
  loadSession(params: AcpSessionSetup & { sessionId: string }): Promise<{ session: AcpSession; history: SessionUpdate[] }>;
  /** Acquire auth/turn ownership before any async preparation, then validate the durable session.
   * Core deliberately does not call getSession before prompt: such a read would sit outside
   * the host's cancellation/auth lifetime. Missing sessions must throw AcpError(-32002, ...).
   */
  prompt(sessionId: string, prompt: ContentBlock[], context: AcpPromptContext): Promise<PromptResponse>;
  setMode?(sessionId: string, modeId: string): Promise<AcpSession>;
  setConfigOption?(sessionId: string, configId: string, value: string): Promise<AcpSession>;
  /** Release transient resources; preserve durable history. Core cancels and awaits prompt first. */
  closeSession?(sessionId: string): Promise<void>;
  /** Soft-delete durable session; optional and advertised only if implemented. */
  deleteSession?(sessionId: string): Promise<void>;
}

export class AcpError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'AcpError';
  }
}
