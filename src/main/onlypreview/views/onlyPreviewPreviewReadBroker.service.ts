import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewWorkspaceRegistry } from '@main/onlypreview/onlyPreviewWorkspace.registry';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  getOnlyPreviewFileSizeLimit,
  type OnlyPreviewDescriptor,
  type OnlyPreviewFileRef,
  type OnlyPreviewPreviewPresentation
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_OFFICE_READ_MAX_BYTES,
  type OnlyPreviewOfficePackageKind,
  type OnlyPreviewOfficeReadChunkRuntimeResult,
  type OnlyPreviewOfficeReadOpenRuntimeResult
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import type {
  OnlyPreviewPreviewReadChunkResult,
  OnlyPreviewPreviewReadOpenResult,
  OnlyPreviewPreviewReadPreparedSelection
} from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';

interface OfficeReadAuthority {
  brokerCapability: string;
  grantId: string;
  runtimeId: string;
  selectionRevision: number;
  kind: OnlyPreviewOfficePackageKind;
  opened: boolean;
}

interface PreviewReadAuthority {
  brokerCapability: string | null;
  prepared: OnlyPreviewPreviewReadPreparedSelection;
  textSessions: Set<string>;
}

interface PreviewReadBrokerCallbacks {
  requireCurrentVueRevision: (
    hostToken: string,
    selectionRevision: number,
    previewRuntimeToken: string
  ) => void;
  requireVueRuntime: (hostToken: string, previewRuntimeToken: string) => void;
  getPresentation: () => OnlyPreviewPreviewPresentation;
}

export class OnlyPreviewPreviewReadBrokerService {
  private officeAuthority: OfficeReadAuthority | null = null;
  private previewAuthority: PreviewReadAuthority | null = null;
  private officeCancellationFence: Promise<void> = Promise.resolve();

  constructor(private readonly callbacks: PreviewReadBrokerCallbacks) {}

  setPreviewAuthority(
    brokerCapability: string | null,
    prepared: OnlyPreviewPreviewReadPreparedSelection
  ): void {
    this.previewAuthority = { brokerCapability, prepared, textSessions: new Set() };
  }

  setOfficeAuthority(authority: Omit<OfficeReadAuthority, 'opened'>): void {
    this.officeAuthority = { ...authority, opened: false };
  }

  hasOfficeSelection(selectionRevision: number): boolean {
    return this.officeAuthority?.selectionRevision === selectionRevision;
  }

  async waitForOfficeCancellation(): Promise<void> {
    await this.officeCancellationFence;
  }

  async prepareOfficeSelection(params: {
    hostToken: string;
    fileRef: OnlyPreviewFileRef;
    selectionRevision: number;
    runtimeId: string;
    kind: OnlyPreviewOfficePackageKind;
  }): Promise<{
    adapterId: 'ooxml-xlsx' | 'ooxml-docx' | 'ooxml-pptx';
    descriptor: OnlyPreviewDescriptor;
    grantId: string;
  }> {
    const bootstrap = onlyPreviewWorkspaceRegistry.getOfficeReadBootstrap(
      params.hostToken,
      params.fileRef
    );
    const adapterId =
      params.kind === 'xlsx'
        ? 'ooxml-xlsx'
        : params.kind === 'docx'
          ? 'ooxml-docx'
          : 'ooxml-pptx';
    const configuredMaxBytes = getOnlyPreviewFileSizeLimit(adapterId);
    const prepared = await fileSearchWindowService.prepareOfficeRead({
      grantId: randomUUID(),
      runtimeId: params.runtimeId,
      selectionRevision: params.selectionRevision,
      kind: params.kind,
      workspaceId: bootstrap.workspaceId,
      relativePath: bootstrap.relativePath,
      maxBytes: Math.min(
        configuredMaxBytes ?? ONLY_PREVIEW_OFFICE_READ_MAX_BYTES,
        ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
      )
    });
    const extension = extname(params.fileRef.relativePath).toLowerCase();
    const descriptorKind =
      params.kind === 'xlsx'
        ? 'sheet'
        : params.kind === 'docx'
          ? 'document'
          : 'presentation';
    return {
      adapterId,
      grantId: prepared.grantId,
      descriptor: {
        workspaceId: params.fileRef.workspaceId,
        relativePath: params.fileRef.relativePath,
        name: basename(params.fileRef.relativePath),
        extension,
        kind: descriptorKind,
        mimeType:
          params.kind === 'xlsx'
            ? extension === '.xlsm'
              ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : params.kind === 'docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        language: '',
        size: prepared.size,
        modifiedAt: prepared.modifiedAt
      }
    };
  }

  async cancelPreparedOffice(
    grantId: string,
    runtimeId: string,
    selectionRevision: number
  ): Promise<void> {
    await fileSearchWindowService.cancelOfficeRead({
      grantId,
      runtimeId,
      selectionRevision
    });
  }

  async openCurrentOfficeRead(
    hostToken: string,
    brokerCapability: string,
    previewRuntimeToken: string,
    selectionRevision: number
  ): Promise<OnlyPreviewOfficeReadOpenRuntimeResult> {
    this.callbacks.requireCurrentVueRevision(
      hostToken,
      selectionRevision,
      previewRuntimeToken
    );
    const authority = this.officeAuthority;
    if (
      !authority ||
      authority.brokerCapability !== brokerCapability ||
      authority.opened ||
      authority.runtimeId !== previewRuntimeToken ||
      authority.selectionRevision !== selectionRevision
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read authority is unavailable.');
    }
    authority.opened = true;
    return await fileSearchWindowService.openOfficeRead({
      grantId: authority.grantId,
      runtimeId: authority.runtimeId,
      selectionRevision: authority.selectionRevision
    });
  }

  async readCurrentOfficeChunk(
    hostToken: string,
    brokerCapability: string,
    previewRuntimeToken: string,
    selectionRevision: number,
    grantId: string,
    offset: number
  ): Promise<OnlyPreviewOfficeReadChunkRuntimeResult> {
    this.callbacks.requireCurrentVueRevision(
      hostToken,
      selectionRevision,
      previewRuntimeToken
    );
    const authority = this.officeAuthority;
    if (
      !authority?.opened ||
      authority.brokerCapability !== brokerCapability ||
      authority.grantId !== grantId
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read authority is unavailable.');
    }
    return await fileSearchWindowService.readNextOfficeChunk({
      grantId,
      runtimeId: previewRuntimeToken,
      selectionRevision,
      offset
    });
  }

  async cancelCurrentOfficeRead(
    hostToken: string,
    brokerCapability: string,
    previewRuntimeToken: string,
    selectionRevision: number,
    grantId: string
  ): Promise<void> {
    this.callbacks.requireVueRuntime(hostToken, previewRuntimeToken);
    const authority = this.officeAuthority;
    if (
      !authority ||
      authority.brokerCapability !== brokerCapability ||
      authority.grantId !== grantId ||
      authority.selectionRevision !== selectionRevision
    ) {
      return;
    }
    await fileSearchWindowService.cancelOfficeRead({
      grantId,
      runtimeId: previewRuntimeToken,
      selectionRevision
    });
    if (this.officeAuthority === authority) this.officeAuthority = null;
  }

  async openCurrentPreviewText(
    hostToken: string,
    brokerCapability: string,
    previewRuntimeToken: string,
    selectionRevision: number
  ): Promise<OnlyPreviewPreviewReadOpenResult> {
    this.callbacks.requireCurrentVueRevision(
      hostToken,
      selectionRevision,
      previewRuntimeToken
    );
    const authority = this.previewAuthority;
    const presentation = this.callbacks.getPresentation();
    const descriptor = presentation.descriptor;
    if (
      !authority ||
      authority.brokerCapability !== brokerCapability ||
      authority.prepared.selectionRevision !== selectionRevision ||
      (presentation.adapterId !== 'monaco' && presentation.adapterId !== 'markdown-dom') ||
      descriptor?.kind !== 'text' ||
      presentation.status !== 'loading'
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text authority is unavailable.');
    }
    const sessionId = randomUUID();
    const opened = await fileSearchWindowService.openPreviewRead({
      grantId: authority.prepared.grantId,
      selectionRevision,
      sessionId,
      method: 'GET',
      source: { kind: 'selection' },
      start: 0,
      end: descriptor.size === 0 ? -1 : descriptor.size - 1
    });
    this.callbacks.requireCurrentVueRevision(
      hostToken,
      selectionRevision,
      previewRuntimeToken
    );
    if (this.previewAuthority !== authority) {
      await fileSearchWindowService
        .cancelPreviewRead({
          grantId: authority.prepared.grantId,
          selectionRevision,
          sessionId
        })
        .catch(() => undefined);
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text authority is stale.');
    }
    if (!opened.eof) authority.textSessions.add(sessionId);
    return opened;
  }

  async readCurrentPreviewTextChunk(
    hostToken: string,
    brokerCapability: string,
    previewRuntimeToken: string,
    selectionRevision: number,
    grantId: string,
    sessionId: string,
    offset: number
  ): Promise<OnlyPreviewPreviewReadChunkResult> {
    this.callbacks.requireCurrentVueRevision(
      hostToken,
      selectionRevision,
      previewRuntimeToken
    );
    const authority = this.previewAuthority;
    if (
      !authority ||
      authority.brokerCapability !== brokerCapability ||
      authority.prepared.grantId !== grantId ||
      !authority.textSessions.has(sessionId)
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text authority is unavailable.');
    }
    const chunk = await fileSearchWindowService.readNextPreviewChunk({
      grantId,
      selectionRevision,
      sessionId,
      offset
    });
    this.callbacks.requireCurrentVueRevision(
      hostToken,
      selectionRevision,
      previewRuntimeToken
    );
    if (this.previewAuthority !== authority || !authority.textSessions.has(sessionId)) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text authority is stale.');
    }
    if (chunk.eof) authority.textSessions.delete(sessionId);
    return chunk;
  }

  async cancelCurrentPreviewText(
    hostToken: string,
    brokerCapability: string,
    previewRuntimeToken: string,
    selectionRevision: number,
    grantId: string,
    sessionId: string
  ): Promise<void> {
    this.callbacks.requireVueRuntime(hostToken, previewRuntimeToken);
    const authority = this.previewAuthority;
    if (
      !authority ||
      authority.brokerCapability !== brokerCapability ||
      authority.prepared.grantId !== grantId ||
      authority.prepared.selectionRevision !== selectionRevision ||
      !authority.textSessions.delete(sessionId)
    ) {
      return;
    }
    await fileSearchWindowService.cancelPreviewRead({
      grantId,
      selectionRevision,
      sessionId
    });
  }

  revokePreviewReadAuthority(): void {
    const authority = this.previewAuthority;
    this.previewAuthority = null;
    if (!authority) return;
    void fileSearchWindowService
      .cancelPreviewRead({
        grantId: authority.prepared.grantId,
        selectionRevision: authority.prepared.selectionRevision
      })
      .catch(() => undefined);
  }

  revokeOfficeReadAuthority(): void {
    const authority = this.officeAuthority;
    this.officeAuthority = null;
    this.officeCancellationFence = this.officeCancellationFence
      .then(async () => {
        await fileSearchWindowService.cancelOfficeRead({
          ...(authority
            ? {
                grantId: authority.grantId,
                runtimeId: authority.runtimeId,
                selectionRevision: authority.selectionRevision
              }
            : {})
        });
      })
      .catch(() => undefined);
  }

  revokeAll(): void {
    this.revokePreviewReadAuthority();
    this.revokeOfficeReadAuthority();
  }
}
