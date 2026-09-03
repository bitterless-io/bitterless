import type { OnlyPreviewResult } from './onlyPreview.types';

export const onlyPreviewFileAuthorityRuntimeHandlerName = (capability: string): string =>
  `OnlyPreviewFileAuthorityRuntime_${capability}`;

export interface OnlyPreviewFileAuthorityRuntimeIdentity {
  capability: string;
  runtimeInstanceId: string;
}

export interface OnlyPreviewFileAuthorityRuntimeReadyRequest extends OnlyPreviewFileAuthorityRuntimeIdentity {}

export type OnlyPreviewFileAuthorityRuntimeReadyResult =
  | { ok: true }
  | { ok: false; error: string };

export interface OnlyPreviewFileAuthorityTargetInspectionRequest extends OnlyPreviewFileAuthorityRuntimeIdentity {
  absoluteTarget: string;
}

export interface OnlyPreviewValidatedTarget {
  rootRealPath: string;
  rootName: string;
  displayPath: string;
  selectedRelativePath?: string;
}

export interface OnlyPreviewFileAuthorityWorkspaceBindRequest extends OnlyPreviewFileAuthorityRuntimeIdentity {
  workspaceId: string;
  rootPath: string;
}

export interface OnlyPreviewFileAuthorityWorkspaceBinding {
  runtimeInstanceId: string;
  workspaceId: string;
  workspaceGeneration: number;
}

export interface OnlyPreviewFileAuthorityWorkspaceRef extends OnlyPreviewFileAuthorityRuntimeIdentity {
  workspaceId: string;
  workspaceGeneration: number;
}

export interface OnlyPreviewFileAuthorityItemRequest extends OnlyPreviewFileAuthorityWorkspaceRef {
  relativePath: string;
}

export interface OnlyPreviewFileAuthorityTarget {
  runtimeInstanceId: string;
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
  name: string;
  nodeKind: 'file' | 'directory';
  canonicalPath: string;
  size: number;
  modifiedAt: number;
}

export interface OnlyPreviewFileAuthorityCreateDirectoryRequest
  extends OnlyPreviewFileAuthorityWorkspaceRef {
  parentRelativePath: string;
  name: string;
}

export interface OnlyPreviewFileAuthorityRenameRequest extends OnlyPreviewFileAuthorityItemRequest {
  name: string;
}

export interface OnlyPreviewFileAuthorityDeleteGrant {
  runtimeInstanceId: string;
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
  name: string;
  grantId: string;
  size: number;
  modifiedAt: number;
}

export interface OnlyPreviewFileAuthorityDeleteGrantRequest extends OnlyPreviewFileAuthorityWorkspaceRef {
  grantId: string;
  relativePath: string;
}

export interface OnlyPreviewFileAuthorityDeleteResult {
  runtimeInstanceId: string;
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
  grantId: string;
  size: number;
  modifiedAt: number;
}

export interface OnlyPreviewFileAuthorityRuntimePrivateApi {
  ready(
    request: OnlyPreviewFileAuthorityRuntimeReadyRequest
  ): Promise<OnlyPreviewFileAuthorityRuntimeReadyResult>;
  inspectTarget(
    request: OnlyPreviewFileAuthorityTargetInspectionRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewValidatedTarget>>;
  bindWorkspace(
    request: OnlyPreviewFileAuthorityWorkspaceBindRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewFileAuthorityWorkspaceBinding>>;
  revokeWorkspace(request: OnlyPreviewFileAuthorityWorkspaceRef): Promise<OnlyPreviewResult<void>>;
  authorizeItem(
    request: OnlyPreviewFileAuthorityItemRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewFileAuthorityTarget>>;
  authorizeRoot(
    request: OnlyPreviewFileAuthorityWorkspaceRef
  ): Promise<OnlyPreviewResult<OnlyPreviewFileAuthorityTarget>>;
  createDirectory(
    request: OnlyPreviewFileAuthorityCreateDirectoryRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewFileAuthorityTarget>>;
  renameEntry(
    request: OnlyPreviewFileAuthorityRenameRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewFileAuthorityTarget>>;
  prepareDelete(
    request: OnlyPreviewFileAuthorityItemRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewFileAuthorityDeleteGrant>>;
  commitDelete(
    request: OnlyPreviewFileAuthorityDeleteGrantRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewFileAuthorityDeleteResult>>;
  cancelDelete(
    request: OnlyPreviewFileAuthorityDeleteGrantRequest
  ): Promise<OnlyPreviewResult<void>>;
}
