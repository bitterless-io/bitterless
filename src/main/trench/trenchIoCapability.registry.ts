import { randomBytes, randomUUID } from 'node:crypto';
import type { TrenchIoSystemRequest } from '@shared/trench/trenchIndex.type';

interface TrenchIoCapability extends TrenchIoSystemRequest {}

export class TrenchIoCapabilityRegistry {
  private current: TrenchIoCapability | null = null;

  issue(): TrenchIoCapability {
    const capability = {
      capability: randomBytes(32).toString('base64url'),
      instanceId: randomUUID(),
    };
    this.current = capability;
    return capability;
  }

  assert(input: TrenchIoSystemRequest): void {
    if (!this.current || input.capability !== this.current.capability ||
      input.instanceId !== this.current.instanceId) {
      throw new TypeError('[trench-io] capability is invalid.');
    }
  }

  revoke(input?: TrenchIoSystemRequest): void {
    if (!input || (this.current?.capability === input.capability &&
      this.current.instanceId === input.instanceId)) {
      this.current = null;
    }
  }
}

export const trenchIoCapabilityRegistry = new TrenchIoCapabilityRegistry();
