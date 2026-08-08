import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  cloneDefaultOnlyPreviewSettings,
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewSettings,
  type OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';

const isHostEvent = (value: unknown): value is { hostId: string } =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Record<string, unknown>).hostId === 'string';

class OnlyPreviewPreviewStore {
  currentRef: OnlyPreviewFileRef | null = null;
  descriptor: OnlyPreviewDescriptor | null = null;
  textContent: OnlyPreviewTextContent | null = null;
  settings: OnlyPreviewSettings = cloneDefaultOnlyPreviewSettings();
  loading = false;
  errorCode: OnlyPreviewErrorCode | null = null;
  errorMessage = '';
  presentationError = '';
  actionError = '';
  private initialized = false;
  private generation = 0;
  private restoreGeneration = 0;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.subscribe();
    if (!onlyPreviewEnv.hostToken || !onlyPreviewEnv.hostId) {
      this.errorCode = 'HOST_NOT_FOUND';
      this.errorMessage = onlyPreviewI18n.errors.HOST_NOT_FOUND;
      return;
    }
    await this.refreshSettings();
    await this.restoreSelection();
  }

  async loadFile(fileRef: OnlyPreviewFileRef): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    this.restoreGeneration += 1;
    const generation = ++this.generation;
    this.currentRef = { ...fileRef };
    this.loading = true;
    this.errorCode = null;
    this.errorMessage = '';
    this.presentationError = '';
    this.actionError = '';
    this.descriptor = null;
    this.textContent = null;
    try {
      const descriptor = unwrapOnlyPreviewResult(
        await onlyPreviewClient.describeFile({
          hostToken,
          ...fileRef
        })
      );
      if (generation !== this.generation) return;
      this.descriptor = descriptor;
      if (descriptor.previewError) {
        this.presentationError =
          descriptor.previewError.code === 'SIGNATURE_MISMATCH'
            ? getOnlyPreviewErrorMessage('SIGNATURE_MISMATCH')
            : onlyPreviewI18n.preview.mediaFailed;
        return;
      }
      if (descriptor.kind !== 'text') return;
      const textContent = unwrapOnlyPreviewResult(
        await onlyPreviewClient.readText({
          hostToken,
          ...fileRef
        })
      );
      if (generation === this.generation) this.textContent = textContent;
    } catch (error) {
      if (generation !== this.generation) return;
      const contractError = error instanceof OnlyPreviewContractError ? error : null;
      this.errorCode = contractError?.code || 'OPERATION_FAILED';
      this.errorMessage = contractError
        ? getOnlyPreviewErrorMessage(contractError.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.currentRef) return;
    await this.loadFile(this.currentRef);
  }

  clear(): void {
    this.restoreGeneration += 1;
    this.generation += 1;
    this.currentRef = null;
    this.descriptor = null;
    this.textContent = null;
    this.loading = false;
    this.errorCode = null;
    this.errorMessage = '';
    this.presentationError = '';
    this.actionError = '';
  }

  reportMediaError(kind: 'pdf' | 'media'): void {
    this.presentationError =
      kind === 'pdf' ? onlyPreviewI18n.preview.pdfFailed : onlyPreviewI18n.preview.mediaFailed;
  }

  async openExternally(): Promise<void> {
    await this.runFileAction('open');
  }

  async revealInFolder(): Promise<void> {
    await this.runFileAction('reveal');
  }

  private subscribe(): void {
    xpcRenderer.subscribe(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        void this.restoreSelection();
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        void this.restoreSelection();
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_REFRESH_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        void this.refresh();
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, () => {
      void this.refreshSettings();
    });
  }

  private async restoreSelection(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const generation = ++this.restoreGeneration;
    try {
      const workspace = unwrapOnlyPreviewResult(
        await onlyPreviewClient.restoreWorkspace({ hostToken })
      );
      if (generation !== this.restoreGeneration) return;
      if (!workspace?.selectedRelativePath) {
        this.clear();
        return;
      }
      await this.loadFile({
        workspaceId: workspace.workspaceId,
        relativePath: workspace.selectedRelativePath
      });
    } catch (error) {
      if (generation !== this.restoreGeneration) return;
      const contractError = error instanceof OnlyPreviewContractError ? error : null;
      this.errorCode = contractError?.code || 'OPERATION_FAILED';
      this.errorMessage = contractError
        ? getOnlyPreviewErrorMessage(contractError.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
    }
  }

  private async refreshSettings(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      this.settings = unwrapOnlyPreviewResult(await onlyPreviewClient.getSettings({ hostToken }));
    } catch {
      // The explicit defaults are safe for rendering when settings storage is unavailable.
      this.settings = cloneDefaultOnlyPreviewSettings();
    }
  }

  private async runFileAction(action: 'open' | 'reveal'): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const fileRef = this.currentRef;
    if (!hostToken || !fileRef) return;
    this.actionError = '';
    try {
      const result =
        action === 'open'
          ? await onlyPreviewClient.openExternally({ hostToken, ...fileRef })
          : await onlyPreviewClient.revealInFolder({ hostToken, ...fileRef });
      unwrapOnlyPreviewResult(result);
    } catch (error) {
      const contractError = error instanceof OnlyPreviewContractError ? error : null;
      this.actionError = contractError
        ? getOnlyPreviewErrorMessage(contractError.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
    }
  }
}

export const onlyPreviewPreviewStore = reactive<OnlyPreviewPreviewStore>(
  new OnlyPreviewPreviewStore()
);
