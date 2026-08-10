import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import { onlyPreviewHostRegistry, type OnlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

const MAX_LIVE_SEARCH_BOOTSTRAPS = 128;
const SEARCH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface OnlyPreviewSearchBootstrapCapability {
  searchToken: string;
  hostToken: string;
  createdAt: number;
}

export class OnlyPreviewSearchBootstrapRegistry {
  private readonly capabilities = new Map<string, OnlyPreviewSearchBootstrapCapability>();

  constructor(
    private readonly hosts: OnlyPreviewHostRegistry,
    private readonly workspaces: OnlyPreviewWorkspaceRegistry
  ) {
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
  }

  issue(hostToken: unknown): OnlyPreviewSearchBootstrapCapability {
    const host = this.hosts.require(hostToken, ['content']);
    if (host.kind !== 'standalone') {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'Only the active standalone OnlyPreview host can own search authority.'
      );
    }
    if (this.capabilities.size >= MAX_LIVE_SEARCH_BOOTSTRAPS) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview has too many live search bootstrap capabilities.'
      );
    }
    this.revokeHost(host.hostToken);
    const capability: OnlyPreviewSearchBootstrapCapability = Object.freeze({
      searchToken: randomBytes(32).toString('base64url'),
      hostToken: host.hostToken,
      createdAt: Date.now()
    });
    this.capabilities.set(capability.searchToken, capability);
    return capability;
  }

  resolve(
    searchToken: unknown,
    workspaceId: unknown,
    userDataPath: string
  ): OnlyPreviewSearchBootstrap {
    if (typeof searchToken !== 'string' || !SEARCH_TOKEN_PATTERN.test(searchToken)) {
      throw new OnlyPreviewContractError(
        'HOST_NOT_FOUND',
        'OnlyPreview search authority is no longer available.'
      );
    }
    const capability = this.capabilities.get(searchToken);
    if (!capability) {
      throw new OnlyPreviewContractError(
        'HOST_NOT_FOUND',
        'OnlyPreview search authority is no longer available.'
      );
    }
    this.hosts.require(capability.hostToken, ['content']);
    const workspace = this.workspaces.requireWorkspace(capability.hostToken, workspaceId);
    const databaseName = createHash('sha256').update(workspace.rootRealPath).digest('hex');
    return {
      workspaceId: workspace.workspaceId,
      rootPath: workspace.rootRealPath,
      databasePath: join(userDataPath, 'onlypreview', 'search-index-v6', `${databaseName}.sqlite`)
    };
  }

  revoke(searchToken: unknown): boolean {
    if (typeof searchToken !== 'string') return false;
    return this.capabilities.delete(searchToken);
  }

  revokeHost(hostToken: string): void {
    for (const [searchToken, capability] of this.capabilities) {
      if (capability.hostToken === hostToken) this.capabilities.delete(searchToken);
    }
  }

  clear(): void {
    this.capabilities.clear();
  }
}

export const onlyPreviewSearchBootstrapRegistry = new OnlyPreviewSearchBootstrapRegistry(
  onlyPreviewHostRegistry,
  onlyPreviewWorkspaceRegistry
);
