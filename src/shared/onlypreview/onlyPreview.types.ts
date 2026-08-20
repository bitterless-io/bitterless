export const ONLY_PREVIEW_SCHEME = 'bitterless-preview' as const;
export const ONLY_PREVIEW_MAX_INDEX_ENTRIES = 20_000;
export const ONLY_PREVIEW_MAX_INDEX_DEPTH = 32;
export const ONLY_PREVIEW_MAX_TEXT_BYTES = 8 * 1024 * 1024;
export const ONLY_PREVIEW_MAX_MARKDOWN_BYTES = 1024 * 1024;
export const ONLY_PREVIEW_MAX_HTML_BYTES = 1024 * 1024;
export const ONLY_PREVIEW_MAX_PDF_BYTES = 100 * 1024 * 1024;
export const ONLY_PREVIEW_MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const ONLY_PREVIEW_MAX_SHEET_BYTES = 25 * 1024 * 1024;
export const ONLY_PREVIEW_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES = 25 * 1024 * 1024;
export const ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES = 100 * 1024 * 1024;
export const ONLY_PREVIEW_MAX_ABSOLUTE_PATH_LENGTH = 16_384;

export type OnlyPreviewHostKind = 'standalone' | 'settings' | 'guide';
export type OnlyPreviewHostRole = 'content' | 'settings' | 'guide';
export type OnlyPreviewNodeKind = 'file' | 'directory' | 'symlink';
export type OnlyPreviewKind =
  | 'text'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'sheet'
  | 'document'
  | 'unsupported';
export type OnlyPreviewTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';
export type OnlyPreviewPreviewSurface = 'chrome' | 'vue';
export type OnlyPreviewPreviewAdapterId =
  | 'monaco'
  | 'markdown-dom'
  | 'html-page'
  | 'chromium-pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'unsupported';
export type OnlyPreviewPreviewPresentationStatus = 'empty' | 'loading' | 'ready' | 'unavailable';

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
  mediaType: 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'unknown';
  isText: boolean;
}

export interface OnlyPreviewIndex {
  workspaceId: string;
  entries: OnlyPreviewIndexEntry[];
  truncated: boolean;
  limit: number;
}

export interface OnlyPreviewDescriptorError {
  code: 'TEXT_TOO_LARGE' | 'SIGNATURE_MISMATCH' | 'UNSUPPORTED_CODEC';
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

export interface OnlyPreviewAgentSkillGuideInfo {
  serverName: string;
  skillVersionCode: string;
  instruction: string;
}

export interface OnlyPreviewHostEvent {
  hostId: string;
}

export interface OnlyPreviewPreviewPresentation extends OnlyPreviewHostEvent {
  workspaceId: string | null;
  selectionRevision: number;
  surface: OnlyPreviewPreviewSurface;
  adapterId: OnlyPreviewPreviewAdapterId;
  status: OnlyPreviewPreviewPresentationStatus;
  fileRef: OnlyPreviewFileRef | null;
  descriptor: OnlyPreviewDescriptor | null;
  error: OnlyPreviewErrorPayload | null;
  selectedTextAvailable: boolean;
}

export interface OnlyPreviewPreviewRuntimeRequest extends OnlyPreviewHostRequest {
  previewRuntimeToken: string;
}

export interface OnlyPreviewPreviewRevisionRequest extends OnlyPreviewPreviewRuntimeRequest {
  selectionRevision: number;
}

export interface OnlyPreviewTextReadRequest
  extends OnlyPreviewPreviewRevisionRequest, OnlyPreviewFileRef {
  adapterId: 'monaco' | 'markdown-dom';
}

export interface OnlyPreviewPreviewErrorRequest extends OnlyPreviewPreviewRevisionRequest {
  errorCode: OnlyPreviewErrorCode;
}

export interface OnlyPreviewCharacterCountEvent extends OnlyPreviewHostEvent {
  characterCount: number;
}

export interface OnlyPreviewCharacterCountRevisionEvent extends OnlyPreviewHostEvent {
  revision: string;
}

export const ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT = 'onlypreview/workspaceChanged' as const;
export const ONLY_PREVIEW_SELECTION_CHANGED_EVENT = 'onlypreview/selectionChanged' as const;
export const ONLY_PREVIEW_REFRESH_EVENT = 'onlypreview/refresh' as const;
export const ONLY_PREVIEW_FOCUS_PROJECT_EVENT = 'onlypreview/focusProject' as const;
export const ONLY_PREVIEW_FOCUS_SEARCH_EVENT = 'onlypreview/focusSearch' as const;
export const ONLY_PREVIEW_SETTINGS_CHANGED_EVENT = 'onlypreview/settingsChanged' as const;
export const ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT =
  'onlypreview/characterCountChanged' as const;
export const ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT = 'onlypreview/characterCountReady' as const;
export const ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT = 'onlypreview/previewPresentation' as const;

export interface OnlyPreviewApi {
  openOnlyPreviewWindow(): Promise<OnlyPreviewResult<void>>;
  chooseFolder(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  restoreWorkspace(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  readText(params: OnlyPreviewTextReadRequest): Promise<OnlyPreviewResult<OnlyPreviewTextContent>>;
  selectStandaloneFile(
    params: OnlyPreviewHostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<void>>;
  updatePreviewBounds(
    params: OnlyPreviewHostRequest & OnlyPreviewBounds
  ): Promise<OnlyPreviewResult<void>>;
  getPreviewPresentation(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewPresentation>>;
  getVuePreviewPresentation(
    params: OnlyPreviewPreviewRuntimeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewPresentation>>;
  reportPreviewReset(params: OnlyPreviewPreviewRevisionRequest): Promise<OnlyPreviewResult<void>>;
  reportPreviewReady(params: OnlyPreviewPreviewRevisionRequest): Promise<OnlyPreviewResult<void>>;
  reportPreviewError(params: OnlyPreviewPreviewErrorRequest): Promise<OnlyPreviewResult<void>>;
  minimizeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  toggleMaximizeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  closeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  showFileContextMenu(
    params: OnlyPreviewHostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<void>>;
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
  openAgentSkillGuide(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  getAgentSkillGuideInfo(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewAgentSkillGuideInfo>>;
}
