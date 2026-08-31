import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OnlyPreviewContractError,
  normalizeOnlyPreviewRelativePath,
  parseOnlyPreviewFileRef
} from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewFileRef,
  OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewValidatedTarget } from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostCapability,
  type OnlyPreviewHostRegistry
} from './onlyPreviewHost.registry';

const MAX_WORKSPACES = 128;

export interface OnlyPreviewWorkspaceRecord {
  workspaceId: string;
  hostToken: string;
  rootRealPath: string;
  rootName: string;
  displayPath: string;
  selectedRelativePath?: string;
  projectAuthorityGeneration?: number;
  projectAuthorityPending?: true;
  createdAt: number;
}

export interface OnlyPreviewProjectAuthorityRef {
  host: OnlyPreviewHostCapability;
  workspace: OnlyPreviewWorkspaceRecord;
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
}


type WorkspaceRevocationListener = (workspace: OnlyPreviewWorkspaceRecord) => void;

const toSnapshot = (workspace: OnlyPreviewWorkspaceRecord): OnlyPreviewWorkspace => ({
  workspaceId: workspace.workspaceId,
  rootName: workspace.rootName,
  displayPath: workspace.displayPath,
  ...(workspace.selectedRelativePath
    ? { selectedRelativePath: workspace.selectedRelativePath }
    : {})
});

export class OnlyPreviewWorkspaceRegistry {
  private readonly workspaces = new Map<string, OnlyPreviewWorkspaceRecord>();
  private readonly latestWorkspaceByHost = new Map<string, string>();
  private readonly revocationListeners = new Set<WorkspaceRevocationListener>();

  constructor(private readonly hosts: OnlyPreviewHostRegistry) {
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
  }

  registerValidatedTarget(
    hostToken: unknown,
    target: OnlyPreviewValidatedTarget
  ): OnlyPreviewWorkspace {
    const host = this.hosts.require(hostToken, ['content']);
    if (
      !target ||
      !isAbsolute(target.rootRealPath) ||
      target.displayPath !== target.rootRealPath ||
      typeof target.rootName !== 'string' ||
      !target.rootName
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Validated OnlyPreview target is invalid.'
      );
    }
    const replacingOwnWorkspace = [...this.workspaces.values()].some(
      (workspace) => workspace.hostToken === host.hostToken
    );
    if (this.workspaces.size >= MAX_WORKSPACES && !replacingOwnWorkspace) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview has too many live workspaces.'
      );
    }
    const selectedRelativePath = target.selectedRelativePath
      ? normalizeOnlyPreviewRelativePath(target.selectedRelativePath)
      : undefined;
    const record: OnlyPreviewWorkspaceRecord = {
      workspaceId: randomUUID(),
      hostToken: host.hostToken,
      rootRealPath: target.rootRealPath,
      rootName: target.rootName,
      displayPath: target.displayPath,
      ...(selectedRelativePath ? { selectedRelativePath } : {}),
      projectAuthorityPending: true,
      createdAt: Date.now()
    };
    this.revokeHost(host.hostToken);
    this.workspaces.set(record.workspaceId, record);
    this.latestWorkspaceByHost.set(host.hostToken, record.workspaceId);
    return toSnapshot(record);
  }

  getOfficeReadBootstrap(
    hostToken: unknown,
    value: unknown
  ): { workspaceId: string; relativePath: string; rootPath: string } {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(host.hostToken, fileRef.workspaceId);
    return {
      workspaceId: workspace.workspaceId,
      relativePath: fileRef.relativePath,
      rootPath: workspace.rootRealPath
    };
  }

  bindProjectAuthority(hostToken: unknown, workspaceId: unknown, generation: unknown): void {
    const workspace = this.requireWorkspace(hostToken, workspaceId);
    if (!Number.isSafeInteger(generation) || (generation as number) < 1) {
      throw new OnlyPreviewContractError(
        'PROTOCOL_ERROR',
        'Project authority generation is invalid.'
      );
    }
    workspace.projectAuthorityGeneration = generation as number;
    delete workspace.projectAuthorityPending;
  }

  getProjectAuthorityItemRef(hostToken: unknown, value: unknown): OnlyPreviewProjectAuthorityRef {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(host.hostToken, fileRef.workspaceId);
    const workspaceGeneration = this.requireProjectAuthorityGeneration(workspace);
    return {
      host,
      workspace,
      workspaceId: workspace.workspaceId,
      workspaceGeneration,
      relativePath: fileRef.relativePath
    };
  }

  getProjectAuthorityRootRef(
    hostToken: unknown,
    workspaceId: unknown
  ): Omit<OnlyPreviewProjectAuthorityRef, 'relativePath'> & { relativePath: '' } {
    const host = this.hosts.require(hostToken, ['content']);
    const workspace = this.requireWorkspace(host.hostToken, workspaceId);
    const workspaceGeneration = this.requireProjectAuthorityGeneration(workspace);
    return {
      host,
      workspace,
      workspaceId: workspace.workspaceId,
      workspaceGeneration,
      relativePath: ''
    };
  }

  restore(hostToken: unknown): OnlyPreviewWorkspace | null {
    const host = this.hosts.require(hostToken, ['content']);
    const workspaceId = this.latestWorkspaceByHost.get(host.hostToken);
    if (!workspaceId) return null;
    const workspace = this.workspaces.get(workspaceId);
    return workspace && !workspace.projectAuthorityPending ? toSnapshot(workspace) : null;
  }

  requireWorkspace(hostToken: unknown, workspaceId: unknown): OnlyPreviewWorkspaceRecord {
    const host = this.hosts.require(hostToken, ['content']);
    if (typeof workspaceId !== 'string' || workspaceId.length < 16 || workspaceId.length > 256) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workspace capability is invalid.');
    }
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_NOT_FOUND',
        'OnlyPreview workspace is no longer available.'
      );
    }
    if (workspace.hostToken !== host.hostToken) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Workspace belongs to another OnlyPreview host.'
      );
    }
    return workspace;
  }

  select(hostToken: unknown, value: OnlyPreviewFileRef): void {
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(hostToken, fileRef.workspaceId);
    workspace.selectedRelativePath = fileRef.relativePath;
    this.latestWorkspaceByHost.set(workspace.hostToken, workspace.workspaceId);
  }

  clearSelection(hostToken: unknown, value: OnlyPreviewFileRef): boolean {
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(hostToken, fileRef.workspaceId);
    if (workspace.selectedRelativePath !== fileRef.relativePath) return false;
    delete workspace.selectedRelativePath;
    return true;
  }

  revokeHost(hostToken: string): void {
    for (const workspace of [...this.workspaces.values()]) {
      if (workspace.hostToken === hostToken) this.revokeWorkspace(workspace.workspaceId);
    }
    this.latestWorkspaceByHost.delete(hostToken);
  }

  revokeWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    this.workspaces.delete(workspaceId);
    if (this.latestWorkspaceByHost.get(workspace.hostToken) === workspaceId) {
      this.latestWorkspaceByHost.delete(workspace.hostToken);
    }
    for (const listener of this.revocationListeners) listener(workspace);
    return true;
  }

  onRevoke(listener: WorkspaceRevocationListener): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  clear(): void {
    for (const workspaceId of [...this.workspaces.keys()]) this.revokeWorkspace(workspaceId);
  }

  private requireProjectAuthorityGeneration(workspace: OnlyPreviewWorkspaceRecord): number {
    const generation = workspace.projectAuthorityGeneration;
    if (!Number.isSafeInteger(generation) || (generation as number) < 1) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Project authority is not available for this workspace.'
      );
    }
    return generation as number;
  }
}

export const onlyPreviewWorkspaceRegistry = new OnlyPreviewWorkspaceRegistry(
  onlyPreviewHostRegistry
);
