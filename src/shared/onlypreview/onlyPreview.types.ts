export const ONLY_PREVIEW_SCHEME = 'bitterless-preview' as const;
export const ONLY_PREVIEW_MAX_INDEX_ENTRIES = 20_000;
export const ONLY_PREVIEW_MAX_INDEX_DEPTH = 32;
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
  | 'presentation'
  | 'diagram'
  | 'unsupported';
export type OnlyPreviewTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';
export type OnlyPreviewPreviewSurface = 'chrome' | 'vue';
export type OnlyPreviewPreviewAdapterId =
  | 'monaco'
  | 'markdown-dom'
  | 'html-page'
  | 'chromium-pdf'
  | 'ooxml-xlsx'
  | 'ooxml-docx'
  | 'ooxml-pptx'
  | 'drawio-viewer'
  | 'image'
  | 'audio'
  | 'video'
  | 'unsupported';
export type OnlyPreviewPreviewPresentationStatus = 'empty' | 'loading' | 'ready' | 'unavailable';
export type OnlyPreviewFindMode = 'webcontents-find' | 'content-adapter' | 'none';
export type OnlyPreviewFindUnavailableReason =
  | 'non-text'
  | 'unsupported'
  | 'size-limit'
  | 'render-failed';

export type OnlyPreviewFindCoverage =
  | { kind: 'complete' }
  | {
      kind: 'partial';
      reason: 'sheet-model-cap';
      acceptedSheets: number;
      acceptedCells: number;
    };

export type OnlyPreviewFindCapability =
  | { mode: 'webcontents-find' }
  | { mode: 'content-adapter'; adapter: 'monaco' | 'office' };

interface OnlyPreviewFindStateBase extends OnlyPreviewHostEvent {
  selectionRevision: number;
  surface: OnlyPreviewPreviewSurface;
  findRevision: number;
}

export type OnlyPreviewFindState =
  | (OnlyPreviewFindStateBase & { state: 'pending' })
  | (OnlyPreviewFindStateBase & {
      state: 'ready';
      capability: OnlyPreviewFindCapability;
      coverage: OnlyPreviewFindCoverage;
    })
  | (OnlyPreviewFindStateBase & {
      state: 'unavailable';
      reason: OnlyPreviewFindUnavailableReason;
    });

export interface OnlyPreviewFindResult extends OnlyPreviewFindStateBase {
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
  coverage: OnlyPreviewFindCoverage;
}

export interface OnlyPreviewFindSnapshot {
  state: OnlyPreviewFindState;
  open: boolean;
  query: string;
  caseSensitive: boolean;
  result: OnlyPreviewFindResult | null;
}

export interface OnlyPreviewFindIntent extends OnlyPreviewHostRequest {
  selectionRevision: number;
  surface: OnlyPreviewPreviewSurface;
  query: string;
  caseSensitive: boolean;
  direction: 'forward' | 'backward';
  findNext: boolean;
}

export interface OnlyPreviewFindCommand extends Omit<OnlyPreviewFindIntent, 'hostToken'> {
  hostId: string;
  findRevision: number;
  adapter: 'monaco' | 'office';
}

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
  | 'NAME_INVALID'
  | 'NAME_EXISTS'
  | 'PATH_UNSUPPORTED_DEVICE'
  | 'TEXT_TOO_LARGE'
  | 'SIGNATURE_MISMATCH'
  | 'OOXML_ARCHIVE_LIMIT'
  | 'OOXML_ENCRYPTED'
  | 'OOXML_ARCHIVE_INVALID'
  | 'SHEET_PARSE_FAILED'
  | 'SHEET_RENDER_FAILED'
  | 'SHEET_EMPTY'
  | 'SHEET_RENDER_TIMEOUT'
  | 'DOCUMENT_PARSE_FAILED'
  | 'DOCUMENT_RENDER_FAILED'
  | 'DOCUMENT_EMPTY'
  | 'DOCUMENT_SANITIZE_FAILED'
  | 'DOCUMENT_RENDER_TIMEOUT'
  | 'PRESENTATION_PARSE_FAILED'
  | 'PRESENTATION_RENDER_FAILED'
  | 'PRESENTATION_EMPTY'
  | 'PRESENTATION_RENDER_TIMEOUT'
  | 'DIAGRAM_PARSE_FAILED'
  | 'DIAGRAM_EMPTY'
  | 'DIAGRAM_LIMIT'
  | 'DIAGRAM_RENDER_TIMEOUT'
  | 'IMAGE_EMPTY'
  | 'IMAGE_READ_FAILED'
  | 'IMAGE_DECODE_FAILED'
  | 'MEDIA_EMPTY'
  | 'MEDIA_READ_FAILED'
  | 'MEDIA_ABORTED'
  | 'MEDIA_NETWORK_FAILED'
  | 'MEDIA_DECODE_FAILED'
  | 'MEDIA_SOURCE_UNSUPPORTED'
  | 'SETTINGS_INVALID'
  | 'INDEX_FAILED'
  | 'INDEX_PROTOCOL_ERROR'
  | 'PDF_VIEWER_UNAVAILABLE'
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

export type OnlyPreviewProjectItemCopyKind = 'item' | 'absolute-path' | 'relative-path' | 'name';

export interface OnlyPreviewProjectItemCopyRequest
  extends OnlyPreviewHostRequest, OnlyPreviewFileRef {
  copyKind: OnlyPreviewProjectItemCopyKind;
}

export interface OnlyPreviewProjectRootRequest extends OnlyPreviewHostRequest {
  workspaceId: string;
}

export interface OnlyPreviewCreateProjectFolderRequest extends OnlyPreviewProjectRootRequest {
  parentRelativePath: string;
}

export interface OnlyPreviewRenameProjectItemRequest
  extends OnlyPreviewHostRequest, OnlyPreviewFileRef {
  name: string;
}

export interface OnlyPreviewProjectEntry {
  relativePath: string;
  name: string;
  nodeKind: 'file' | 'directory';
}

export interface OnlyPreviewProjectRootCopyRequest extends OnlyPreviewProjectRootRequest {
  copyKind: OnlyPreviewProjectItemCopyKind;
}

export type OnlyPreviewGlobalSearchFocusOrigin = 'shell' | 'vue' | 'chrome';

export interface OnlyPreviewGlobalSearchCloseRequest extends OnlyPreviewHostRequest {
  mode: 'opener' | 'project' | 'preview' | 'discard';
}

export interface OnlyPreviewGlobalSearchWorkspaceContext {
  workspaceId: string;
  generation: number;
  ready: boolean;
  rootName: string;
  currentDirectoryRelativePath: string;
}

export interface OnlyPreviewGlobalSearchLayout {
  viewBounds: OnlyPreviewBounds;
  workspaceBounds: OnlyPreviewBounds;
}

export interface OnlyPreviewGlobalSearchContextSnapshot {
  revision: number;
  active: boolean;
  workspace: OnlyPreviewGlobalSearchWorkspaceContext | null;
  layout: OnlyPreviewGlobalSearchLayout | null;
}

export interface OnlyPreviewGlobalSearchContextReportRequest extends OnlyPreviewHostRequest {
  workspace: OnlyPreviewGlobalSearchWorkspaceContext | null;
}

export interface OnlyPreviewGlobalSearchVisibilityEvent extends OnlyPreviewHostEvent {
  revision: number;
  active: boolean;
}

export interface OnlyPreviewGlobalSearchLayoutEvent extends OnlyPreviewHostEvent {
  revision: number;
  layout: OnlyPreviewGlobalSearchLayout;
}

export interface OnlyPreviewGlobalSearchDirectoryRevealRequest extends OnlyPreviewHostRequest {
  workspaceId: string;
  generation: number;
  relativePath: string;
}

export interface OnlyPreviewGlobalSearchDirectoryRevealAction extends OnlyPreviewHostEvent {
  actionId: string;
  workspaceId: string;
  generation: number;
  relativePath: string;
}

export interface OnlyPreviewGlobalSearchDirectoryRevealCompletion extends OnlyPreviewHostRequest {
  actionId: string;
  workspaceId: string;
  generation: number;
  relativePath: string;
  succeeded: boolean;
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
  code:
    | 'TEXT_TOO_LARGE'
    | 'SIGNATURE_MISMATCH'
    | 'UNSUPPORTED_CODEC'
    | 'OOXML_ENCRYPTED'
    | 'DIAGRAM_EMPTY'
    | 'IMAGE_EMPTY'
    | 'MEDIA_EMPTY';
  message: string;
}

export const ONLY_PREVIEW_DEFAULT_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

export const ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES = {
  monaco: 8 * 1024 * 1024,
  'markdown-dom': 1024 * 1024,
  'html-page': 1024 * 1024,
  'chromium-pdf': 100 * 1024 * 1024,
  'ooxml-xlsx': 25 * 1024 * 1024,
  'ooxml-docx': 25 * 1024 * 1024,
  'ooxml-pptx': 25 * 1024 * 1024,
  'drawio-viewer': 20 * 1024 * 1024,
  image: 100 * 1024 * 1024,
  audio: null,
  video: null
} as const satisfies Partial<Record<OnlyPreviewPreviewAdapterId, number | null>>;

export const getOnlyPreviewFileSizeLimit = (
  adapterId: OnlyPreviewPreviewAdapterId
): number | null => {
  if (Object.prototype.hasOwnProperty.call(ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES, adapterId)) {
    return ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES[
      adapterId as keyof typeof ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES
    ];
  }
  return ONLY_PREVIEW_DEFAULT_FILE_SIZE_LIMIT_BYTES;
};

// Compatibility names keep format-local validators readable while all admission and asset
// issuance use getOnlyPreviewFileSizeLimit(), the single policy source of truth.
export const ONLY_PREVIEW_MAX_TEXT_BYTES = ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES.monaco;
export const ONLY_PREVIEW_MAX_MARKDOWN_BYTES =
  ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES['markdown-dom'];
export const ONLY_PREVIEW_MAX_HTML_BYTES = ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES['html-page'];
export const ONLY_PREVIEW_MAX_PDF_BYTES = ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES['chromium-pdf'];
export const ONLY_PREVIEW_MAX_IMAGE_BYTES = ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES.image;
export const ONLY_PREVIEW_MAX_SHEET_BYTES = ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES['ooxml-xlsx'];
export const ONLY_PREVIEW_MAX_DOCUMENT_BYTES = ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES['ooxml-docx'];
export const ONLY_PREVIEW_MAX_PRESENTATION_BYTES =
  ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES['ooxml-pptx'];
export const ONLY_PREVIEW_MAX_DIAGRAM_BYTES =
  ONLY_PREVIEW_FILE_SIZE_LIMIT_OVERRIDES['drawio-viewer'];

export interface OnlyPreviewDescriptor {
  workspaceId: string;
  relativePath: string;
  name: string;
  extension: string;
  kind: OnlyPreviewKind;
  mimeType: string;
  language: string;
  size: number;
  modifiedAt: number;
  assetUrl?: string;
  unsupportedCategory?: 'image-format' | 'video-container';
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
  // Derived by Main at snapshot time, never stored on the presentation: the Project's index state
  // outlives the selection, and every path that binds a Project clears the presentation right after
  // binding it, which would erase a stored value microseconds after it was set.
  projectIndexState: OnlyPreviewProjectIndexState | null;
}

export interface OnlyPreviewPreviewRuntimeRequest extends OnlyPreviewHostRequest {
  previewRuntimeToken: string;
}

export interface OnlyPreviewPreviewRevisionRequest extends OnlyPreviewPreviewRuntimeRequest {
  selectionRevision: number;
}

export interface OnlyPreviewPreviewReadyRequest extends OnlyPreviewPreviewRevisionRequest {
  findCoverage?: OnlyPreviewFindCoverage;
  findAdapter?: 'monaco' | 'office';
}

export interface OnlyPreviewFindResultRequest extends OnlyPreviewPreviewRuntimeRequest {
  result: OnlyPreviewFindResult;
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
export const ONLY_PREVIEW_GLOBAL_SEARCH_CONTEXT_CHANGED_EVENT =
  'onlypreview/globalSearchContextChanged' as const;
export const ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT =
  'onlypreview/globalSearchVisibility' as const;
export const ONLY_PREVIEW_GLOBAL_SEARCH_LAYOUT_EVENT = 'onlypreview/globalSearchLayout' as const;
export const ONLY_PREVIEW_GLOBAL_SEARCH_REVEAL_DIRECTORY_EVENT =
  'onlypreview/globalSearchRevealDirectory' as const;
// The native context menu lives in Main, but the tree row that has to become editable lives in the
// shell renderer, so the menu click is delivered as an intent and the renderer owns the edit.
// Copy Path / Copy Name are window-wide shortcuts owned by Main, so they reach the shell as an
// intent: only the shell knows which Project row is selected.
export const ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT = 'onlypreview/copyProjectItem' as const;
export const ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT = 'onlypreview/projectNewFolder' as const;
export const ONLY_PREVIEW_PROJECT_RENAME_EVENT = 'onlypreview/projectRename' as const;
export const ONLY_PREVIEW_SETTINGS_CHANGED_EVENT = 'onlypreview/settingsChanged' as const;
export const ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT =
  'onlypreview/characterCountChanged' as const;
export const ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT = 'onlypreview/characterCountReady' as const;
export const ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT = 'onlypreview/previewPresentation' as const;
export const ONLY_PREVIEW_FIND_STATE_EVENT = 'onlypreview/findState' as const;
export const ONLY_PREVIEW_FIND_FOCUS_EVENT = 'onlypreview/findFocus' as const;
export const ONLY_PREVIEW_FIND_COMMAND_EVENT = 'onlypreview/findCommand' as const;
// The alert renderer pulls the dialog stack with `getAlertSnapshot` and this only tells it that the
// stack changed. A lazily created renderer misses broadcasts sent before it subscribed, and a
// broadcast has no replay, so the state itself must never travel in the event.
export const ONLY_PREVIEW_ALERT_STATE_EVENT = 'onlypreview/alertState' as const;

// `failed` is not a search-engine state. It is the terminal Main needs: a first build that throws
// before an index exists emits no snapshot at all, so without it the preview pane would animate
// "Loading project" forever while the Project rail already shows the failure.
export type OnlyPreviewProjectIndexState = 'building' | 'reconciling' | 'ready' | 'failed';

export interface OnlyPreviewCopyProjectItemEvent extends OnlyPreviewHostEvent {
  copyKind: Extract<OnlyPreviewProjectItemCopyKind, 'absolute-path' | 'name'>;
}

// Carries the folder Main has already created, not the parent to create in: the name is collected
// by the alert-layer dialog and nothing is written until it is confirmed, so the tree's only job is
// to make the finished row appear.
export interface OnlyPreviewProjectNewFolderEvent extends OnlyPreviewHostEvent {
  workspaceId: string;
  relativePath: string;
}

export interface OnlyPreviewProjectRenameEvent extends OnlyPreviewHostEvent {
  workspaceId: string;
  relativePath: string;
}

export interface OnlyPreviewFocusSearchEvent extends OnlyPreviewHostEvent {
  origin: OnlyPreviewGlobalSearchFocusOrigin;
}

export interface OnlyPreviewApi {
  openOnlyPreviewWindow(): Promise<OnlyPreviewResult<void>>;
  reportShellMounted(params: OnlyPreviewHostRequest & {
    openTag: string;
    phase: 'renderer-script' | 'renderer-language' | 'renderer-import' | 'renderer-mount' | 'renderer-receipt';
    outcome?: 'success' | 'failure';
  }): Promise<OnlyPreviewResult<void>>;
  chooseFolder(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  restoreWorkspace(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
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
  reportPreviewReady(params: OnlyPreviewPreviewReadyRequest): Promise<OnlyPreviewResult<void>>;
  reportPreviewError(params: OnlyPreviewPreviewErrorRequest): Promise<OnlyPreviewResult<void>>;
  getPreviewFindSnapshot(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewFindSnapshot>>;
  submitPreviewFind(params: OnlyPreviewFindIntent): Promise<OnlyPreviewResult<void>>;
  closePreviewFind(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  reportGlobalSearchContext(
    params: OnlyPreviewGlobalSearchContextReportRequest
  ): Promise<OnlyPreviewResult<void>>;
  getGlobalSearchContext(
    params: OnlyPreviewHostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchContextSnapshot>>;
  revealGlobalSearchDirectory(
    params: OnlyPreviewGlobalSearchDirectoryRevealRequest
  ): Promise<OnlyPreviewResult<boolean>>;
  reportGlobalSearchDirectoryReveal(
    params: OnlyPreviewGlobalSearchDirectoryRevealCompletion
  ): Promise<OnlyPreviewResult<void>>;
  closeGlobalSearch(
    params: OnlyPreviewGlobalSearchCloseRequest
  ): Promise<OnlyPreviewResult<boolean>>;
  reportPreviewFindResult(params: OnlyPreviewFindResultRequest): Promise<OnlyPreviewResult<void>>;
  minimizeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  toggleMaximizeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  closeWindow(params: OnlyPreviewHostRequest): Promise<OnlyPreviewResult<void>>;
  showFileContextMenu(
    params: OnlyPreviewHostRequest &
      OnlyPreviewFileRef & {
        // The tree selection, so Delete can act on all of it when the clicked row is part of it.
        // Only the shell knows which rows are selected, and Main re-validates every entry.
        selection?: { relativePath: string; nodeKind: 'file' | 'directory' }[];
      }
  ): Promise<OnlyPreviewResult<void>>;
  showProjectRootContextMenu(
    params: OnlyPreviewProjectRootRequest
  ): Promise<OnlyPreviewResult<void>>;
  reportProjectIndexFailed(params: OnlyPreviewProjectRootRequest): Promise<OnlyPreviewResult<void>>;
  copyProjectItem(params: OnlyPreviewProjectItemCopyRequest): Promise<OnlyPreviewResult<void>>;
  createProjectFolder(
    params: OnlyPreviewCreateProjectFolderRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewProjectEntry>>;
  renameProjectItem(
    params: OnlyPreviewRenameProjectItemRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewProjectEntry>>;
  copyProjectRoot(params: OnlyPreviewProjectRootCopyRequest): Promise<OnlyPreviewResult<void>>;
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
