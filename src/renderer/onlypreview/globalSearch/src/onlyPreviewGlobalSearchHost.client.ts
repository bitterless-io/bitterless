import { xpcRenderer } from 'electron-xpc/renderer';
import {
  parseOnlyPreviewGlobalSearchContextSnapshot,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_FOCUS_SEARCH_EVENT,
  ONLY_PREVIEW_GLOBAL_SEARCH_CONTEXT_CHANGED_EVENT,
  ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT,
  type OnlyPreviewFocusSearchEvent,
  type OnlyPreviewGlobalSearchContextSnapshot,
  type OnlyPreviewGlobalSearchFocusOrigin,
  type OnlyPreviewGlobalSearchVisibilityEvent,
  type OnlyPreviewGlobalSearchWorkspaceContext
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewGlobalSearchResult } from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';

interface GlobalSearchContextNudge {
  hostId: string;
  revision: number;
}

const isExactHostRevision = (value: unknown): value is GlobalSearchContextNudge => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(event).length === 2 &&
    typeof event.hostId === 'string' &&
    Number.isSafeInteger(event.revision) &&
    (event.revision as number) >= 0
  );
};

const isFocusSearchEvent = (value: unknown): value is OnlyPreviewFocusSearchEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(event).length === 2 &&
    typeof event.hostId === 'string' &&
    (event.origin === 'shell' || event.origin === 'vue' || event.origin === 'chrome')
  );
};

const isGlobalSearchVisibilityEvent = (
  value: unknown
): value is OnlyPreviewGlobalSearchVisibilityEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(event).length === 3 &&
    typeof event.hostId === 'string' &&
    Number.isSafeInteger(event.revision) &&
    (event.revision as number) >= 0 &&
    typeof event.active === 'boolean'
  );
};

export class OnlyPreviewGlobalSearchHostClient {
  private snapshot: OnlyPreviewGlobalSearchContextSnapshot = {
    revision: 0,
    active: false,
    workspace: null
  };
  private initialized = false;

  get context(): OnlyPreviewGlobalSearchWorkspaceContext | null {
    return this.snapshot.workspace;
  }

  async initialize(
    onContext: (context: OnlyPreviewGlobalSearchWorkspaceContext | null) => void,
    onFocus: (origin: OnlyPreviewGlobalSearchFocusOrigin) => void,
    onVisibility: (active: boolean) => void
  ): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const hostId = onlyPreviewEnv.hostId;
    if (!hostId) return;
    xpcRenderer.subscribe(ONLY_PREVIEW_GLOBAL_SEARCH_CONTEXT_CHANGED_EVENT, ({ params }) => {
      if (!isExactHostRevision(params) || params.hostId !== hostId) return;
      void this.refreshContext(onContext, onVisibility);
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_FOCUS_SEARCH_EVENT, ({ params }) => {
      if (!isFocusSearchEvent(params) || params.hostId !== hostId) return;
      onFocus(params.origin);
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_GLOBAL_SEARCH_VISIBILITY_EVENT, ({ params }) => {
      if (!isGlobalSearchVisibilityEvent(params) || params.hostId !== hostId) return;
      this.acceptVisibility(params, onVisibility);
    });
    await this.refreshContext(onContext, onVisibility);
  }

  async openResult(result: OnlyPreviewGlobalSearchResult): Promise<boolean> {
    const hostToken = onlyPreviewEnv.hostToken;
    const context = this.context;
    if (!hostToken || !context) return false;
    if (result.section === 'files' && result.nodeKind === 'directory') {
      const revealed = unwrapOnlyPreviewResult(
        await onlyPreviewClient.revealGlobalSearchDirectory({
          hostToken,
          workspaceId: context.workspaceId,
          generation: context.generation,
          relativePath: result.relativePath
        })
      );
      if (!revealed) return false;
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.closeGlobalSearch({ hostToken, mode: 'project' })
      );
      return true;
    }
    unwrapOnlyPreviewResult(
      await onlyPreviewClient.selectStandaloneFile({
        hostToken,
        workspaceId: context.workspaceId,
        relativePath: result.relativePath
      })
    );
    unwrapOnlyPreviewResult(
      await onlyPreviewClient.closeGlobalSearch({ hostToken, mode: 'preview' })
    );
    return true;
  }

  async close(mode: 'opener' | 'project' | 'preview' | 'discard'): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    unwrapOnlyPreviewResult(await onlyPreviewClient.closeGlobalSearch({ hostToken, mode }));
  }

  private async refreshContext(
    onContext: (context: OnlyPreviewGlobalSearchWorkspaceContext | null) => void,
    onVisibility: (active: boolean) => void
  ): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const snapshot = parseOnlyPreviewGlobalSearchContextSnapshot(
      unwrapOnlyPreviewResult(await onlyPreviewClient.getGlobalSearchContext({ hostToken }))
    );
    if (snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot;
    onContext(snapshot.workspace);
    onVisibility(snapshot.active);
  }

  private acceptVisibility(
    event: OnlyPreviewGlobalSearchVisibilityEvent,
    onVisibility: (active: boolean) => void
  ): void {
    if (event.revision < this.snapshot.revision) return;
    this.snapshot = {
      ...this.snapshot,
      revision: event.revision,
      active: event.active
    };
    onVisibility(event.active);
  }
}

export const onlyPreviewGlobalSearchHostClient = new OnlyPreviewGlobalSearchHostClient();
