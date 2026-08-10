import type {
  OnlyPreviewSearchBuildProgress,
  OnlyPreviewSearchProgressEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';

export interface OnlyPreviewSearchProgressState {
  buildRevision: number;
  progress: OnlyPreviewSearchBuildProgress | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
};

const isBoundedIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 256 && !value.includes('\0');

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isBuildProgress = (value: unknown): value is OnlyPreviewSearchBuildProgress => {
  if (!isRecord(value)) return false;
  if (
    !isBoundedIdentifier(value.workspaceId) ||
    !isNonnegativeSafeInteger(value.generation) ||
    !Number.isSafeInteger(value.buildRevision) ||
    (value.buildRevision as number) < 1
  ) {
    return false;
  }
  if (value.phase === 'counting') {
    return hasExactKeys(value, ['workspaceId', 'generation', 'buildRevision', 'phase']);
  }
  return (
    value.phase === 'indexing' &&
    hasExactKeys(value, [
      'workspaceId',
      'generation',
      'buildRevision',
      'phase',
      'completed',
      'total'
    ]) &&
    isNonnegativeSafeInteger(value.completed) &&
    isNonnegativeSafeInteger(value.total) &&
    value.completed <= value.total
  );
};

export const isOnlyPreviewSearchProgressEvent = (
  value: unknown
): value is OnlyPreviewSearchProgressEvent =>
  isRecord(value) &&
  hasExactKeys(value, ['hostId', 'progress']) &&
  isBoundedIdentifier(value.hostId) &&
  isBuildProgress(value.progress);

export const createOnlyPreviewSearchProgressState = (): OnlyPreviewSearchProgressState => ({
  buildRevision: 0,
  progress: null
});

export const reduceOnlyPreviewSearchProgress = (
  state: OnlyPreviewSearchProgressState,
  progress: OnlyPreviewSearchBuildProgress,
  expected: { workspaceId: string; generation: number }
): OnlyPreviewSearchProgressState => {
  if (
    progress.workspaceId !== expected.workspaceId ||
    progress.generation !== expected.generation ||
    progress.buildRevision < state.buildRevision
  ) {
    return state;
  }
  if (progress.buildRevision > state.buildRevision) {
    return progress.phase === 'counting'
      ? { buildRevision: progress.buildRevision, progress }
      : state;
  }
  const current = state.progress;
  if (!current) return state;
  if (progress.phase === 'counting') {
    return current.phase === 'counting' ? { ...state, progress } : state;
  }
  if (current.phase === 'counting') return { ...state, progress };
  if (progress.total !== current.total || progress.completed < current.completed) return state;
  return { ...state, progress };
};

export const settleOnlyPreviewSearchProgress = (
  state: OnlyPreviewSearchProgressState
): OnlyPreviewSearchProgressState => ({ ...state, progress: null });

export const resetOnlyPreviewSearchProgress = (): OnlyPreviewSearchProgressState =>
  createOnlyPreviewSearchProgressState();
