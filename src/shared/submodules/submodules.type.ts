export const SUBMODULES_HANDLER_NAME = 'SubmodulesHandler' as const;
export const SUBMODULES_WINDOW_HANDLER_NAME = 'SubmodulesWindowHandler' as const;
export const SUBMODULES_SYSTEM_HANDLER_NAME = 'SubmodulesSystemHandler' as const;

/** Main broadcasts a changed snapshot here; every Submodules renderer subscribes to it. */
export const SUBMODULES_SNAPSHOT_EVENT = 'submodules/snapshot' as const;

export const SUBMODULES_SETTING_KEY = 'submodules_workspace' as const;
export const SUBMODULES_SETTING_SUB_KEY = 'root' as const;
/** List controls live beside the root under the same setting key, so both hosts share them. */
export const SUBMODULES_VIEW_SETTING_SUB_KEY = 'view' as const;

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
  /**
   * Newest modification time (ms) observed among the working copy's own Git state — the submodule
   * directory entry, `HEAD`, `index`, `packed-refs`, and the branch ref file. It answers "which
   * repository did I last work in", and is null when nothing could be read. Deliberately *not* a
   * recursive working-tree scan: see `docs/features/submodules.md`.
   */
  changedAt: number | null;
}

/** `name` — ASCII by directory name. `updated` — newest `changedAt` first. */
export type SubmodulesSortMode = 'name' | 'updated';

export interface SubmodulesViewSettings {
  /** Branch-mismatched submodules are listed before every other row. */
  showDiffOnTop: boolean;
  sortMode: SubmodulesSortMode;
}

export interface SubmodulesSnapshot {
  rootPath: string | null;
  rootName: string | null;
  scannedAt: number;
  watching: boolean;
  entries: SubmoduleEntry[];
  error: SubmodulesErrorCode | null;
  /** Persisted list controls, carried by the snapshot so every host renders the same order. */
  settings: SubmodulesViewSettings;
}

export interface SubmodulesOpenResult {
  ok: boolean;
  /**
   * `reveal-in-project` — a file inside the submodule was opened in the workspace project, so the
   * IDE located the submodule. `root-project` — the submodule holds no file to open (an
   * uninitialized submodule is empty), so only the workspace root was handed over.
   * `launch-services` — no launcher was usable and the root was opened through the OS, without the
   * reveal.
   */
  via: 'reveal-in-project' | 'root-project' | 'launch-services' | null;
  errorCode: SubmodulesOpenErrorCode | null;
}

/**
 * Main capability: one application-wide runtime that reads and watches the submodule inventory and
 * owns its SQLite root. Every renderer calls these methods and otherwise waits for
 * `SUBMODULES_SNAPSHOT_EVENT`.
 */
export interface SubmodulesApi {
  /** Restore the persisted root, scan it, and arm the watcher. Idempotent across views. */
  initialize(): Promise<SubmodulesSnapshot>;
  /** Persist a new root, scan it, and re-arm watching. */
  setRoot(params: { rootPath: string }): Promise<SubmodulesSnapshot>;
  /** Rescan the current root without changing it. */
  refresh(): Promise<SubmodulesSnapshot>;
  /** Forget the persisted root and stop watching. */
  clearRoot(): Promise<SubmodulesSnapshot>;
  /** Persist one or both list controls and republish the reordered snapshot to every view. */
  updateViewSettings(params: Partial<SubmodulesViewSettings>): Promise<SubmodulesSnapshot>;
}

/** Main capability: the two OS actions the renderer and preload cannot perform themselves. */
export interface SubmodulesSystemApi {
  chooseDirectory(): Promise<{ path: string | null }>;
  /**
   * Locate a submodule in WebStorm. `rootPath` is the watched workspace root and the only project
   * the IDE is ever asked to open; `path` is the submodule directory to reveal inside it.
   */
  openInWebStorm(params: { rootPath: string; path: string }): Promise<SubmodulesOpenResult>;
}

/**
 * Main capability addressing the standalone Submodules window only. An Omni-hosted renderer must
 * never call it, so an open standalone window is never moved by an embedded cell.
 */
export interface SubmodulesWindowApi {
  openSubmodulesWindow(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export type SubmodulesHost = 'standalone' | 'omni';

/** Static preload context: which host renders this Submodules instance. */
export interface SubmodulesEnvApi {
  host: SubmodulesHost;
}

/** Mismatch-first is the owner default: a drifted submodule is the row worth seeing without looking. */
export const createDefaultSubmodulesViewSettings = (): SubmodulesViewSettings => ({
  showDiffOnTop: true,
  sortMode: 'name'
});

export const createEmptySubmodulesSnapshot = (): SubmodulesSnapshot => ({
  rootPath: null,
  rootName: null,
  scannedAt: 0,
  watching: false,
  entries: [],
  error: null,
  settings: createDefaultSubmodulesViewSettings()
});

export const isSubmoduleBranchMismatch = (entry: SubmoduleEntry): boolean =>
  Boolean(entry.configuredBranch && entry.branch && entry.configuredBranch !== entry.branch);

/**
 * Row title: the submodule's own directory name. `.gitmodules` section names are path-shaped
 * (`projects/bitterless`), so the declared path carries the relative location and the title must not
 * repeat it.
 */
export const submoduleDisplayName = (entry: SubmoduleEntry): string => {
  const segments = (entry.path || entry.name).split('/').filter(Boolean);
  return segments[segments.length - 1] ?? entry.name;
};
