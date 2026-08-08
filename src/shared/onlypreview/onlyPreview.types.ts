export const ONLY_PREVIEW_SCHEME = 'bitterless-preview' as const;
export const ONLY_PREVIEW_MAX_INDEX_ENTRIES = 20_000;
export const ONLY_PREVIEW_MAX_INDEX_DEPTH = 32;
export const ONLY_PREVIEW_MAX_TEXT_BYTES = 8 * 1024 * 1024;

export type OnlyPreviewHostKind = 'standalone' | 'settings';
export type OnlyPreviewHostRole = 'content' | 'settings';
export type OnlyPreviewTargetKind = 'file' | 'directory';
export type OnlyPreviewNodeKind = 'file' | 'directory' | 'symlink';
export type OnlyPreviewKind = 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'unsupported';
export type OnlyPreviewTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

export type OnlyPreviewErrorCode =
  | 'INVALID_INPUT'
  | 'HOST_NOT_FOUND'
  | 'HOST_ROLE_DENIED'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_ACCESS_DENIED'
  | 'PATH_NOT_FOUND'
  | 'PATH_PERMISSION_DENIED'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_NOT_REGULAR_FILE'
  | 'PATH_UNSUPPORTED_DEVICE'
  | 'TEXT_TOO_LARGE'
  | 'BINARY_TEXT'
  | 'INVALID_ENCODING'
  | 'SIGNATURE_MISMATCH'
  | 'SETTINGS_INVALID'
  | 'INDEX_FAILED'
  | 'OPERATION_FAILED'
  | 'PROTOCOL_ERROR';

export interface OnlyPreviewErrorPayload {
  code: OnlyPreviewErrorCode;
  message: string;
}

export type OnlyPreviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: OnlyPreviewErrorPayload };

export interface OnlyPreviewHostRequest {
  hostToken: string;
}

export interface OnlyPreviewWorkspace {
  workspaceId: string;
  rootName: string;
  displayPath: string;
  selectedRelativePath?: string;
}

export interface OnlyPreviewFileRef {
  workspaceId: string;
  relativePath: string;
}

export interface OnlyPreviewIndexEntry {
  relativePath: string;
  parentRelativePath: string;
  name: string;
  nodeKind: OnlyPreviewNodeKind;
  size: number;
  modifiedAt: number;
  previewHint: OnlyPreviewKind;
}

export interface OnlyPreviewIndex {
  workspaceId: string;
  entries: OnlyPreviewIndexEntry[];
  truncated: boolean;
  limit: number;
}

export interface OnlyPreviewDescriptorError {
  code: 'SIGNATURE_MISMATCH' | 'UNSUPPORTED_CODEC';
  message: string;
}

export interface OnlyPreviewDescriptor {
  workspaceId: string;
  relativePath: string;
  name: string;
  displayPath: string;
  extension: string;
  kind: OnlyPreviewKind;
  mimeType: string;
  language: string;
  size: number;
  modifiedAt: number;
  assetUrl?: string;
  previewError?: OnlyPreviewDescriptorError;
}

export interface OnlyPreviewTextContent {
  workspaceId: string;
  relativePath: string;
  text: string;
  encoding: OnlyPreviewTextEncoding;
  size: number;
}

export interface OnlyPreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OnlyPreviewSettings {
  theme: 'light';
  editorFontSize: number;
  wordWrap: boolean;
  showHiddenFiles: boolean;
  openFilesWithSingleClick: boolean;
}

export interface OnlyPreviewHostEvent {
  hostId: string;
}

export const ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT = 'onlypreview/workspaceChanged' as const;
export const ONLY_PREVIEW_SELECTION_CHANGED_EVENT = 'onlypreview/selectionChanged' as const;
export const ONLY_PREVIEW_REFRESH_EVENT = 'onlypreview/refresh' as const;
export const ONLY_PREVIEW_FOCUS_PROJECT_EVENT = 'onlypreview/focusProject' as const;
export const ONLY_PREVIEW_FOCUS_SEARCH_EVENT = 'onlypreview/focusSearch' as const;
export const ONLY_PREVIEW_SETTINGS_CHANGED_EVENT = 'onlypreview/settingsChanged' as const;

export interface OnlyPreviewApi {
  openOnlyPreviewWindow(): Promise<OnlyPreviewResult<void>>;
  chooseTarget(
    params: OnlyPreviewHostRequest & { kind: OnlyPreviewTargetKind }
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  restoreWorkspace(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  buildIndex(
    params: OnlyPreviewHostRequest & { workspaceId: string }
  ): Promise<OnlyPreviewResult<OnlyPreviewIndex>>;
  describeFile(
    params: OnlyPreviewHostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<OnlyPreviewDescriptor>>;
  readText(
    params: OnlyPreviewHostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<OnlyPreviewTextContent>>;
  selectStandaloneFile(
    params: OnlyPreviewHostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<void>>;
  updatePreviewBounds(
    params: OnlyPreviewHostRequest & OnlyPreviewBounds
  ): Promise<OnlyPreviewResult<void>>;
  minimizeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  toggleMaximizeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  closeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  openExternally(
    params: OnlyPreviewHostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<void>>;
  revealInFolder(
    params: OnlyPreviewHostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<void>>;
  getSettings(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<OnlyPreviewSettings>>;
  saveSettings(
    params: OnlyPreviewHostRequest & { settings: OnlyPreviewSettings }
  ): Promise<OnlyPreviewResult<OnlyPreviewSettings>>;
  openSettings(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  closeSettings(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
}
