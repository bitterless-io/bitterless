import { nextTick, reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  cloneDefaultOnlyPreviewSettings,
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT,
  ONLY_PREVIEW_MAX_MARKDOWN_BYTES,
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewPreviewPresentation,
  type OnlyPreviewSettings,
  type OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { OnlyPreviewCharacterCountSourceGate } from '../../common/onlyPreviewCharacterCountGate.service';
import {
  isOnlyPreviewPresentationNudge,
  sameOnlyPreviewSelection
} from '../../common/onlyPreviewPresentation.service';

const toRendererError = (error: unknown): { code: OnlyPreviewErrorCode; message: string } => {
  const contractError = error instanceof OnlyPreviewContractError ? error : null;
  const code = contractError?.code || 'OPERATION_FAILED';
  return {
    code,
    message: contractError
      ? getOnlyPreviewErrorMessage(contractError.code)
      : onlyPreviewI18n.errors.OPERATION_FAILED
  };
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
  selectionReportingRevision = '';
  private initialized = false;
  private generation = 0;
  private presentation: OnlyPreviewPreviewPresentation | null = null;
  private appliedDescriptorRevision = -1;
  private loadedRevision = -1;
  private resetAcknowledgedRevision = -1;
  private presentationFetchGeneration = 0;
  private readonly characterCountGate = new OnlyPreviewCharacterCountSourceGate();

  get descriptorType(): string {
    const descriptor = this.descriptor;
    if (!descriptor) return '';
    return (
      descriptor.language ||
      descriptor.extension.replace(/^\./, '').toUpperCase() ||
      descriptor.kind
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.subscribe();
    if (
      !onlyPreviewEnv.hostToken ||
      !onlyPreviewEnv.hostId ||
      !onlyPreviewEnv.previewRuntimeToken
    ) {
      this.errorCode = 'HOST_NOT_FOUND';
      this.errorMessage = onlyPreviewI18n.errors.HOST_NOT_FOUND;
      return;
    }
    await Promise.all([this.refreshSettings(), this.syncPresentation()]);
  }

  reportMediaError(reportingRevision: string): void {
    if (!this.characterCountGate.disarm(reportingRevision)) return;
    this.broadcastCharacterCount(0);
    this.presentationError = onlyPreviewI18n.preview.mediaFailed;
    void this.reportErrorForCurrentRevision('OPERATION_FAILED');
  }

  reportSurfaceReady(reportingRevision: string): void {
    const selectionRevision = Number(reportingRevision);
    if (
      !this.characterCountGate.isCurrent(reportingRevision) ||
      !Number.isSafeInteger(selectionRevision)
    ) {
      return;
    }
    void this.reportReady(selectionRevision);
  }

  reportSurfaceError(reportingRevision: string, errorCode: OnlyPreviewErrorCode): void {
    const selectionRevision = Number(reportingRevision);
    if (
      !this.characterCountGate.isCurrent(reportingRevision) ||
      !Number.isSafeInteger(selectionRevision)
    ) {
      return;
    }
    void this.reportError(selectionRevision, errorCode);
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

  private subscribe(): void {
    xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, () => {
      void this.refreshSettings();
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, ({ params }) => {
      if (!isOnlyPreviewPresentationNudge(params) || params.hostId !== onlyPreviewEnv.hostId) {
        return;
      }
      void this.syncPresentation();
    });
  }

  private async syncPresentation(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const previewRuntimeToken = onlyPreviewEnv.previewRuntimeToken;
    if (!hostToken || !previewRuntimeToken) return;
    const generation = ++this.presentationFetchGeneration;
    try {
      const presentation = unwrapOnlyPreviewResult(
        await onlyPreviewClient.getVuePreviewPresentation({ hostToken, previewRuntimeToken })
      );
      if (generation !== this.presentationFetchGeneration) return;
      await this.applyPresentation(presentation, generation);
    } catch (error) {
      if (generation !== this.presentationFetchGeneration) return;
      const failure = toRendererError(error);
      this.errorCode = failure.code;
      this.errorMessage = failure.message;
    }
  }

  private async applyPresentation(
    presentation: OnlyPreviewPreviewPresentation,
    fetchGeneration: number
  ): Promise<void> {
    const current = this.presentation;
    if (presentation.hostId !== onlyPreviewEnv.hostId) return;
    if (current && presentation.selectionRevision < current.selectionRevision) return;
    if (
      current &&
      presentation.selectionRevision === current.selectionRevision &&
      !sameOnlyPreviewSelection(current, presentation)
    ) {
      return;
    }

    const revisionChanged = presentation.selectionRevision !== current?.selectionRevision;
    if (revisionChanged) this.beginSelection(presentation);
    else {
      this.presentation = presentation;
      this.currentRef = presentation.fileRef ? { ...presentation.fileRef } : null;
    }

    if (presentation.surface !== 'vue') {
      this.generation += 1;
      this.resetAcknowledgedRevision = -1;
      this.descriptor = null;
      this.textContent = null;
      this.loading = false;
      this.errorCode = null;
      this.errorMessage = '';
      this.presentationError = '';
      this.selectionReportingRevision = '';
      return;
    }
    if (presentation.status === 'empty' || !presentation.fileRef) {
      this.loading = false;
      await this.acknowledgeReset(presentation.selectionRevision, fetchGeneration);
      return;
    }
    if (presentation.status === 'unavailable') {
      this.generation += 1;
      this.descriptor = presentation.descriptor ? { ...presentation.descriptor } : null;
      this.textContent = null;
      this.loading = false;
      this.errorCode = presentation.error?.code || 'OPERATION_FAILED';
      this.errorMessage = presentation.error
        ? getOnlyPreviewErrorMessage(presentation.error.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
      await this.acknowledgeReset(presentation.selectionRevision, fetchGeneration);
      return;
    }
    if (presentation.error) {
      this.generation += 1;
      this.descriptor = presentation.descriptor ? { ...presentation.descriptor } : null;
      this.textContent = null;
      this.loading = false;
      this.errorCode = presentation.error.code;
      this.errorMessage = getOnlyPreviewErrorMessage(presentation.error.code);
      if (!(await this.acknowledgeReset(presentation.selectionRevision, fetchGeneration))) return;
      await this.reportError(presentation.selectionRevision, presentation.error.code);
      return;
    }
    if (!presentation.descriptor) {
      this.loading = true;
      await this.acknowledgeReset(presentation.selectionRevision, fetchGeneration);
      return;
    }
    if (presentation.status === 'ready' && this.loadedRevision === presentation.selectionRevision) {
      this.descriptor = { ...presentation.descriptor };
      this.loading = false;
      await this.acknowledgeReset(presentation.selectionRevision, fetchGeneration);
      return;
    }
    if (!(await this.acknowledgeReset(presentation.selectionRevision, fetchGeneration))) return;
    if (this.appliedDescriptorRevision === presentation.selectionRevision) return;
    this.appliedDescriptorRevision = presentation.selectionRevision;
    await this.loadPresentation(presentation);
  }

  private beginSelection(presentation: OnlyPreviewPreviewPresentation): void {
    this.generation += 1;
    this.presentation = presentation;
    this.currentRef = presentation.fileRef ? { ...presentation.fileRef } : null;
    this.descriptor = null;
    this.textContent = null;
    this.loading = presentation.status === 'loading';
    this.errorCode = null;
    this.errorMessage = '';
    this.presentationError = '';
    this.selectionReportingRevision = '';
    this.appliedDescriptorRevision = -1;
    this.loadedRevision = -1;
    this.resetAcknowledgedRevision = -1;
    const reportingRevision = String(presentation.selectionRevision);
    this.characterCountGate.beginTransition(reportingRevision);
    this.broadcastCharacterCount(0);
  }

  private async loadPresentation(presentation: OnlyPreviewPreviewPresentation): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const previewRuntimeToken = onlyPreviewEnv.previewRuntimeToken;
    const fileRef = presentation.fileRef;
    if (!hostToken || !previewRuntimeToken || !fileRef || presentation.surface !== 'vue') return;
    const generation = ++this.generation;
    const revision = presentation.selectionRevision;
    const reportingRevision = String(revision);
    this.descriptor = { ...presentation.descriptor! };
    this.textContent = null;
    this.selectionReportingRevision = reportingRevision;
    this.loading = true;
    try {
      if (presentation.adapterId === 'monaco' || presentation.adapterId === 'markdown-dom') {
        const textContent = unwrapOnlyPreviewResult(
          await onlyPreviewClient.readText({
            hostToken,
            previewRuntimeToken,
            selectionRevision: revision,
            ...fileRef,
            adapterId: presentation.adapterId
          })
        );
        if (!this.isCurrent(generation, revision)) return;
        if (
          presentation.adapterId === 'markdown-dom' &&
          textContent.size > ONLY_PREVIEW_MAX_MARKDOWN_BYTES
        ) {
          throw new OnlyPreviewContractError(
            'TEXT_TOO_LARGE',
            'Markdown rendering exceeds the bounded renderer limit.'
          );
        }
        this.textContent = textContent;
      } else if (
        presentation.adapterId === 'html-page' ||
        presentation.adapterId === 'chromium-pdf'
      ) {
        throw new OnlyPreviewContractError(
          'INVALID_INPUT',
          'A Chromium-direct document was routed to the Vue Preview surface.'
        );
      }
      await nextTick();
      if (!this.isCurrent(generation, revision)) return;
      this.loadedRevision = revision;
      this.loading = false;
      if (
        presentation.adapterId !== 'markdown-dom' &&
        presentation.adapterId !== 'image' &&
        presentation.adapterId !== 'audio' &&
        presentation.adapterId !== 'video'
      ) {
        await this.reportReady(revision);
      }
    } catch (error) {
      if (!this.isCurrent(generation, revision)) return;
      const failure = toRendererError(error);
      this.loading = false;
      this.errorCode = failure.code;
      this.errorMessage = failure.message;
      await this.reportError(revision, failure.code);
    }
  }

  private isCurrent(generation: number, revision: number): boolean {
    return (
      generation === this.generation &&
      this.presentation?.selectionRevision === revision &&
      this.presentation.surface === 'vue'
    );
  }

  private async acknowledgeReset(
    selectionRevision: number,
    fetchGeneration: number
  ): Promise<boolean> {
    if (this.resetAcknowledgedRevision === selectionRevision) {
      return this.isCurrentPresentationFetch(fetchGeneration, selectionRevision);
    }
    const hostToken = onlyPreviewEnv.hostToken;
    const previewRuntimeToken = onlyPreviewEnv.previewRuntimeToken;
    if (!hostToken || !previewRuntimeToken) return false;
    await nextTick();
    if (!this.isCurrentPresentationFetch(fetchGeneration, selectionRevision)) return false;
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.reportPreviewReset({
          hostToken,
          selectionRevision,
          previewRuntimeToken
        })
      );
    } catch {
      return false;
    }
    if (!this.isCurrentPresentationFetch(fetchGeneration, selectionRevision)) return false;
    this.resetAcknowledgedRevision = selectionRevision;
    return true;
  }

  private isCurrentPresentationFetch(fetchGeneration: number, selectionRevision: number): boolean {
    return (
      fetchGeneration === this.presentationFetchGeneration &&
      this.presentation?.selectionRevision === selectionRevision &&
      this.presentation.surface === 'vue'
    );
  }

  private async reportReady(selectionRevision: number): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const previewRuntimeToken = onlyPreviewEnv.previewRuntimeToken;
    if (!hostToken || !previewRuntimeToken) return;
    await onlyPreviewClient
      .reportPreviewReady({ hostToken, selectionRevision, previewRuntimeToken })
      .catch(() => null);
  }

  private async reportError(
    selectionRevision: number,
    errorCode: OnlyPreviewErrorCode
  ): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const previewRuntimeToken = onlyPreviewEnv.previewRuntimeToken;
    if (!hostToken || !previewRuntimeToken) return;
    await onlyPreviewClient
      .reportPreviewError({ hostToken, selectionRevision, previewRuntimeToken, errorCode })
      .catch(() => null);
  }

  private async reportErrorForCurrentRevision(errorCode: OnlyPreviewErrorCode): Promise<void> {
    const revision = this.presentation?.selectionRevision;
    if (revision === undefined) return;
    await this.reportError(revision, errorCode);
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
      this.settings = cloneDefaultOnlyPreviewSettings();
    }
  }
}

export const onlyPreviewPreviewStore = reactive<OnlyPreviewPreviewStore>(
  new OnlyPreviewPreviewStore()
);
