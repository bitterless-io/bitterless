interface OnlyPreviewSearchRuntimeFenceState {
  sessionId: number;
  workspaceId: string;
  generation: number;
}

interface OnlyPreviewSearchRuntimeFenceEvent {
  workspaceId: string;
  generation: number;
}

export const isOnlyPreviewSearchRuntimeEventCurrent = (
  active: OnlyPreviewSearchRuntimeFenceState | null,
  sessionId: number,
  event: OnlyPreviewSearchRuntimeFenceEvent
): boolean =>
  active !== null &&
  active.sessionId === sessionId &&
  event.workspaceId === active.workspaceId &&
  event.generation === active.generation;
