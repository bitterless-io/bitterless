export type ClaudeInventoryInvalidationSource = 'desktop' | 'transcripts';

export type ClaudeInventoryBridgeTransport = 'unix' | 'win32-named-pipe';

export interface ClaudeInventoryBridgeEndpoint {
  transport: ClaudeInventoryBridgeTransport;
  path: string;
}

export interface ClaudeInventoryInvalidation {
  schemaVersion: 1;
  nonce: string;
  source: ClaudeInventoryInvalidationSource;
  observedAt: number;
}

export interface ClaudeInventoryWatcherReady {
  schemaVersion: 1;
  type: 'ready';
}

export interface ClaudeInventoryWatcherArgs {
  endpoint: ClaudeInventoryBridgeEndpoint;
  nonce: string;
  roots: Array<{ source: ClaudeInventoryInvalidationSource; path: string }>;
}
