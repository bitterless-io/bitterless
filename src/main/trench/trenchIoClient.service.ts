import type {
  TrenchIndexCompletedBatch,
  TrenchIndexStorageAddTargetsAndBeginRunInput,
  TrenchIndexStorageBeginRunInput,
  TrenchIndexStorageFailRunInput,
  TrenchIoRuntimeApi,
} from '@shared/trench/trenchIndex.type';
import type {
  TrenchPersonAttachWalletInput,
  TrenchPersonImportInput,
  TrenchPersonListInput,
  TrenchPersonUpdateProfileInput,
} from '@shared/trench/trenchPerson.type';

interface AttachedRuntime {
  capability: string;
  instanceId: string;
  client: TrenchIoRuntimeApi;
}

export class TrenchIoClientService {
  private runtime: AttachedRuntime | null = null;

  attach(runtime: AttachedRuntime): void {
    this.runtime = runtime;
  }

  detach(capability?: string): void {
    if (!capability || this.runtime?.capability === capability) this.runtime = null;
  }

  async getWorkspace() {
    const runtime = this.requireRuntime();
    return await runtime.client.getWorkspace({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request: {},
    });
  }

  async addTargetsAndBeginRun(request: TrenchIndexStorageAddTargetsAndBeginRunInput) {
    const runtime = this.requireRuntime();
    return await runtime.client.addTargetsAndBeginRun({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async beginRun(request: TrenchIndexStorageBeginRunInput) {
    const runtime = this.requireRuntime();
    return await runtime.client.beginRun({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async completeRun(request: TrenchIndexCompletedBatch) {
    const runtime = this.requireRuntime();
    return await runtime.client.completeRun({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async failRun(request: TrenchIndexStorageFailRunInput) {
    const runtime = this.requireRuntime();
    return await runtime.client.failRun({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async listPersons(request: TrenchPersonListInput) {
    const runtime = this.requireRuntime();
    return await runtime.client.listPersons({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async getPerson(request: { personId: string }) {
    const runtime = this.requireRuntime();
    return await runtime.client.getPerson({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async updatePersonProfile(request: TrenchPersonUpdateProfileInput) {
    const runtime = this.requireRuntime();
    return await runtime.client.updatePersonProfile({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async attachWalletToPerson(request: TrenchPersonAttachWalletInput) {
    const runtime = this.requireRuntime();
    return await runtime.client.attachWalletToPerson({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  async importPersonWallets(request: TrenchPersonImportInput) {
    const runtime = this.requireRuntime();
    return await runtime.client.importPersonWallets({
      capability: runtime.capability,
      instanceId: runtime.instanceId,
      request,
    });
  }

  private requireRuntime(): AttachedRuntime {
    if (!this.runtime) throw new Error('[trench-io] runtime is unavailable.');
    return this.runtime;
  }
}

export const trenchIoClientService = new TrenchIoClientService();
