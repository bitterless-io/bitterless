import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_FIND_FOCUS_EVENT,
  ONLY_PREVIEW_FIND_STATE_EVENT,
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  type OnlyPreviewPreviewPresentation
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../onlypreview/common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../onlypreview/common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewFindStore } from '../../onlypreview/shell/src/onlyPreviewFind.store';

class FilePreviewStore {
  presentation: OnlyPreviewPreviewPresentation | null = null;
  path = new URLSearchParams(window.location.search).get('path') || '';
  actionPending = false;
  error = '';
  private generation = 0;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    xpcRenderer.subscribe(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, ({ params }) => {
      if (params?.hostId === onlyPreviewEnv.hostId) void this.refresh();
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_FIND_STATE_EVENT, ({ params }) => {
      if (params?.hostId === onlyPreviewEnv.hostId) void onlyPreviewFindStore.sync();
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_FIND_FOCUS_EVENT, ({ params }) => {
      if (params?.hostId === onlyPreviewEnv.hostId) void onlyPreviewFindStore.handleFocusRequest();
    });
    await Promise.all([this.refresh(), onlyPreviewFindStore.initialize()]);
  }

  async refresh(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const generation = ++this.generation;
    try {
      if (!hostToken)
        throw new OnlyPreviewContractError('HOST_NOT_FOUND', 'File preview host is unavailable.');
      const next = unwrapOnlyPreviewResult(
        await onlyPreviewClient.getPreviewPresentation({ hostToken })
      );
      if (generation === this.generation) this.presentation = next;
    } catch (error) {
      if (generation === this.generation) this.error = (error as Error).message;
    }
  }

  async act(action: 'openExternally' | 'revealInFolder'): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const fileRef = this.presentation?.fileRef;
    if (!fileRef || this.actionPending) return;
    this.actionPending = true;
    this.error = '';
    try {
      if (!hostToken)
        throw new OnlyPreviewContractError('HOST_NOT_FOUND', 'File preview host is unavailable.');
      unwrapOnlyPreviewResult(await onlyPreviewClient[action]({ hostToken, ...fileRef }));
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.actionPending = false;
    }
  }

  dispose(): void {
    this.generation++;
  }
}

export const filePreviewStore = reactive(new FilePreviewStore());
