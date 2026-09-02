import type {
  OnlyPreviewDescriptor,
  OnlyPreviewResult,
  OnlyPreviewTextContent
} from './onlyPreview.types';

export const ONLY_PREVIEW_READ_CHUNK_BYTES = 512 * 1024;
export const ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_IDENTITIES = 2_048;

export const onlyPreviewPreviewReadRuntimeHandlerName = (capability: string): string =>
  `OnlyPreviewPreviewReadRuntime_${capability}`;

export interface OnlyPreviewPreviewReadRuntimeIdentity {
  capability: string;
  runtimeInstanceId: string;
}

export interface OnlyPreviewPreviewReadRuntimeReadyRequest
  extends OnlyPreviewPreviewReadRuntimeIdentity {}

export type OnlyPreviewPreviewReadRuntimeReadyResult =
  | { ok: true }
  | { ok: false; error: string };

export interface OnlyPreviewPreviewReadWorkspaceBindRequest
  extends OnlyPreviewPreviewReadRuntimeIdentity {
  workspaceId: string;
  workspaceGeneration: number;
  rootPath: string;
}

export interface OnlyPreviewPreviewReadWorkspaceRef
  extends OnlyPreviewPreviewReadRuntimeIdentity {
  workspaceId: string;
  workspaceGeneration: number;
}

export interface OnlyPreviewPreviewReadPrepareGrant {
  grantId: string;
  selectionRevision: number;
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
}

export interface OnlyPreviewPreviewReadPrepareRequest
  extends OnlyPreviewPreviewReadRuntimeIdentity {
  grant: OnlyPreviewPreviewReadPrepareGrant;
}

export interface OnlyPreviewPreviewReadPreparedSelection
  extends OnlyPreviewPreviewReadPrepareGrant {
  runtimeInstanceId: string;
  descriptor: OnlyPreviewDescriptor;
}

export interface OnlyPreviewPreviewReadSelectionRef
  extends OnlyPreviewPreviewReadRuntimeIdentity {
  grantId: string;
  selectionRevision: number;
}

export interface OnlyPreviewPreviewReadDocumentResourceRequest
  extends OnlyPreviewPreviewReadSelectionRef {
  requestPath: string;
}

export interface OnlyPreviewPreviewReadDocumentResource {
  runtimeInstanceId: string;
  grantId: string;
  selectionRevision: number;
  requestPath: string;
  size: number;
}

export type OnlyPreviewPreviewReadSource =
  | { kind: 'selection' }
  | { kind: 'document'; requestPath: string };

export interface OnlyPreviewPreviewReadOpenRequest
  extends OnlyPreviewPreviewReadSelectionRef {
  sessionId: string;
  method: 'GET' | 'HEAD';
  source: OnlyPreviewPreviewReadSource;
  start: number;
  end: number;
}

export interface OnlyPreviewPreviewReadOpenResult {
  runtimeInstanceId: string;
  grantId: string;
  selectionRevision: number;
  workspaceId: string;
  relativePath: string;
  sessionId: string;
  method: 'GET' | 'HEAD';
  start: number;
  end: number;
  totalBytes: number;
  eof: boolean;
}

export interface OnlyPreviewPreviewReadChunkRequest
  extends OnlyPreviewPreviewReadSelectionRef {
  sessionId: string;
  offset: number;
}

export interface OnlyPreviewPreviewReadChunkResult {
  runtimeInstanceId: string;
  grantId: string;
  selectionRevision: number;
  sessionId: string;
  offset: number;
  bytes: ArrayBuffer;
  eof: boolean;
}

export interface OnlyPreviewPreviewReadCancelRequest
  extends OnlyPreviewPreviewReadRuntimeIdentity {
  grantId?: string;
  selectionRevision?: number;
  sessionId?: string;
}

export interface OnlyPreviewPreviewReadRuntimePrivateApi {
  ready(
    request: OnlyPreviewPreviewReadRuntimeReadyRequest
  ): Promise<OnlyPreviewPreviewReadRuntimeReadyResult>;
  bindWorkspace(
    request: OnlyPreviewPreviewReadWorkspaceBindRequest
  ): Promise<OnlyPreviewResult<void>>;
  revokeWorkspace(request: OnlyPreviewPreviewReadWorkspaceRef): Promise<OnlyPreviewResult<void>>;
  prepare(
    request: OnlyPreviewPreviewReadPrepareRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewReadPreparedSelection>>;
  inspectDocumentResource(
    request: OnlyPreviewPreviewReadDocumentResourceRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewReadDocumentResource>>;
  open(
    request: OnlyPreviewPreviewReadOpenRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewReadOpenResult>>;
  readNext(
    request: OnlyPreviewPreviewReadChunkRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewReadChunkResult>>;
  cancel(request: OnlyPreviewPreviewReadCancelRequest): Promise<OnlyPreviewResult<void>>;
}

export interface OnlyPreviewPreviewTextBrokerRequest {
  brokerCapability: string;
  hostToken: string;
  previewRuntimeToken: string;
  selectionRevision: number;
}

export interface OnlyPreviewPreviewTextChunkBrokerRequest
  extends OnlyPreviewPreviewTextBrokerRequest {
  grantId: string;
  sessionId: string;
  offset: number;
}

export interface OnlyPreviewPreviewTextCancelBrokerRequest
  extends OnlyPreviewPreviewTextBrokerRequest {
  grantId: string;
  sessionId: string;
}

export interface OnlyPreviewPreviewTextBrokerApi {
  openCurrentPreviewText(
    request: OnlyPreviewPreviewTextBrokerRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewReadOpenResult>>;
  readCurrentPreviewTextChunk(
    request: OnlyPreviewPreviewTextChunkBrokerRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewPreviewReadChunkResult>>;
  cancelCurrentPreviewText(
    request: OnlyPreviewPreviewTextCancelBrokerRequest
  ): Promise<OnlyPreviewResult<void>>;
}

export interface OnlyPreviewPreviewTextBridgeRequest {
  selectionRevision: number;
}

export interface OnlyPreviewPreviewTextBridgeApi {
  readCurrentText(
    request: OnlyPreviewPreviewTextBridgeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewTextContent>>;
}
