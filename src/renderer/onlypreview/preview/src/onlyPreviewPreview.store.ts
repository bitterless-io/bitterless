import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  cloneDefaultOnlyPreviewSettings,
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  type OnlyPreviewCharacterCountRevisionEvent,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewSettings,
  type OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { OnlyPreviewCharacterCountSourceGate } from '../../common/onlyPreviewCharacterCountGate.service';

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
  selectionReportingRevision = '';
  private initialized = false;
  private generation = 0;
  private restoreGeneration = 0;
  private readonly characterCountGate = new OnlyPreviewCharacterCountSourceGate();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.subscribe();
    if (!onlyPreviewEnv.hostToken || !onlyPreviewEnv.hostId) {
      this.errorCode = 'HOST_NOT_FOUND';
      this.errorMessage = onlyPreviewI18n.errors.HOST_NOT_FOUND;
      return;
    }
    xpcRenderer.broadcast(ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT, {
      hostId: onlyPreviewEnv.hostId
    });
    await this.refreshSettings();
  }

  private async loadFile(fileRef: OnlyPreviewFileRef, reportingRevision: string): Promise<void> {
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
      if (generation !== this.generation || !this.characterCountGate.isCurrent(reportingRevision)) {
        return;
      }
      this.descriptor = descriptor;
      if (descriptor.previewError) {
        this.presentationError =
          descriptor.previewError.code === 'SIGNATURE_MISMATCH'
            ? getOnlyPreviewErrorMessage('SIGNATURE_MISMATCH')
            : onlyPreviewI18n.preview.mediaFailed;
        return;
      }
      if (descriptor.kind !== 'text') {
        this.selectionReportingRevision = reportingRevision;
        return;
      }
      const textContent = unwrapOnlyPreviewResult(
        await onlyPreviewClient.readText({
          hostToken,
          ...fileRef
        })
      );
      if (generation === this.generation && this.characterCountGate.isCurrent(reportingRevision)) {
        this.textContent = textContent;
        this.selectionReportingRevision = reportingRevision;
      }
    } catch (error) {
      if (generation !== this.generation || !this.characterCountGate.isCurrent(reportingRevision)) {
        return;
      }
      const contractError = error instanceof OnlyPreviewContractError ? error : null;
      this.errorCode = contractError?.code || 'OPERATION_FAILED';
      this.errorMessage = contractError
        ? getOnlyPreviewErrorMessage(contractError.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private clear(): void {
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
    this.selectionReportingRevision = '';
  }

  reportMediaError(kind: 'pdf' | 'media', reportingRevision: string): void {
    if (!this.characterCountGate.disarm(reportingRevision)) return;
    this.broadcastCharacterCount(0);
    this.presentationError =
      kind === 'pdf' ? onlyPreviewI18n.preview.pdfFailed : onlyPreviewI18n.preview.mediaFailed;
  }

  reportCharacterCount(characterCount: number, reportingRevision: string): void {
    const normalizedCount =
      Number.isSafeInteger(characterCount) && characterCount >= 0 ? characterCount : 0;
    if (!this.characterCountGate.canReport(reportingRevision, normalizedCount)) return;
    this.broadcastCharacterCount(normalizedCount);
  }

  armCharacterCountReporting(reportingRevision: string): void {
    const hostId = onlyPreviewEnv.hostId;
    if (!hostId || !this.characterCountGate.arm(reportingRevision)) return;
    xpcRenderer.broadcast(ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT, {
      hostId,
      revision: reportingRevision
    });
  }

  async openExternally(): Promise<void> {
    await this.runFileAction('open');
  }

  async revealInFolder(): Promise<void> {
    await this.runFileAction('reveal');
  }

  private subscribe(): void {
    xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT, (payload) => {
      if (isRevisionEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        void this.restoreSelection(payload.params.revision);
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, () => {
      void this.refreshSettings();
    });
  }

  private async restoreSelection(reportingRevision: string): Promise<void> {
    if (!this.characterCountGate.beginTransition(reportingRevision)) return;
    this.selectionReportingRevision = '';
    this.broadcastCharacterCount(0);
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const generation = ++this.restoreGeneration;
    try {
      const workspace = unwrapOnlyPreviewResult(
        await onlyPreviewClient.restoreWorkspace({ hostToken })
      );
      if (
        generation !== this.restoreGeneration ||
        !this.characterCountGate.isCurrent(reportingRevision)
      ) {
        return;
      }
      if (!workspace?.selectedRelativePath) {
        this.clear();
        return;
      }
      await this.loadFile(
        {
          workspaceId: workspace.workspaceId,
          relativePath: workspace.selectedRelativePath
        },
        reportingRevision
      );
    } catch (error) {
      if (
        generation !== this.restoreGeneration ||
        !this.characterCountGate.isCurrent(reportingRevision)
      ) {
        return;
      }
      const contractError = error instanceof OnlyPreviewContractError ? error : null;
      this.errorCode = contractError?.code || 'OPERATION_FAILED';
      this.errorMessage = contractError
        ? getOnlyPreviewErrorMessage(contractError.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
    }
  }

  private broadcastCharacterCount(characterCount: number): void {
    const hostId = onlyPreviewEnv.hostId;
    if (!hostId) return;
    xpcRenderer.broadcast(ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT, {
      hostId,
      characterCount
    });
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
