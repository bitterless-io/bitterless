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
  ONLY_PREVIEW_PREVIEW_CONTROL_EVENT,
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewCharacterCountRevisionEvent,
  type OnlyPreviewDescriptor,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFileRef,
  type OnlyPreviewSettings,
  type OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewSearchWatchCommitEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { OnlyPreviewCharacterCountSourceGate } from '../../common/onlyPreviewCharacterCountGate.service';
import {
  createOnlyPreviewWatchReloadCursor,
  evaluateOnlyPreviewWatchReload,
  type OnlyPreviewWatchReloadCursor
} from './onlyPreviewWatchReload.service';

const isExactHostEvent = (value: unknown): value is { hostId: string } => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return Object.keys(event).length === 1 && typeof event.hostId === 'string';
};

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
  private nextAction: 'render' | 'reload' = 'render';
  private currentRelativePath = '';
  private watchCursor: OnlyPreviewWatchReloadCursor = createOnlyPreviewWatchReloadCursor();
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
    this.currentRelativePath = '';
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
      this.currentRelativePath = descriptor.relativePath;
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
    this.currentRelativePath = '';
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
    xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, () => {
      void this.refreshSettings();
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT, (payload) => {
      if (!isRevisionEvent(payload.params) || payload.params.hostId !== onlyPreviewEnv.hostId) {
        return;
      }
      const action = this.nextAction;
      this.nextAction = 'render';
      this.startTransition(payload.params.revision, action);
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, (payload) => {
      if (isExactHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.watchCursor = createOnlyPreviewWatchReloadCursor();
        this.nextAction = 'render';
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_REFRESH_EVENT, (payload) => {
      if (isExactHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.nextAction = 'reload';
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT, (payload) => {
      if (!isWatchCommitEvent(payload.params) || payload.params.hostId !== onlyPreviewEnv.hostId) {
        return;
      }
      const decision = evaluateOnlyPreviewWatchReload(
        this.watchCursor,
        payload.params.commit,
        this.currentRelativePath
      );
      this.watchCursor = decision.cursor;
      if (!decision.reload) return;
      this.startTransition(crypto.randomUUID(), 'reload');
    });
  }

  /**
   * The Shell owns selection and normally issues the transition revision. The Preview view also starts
   * its own transitions for watch-driven reloads, so every transition is announced back to the Shell
   * before the load begins; its character-count gate keys off that revision.
   */
  private startTransition(revision: string, action: 'render' | 'reload'): void {
    const hostId = onlyPreviewEnv.hostId;
    if (hostId) {
      xpcRenderer.broadcast(ONLY_PREVIEW_PREVIEW_CONTROL_EVENT, { hostId, revision, action });
    }
    void this.restoreSelection(revision);
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
