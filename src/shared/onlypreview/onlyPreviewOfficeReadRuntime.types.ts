import type { OnlyPreviewResult } from './onlyPreview.types';

export const ONLY_PREVIEW_OFFICE_READ_MAX_BYTES = 25 * 1024 * 1024;
export const ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES = 512 * 1024;

export type OnlyPreviewOfficePackageKind = 'xlsx' | 'docx' | 'pptx';

export const getOnlyPreviewOfficePackageKind = (
  relativePath: string
): OnlyPreviewOfficePackageKind | null => {
  const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase();
  if (extension === '.xlsx' || extension === '.xlsm') return 'xlsx';
  if (extension === '.docx') return 'docx';
  if (extension === '.pptx') return 'pptx';
  return null;
};

export const onlyPreviewOfficeReadRuntimeHandlerName = (capability: string): string =>
  `OnlyPreviewOfficeReadRuntime_${capability}`;

export interface OnlyPreviewOfficeReadRuntimeReadyRequest {
  capability: string;
  instanceId: string;
}

export type OnlyPreviewOfficeReadRuntimeReadyResult = { ok: true } | { ok: false; error: string };

export interface OnlyPreviewOfficeReadWorkspaceBindRequest {
  capability: string;
  workspaceId: string;
  rootPath: string;
}

export interface OnlyPreviewOfficePrepareGrant {
  grantId: string;
  runtimeId: string;
  selectionRevision: number;
  kind: OnlyPreviewOfficePackageKind;
  workspaceId: string;
  relativePath: string;
  maxBytes: number;
}

export interface OnlyPreviewOfficePrepareRuntimeRequest {
  capability: string;
  grant: OnlyPreviewOfficePrepareGrant;
}

export interface OnlyPreviewOfficePrepareRuntimeResult {
  grantId: string;
  runtimeId: string;
  selectionRevision: number;
  kind: OnlyPreviewOfficePackageKind;
  size: number;
  modifiedAt: number;
}

export interface OnlyPreviewOfficeReadOpenRuntimeRequest {
  capability: string;
  grantId: string;
  runtimeId: string;
  selectionRevision: number;
}

export interface OnlyPreviewOfficeReadOpenRuntimeResult {
  grantId: string;
  runtimeId: string;
  selectionRevision: number;
  totalBytes: number;
}

export interface OnlyPreviewOfficeReadChunkRuntimeRequest extends OnlyPreviewOfficeReadOpenRuntimeRequest {
  offset: number;
}

export interface OnlyPreviewOfficeReadChunkRuntimeResult {
  grantId: string;
  runtimeId: string;
  selectionRevision: number;
  offset: number;
  // electron-xpc structured-clones one bounded frame through Main; it is not transferable.
  bytes: ArrayBuffer;
  eof: boolean;
}

export interface OnlyPreviewOfficeReadRuntimeCancelRequest {
  capability: string;
  grantId?: string;
  runtimeId?: string;
  selectionRevision?: number;
}

export interface OnlyPreviewOfficeReadRuntimePrivateApi {
  ready(
    request: OnlyPreviewOfficeReadRuntimeReadyRequest
  ): Promise<OnlyPreviewOfficeReadRuntimeReadyResult>;
  bindWorkspace(
    request: OnlyPreviewOfficeReadWorkspaceBindRequest
  ): Promise<OnlyPreviewResult<void>>;
  prepare(
    request: OnlyPreviewOfficePrepareRuntimeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewOfficePrepareRuntimeResult>>;
  open(
    request: OnlyPreviewOfficeReadOpenRuntimeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewOfficeReadOpenRuntimeResult>>;
  readNext(
    request: OnlyPreviewOfficeReadChunkRuntimeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewOfficeReadChunkRuntimeResult>>;
  cancel(request: OnlyPreviewOfficeReadRuntimeCancelRequest): Promise<OnlyPreviewResult<void>>;
}

export interface OnlyPreviewOfficeReadBrokerRequest {
  brokerCapability: string;
  hostToken: string;
  previewRuntimeToken: string;
  selectionRevision: number;
}

export interface OnlyPreviewOfficeReadChunkBrokerRequest extends OnlyPreviewOfficeReadBrokerRequest {
  grantId: string;
  offset: number;
}

export interface OnlyPreviewOfficeReadCancelBrokerRequest extends OnlyPreviewOfficeReadBrokerRequest {
  grantId: string;
}

export interface OnlyPreviewOfficeReadBrokerApi {
  openCurrentOfficeRead(
    request: OnlyPreviewOfficeReadBrokerRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewOfficeReadOpenRuntimeResult>>;
  readCurrentOfficeChunk(
    request: OnlyPreviewOfficeReadChunkBrokerRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewOfficeReadChunkRuntimeResult>>;
  cancelCurrentOfficeRead(
    request: OnlyPreviewOfficeReadCancelBrokerRequest
  ): Promise<OnlyPreviewResult<void>>;
}

export interface OnlyPreviewOfficeReadBridgeRequest {
  selectionRevision: number;
}

export interface OnlyPreviewOfficeReadContent {
  selectionRevision: number;
  bytes: ArrayBuffer;
}

export interface OnlyPreviewOfficeReadBridgeApi {
  readCurrentOfficeBytes(
    request: OnlyPreviewOfficeReadBridgeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewOfficeReadContent>>;
}
