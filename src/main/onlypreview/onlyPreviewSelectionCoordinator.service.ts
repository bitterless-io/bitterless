import type { OnlyPreviewFileRef } from '@shared/onlypreview/onlyPreview.types';

interface PendingOnlyPreviewSelection extends OnlyPreviewFileRef {
  generation: number;
}

export class OnlyPreviewSelectionCoordinator {
  private readonly generationByHost = new Map<string, number>();
  private readonly pendingSelectionByHost = new Map<string, PendingOnlyPreviewSelection>();

  advance(hostToken: string): number {
    const generation = (this.generationByHost.get(hostToken) || 0) + 1;
    this.generationByHost.set(hostToken, generation);
    this.pendingSelectionByHost.delete(hostToken);
    return generation;
  }

  beginSelection(hostToken: string, fileRef: OnlyPreviewFileRef): number {
    const generation = this.advance(hostToken);
    this.pendingSelectionByHost.set(hostToken, { generation, ...fileRef });
    return generation;
  }

  isCurrent(hostToken: string, generation: number): boolean {
    return this.generationByHost.get(hostToken) === generation;
  }

  finishSelection(hostToken: string, generation: number): void {
    if (this.pendingSelectionByHost.get(hostToken)?.generation === generation) {
      this.pendingSelectionByHost.delete(hostToken);
    }
  }

  invalidatePendingSelection(hostToken: string, fileRef: OnlyPreviewFileRef): boolean {
    const pending = this.pendingSelectionByHost.get(hostToken);
    if (
      !pending ||
      pending.generation !== this.generationByHost.get(hostToken) ||
      pending.workspaceId !== fileRef.workspaceId ||
      pending.relativePath !== fileRef.relativePath
    ) {
      return false;
    }
    this.advance(hostToken);
    return true;
  }

  revoke(hostToken: string): void {
    this.generationByHost.delete(hostToken);
    this.pendingSelectionByHost.delete(hostToken);
  }
}

export const onlyPreviewSelectionCoordinator = new OnlyPreviewSelectionCoordinator();
