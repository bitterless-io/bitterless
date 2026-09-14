export const ZELLIJ_STATE_EVENT = 'zellij/state' as const;
export const ZELLIJ_SURFACE_STATE_EVENT = 'zellij/surface-state' as const;
export const ZELLIJ_SETTINGS_OPEN_EVENT = 'zellij/settings-open' as const;
export const ZELLIJ_HANDLER_NAME = 'ZellijHandler' as const;
export const ZELLIJ_WINDOW_HANDLER_NAME = 'ZellijWindowHandler' as const;

/**
 * Query parameter carrying a chrome's own surface id (`zellij/index.html?surface=<id>`).
 *
 * Several Zellij surfaces can be live at once, each with its own chrome renderer, and every one of
 * them talks to the same main-side handler. The id has to be on the wire for main to know which
 * terminal a measurement is about.
 */
export const ZELLIJ_SURFACE_QUERY = 'surface' as const;

export type ZellijErrorCode =
  | 'binary-missing'
  | 'unsupported-platform'
  | 'port-occupied'
  | 'version-mismatch'
  | 'web-sharing-disabled'
  | 'start-failed'
  | 'startup-timeout'
  | 'authentication-failed'
  | 'token-failed'
  | 'secure-storage-unavailable'
  | 'config-invalid'
  | 'config-drift'
  | 'config-validation-failed'
  | 'config-write-failed'
  | 'shortcut-invalid'
  | 'shortcut-conflict'
  | 'directory-missing'
  | 'directory-open-failed'
  | 'operation-failed';

export interface ZellijSnapshot {
  status: 'idle' | 'starting' | 'ready' | 'error';
  error: ZellijErrorCode | null;
  configDirectory: string;
  configFile: string;
  configRevision: string;
  configExists: boolean;
  shortcuts: { splitDown: string; splitRight: string; closePane: string };
}

export interface ZellijApi {
  snapshot(params: { surfaceId: string }): Promise<ZellijSnapshot>;
  initialize(params: { surfaceId: string }): Promise<ZellijSnapshot>;
  saveShortcuts(params: {
    revision: string;
    shortcuts: ZellijSnapshot['shortcuts'];
  }): Promise<ZellijSnapshot>;
  copyConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }>;
  openConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }>;
  openSettings(): Promise<void>;
  consumeSettingsRequest(): Promise<boolean>;
  /** `surfaceId` says WHICH terminal measured; an unknown id is dropped, never guessed at. */
  setContentBounds(params: {
    surfaceId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<void>;
}

export interface ZellijWindowApi {
  openZellijWindow(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}
