import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewSearchWatchCommitEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';
import {
  ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT,
  ONLY_PREVIEW_HEADER_METADATA_EVENT,
  ONLY_PREVIEW_HEADER_SYNC_REQUEST_EVENT,
  ONLY_PREVIEW_PREVIEW_CONTROL_EVENT,
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewCharacterCountRevisionEvent,
  type OnlyPreviewHeaderMetadata,
  type OnlyPreviewHeaderMetadataEvent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import {
  createOnlyPreviewWatchReloadCursor,
  evaluateOnlyPreviewWatchReload,
  type OnlyPreviewWatchReloadCursor
} from './onlyPreviewWatchReload.service';

const KINDS = new Set(['text', 'pdf', 'image', 'audio', 'video', 'unsupported']);

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length <= maxLength && !value.includes('\0');

const isRelativePath = (value: unknown): value is string => {
  if (!isBoundedString(value, 16_384) || !value || value.startsWith('/') || value.includes('\\')) {
    return false;
  }
  return (
    !/^[a-zA-Z]:/.test(value) &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  );
};

const isMetadata = (value: unknown): value is OnlyPreviewHeaderMetadata => {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Record<string, unknown>;
  return (
    Object.keys(metadata).length === 5 &&
    isBoundedString(metadata.fileName, 1_024) &&
    !!metadata.fileName &&
    isRelativePath(metadata.relativePath) &&
    typeof metadata.kind === 'string' &&
    KINDS.has(metadata.kind) &&
    isBoundedString(metadata.extension, 256) &&
    isBoundedString(metadata.language, 256)
  );
};

const isMetadataEvent = (value: unknown): value is OnlyPreviewHeaderMetadataEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    Object.keys(event).length === 2 &&
    typeof event.hostId === 'string' &&
    (event.metadata === null || isMetadata(event.metadata))
  );
};

const isRevisionEvent = (value: unknown): value is OnlyPreviewCharacterCountRevisionEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    Object.keys(event).length === 2 &&
    typeof event.hostId === 'string' &&
    typeof event.revision === 'string' &&
    event.revision.length > 0 &&
    event.revision.length <= 128
  );
};

const isExactHostEvent = (value: unknown): value is { hostId: string } => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return Object.keys(event).length === 1 && typeof event.hostId === 'string';
};

const isWatchCommitEvent = (value: unknown): value is OnlyPreviewSearchWatchCommitEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (
    Object.keys(event).sort().join(',') !== 'commit,hostId' ||
    typeof event.hostId !== 'string' ||
    !event.commit ||
    typeof event.commit !== 'object' ||
    Array.isArray(event.commit)
  ) {
    return false;
  }
  const commit = event.commit as Record<string, unknown>;
  return (
    Object.keys(commit).sort().join(',') ===
      'changedRelativePaths,full,generation,revision,workspaceId' &&
    isBoundedString(commit.workspaceId, 256) &&
    !!commit.workspaceId &&
    Number.isSafeInteger(commit.generation) &&
    (commit.generation as number) >= 0 &&
    Number.isSafeInteger(commit.revision) &&
    (commit.revision as number) > 0 &&
    typeof commit.full === 'boolean' &&
    Array.isArray(commit.changedRelativePaths) &&
    commit.changedRelativePaths.length <= ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS &&
    commit.changedRelativePaths.every(isRelativePath)
  );
};

class OnlyPreviewPreviewHeaderStore {
  metadata: OnlyPreviewHeaderMetadata | null = null;
  private initialized = false;
  private nextAction: 'render' | 'reload' = 'render';
  private currentRelativePath = '';
  private watchCursor: OnlyPreviewWatchReloadCursor = createOnlyPreviewWatchReloadCursor();

  get descriptorType(): string {
    const metadata = this.metadata;
    if (!metadata) return '';
    return (
      metadata.language || metadata.extension.replace(/^\./, '').toUpperCase() || metadata.kind
    );
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.subscribe();
    const hostId = onlyPreviewEnv.hostId;
    if (!hostId) return;
    xpcRenderer.broadcast(ONLY_PREVIEW_HEADER_SYNC_REQUEST_EVENT, { hostId });
    xpcRenderer.broadcast(ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT, { hostId });
  }

  private subscribe(): void {
    xpcRenderer.subscribe(ONLY_PREVIEW_HEADER_METADATA_EVENT, (payload) => {
      if (isMetadataEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.metadata = payload.params.metadata ? { ...payload.params.metadata } : null;
        if (payload.params.metadata) {
          this.currentRelativePath = payload.params.metadata.relativePath;
        }
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, (payload) => {
      if (isExactHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.metadata = null;
        this.currentRelativePath = '';
        this.watchCursor = createOnlyPreviewWatchReloadCursor();
        this.nextAction = 'render';
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_REFRESH_EVENT, (payload) => {
      if (isExactHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.nextAction = 'reload';
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT, (payload) => {
      if (!isRevisionEvent(payload.params) || payload.params.hostId !== onlyPreviewEnv.hostId) {
        return;
      }
      const action = this.nextAction;
      this.nextAction = 'render';
      this.metadata = null;
      this.currentRelativePath = '';
      xpcRenderer.broadcast(ONLY_PREVIEW_PREVIEW_CONTROL_EVENT, {
        hostId: payload.params.hostId,
        revision: payload.params.revision,
        action
      });
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT, (payload) => {
      if (!isWatchCommitEvent(payload.params) || payload.params.hostId !== onlyPreviewEnv.hostId) {
        return;
      }
      const { commit } = payload.params;
      const decision = evaluateOnlyPreviewWatchReload(
        this.watchCursor,
        commit,
        this.currentRelativePath
      );
      this.watchCursor = decision.cursor;
      if (!decision.reload) return;
      this.metadata = null;
      xpcRenderer.broadcast(ONLY_PREVIEW_PREVIEW_CONTROL_EVENT, {
        hostId: payload.params.hostId,
        revision: crypto.randomUUID(),
        action: 'reload'
      });
    });
  }
}

export const onlyPreviewPreviewHeaderStore = reactive<OnlyPreviewPreviewHeaderStore>(
  new OnlyPreviewPreviewHeaderStore()
);
