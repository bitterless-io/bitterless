import { markRaw, nextTick, reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  cloneDefaultOnlyPreviewSettings,
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT,
  ONLY_PREVIEW_FIND_STATE_EVENT,
  ONLY_PREVIEW_MAX_MARKDOWN_BYTES,
  ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewFindCoverage,
  type OnlyPreviewFindSnapshot,
  type OnlyPreviewPreviewPresentation,
  type OnlyPreviewSettings,
  type OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewOfficeRead } from '../../common/contextBridge/onlyPreviewOfficeRead.bridge';
import { onlyPreviewPreviewRead } from '../../common/contextBridge/onlyPreviewPreviewRead.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { OnlyPreviewCharacterCountSourceGate } from '../../common/onlyPreviewCharacterCountGate.service';
import {
  isOnlyPreviewPresentationNudge,
  sameOnlyPreviewSelection
} from '../../common/onlyPreviewPresentation.service';
import type { OnlyPreviewDrawioContent } from './onlyPreviewDrawio.service';
import { OnlyPreviewDrawioSelectionStore } from './onlyPreviewDrawioSelection.store';
import { OnlyPreviewImageSession, type OnlyPreviewImageRender } from './onlyPreviewImage.service';
import { OnlyPreviewMediaSession } from './onlyPreviewMedia.service';
import { onlyPreviewFindAdapterBridge } from './onlyPreviewFindAdapter.service';
import { OnlyPreviewOfficeSession } from './onlyPreviewOfficeSession.service';

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

export interface OnlyPreviewMetadataViewModel {
  variant: 'unsupported' | 'error';
  title: string;
  reason: string;
  name: string;
  type: string;
  size: number;
  modifiedAt: number;
}

class OnlyPreviewPreviewStore {
  currentRef: OnlyPreviewFileRef | null = null;
  descriptor: OnlyPreviewDescriptor | null = null;
  textContent: OnlyPreviewTextContent | null = null;
  officeSession: OnlyPreviewOfficeSession | null = null;
  drawioContent: OnlyPreviewDrawioContent | null = null;
  imageSession: OnlyPreviewImageSession | null = null;
  imageContent: OnlyPreviewImageRender | null = null;
  mediaSession: OnlyPreviewMediaSession | null = null;
  mediaPrepared = false;
  settings: OnlyPreviewSettings = cloneDefaultOnlyPreviewSettings();
  loading = false;
  errorCode: OnlyPreviewErrorCode | null = null;
  errorMessage = '';
  presentationError = '';
  openingExternally = false;
  openExternallyError = '';
  selectionReportingRevision = '';
  private initialized = false;
  private generation = 0;
  private presentation: OnlyPreviewPreviewPresentation | null = null;
  private appliedDescriptorRevision = -1;
  private loadedRevision = -1;
  private resetAcknowledgedRevision = -1;
  private presentationFetchGeneration = 0;
  private findSnapshotFetchGeneration = 0;
  private findSnapshot: OnlyPreviewFindSnapshot | null = null;
  private nativeFindSuppressesSelection = false;
  private descriptorErrorActive = false;
  private openExternallyGeneration = 0;
  private readonly characterCountGate = new OnlyPreviewCharacterCountSourceGate();
  private readonly drawioSelection = markRaw(new OnlyPreviewDrawioSelectionStore());

  get descriptorType(): string {
    const descriptor = this.descriptor;
    if (!descriptor) return '';
    return (
      descriptor.language ||
      descriptor.extension.replace(/^\./, '').toUpperCase() ||
      descriptor.kind
    );
  }

  get previewMetadata(): OnlyPreviewMetadataViewModel | null {
    const descriptor = this.descriptor;
    if (!descriptor || this.presentation?.surface !== 'vue') return null;
    const hasAnyError =
      this.errorCode !== null || this.errorMessage !== '' || this.presentationError !== '';
    const hasError = this.descriptorErrorActive && hasAnyError;
    if (hasAnyError && !hasError) return null;
    if (!hasError && this.presentation.adapterId !== 'unsupported') return null;
    const variant = hasError ? 'error' : 'unsupported';
    let reason = this.errorMessage || this.presentationError;
    if (!reason) {
      if (descriptor.unsupportedCategory === 'image-format') {
        reason = onlyPreviewI18n.preview.unsupportedImageBody;
      } else if (descriptor.unsupportedCategory === 'video-container') {
        reason = onlyPreviewI18n.preview.unsupportedVideoBody;
      } else {
        reason = onlyPreviewI18n.preview.unsupportedBody;
      }
    }
    return {
      variant,
      title:
        variant === 'error'
          ? onlyPreviewI18n.preview.failedTitle
          : onlyPreviewI18n.preview.unsupportedTitle,
      reason,
      name: descriptor.name,
      type: this.descriptorType,
      size: descriptor.size,
      modifiedAt: descriptor.modifiedAt
    };
  }

  get showsUnsupportedMetadata(): boolean {
    return this.previewMetadata?.variant === 'unsupported';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    onlyPreviewFindAdapterBridge.initialize();
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

  reportSurfaceReady(reportingRevision: string): void {
    const selectionRevision = Number(reportingRevision);
    if (
      !this.characterCountGate.isCurrent(reportingRevision) ||
      !Number.isSafeInteger(selectionRevision) ||
      this.errorCode !== null ||
      this.loadedRevision === selectionRevision
    ) {
      return;
    }
    this.loadedRevision = selectionRevision;
    this.loading = false;
    void this.reportReady(selectionRevision);
  }

  reportSurfaceError(reportingRevision: string, errorCode: OnlyPreviewErrorCode): void {
    const selectionRevision = Number(reportingRevision);
    if (
      !this.characterCountGate.disarm(reportingRevision) ||
      !Number.isSafeInteger(selectionRevision)
    ) {
      return;
    }
    this.disposeContentSessions();
    this.loadedRevision = -1;
    this.loading = false;
    this.errorCode = errorCode;
    this.errorMessage = getOnlyPreviewErrorMessage(errorCode);
    this.presentationError = '';
    this.descriptorErrorActive = true;
    void this.reportError(selectionRevision, errorCode);
  }

  reportOfficeReady(reportingRevision: string): void {
    const selectionRevision = Number(reportingRevision);
    if (
      !this.characterCountGate.isCurrent(reportingRevision) ||
      !Number.isSafeInteger(selectionRevision) ||
      !this.presentation ||
      !['ooxml-xlsx', 'ooxml-docx', 'ooxml-pptx'].includes(this.presentation.adapterId) ||
      !this.officeSession ||
      this.errorCode !== null
    ) {
      return;
    }
    this.loadedRevision = selectionRevision;
    this.loading = false;
    void this.reportReady(selectionRevision, { kind: 'complete' }, 'office');
  }

  reportMonacoReady(reportingRevision: string): void {
    const selectionRevision = Number(reportingRevision);
    if (
      !this.characterCountGate.isCurrent(reportingRevision) ||
      !Number.isSafeInteger(selectionRevision) ||
      this.presentation?.adapterId !== 'monaco' ||
      this.errorCode !== null
    ) {
      return;
    }
    this.loadedRevision = selectionRevision;
    this.loading = false;
    void this.reportReady(selectionRevision, { kind: 'complete' }, 'monaco');
  }

  dispose(): void {
    this.generation += 1;
    this.presentationFetchGeneration += 1;
    this.findSnapshotFetchGeneration += 1;
    this.resetOpenExternallyAction();
    this.findSnapshot = null;
    this.nativeFindSuppressesSelection = false;
    this.disposeContentSessions();
    onlyPreviewFindAdapterBridge.clear();
  }

  async openExternally(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const fileRef = this.currentRef ? { ...this.currentRef } : null;
    if (!hostToken || !fileRef || this.openingExternally) return;

    const generation = ++this.openExternallyGeneration;
    this.openingExternally = true;
    this.openExternallyError = '';
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.openExternally({
          hostToken,
          ...fileRef
        })
      );
    } catch (error) {
      if (!this.isCurrentOpenExternallyAction(generation, fileRef)) return;
      const failure = toRendererError(error);
      this.openExternallyError =
        failure.code === 'OPERATION_FAILED'
          ? onlyPreviewI18n.preview.openExternallyFailed
          : failure.message;
    } finally {
      if (this.isCurrentOpenExternallyAction(generation, fileRef)) {
        this.openingExternally = false;
      }
    }
  }

  reportCharacterCount(characterCount: number, reportingRevision: string): void {
    const normalizedCount =
      Number.isSafeInteger(characterCount) && characterCount >= 0 ? characterCount : 0;
    if (this.nativeFindSuppressesSelection) return;
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
    xpcRenderer.subscribe(ONLY_PREVIEW_FIND_STATE_EVENT, ({ params }) => {
      if (!isOnlyPreviewPresentationNudge(params) || params.hostId !== onlyPreviewEnv.hostId) {
        return;
      }
      void this.syncFindSelectionSuppression();
    });
  }

  private async syncFindSelectionSuppression(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const generation = ++this.findSnapshotFetchGeneration;
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await onlyPreviewClient.getPreviewFindSnapshot({ hostToken })
      );
      if (
        generation !== this.findSnapshotFetchGeneration ||
        snapshot.state.hostId !== onlyPreviewEnv.hostId
      ) {
        return;
      }
      this.findSnapshot = snapshot;
      this.applyFindSelectionSuppression();
    } catch {
      if (generation !== this.findSnapshotFetchGeneration) return;
      this.findSnapshot = null;
      this.applyFindSelectionSuppression();
    }
  }

  private applyFindSelectionSuppression(): void {
    const presentation = this.presentation;
    const snapshot = this.findSnapshot;
    const suppressesSelection =
      snapshot?.open === true &&
      presentation?.surface === 'vue' &&
      snapshot.state.selectionRevision === presentation.selectionRevision &&
      snapshot.state.surface === presentation.surface &&
      presentation.adapterId === 'markdown-dom';
    if (suppressesSelection === this.nativeFindSuppressesSelection) return;
    this.nativeFindSuppressesSelection = suppressesSelection;
    this.broadcastCharacterCount(0);
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
      this.descriptorErrorActive = false;
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
    this.applyFindSelectionSuppression();

    if (presentation.surface !== 'vue') {
      this.generation += 1;
      this.resetOpenExternallyAction();
      this.disposeContentSessions();
      this.resetAcknowledgedRevision = -1;
      this.descriptor = null;
      this.textContent = null;
      this.loading = false;
      this.errorCode = null;
      this.errorMessage = '';
      this.presentationError = '';
      this.descriptorErrorActive = false;
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
      this.disposeContentSessions();
      this.descriptor = presentation.descriptor ? { ...presentation.descriptor } : null;
      this.textContent = null;
      this.loading = false;
      this.errorCode = presentation.error?.code || 'OPERATION_FAILED';
      this.errorMessage = presentation.error
        ? getOnlyPreviewErrorMessage(presentation.error.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
      this.descriptorErrorActive = true;
      await this.acknowledgeReset(presentation.selectionRevision, fetchGeneration);
      return;
    }
    if (presentation.error) {
      this.generation += 1;
      this.disposeContentSessions();
      this.descriptor = presentation.descriptor ? { ...presentation.descriptor } : null;
      this.textContent = null;
      this.loading = false;
      this.errorCode = presentation.error.code;
      this.errorMessage = getOnlyPreviewErrorMessage(presentation.error.code);
      this.descriptorErrorActive = true;
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
    this.resetOpenExternallyAction();
    this.disposeContentSessions();
    this.presentation = presentation;
    this.applyFindSelectionSuppression();
    this.currentRef = presentation.fileRef ? { ...presentation.fileRef } : null;
    this.descriptor = null;
    this.textContent = null;
    this.loading = presentation.status === 'loading';
    this.errorCode = null;
    this.errorMessage = '';
    this.presentationError = '';
    this.descriptorErrorActive = false;
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
      if (presentation.adapterId === 'unsupported') {
        this.loading = false;
        await nextTick();
        if (!this.isCurrent(generation, revision)) return;
        this.loadedRevision = revision;
        await this.reportReady(revision);
        return;
      }
      if (presentation.adapterId === 'monaco' || presentation.adapterId === 'markdown-dom') {
        const textContent = unwrapOnlyPreviewResult(
          await onlyPreviewPreviewRead.readCurrentText({ selectionRevision: revision })
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
        presentation.adapterId === 'ooxml-xlsx' ||
        presentation.adapterId === 'ooxml-docx' ||
        presentation.adapterId === 'ooxml-pptx'
      ) {
        const expectedKind =
          presentation.adapterId === 'ooxml-xlsx'
            ? 'sheet'
            : presentation.adapterId === 'ooxml-docx'
              ? 'document'
              : 'presentation';
        if (presentation.descriptor?.kind !== expectedKind) {
          throw new OnlyPreviewContractError(
            'INVALID_INPUT',
            'Office preview is missing its revision-bound asset.'
          );
        }
        const session = markRaw(
          new OnlyPreviewOfficeSession({
            hostId: onlyPreviewEnv.hostId!,
            selectionRevision: revision,
            kind:
              presentation.adapterId === 'ooxml-xlsx'
                ? 'xlsx'
                : presentation.adapterId === 'ooxml-docx'
                  ? 'docx'
                  : 'pptx',
            sourceExtension: presentation.descriptor.extension,
            expectedSize: presentation.descriptor.size,
            readBytes: async () => {
              const content = unwrapOnlyPreviewResult(
                await onlyPreviewOfficeRead.readCurrentOfficeBytes({
                  selectionRevision: revision
                })
              );
              if (content.selectionRevision !== revision) {
                throw new OnlyPreviewContractError(
                  'INVALID_INPUT',
                  'Office read response belongs to a stale selection.'
                );
              }
              return content.bytes;
            },
            onRuntimeError: (errorCode) => this.reportSurfaceError(String(revision), errorCode)
          })
        );
        this.officeSession = session;
        await nextTick();
        return;
      } else if (presentation.adapterId === 'drawio-viewer') {
        const assetUrl = presentation.descriptor?.assetUrl;
        if (presentation.descriptor?.kind !== 'diagram' || !assetUrl) {
          throw new OnlyPreviewContractError(
            'INVALID_INPUT',
            'Draw.io preview is missing its revision-bound asset.'
          );
        }
        const attempt = this.drawioSelection.start(
          onlyPreviewEnv.hostId!,
          revision,
          assetUrl,
          presentation.descriptor.size
        );
        const content = await attempt.result;
        if (!this.isCurrent(generation, revision)) {
          this.drawioSelection.cancel(attempt);
          return;
        }
        if (!this.drawioSelection.accept(attempt)) return;
        this.drawioContent = markRaw(content);
        await nextTick();
        return;
      } else if (presentation.adapterId === 'image') {
        const assetUrl = presentation.descriptor?.assetUrl;
        if (presentation.descriptor?.kind !== 'image' || !assetUrl) {
          throw new OnlyPreviewContractError(
            'INVALID_INPUT',
            'Image preview is missing its revision-bound asset.'
          );
        }
        const session = markRaw(new OnlyPreviewImageSession());
        this.imageSession = session;
        const content = await session.load(
          assetUrl,
          presentation.descriptor.size,
          presentation.descriptor.mimeType
        );
        if (!this.isCurrent(generation, revision)) {
          session.dispose();
          return;
        }
        this.imageContent = markRaw(content);
        await nextTick();
        return;
      } else if (presentation.adapterId === 'audio' || presentation.adapterId === 'video') {
        const assetUrl = presentation.descriptor?.assetUrl;
        if (presentation.descriptor?.kind !== presentation.adapterId || !assetUrl) {
          throw new OnlyPreviewContractError(
            'INVALID_INPUT',
            'Media preview is missing its revision-bound asset.'
          );
        }
        const session = markRaw(new OnlyPreviewMediaSession());
        this.mediaSession = session;
        await session.prepare(assetUrl, presentation.descriptor.size);
        if (!this.isCurrent(generation, revision)) {
          session.dispose();
          return;
        }
        this.mediaPrepared = true;
        await nextTick();
        return;
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
      // Monaco reports ready only after its model-backed find adapter is registered by the SFC.
    } catch (error) {
      if (!this.isCurrent(generation, revision)) return;
      this.disposeContentSessions();
      const failure = toRendererError(error);
      this.loading = false;
      this.errorCode = failure.code;
      this.errorMessage = failure.message;
      this.descriptorErrorActive = true;
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

  private isCurrentOpenExternallyAction(generation: number, fileRef: OnlyPreviewFileRef): boolean {
    const currentRef = this.currentRef;
    return (
      generation === this.openExternallyGeneration &&
      currentRef?.workspaceId === fileRef.workspaceId &&
      currentRef.relativePath === fileRef.relativePath
    );
  }

  private resetOpenExternallyAction(): void {
    this.openExternallyGeneration += 1;
    this.openingExternally = false;
    this.openExternallyError = '';
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

  private async reportReady(
    selectionRevision: number,
    findCoverage?: OnlyPreviewFindCoverage,
    findAdapter?: 'monaco' | 'office'
  ): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const previewRuntimeToken = onlyPreviewEnv.previewRuntimeToken;
    if (!hostToken || !previewRuntimeToken) return;
    await onlyPreviewClient
      .reportPreviewReady({
        hostToken,
        selectionRevision,
        previewRuntimeToken,
        ...(findCoverage ? { findCoverage } : {}),
        ...(findAdapter ? { findAdapter } : {})
      })
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

  private broadcastCharacterCount(characterCount: number): void {
    const hostId = onlyPreviewEnv.hostId;
    if (!hostId) return;
    xpcRenderer.broadcast(ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT, {
      hostId,
      characterCount
    });
  }

  private disposeOfficeSession(): void {
    this.officeSession?.dispose();
    this.officeSession = null;
  }

  private disposeImageSession(): void {
    this.imageSession?.dispose();
    this.imageSession = null;
    this.imageContent = null;
  }

  private disposeMediaSession(): void {
    this.mediaSession?.dispose();
    this.mediaSession = null;
    this.mediaPrepared = false;
  }

  private disposeContentSessions(): void {
    this.disposeOfficeSession();
    this.drawioSelection.dispose();
    this.drawioContent = null;
    this.disposeImageSession();
    this.disposeMediaSession();
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
