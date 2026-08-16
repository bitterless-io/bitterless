import type {
  TrenchIndexAddTargetInput,
  TrenchIndexError,
  TrenchIndexWorkspaceSnapshot,
} from '@shared/trench/trenchIndex.type';

interface TrenchIndexClient {
  getWorkspace: typeof import('./trenchIndex.client').trenchIndexClient.getWorkspace;
  addTarget: typeof import('./trenchIndex.client').trenchIndexClient.addTarget;
  reanalyze: typeof import('./trenchIndex.client').trenchIndexClient.reanalyze;
  subscribe: typeof import('./trenchIndex.client').trenchIndexClient.subscribe;
}

export class TrenchIndexStore {
  phase: 'idle' | 'loading' | 'refreshing' | 'ready' | 'unavailable' = 'idle';
  snapshot: TrenchIndexWorkspaceSnapshot | null = null;
  commandError: TrenchIndexError | null = null;
  private initialized = false;
  private loadSequence = 0;

  constructor(private readonly client: TrenchIndexClient) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.client.subscribe((event) => {
      if ((this.snapshot?.revision ?? -1) <= event.revision) void this.refresh();
    });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.phase = this.snapshot ? 'refreshing' : 'loading';
    const result = await this.client.getWorkspace();
    if (sequence !== this.loadSequence) return;
    if (!result.ok) {
      this.phase = 'unavailable';
      this.commandError = result.error;
      return;
    }
    if (!this.snapshot || result.value.revision >= this.snapshot.revision) {
      this.snapshot = result.value;
    }
    this.phase = 'ready';
  }

  async addTarget(input: TrenchIndexAddTargetInput): Promise<boolean> {
    this.commandError = null;
    const result = await this.client.addTarget(input);
    if (!result.ok) {
      this.commandError = result.error;
      return false;
    }
    await this.refresh();
    return true;
  }

  async reanalyze(): Promise<boolean> {
    this.commandError = null;
    const result = await this.client.reanalyze({ requestId: window.crypto.randomUUID() });
    if (!result.ok) {
      this.commandError = result.error;
      return false;
    }
    await this.refresh();
    return true;
  }

  clearCommandError(): void {
    this.commandError = null;
  }
}
