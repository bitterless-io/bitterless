import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT,
  ONLY_PREVIEW_FIND_FOCUS_EVENT,
  ONLY_PREVIEW_FIND_STATE_EVENT,
  ONLY_PREVIEW_FOCUS_PROJECT_EVENT,
  ONLY_PREVIEW_FOCUS_SEARCH_EVENT,
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewCharacterCountEvent,
  type OnlyPreviewCharacterCountRevisionEvent
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_BROWSE_LISTING_EVENT,
  ONLY_PREVIEW_SEARCH_PROGRESS_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  type OnlyPreviewBrowseListing,
  type OnlyPreviewSearchBuildProgress,
  type OnlyPreviewSearchSnapshot
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { isOnlyPreviewBrowseListingEvent } from './onlyPreviewBrowseListing.service';
import { isOnlyPreviewPresentationNudge } from '../../common/onlyPreviewPresentation.service';
import { isOnlyPreviewSearchProgressEvent } from './onlyPreviewSearchProgress.service';
import { isOnlyPreviewSearchSnapshotEvent } from './onlyPreviewSearchSnapshot.service';

interface OnlyPreviewShellEventHandlers {
  workspaceChanged: () => void;
  selectionChanged: () => void;
  characterCountChanged: (characterCount: number) => void;
  characterCountReady: (revision: string) => void;
  previewPresentation: () => void;
  refresh: () => void;
  browseListing: (listing: OnlyPreviewBrowseListing) => void;
  searchProgress: (progress: OnlyPreviewSearchBuildProgress) => void;
  searchSnapshot: (snapshot: OnlyPreviewSearchSnapshot) => void;
  settingsChanged: () => void;
  focusProject: () => void;
  focusSearch: () => void;
  findState: () => void;
  focusFind: () => void;
}

const isHostEvent = (value: unknown): value is { hostId: string } =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Record<string, unknown>).hostId === 'string';

const isCharacterCountEvent = (value: unknown): value is OnlyPreviewCharacterCountEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  const keys = Object.keys(event);
  return (
    keys.length === 2 &&
    keys.includes('hostId') &&
    keys.includes('characterCount') &&
    typeof event.hostId === 'string' &&
    Number.isSafeInteger(event.characterCount) &&
    (event.characterCount as number) >= 0
  );
};

const isRevisionEvent = (value: unknown): value is OnlyPreviewCharacterCountRevisionEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.hostId === 'string' &&
    typeof event.revision === 'string' &&
    event.revision.length > 0 &&
    event.revision.length <= 128
  );
};

const isCharacterCountRevisionEvent = (
  value: unknown
): value is OnlyPreviewCharacterCountRevisionEvent =>
  isRevisionEvent(value) && Reflect.ownKeys(value).length === 2;

export const subscribeOnlyPreviewShellEvents = (
  hostId: string | null | undefined,
  handlers: OnlyPreviewShellEventHandlers
): void => {
  if (!hostId) return;
  const isCurrentHost = (value: { hostId: string }): boolean => value.hostId === hostId;
  xpcRenderer.subscribe(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, ({ params }) => {
    if (isHostEvent(params) && isCurrentHost(params)) handlers.workspaceChanged();
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, ({ params }) => {
    if (isHostEvent(params) && isCurrentHost(params)) handlers.selectionChanged();
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT, ({ params }) => {
    if (isCharacterCountEvent(params) && isCurrentHost(params)) {
      handlers.characterCountChanged(params.characterCount);
    }
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT, ({ params }) => {
    if (isCharacterCountRevisionEvent(params) && isCurrentHost(params)) {
      handlers.characterCountReady(params.revision);
    }
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, ({ params }) => {
    if (isOnlyPreviewPresentationNudge(params) && isCurrentHost(params)) {
      handlers.previewPresentation();
    }
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_REFRESH_EVENT, ({ params }) => {
    if (isHostEvent(params) && isCurrentHost(params)) handlers.refresh();
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_BROWSE_LISTING_EVENT, ({ params }) => {
    if (isOnlyPreviewBrowseListingEvent(params) && isCurrentHost(params)) {
      handlers.browseListing(params.listing);
    }
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_PROGRESS_EVENT, ({ params }) => {
    if (isOnlyPreviewSearchProgressEvent(params) && isCurrentHost(params)) {
      handlers.searchProgress(params.progress);
    }
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT, ({ params }) => {
    if (isOnlyPreviewSearchSnapshotEvent(params) && isCurrentHost(params)) {
      handlers.searchSnapshot(params.snapshot);
    }
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, handlers.settingsChanged);
  xpcRenderer.subscribe(ONLY_PREVIEW_FOCUS_PROJECT_EVENT, ({ params }) => {
    if (isHostEvent(params) && isCurrentHost(params)) handlers.focusProject();
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_FOCUS_SEARCH_EVENT, ({ params }) => {
    if (isHostEvent(params) && isCurrentHost(params)) handlers.focusSearch();
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_FIND_STATE_EVENT, ({ params }) => {
    if (isHostEvent(params) && isCurrentHost(params)) handlers.findState();
  });
  xpcRenderer.subscribe(ONLY_PREVIEW_FIND_FOCUS_EVENT, ({ params }) => {
    if (isHostEvent(params) && isCurrentHost(params)) handlers.focusFind();
  });
};
