import { BrowserWindow } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';
import type { FileSearchRuntimePrivateApi } from '@shared/onlypreview/fileSearchRuntime.types';
import { fileSearchRuntimeHandlerName } from '@shared/onlypreview/fileSearchRuntime.types';
import {
  type OnlyPreviewOfficePrepareGrant,
  type OnlyPreviewOfficePrepareRuntimeResult,
  type OnlyPreviewOfficeReadChunkRuntimeResult,
  type OnlyPreviewOfficeReadOpenRuntimeResult
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import {
  onlyPreviewFileAuthorityRuntimeHandlerName,
  type OnlyPreviewFileAuthorityDeleteGrant,
  type OnlyPreviewFileAuthorityDeleteResult,
  type OnlyPreviewFileAuthorityRuntimePrivateApi,
  type OnlyPreviewFileAuthorityTarget,
  type OnlyPreviewFileAuthorityWorkspaceBinding,
  type OnlyPreviewValidatedTarget
} from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';
import {
  type OnlyPreviewPreviewReadChunkResult,
  type OnlyPreviewPreviewReadDocumentResource,
  type OnlyPreviewPreviewReadOpenRequest,
  type OnlyPreviewPreviewReadOpenResult,
  type OnlyPreviewPreviewReadPrepareGrant,
  type OnlyPreviewPreviewReadPreparedSelection
} from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { validateOnlyPreviewEntryName } from '@shared/onlypreview/onlyPreviewEntryName.shared';
import {
  OnlyPreviewProjectAuthorityProtocolError,
  unwrapOnlyPreviewProjectAuthorityResponse
} from './fileSearchProjectAuthorityResponse.service';
import { FileSearchOfficeReadClientService } from './fileSearchOfficeReadClient.service';
import { FileSearchPreviewReadClientService } from './fileSearchPreviewReadClient.service';
import { fileSearchRuntimeRelayService } from './fileSearchRuntimeRelay.service';
import { FileSearchLifecycleFence } from './fileSearchLifecycleFence.service';
import { waitForFileSearchRuntimeReady } from './fileSearchRuntimeReady.service';
import { registerFileSearchRuntimeEventHandler } from './fileSearchRuntimeEvent.handler';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

const requireProjectEntryName = (value: unknown): string => {
  const result = validateOnlyPreviewEntryName(value);
  if (!result.ok) {
    throw new OnlyPreviewContractError('NAME_INVALID', `The name is not usable: ${result.reason}.`);
  }
  return result.name;
};

const PROJECT_AUTHORITY_TIMEOUT_MS = 10_000;
const INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  );
};

const rendererTarget = (): { filePath: string; url: string } => {
  const rendererPath = 'fileSearch/index.html';
  const filePath = join(__dirname, `../renderer/${rendererPath}`);
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return {
      filePath,
      url: `${process.env.ELECTRON_RENDERER_URL.replace(/\/+$/, '')}/${rendererPath}`
    };
  }
  return { filePath, url: pathToFileURL(filePath).href };
};

export class FileSearchWindowService {
  private window: BrowserWindow | null = null;
  private projectAuthorityCapability: string | null = null;
  private projectAuthorityClient: OnlyPreviewFileAuthorityRuntimePrivateApi | null = null;
  private readonly officeReader: FileSearchOfficeReadClientService;
  private readonly previewReader: FileSearchPreviewReadClientService;
  private runtimeInstanceId: string | null = null;
  private privilegedRuntimeFatal: (() => void) | null = null;
  private lifecycleId = 0;

  constructor(
    private readonly diagnostics: OnlyPreviewSearchDiagnostics = createOnlyPreviewSearchDiagnostics()
  ) {
    this.officeReader = new FileSearchOfficeReadClientService({
      getLifecycleState: () => ({ lifecycleId: this.lifecycleId, window: this.window }),
      rejectProtocol: (message) => this.rejectOfficeReadProtocol(message)
    });
    this.previewReader = new FileSearchPreviewReadClientService({
      getLifecycleState: () => ({ lifecycleId: this.lifecycleId, window: this.window }),
      rejectProtocol: (message) => this.rejectPreviewReadProtocol(message)
    });
  }

  async start(params: {
    host: OnlyPreviewHostCapability;
    bootstrapToken: string;
    broadcast(eventName: string, value: unknown): void;
    onUnexpectedExit(reason: string): void;
    onOpenStage?(phase: 'runtime-search' | 'runtime-office' | 'runtime-authority' | 'runtime-preview-read'): void;
  }): Promise<void> {
    this.stop();
    const diagnostic = { tag: this.diagnostics.nextTag('w'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('runtime-window', {
      tag: diagnostic.tag,
      phase: 'start',
      elapsedMs: 0
    });
    const lifecycleId = ++this.lifecycleId;
    const capability = randomBytes(32).toString('base64url');
    const projectAuthorityCapability = randomBytes(32).toString('base64url');
    const instanceId = randomUUID();
    const officeReadCapability = this.officeReader.start(instanceId);
    const previewReadCapability = this.previewReader.start(instanceId);
    registerFileSearchRuntimeEventHandler(capability);
    const runtimeClient = createXpcMainEmitter<FileSearchRuntimePrivateApi>(
      fileSearchRuntimeHandlerName(capability)
    );
    const projectAuthorityClient = createXpcMainEmitter<OnlyPreviewFileAuthorityRuntimePrivateApi>(
      onlyPreviewFileAuthorityRuntimeHandlerName(projectAuthorityCapability)
    );
    const target = rendererTarget();
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 16,
      height: 16,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/fileSearch.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        additionalArguments: [
          `--file-search-capability=${capability}`,
          `--file-search-office-read-capability=${officeReadCapability}`,
          `--file-search-project-authority-capability=${projectAuthorityCapability}`,
          `--file-search-preview-read-capability=${previewReadCapability}`,
          `--file-search-instance=${instanceId}`
        ]
      }
    });
    window.setMenuBarVisibility(false);
    this.window = window;
    this.projectAuthorityCapability = projectAuthorityCapability;
    this.projectAuthorityClient = projectAuthorityClient;
    this.runtimeInstanceId = instanceId;
    let fatalReported = false;
    this.privilegedRuntimeFatal = () => {
      if (fatalReported) return;
      fatalReported = true;
      params.onUnexpectedExit('File-search privileged runtime became unavailable.');
    };

    let resolveStopped = (): void => undefined;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const lifecycleFence = new FileSearchLifecycleFence(target.url, (message) => {
      if (this.window !== window || this.lifecycleId !== lifecycleId) return;
      resolveStopped();
      this.stop();
      params.onUnexpectedExit(message);
    });
    const fenceNavigation = (event: Electron.Event, url: string): void => {
      if (lifecycleFence.acceptNavigation(url)) return;
      event.preventDefault();
    };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', fenceNavigation);
    window.webContents.on('will-redirect', fenceNavigation);
    window.webContents.once('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) lifecycleFence.fail('File-search renderer failed to load.');
    });
    window.webContents.once('render-process-gone', () => {
      lifecycleFence.fail('File-search renderer exited unexpectedly.');
    });
    window.once('unresponsive', () =>
      lifecycleFence.fail('File-search renderer became unresponsive.')
    );
    window.once('closed', () => lifecycleFence.fail('File-search renderer closed unexpectedly.'));

    try {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) await window.loadURL(target.url);
      else await window.loadFile(target.filePath);
      this.diagnostics.emit('runtime-window', {
        tag: diagnostic.tag,
        phase: 'renderer-loaded',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      if (this.window !== window || this.lifecycleId !== lifecycleId || window.isDestroyed()) {
        throw new Error('File-search renderer startup was superseded.');
      }
      await waitForFileSearchRuntimeReady({
        runtimeClient,
        capability,
        instanceId,
        stopped
      });
      params.onOpenStage?.('runtime-search');
      await this.officeReader.waitUntilReady(stopped);
      params.onOpenStage?.('runtime-office');
      let projectReadyTimeout: ReturnType<typeof setTimeout> | undefined;
      const projectReady = await Promise.race([
        projectAuthorityClient.ready({
          capability: projectAuthorityCapability,
          runtimeInstanceId: instanceId
        }),
        stopped.then(() => {
          throw new Error('Project authority runtime startup was superseded.');
        }),
        new Promise<never>((_resolve, reject) => {
          projectReadyTimeout = setTimeout(
            () => reject(new Error('Project authority runtime startup timed out.')),
            PROJECT_AUTHORITY_TIMEOUT_MS
          );
        })
      ]).finally(() => {
        if (projectReadyTimeout) clearTimeout(projectReadyTimeout);
      });
      if (!projectReady.ok) throw new Error('Project authority runtime failed to initialize.');
      params.onOpenStage?.('runtime-authority');
      await this.previewReader.waitUntilReady(stopped);
      params.onOpenStage?.('runtime-preview-read');
      this.diagnostics.emit('runtime-window', {
        tag: diagnostic.tag,
        phase: 'preload-ready',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      if (this.window !== window || this.lifecycleId !== lifecycleId || window.isDestroyed()) {
        throw new Error('File-search renderer startup was superseded.');
      }
      fileSearchRuntimeRelayService.attach({
        hostToken: params.host.hostToken,
        hostId: params.host.hostId,
        bootstrapToken: params.bootstrapToken,
        capability,
        client: runtimeClient,
        broadcast: params.broadcast
      });
      this.diagnostics.emit('runtime-window', {
        tag: diagnostic.tag,
        phase: 'relay-attached',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      this.diagnostics.emit('runtime-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'success',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      window.once('closed', () => lifecycleFence.stop());
    } catch (error) {
      this.diagnostics.emit('runtime-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'failure',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      if (this.window === window) this.stop();
      throw error;
    }
  }

  stop(): void {
    this.lifecycleId += 1;
    const window = this.window;
    this.window = null;
    this.projectAuthorityClient = null;
    this.projectAuthorityCapability = null;
    this.officeReader.stop();
    this.previewReader.stop();
    this.runtimeInstanceId = null;
    this.privilegedRuntimeFatal = null;
    fileSearchRuntimeRelayService.detach();
    if (window && !window.isDestroyed()) window.destroy();
  }

  async inspectTarget(absoluteTarget: string): Promise<OnlyPreviewValidatedTarget> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.inspectTarget({ ...identity, absoluteTarget }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'displayPath',
        'rootName',
        'rootRealPath',
        ...(Object.hasOwn(value, 'selectedRelativePath') ? ['selectedRelativePath'] : [])
      ]) ||
      typeof value.rootRealPath !== 'string' ||
      !isAbsolute(value.rootRealPath) ||
      value.displayPath !== value.rootRealPath ||
      typeof value.rootName !== 'string' ||
      !value.rootName ||
      (value.selectedRelativePath !== undefined &&
        (typeof value.selectedRelativePath !== 'string' ||
          !value.selectedRelativePath ||
          value.selectedRelativePath.includes('/') ||
          value.selectedRelativePath.includes('\\')))
    ) {
      return this.rejectProjectProtocol('Project target inspection response is invalid.');
    }
    return value as unknown as OnlyPreviewValidatedTarget;
  }

  async bindProjectWorkspace(params: {
    workspaceId: string;
    rootPath: string;
  }): Promise<OnlyPreviewFileAuthorityWorkspaceBinding> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.bindWorkspace({ ...identity, ...params }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ['runtimeInstanceId', 'workspaceGeneration', 'workspaceId']) ||
      value.runtimeInstanceId !== this.runtimeInstanceId ||
      value.workspaceId !== params.workspaceId ||
      !Number.isSafeInteger(value.workspaceGeneration) ||
      (value.workspaceGeneration as number) < 1
    ) {
      return this.rejectProjectProtocol('Project workspace binding response is invalid.');
    }
    return value as unknown as OnlyPreviewFileAuthorityWorkspaceBinding;
  }

  async revokeProjectWorkspace(params: {
    workspaceId: string;
    workspaceGeneration: number;
  }): Promise<void> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.revokeWorkspace({ ...identity, ...params }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    if (value !== undefined) {
      return this.rejectProjectProtocol('Project workspace revocation response is invalid.');
    }
  }

  async bindPreviewReadWorkspace(params: {
    workspaceId: string;
    workspaceGeneration: number;
    rootPath: string;
  }): Promise<void> {
    await this.previewReader.bindWorkspace(params);
  }

  async revokePreviewReadWorkspace(params: {
    workspaceId: string;
    workspaceGeneration: number;
  }): Promise<void> {
    await this.previewReader.revokeWorkspace(params);
  }

  async authorizeProjectItem(params: {
    workspaceId: string;
    workspaceGeneration: number;
    relativePath: string;
  }): Promise<OnlyPreviewFileAuthorityTarget> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.authorizeItem({ ...identity, ...params }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    return this.validateProjectTarget(value, params);
  }

  async authorizeProjectRoot(params: {
    workspaceId: string;
    workspaceGeneration: number;
  }): Promise<OnlyPreviewFileAuthorityTarget> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.authorizeRoot({ ...identity, ...params }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    const root = this.validateProjectTarget(value, { ...params, relativePath: '' });
    if (root.nodeKind !== 'directory' || root.size !== 0) {
      return this.rejectProjectProtocol('Project root authorization response is invalid.');
    }
    return root;
  }

  async createProjectDirectory(params: {
    workspaceId: string;
    workspaceGeneration: number;
    parentRelativePath: string;
    name: string;
  }): Promise<OnlyPreviewFileAuthorityTarget> {
    // Both sides must agree on the exact name before the call. The authority trims and re-validates
    // it, and the response is checked for an exact relative-path match — a disagreement here would
    // be read as a protocol violation and tear down the privileged runtime over a stray space.
    const name = requireProjectEntryName(params.name);
    const value = await this.callProjectAuthority(
      (client, identity) => client.createDirectory({ ...identity, ...params, name }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    // The created folder's own relative path is derived by the authority, not supplied here, so the
    // response is validated against the parent it was created in rather than an expected path.
    return this.validateProjectTarget(value, {
      workspaceId: params.workspaceId,
      workspaceGeneration: params.workspaceGeneration,
      relativePath: params.parentRelativePath ? `${params.parentRelativePath}/${name}` : name
    });
  }

  async renameProjectEntry(params: {
    workspaceId: string;
    workspaceGeneration: number;
    relativePath: string;
    name: string;
  }): Promise<OnlyPreviewFileAuthorityTarget> {
    const name = requireProjectEntryName(params.name);
    const value = await this.callProjectAuthority(
      (client, identity) => client.renameEntry({ ...identity, ...params, name }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    const separator = params.relativePath.lastIndexOf('/');
    const parentRelativePath = separator === -1 ? '' : params.relativePath.slice(0, separator);
    return this.validateProjectTarget(value, {
      workspaceId: params.workspaceId,
      workspaceGeneration: params.workspaceGeneration,
      relativePath: parentRelativePath ? `${parentRelativePath}/${name}` : name
    });
  }

  async prepareProjectDelete(params: {
    workspaceId: string;
    workspaceGeneration: number;
    relativePath: string;
  }): Promise<OnlyPreviewFileAuthorityDeleteGrant> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.prepareDelete({ ...identity, ...params }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'grantId',
        'modifiedAt',
        'name',
        'relativePath',
        'runtimeInstanceId',
        'size',
        'workspaceGeneration',
        'workspaceId'
      ]) ||
      value.runtimeInstanceId !== this.runtimeInstanceId ||
      value.workspaceId !== params.workspaceId ||
      value.workspaceGeneration !== params.workspaceGeneration ||
      value.relativePath !== params.relativePath ||
      !INSTANCE_PATTERN.test(String(value.grantId)) ||
      typeof value.name !== 'string' ||
      !value.name ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      !Number.isFinite(value.modifiedAt)
    ) {
      return this.rejectProjectProtocol('Delete preparation response is invalid.');
    }
    return value as unknown as OnlyPreviewFileAuthorityDeleteGrant;
  }

  async commitProjectDelete(params: {
    workspaceId: string;
    workspaceGeneration: number;
    grantId: string;
    relativePath: string;
  }): Promise<OnlyPreviewFileAuthorityDeleteResult> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.commitDelete({ ...identity, ...params }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'grantId',
        'modifiedAt',
        'relativePath',
        'runtimeInstanceId',
        'size',
        'workspaceGeneration',
        'workspaceId'
      ]) ||
      value.runtimeInstanceId !== this.runtimeInstanceId ||
      value.workspaceId !== params.workspaceId ||
      value.workspaceGeneration !== params.workspaceGeneration ||
      value.grantId !== params.grantId ||
      value.relativePath !== params.relativePath ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      !Number.isFinite(value.modifiedAt)
    ) {
      return this.rejectProjectProtocol('Delete commit response is invalid.');
    }
    return value as unknown as OnlyPreviewFileAuthorityDeleteResult;
  }

  async cancelProjectDelete(params: {
    workspaceId: string;
    workspaceGeneration: number;
    grantId: string;
    relativePath: string;
  }): Promise<void> {
    const value = await this.callProjectAuthority(
      (client, identity) => client.cancelDelete({ ...identity, ...params }),
      PROJECT_AUTHORITY_TIMEOUT_MS
    );
    if (value !== undefined) {
      return this.rejectProjectProtocol('Delete cancellation response is invalid.');
    }
  }

  async preparePreviewRead(
    grant: OnlyPreviewPreviewReadPrepareGrant
  ): Promise<OnlyPreviewPreviewReadPreparedSelection> {
    return await this.previewReader.prepare(grant);
  }

  async inspectPreviewDocumentResource(params: {
    grantId: string;
    selectionRevision: number;
    requestPath: string;
  }): Promise<OnlyPreviewPreviewReadDocumentResource> {
    return await this.previewReader.inspectDocumentResource(params);
  }

  async openPreviewRead(
    params: Omit<OnlyPreviewPreviewReadOpenRequest, 'capability' | 'runtimeInstanceId'>
  ): Promise<OnlyPreviewPreviewReadOpenResult> {
    return await this.previewReader.open(params);
  }

  async readNextPreviewChunk(params: {
    grantId: string;
    selectionRevision: number;
    sessionId: string;
    offset: number;
  }): Promise<OnlyPreviewPreviewReadChunkResult> {
    return await this.previewReader.readNext(params);
  }

  async cancelPreviewRead(params: {
    grantId?: string;
    selectionRevision?: number;
    sessionId?: string;
  }): Promise<void> {
    await this.previewReader.cancel(params);
  }

  async prepareOfficeRead(
    grant: OnlyPreviewOfficePrepareGrant
  ): Promise<OnlyPreviewOfficePrepareRuntimeResult> {
    return await this.officeReader.prepare(grant);
  }

  async bindOfficeWorkspace(params: { workspaceId: string; rootPath: string }): Promise<void> {
    await this.officeReader.bindWorkspace(params);
  }

  async openOfficeRead(params: {
    grantId: string;
    runtimeId: string;
    selectionRevision: number;
  }): Promise<OnlyPreviewOfficeReadOpenRuntimeResult> {
    return await this.officeReader.open(params);
  }

  async readNextOfficeChunk(params: {
    grantId: string;
    runtimeId: string;
    selectionRevision: number;
    offset: number;
  }): Promise<OnlyPreviewOfficeReadChunkRuntimeResult> {
    return await this.officeReader.readNext(params);
  }

  async cancelOfficeRead(params: {
    grantId?: string;
    runtimeId?: string;
    selectionRevision?: number;
  }): Promise<void> {
    await this.officeReader.cancel(params);
  }

  isOwner(window: BrowserWindow): boolean {
    return this.window === window && !window.isDestroyed();
  }

  private validateProjectTarget(
    value: unknown,
    expected: { workspaceId: string; workspaceGeneration: number; relativePath: string }
  ): OnlyPreviewFileAuthorityTarget {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'canonicalPath',
        'modifiedAt',
        'name',
        'nodeKind',
        'relativePath',
        'runtimeInstanceId',
        'size',
        'workspaceGeneration',
        'workspaceId'
      ]) ||
      value.runtimeInstanceId !== this.runtimeInstanceId ||
      value.workspaceId !== expected.workspaceId ||
      value.workspaceGeneration !== expected.workspaceGeneration ||
      value.relativePath !== expected.relativePath ||
      (value.nodeKind !== 'file' && value.nodeKind !== 'directory') ||
      typeof value.canonicalPath !== 'string' ||
      !isAbsolute(value.canonicalPath) ||
      typeof value.name !== 'string' ||
      !value.name ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      !Number.isFinite(value.modifiedAt)
    ) {
      return this.rejectProjectProtocol('Project authorization response is invalid.');
    }
    return value as unknown as OnlyPreviewFileAuthorityTarget;
  }

  private rejectProjectProtocol(message: string): never {
    const reportFatal = this.privilegedRuntimeFatal;
    this.stop();
    reportFatal?.();
    throw new OnlyPreviewContractError('PROTOCOL_ERROR', message);
  }

  private rejectPreviewReadProtocol(message: string): never {
    const reportFatal = this.privilegedRuntimeFatal;
    this.stop();
    reportFatal?.();
    throw new OnlyPreviewContractError('PROTOCOL_ERROR', message);
  }

  private rejectOfficeReadProtocol(message: string): never {
    const reportFatal = this.privilegedRuntimeFatal;
    this.stop();
    reportFatal?.();
    throw new OnlyPreviewContractError('PROTOCOL_ERROR', message);
  }

  private async callProjectAuthority<T>(
    operation: (
      client: OnlyPreviewFileAuthorityRuntimePrivateApi,
      identity: { capability: string; runtimeInstanceId: string }
    ) => Promise<unknown>,
    timeoutMs: number
  ): Promise<T> {
    const client = this.projectAuthorityClient;
    const capability = this.projectAuthorityCapability;
    const runtimeInstanceId = this.runtimeInstanceId;
    if (!client || !capability || !runtimeInstanceId || !this.window || this.window.isDestroyed()) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Project authority runtime is unavailable.'
      );
    }
    const lifecycleId = this.lifecycleId;
    const window = this.window;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const result = await Promise.race([
        operation(client, { capability, runtimeInstanceId }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(
              new OnlyPreviewContractError(
                'OPERATION_FAILED',
                'The Project authority runtime timed out.'
              )
            );
          }, timeoutMs);
        })
      ]);
      if (lifecycleId !== this.lifecycleId || this.window !== window || window.isDestroyed()) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Project authority runtime was superseded.'
        );
      }
      return unwrapOnlyPreviewProjectAuthorityResponse(result) as T;
    } catch (error) {
      if (timedOut && this.window === window) {
        const reportFatal = this.privilegedRuntimeFatal;
        this.stop();
        reportFatal?.();
      }
      if (error instanceof OnlyPreviewProjectAuthorityProtocolError) {
        return this.rejectProjectProtocol('Project authority response is invalid.');
      }
      if (error instanceof OnlyPreviewContractError) throw error;
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Project authority runtime rejected the request.'
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export const fileSearchWindowService = new FileSearchWindowService();
