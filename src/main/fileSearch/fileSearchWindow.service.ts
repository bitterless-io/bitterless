import { BrowserWindow } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { OnlyPreviewHostCapability } from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
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
/**
 * `commitProjectDelete` 专用的更宽上限 —— 不能用 `PROJECT_AUTHORITY_TIMEOUT_MS`。
 *
 * `callProjectAuthority` 超时不只是让这一次调用失败:它会 `this.stop()` 整个隐藏 runtime
 * (`:836-840`)。这条路径正是本轮(2026-09-21)从头到尾在修的那个故障形态 ——
 * 一次偶发超时演变成整个 preview 挂掉。删除本身通常在 `PROJECT_AUTHORITY_TIMEOUT_MS` 的
 * 10s 内轻松完成,但 `commitDelete`(preload 侧)现在会在文件删除之后
 * `await runtime.finishDeleteTask(...)`(`index-solution.html` #4,让 alert
 * 进度条等到索引真的清完才收起,而不是文件一删就收),而 `finishDeleteTask` 内部的
 * `forgetPaths` 走的是与全量 reconcile/rebuild **同一条按库序列化的队列**
 * (`index-queue.mjs`,Ral 2026-09-21:「索引变更的操作也都要被 semaphore 限制为串行的」)——
 * 一次删除撞上一轮正在跑的全量重建,合法地要等到重建结束才能轮到。今天验证过重建常见
 * 80–120s,病态情形下(内存压力)见过 ~480s。用同一个 10s 判死刑,会把「文件删成功、只是
 * 索引清理还在排队」误报成「Project authority 超时」,进而拆掉整条搜索 runtime ——
 * 用户明明删除成功了,却看到整个 preview 崩掉。
 *
 * 2.5 分钟覆盖今天观测到的正常情形并留有余量,但仍然是个上限,不是无限等待:真正卡死的
 * runtime 应当和其他操作一样最终被判失败并回收,只是不能用一个为「毫秒级 RPC」量身定的
 * 常数去判一个「可能排在一次索引重建后面」的操作。
 */
const PROJECT_DELETE_TIMEOUT_MS = 150_000;
/**
 * 载入隐藏 file-search renderer 的上限。
 *
 * 为什么需要它:这一步原先是整条启动链上**唯一没有上限**的 await —— 它后面每一步都有
 * (runtime ready 10s、project authority 10s、preview chunk 5s)。`did-fail-load` /
 * `render-process-gone` / `unresponsive` / `closed` 四个事件只覆盖「加载**失败**」,覆盖不了
 * 「**没有任何回应**」:2026-09-17 04:36:24.102Z 打出 `runtime-window phase=start` 之后,那一整个
 * 会话再也没有 `renderer-loaded`(健康时是 342ms)。而 Electron 的网络服务在主进程里,所以主线程
 * 一次瞬时停顿就足以让这个 localhost 载入错过响应。
 *
 * 后果链是这条修复真正要断掉的东西:`attachSurface` 永不返回 → `openOnMount` 的 `finally` 永不
 * 执行 → `surfaceOpening` 永久置位 → 之后每次 `ensureStandalone`/`openOnMount` 永远 await →
 * 目标变更队列停止推进 → 之后每一次打开/选择/导航都静默挂住,直到重启。超时改成**抛**,
 * 那个 `finally` 就会跑,闩锁自己解开。
 *
 * 取 30s 而不是跟着兄弟们 10s:它的职责是断开永久闩锁,不是要求启动够快 —— 而 dev 下首次载入要
 * 等 vite 编译那个 renderer。真正的失败仍然由上面那四个事件**立刻**报出来,这里只兜住「无人应答」。
 */
const RENDERER_LOAD_TIMEOUT_MS = 30_000;
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
  // Kept so a host transition can RE-ATTACH this runtime instead of restarting it. The hidden
  // search window is project-scoped, not window-scoped: tying its lifetime to one host is what made
  // every toggle throw away an in-flight index build (copy-then-promote means everything since the
  // last promote is lost) and what let a dying host tear down the runtime its successor had just
  // built. See docs/issues/onlypreview-host-toggle-tears-down-the-new-runtime.md.
  private runtimeCapability: string | null = null;
  private runtimeClient: FileSearchRuntimePrivateApi | null = null;
  private runtimeBroadcast: ((eventName: string, value: unknown) => void) | null = null;
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
    window.webContents.once('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // Log the Chromium code before collapsing it into one message. ERR_ABORTED (-3) means
      // something tore this window down mid-load and is a completely different bug from
      // ERR_CONNECTION_REFUSED (-102) or a 404 — and the collapsed message told them apart not at all.
      console.info(
        `[onlypreview-search] event=runtime-load-failed code=${code} url=${url}` +
          ` mainFrame=${isMainFrame} lifecycle=${lifecycleId} current=${this.lifecycleId}` +
          ` sameWindow=${this.window === window} description=${description}`
      );
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
      let rendererLoadTimeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        is.dev && process.env.ELECTRON_RENDERER_URL
          ? window.loadURL(target.url)
          : window.loadFile(target.filePath),
        stopped.then(() => {
          throw new Error('File-search renderer load was superseded.');
        }),
        new Promise<never>((_resolve, reject) => {
          rendererLoadTimeout = setTimeout(() => {
            // Same vocabulary as the four load-failure events above, so a stalled load reads as one
            // more way this renderer failed to come up rather than as a new kind of event.
            lifecycleFence.fail('File-search renderer load timed out.');
            reject(new Error('File-search renderer load timed out.'));
          }, RENDERER_LOAD_TIMEOUT_MS);
        })
      ]).finally(() => {
        if (rendererLoadTimeout) clearTimeout(rendererLoadTimeout);
      });
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
      this.runtimeCapability = capability;
      this.runtimeClient = runtimeClient;
      this.runtimeBroadcast = params.broadcast;
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
    // Who tore the runtime down, and from where. The transition bug looks like "the load failed",
    // but the load is aborted BY a teardown — so the caller matters more than the symptom.
    console.info(
      `[onlypreview-search] event=runtime-stop lifecycle=${this.lifecycleId} hadWindow=${Boolean(this.window)}` +
        ` by=${new Error().stack?.split('\n')[2]?.trim().slice(0, 120) ?? 'unknown'}`
    );
    this.lifecycleId += 1;
    const window = this.window;
    this.window = null;
    this.projectAuthorityClient = null;
    this.projectAuthorityCapability = null;
    this.officeReader.stop();
    this.previewReader.stop();
    this.runtimeInstanceId = null;
    this.runtimeCapability = null;
    this.runtimeClient = null;
    this.runtimeBroadcast = null;
    this.privilegedRuntimeFatal = null;
    fileSearchRuntimeRelayService.detach();
    if (window && !window.isDestroyed()) window.destroy();
  }

  /** Is there a live search runtime a new host could adopt instead of starting its own? */
  hasLiveRuntime(): boolean {
    return Boolean(
      this.window && !this.window.isDestroyed() && this.runtimeCapability && this.runtimeClient
    );
  }

  /**
   * Hand the LIVE runtime to a new host, without restarting it.
   *
   * This is the whole point of keeping `runtimeCapability` / `runtimeClient`: the index build in
   * flight inside that renderer keeps going, and there is no dying runtime left to send a late
   * message that tears down the new host. `relay.attach` already detaches the previous host first,
   * so re-attaching is the supported operation rather than a trick.
   *
   * Returns false when there is nothing to adopt, so the caller falls back to `start()`.
   */
  rebindHost(params: {
    host: OnlyPreviewHostCapability;
    bootstrapToken: string;
    broadcast?(eventName: string, value: unknown): void;
  }): boolean {
    if (!this.hasLiveRuntime()) return false;
    const broadcast = params.broadcast ?? this.runtimeBroadcast;
    if (!broadcast) return false;
    this.runtimeBroadcast = broadcast;
    fileSearchRuntimeRelayService.attach({
      hostToken: params.host.hostToken,
      hostId: params.host.hostId,
      bootstrapToken: params.bootstrapToken,
      capability: this.runtimeCapability as string,
      client: this.runtimeClient as FileSearchRuntimePrivateApi,
      broadcast,
      // The index in that renderer never stopped, so its workspace binding must survive with it.
      preserveWorkspace: true
    });
    this.diagnostics.emit('runtime-window', {
      tag: this.diagnostics.nextTag('w'),
      phase: 'relay-attached',
      elapsedMs: 0
    });
    console.info(
      `[onlypreview-search] event=runtime-rebound hostId=${params.host.hostId} lifecycle=${this.lifecycleId}`
    );
    return true;
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

  async pasteProjectItems(params: {
    workspaceId: string;
    workspaceGeneration: number;
    parentRelativePath: string;
    sourcePaths: string[];
  }): Promise<OnlyPreviewFileAuthorityTarget[]> {
    const value = await this.callProjectAuthority<unknown>(
      (client, identity) => client.pasteItems({ ...identity, ...params }),
      30 * 60 * 1000
    );
    const sourcePaths = [...new Set(params.sourcePaths)];
    if (!Array.isArray(value) || value.length !== sourcePaths.length) {
      return this.rejectProjectProtocol('Project paste response is invalid.');
    }
    return value.map((item, index) => {
      const name = requireProjectEntryName(basename(sourcePaths[index]));
      return this.validateProjectTarget(item, {
        workspaceId: params.workspaceId,
        workspaceGeneration: params.workspaceGeneration,
        relativePath: params.parentRelativePath ? `${params.parentRelativePath}/${name}` : name
      });
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
      PROJECT_DELETE_TIMEOUT_MS
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
