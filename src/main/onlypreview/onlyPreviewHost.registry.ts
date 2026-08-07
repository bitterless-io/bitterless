import { randomBytes, randomUUID } from 'node:crypto';
import {
  OnlyPreviewContractError,
  parseOnlyPreviewHostToken
} from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewHostKind,
  OnlyPreviewHostRole
} from '@shared/onlypreview/onlyPreview.types';

const MAX_LIVE_HOSTS = 128;

export interface OnlyPreviewHostCapability {
  hostId: string;
  hostToken: string;
  kind: OnlyPreviewHostKind;
  role: OnlyPreviewHostRole;
  createdAt: number;
}

type HostRevocationListener = (host: OnlyPreviewHostCapability) => void;

export class OnlyPreviewHostRegistry {
  private readonly hosts = new Map<string, OnlyPreviewHostCapability>();
  private readonly revocationListeners = new Set<HostRevocationListener>();

  issue(kind: OnlyPreviewHostKind, role: OnlyPreviewHostRole): OnlyPreviewHostCapability {
    if (this.hosts.size >= MAX_LIVE_HOSTS) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview has too many live host sessions.'
      );
    }
    const host: OnlyPreviewHostCapability = Object.freeze({
      hostId: randomUUID(),
      hostToken: randomBytes(32).toString('hex'),
      kind,
      role,
      createdAt: Date.now()
    });
    this.hosts.set(host.hostToken, host);
    return host;
  }

  require(
    value: unknown,
    allowedRoles?: readonly OnlyPreviewHostRole[]
  ): OnlyPreviewHostCapability {
    const hostToken = parseOnlyPreviewHostToken(value);
    const host = this.hosts.get(hostToken);
    if (!host) {
      throw new OnlyPreviewContractError(
        'HOST_NOT_FOUND',
        'OnlyPreview host session is no longer available.'
      );
    }
    if (allowedRoles && !allowedRoles.includes(host.role)) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview host cannot perform this operation.'
      );
    }
    return host;
  }

  isLive(hostToken: string): boolean {
    return this.hosts.has(hostToken);
  }

  revoke(value: unknown): boolean {
    let hostToken: string;
    try {
      hostToken = parseOnlyPreviewHostToken(value);
    } catch {
      return false;
    }
    const host = this.hosts.get(hostToken);
    if (!host) return false;
    this.hosts.delete(hostToken);
    for (const listener of this.revocationListeners) listener(host);
    return true;
  }

  clear(): void {
    for (const host of [...this.hosts.values()]) this.revoke(host.hostToken);
  }

  onRevoke(listener: HostRevocationListener): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }
}

export const onlyPreviewHostRegistry = new OnlyPreviewHostRegistry();
