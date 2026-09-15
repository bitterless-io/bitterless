import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_RECENTS_CHANGED_EVENT,
  type OnlyPreviewRecentsSnapshot
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { isOnlyPreviewPresentationNudge } from '../../common/onlyPreviewPresentation.service';
import { describeOnlyPreviewError } from './onlyPreviewErrorDetail.store';
import type {
  OnlyPreviewRecentsClient,
  OnlyPreviewRecentsIdentity
} from './onlyPreviewRecents.type';

export class OnlyPreviewRecentsStore {
  activePanel: 'project' | 'recents' = 'project';
  snapshot: OnlyPreviewRecentsSnapshot | null = null;
  selectedEntryId: string | null = null;
  loading = false;
  actionPending = false;
  loadError = '';
  actionError = '';
  private generation = 0;
  private actionGeneration = 0;
  private subscribed = false;
  private active = false;

  constructor(
    private readonly client: OnlyPreviewRecentsClient = onlyPreviewClient,
    private readonly identity: OnlyPreviewRecentsIdentity = onlyPreviewEnv
  ) {}

  get entries(): OnlyPreviewRecentsSnapshot['entries'] {
    return this.snapshot?.entries ?? [];
  }
  get errorMessage(): string {
    return this.actionError || this.loadError;
  }
  get canBack(): boolean {
    return !this.actionPending && Boolean(this.snapshot?.canBack);
  }
  get canForward(): boolean {
    return !this.actionPending && Boolean(this.snapshot?.canForward);
  }
  get canReload(): boolean {
    return !this.actionPending && Boolean(this.snapshot?.canReload);
  }

  async initialize(): Promise<void> {
    this.active = true;
    if (!this.subscribed) {
      this.subscribed = true;
      const refreshForHost = ({ params }: { params?: unknown }): void => {
        if (
          this.active &&
          isOnlyPreviewPresentationNudge(params) &&
          params.hostId === this.identity.hostId
        ) {
          void this.refresh();
        }
      };
      xpcRenderer.subscribe(ONLY_PREVIEW_RECENTS_CHANGED_EVENT, refreshForHost);
    }
    await this.refresh();
  }

  handlePreviewPresentation(): void {
    if (this.active) void this.refresh();
  }

  dispose(): void {
    this.active = false;
    this.generation += 1;
    this.actionGeneration += 1;
    this.loading = false;
    this.actionPending = false;
  }

  resetWorkspace(): void {
    this.snapshot = null;
    this.selectedEntryId = null;
    this.actionError = '';
    this.actionGeneration += 1;
    this.actionPending = false;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const { hostToken, hostId } = this.identity;
    if (!hostToken) return;
    const generation = ++this.generation;
    this.loading = true;
    this.loadError = '';
    try {
      const snapshot = unwrapOnlyPreviewResult(await this.client.getRecents({ hostToken }));
      if (generation !== this.generation || snapshot.hostId !== hostId) return;
      if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
      this.snapshot = snapshot;
      if (!snapshot.entries.some((entry) => entry.id === this.selectedEntryId)) {
        this.selectedEntryId = snapshot.activeEntryId ?? snapshot.entries[0]?.id ?? null;
      }
    } catch (error) {
      if (generation === this.generation) this.loadError = describeOnlyPreviewError(error);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  select(entryId: string): void {
    if (this.entries.some((entry) => entry.id === entryId)) this.selectedEntryId = entryId;
  }

  async openSelected(): Promise<void> {
    const { hostToken } = this.identity;
    const snapshot = this.snapshot;
    const entryId = this.selectedEntryId;
    if (
      !hostToken ||
      !snapshot ||
      !entryId ||
      !snapshot.entries.some((entry) => entry.id === entryId)
    )
      return;
    await this.runAction(() =>
      this.client.openRecent({
        hostToken,
        entryId,
        revision: snapshot.revision
      })
    );
  }

  async navigate(direction: 'back' | 'forward'): Promise<void> {
    const { hostToken } = this.identity;
    const snapshot = this.snapshot;
    if (!hostToken || !snapshot || !(direction === 'back' ? this.canBack : this.canForward)) return;
    await this.runAction(() =>
      this.client.navigateRecent({
        hostToken,
        direction,
        revision: snapshot.revision
      })
    );
  }

  async reload(): Promise<void> {
    const { hostToken } = this.identity;
    if (!hostToken || !this.canReload) return;
    await this.runAction(() => this.client.reloadPreview({ hostToken }));
  }

  private async runAction(
    action: () => ReturnType<OnlyPreviewRecentsClient['openRecent']>
  ): Promise<void> {
    const generation = ++this.actionGeneration;
    this.generation += 1;
    this.actionPending = true;
    this.actionError = '';
    try {
      unwrapOnlyPreviewResult(await action());
    } catch (error) {
      if (generation === this.actionGeneration) this.actionError = describeOnlyPreviewError(error);
    } finally {
      if (generation === this.actionGeneration) {
        this.actionPending = false;
        await this.refresh();
      }
    }
  }
}

export const onlyPreviewRecentsStore = reactive(new OnlyPreviewRecentsStore());
