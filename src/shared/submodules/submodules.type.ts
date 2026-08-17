export const SUBMODULES_HANDLER_NAME = 'SubmodulesHandler' as const;
export const SUBMODULES_STORE_HANDLER_NAME = 'SubmodulesStoreHandler' as const;
export const SUBMODULES_WINDOW_HANDLER_NAME = 'SubmodulesWindowHandler' as const;
export const SUBMODULES_SYSTEM_HANDLER_NAME = 'SubmodulesSystemHandler' as const;

export const SUBMODULES_SETTING_KEY = 'submodules_workspace' as const;
export const SUBMODULES_SETTING_SUB_KEY = 'root' as const;

/** Milliseconds between safety rescans that cover filesystem events the OS dropped. */
export const SUBMODULES_POLL_INTERVAL_MS = 10_000;
/** Milliseconds a burst of filesystem events is collapsed into one rescan. */
export const SUBMODULES_DEBOUNCE_MS = 200;

export type SubmoduleState = 'ok' | 'detached' | 'uninitialized' | 'missing' | 'error';

export type SubmoduleEntryErrorCode = 'gitdir-unreadable' | 'head-unreadable' | 'head-malformed';

export type SubmodulesErrorCode =
  | 'root-missing'
  | 'root-not-a-directory'
  | 'gitmodules-missing'
  | 'gitmodules-unreadable'
  | 'scan-failed';

export type SubmodulesOpenErrorCode = 'path-invalid' | 'path-missing' | 'ide-not-found';

export interface SubmoduleEntry {
  /** Section name declared by `.gitmodules`. */
  name: string;
  /** Path declared by `.gitmodules`, relative to the watched root. */
  path: string;
  absolutePath: string;
  url: string | null;
  /** Branch declared by `.gitmodules`, when the superproject pins one. */
  configuredBranch: string | null;
  /** Branch the submodule HEAD currently points at, or null when detached/unknown. */
  branch: string | null;
  /** Short commit the submodule HEAD resolves to. */
  commit: string | null;
  state: SubmoduleState;
  errorCode: SubmoduleEntryErrorCode | null;
}

export interface SubmodulesSnapshot {
  rootPath: string | null;
  rootName: string | null;
  scannedAt: number;
  watching: boolean;
  entries: SubmoduleEntry[];
  error: SubmodulesErrorCode | null;
}

export interface SubmodulesOpenResult {
  ok: boolean;
  via: 'running-instance' | 'launch-services' | 'path-launcher' | null;
  errorCode: SubmodulesOpenErrorCode | null;
}

/** Preload capability: reads and watches the submodule inventory, and owns its SQLite root. */
export interface SubmodulesApi {
  /** Restore the persisted root, scan it, and start watching. */
  initialize(): Promise<SubmodulesSnapshot>;
  /** Persist a new root, scan it, and restart watching. */
  setRoot(params: { rootPath: string }): Promise<SubmodulesSnapshot>;
  /** Rescan the current root without changing it. */
  refresh(): Promise<SubmodulesSnapshot>;
  /** Forget the persisted root and stop watching. */
  clearRoot(): Promise<SubmodulesSnapshot>;
}

/** Renderer capability: receives snapshots pushed by preload when the working copies change. */
export interface SubmodulesStoreApi {
  onSnapshot(params: SubmodulesSnapshot): Promise<void>;
}

/** Main capability: the two OS actions the renderer and preload cannot perform themselves. */
export interface SubmodulesSystemApi {
  chooseDirectory(): Promise<{ path: string | null }>;
  openInWebStorm(params: { path: string }): Promise<SubmodulesOpenResult>;
}

export interface SubmodulesWindowApi {
  openSubmodulesWindow(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export const createEmptySubmodulesSnapshot = (): SubmodulesSnapshot => ({
  rootPath: null,
  rootName: null,
  scannedAt: 0,
  watching: false,
  entries: [],
  error: null
});

export const isSubmoduleBranchMismatch = (entry: SubmoduleEntry): boolean =>
  Boolean(entry.configuredBranch && entry.branch && entry.configuredBranch !== entry.branch);
