import type { McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';

export type TrenchAgentGuidePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'restart-required'
  | 'error';

export type TrenchAgentGuideCopyKind = 'complete' | 'helper' | 'config' | 'skill';
export type TrenchAgentGuideCopyState = 'idle' | 'copied' | 'failed';

export interface TrenchAgentGuideClient {
  getIntegrationInfo(): Promise<unknown>;
}

export interface TrenchAgentGuideClipboard {
  writeText(text: string): Promise<void>;
}

export interface TrenchAgentGuideState {
  visible: boolean;
  phase: TrenchAgentGuidePhase;
  info: McpIntegrationInfo | null;
  mismatchReason: 'invalid-payload' | 'version-mismatch' | null;
  copyStates: Record<TrenchAgentGuideCopyKind, TrenchAgentGuideCopyState>;
}
