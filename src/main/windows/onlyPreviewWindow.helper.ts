import {
  app,
  BaseWindow,
  BrowserWindow,
  screen,
  View,
  webContents as electronWebContents,
  WebContentsView,
  type Input,
  type Rectangle
} from 'electron';
import { join } from 'node:path';
import {
  isApplicationFindFocusWithin,
  setApplicationFindDispatch
} from '@main/menu/applicationFindMenu.service';
import { is } from '@electron-toolkit/utils';
import type {
  OnlyPreviewBounds,
  OnlyPreviewGlobalSearchFocusOrigin
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT,
  ONLY_PREVIEW_FIND_FOCUS_EVENT,
  ONLY_PREVIEW_FOCUS_PROJECT_EVENT
} from '@shared/onlypreview/onlyPreview.types';
import { xpcMain } from 'electron-xpc/main';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostCapability
} from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
import { resolveOnlyPreviewSettingsBounds } from '@main/miniapps/onlypreview/onlyPreviewWindowBounds.service';
import { clampOnlyPreviewSurfaceLayout } from '@main/miniapps/onlypreview/onlyPreviewSurfaceLayout';
import { OnlyPreviewStandaloneMount } from '@main/windows/onlyPreviewStandaloneMount';
import type {
  OnlyPreviewMount,
  OnlyPreviewMountKind
} from '@main/miniapps/onlypreview/onlyPreviewSurface.mount';
import { onlyPreviewSearchBootstrapRegistry } from '@main/miniapps/onlypreview/onlyPreviewSearchBootstrap.registry';
import { onlyPreviewProjectIndexStateService } from '@main/miniapps/onlypreview/onlyPreviewProjectIndexState.service';
import { onlyPreviewViewLayerService } from '@main/miniapps/onlypreview/views/onlyPreviewViewLayer.service';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewPreviewRegionService } from '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service';
import { onlyPreviewGlobalSearchFocusService } from '@main/miniapps/onlypreview/onlyPreviewGlobalSearchFocus.service';
import { onlyPreviewAlertWindowService } from '@main/miniapps/onlypreview/views/onlyPreviewAlertWindow.service';
import { onlyPreviewGlobalSearchWindowService } from '@main/miniapps/onlypreview/views/onlyPreviewGlobalSearchWindow.service';
import {
  configureOnlyPreviewNavigationFence,
  getOnlyPreviewRendererArguments,
  getOnlyPreviewRendererTarget
} from '@main/miniapps/onlypreview/views/onlyPreviewRendererTarget.service';
import {
  ONLY_PREVIEW_BROWSE_LISTING_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewBrowseListingEvent,
  type OnlyPreviewSearchSnapshotEvent,
  type OnlyPreviewSearchWatchCommitEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';
import '@main/xpc/onlyPreviewSearchRuntime.handler';
import { windowStateService, type WindowStateController } from './windowState.service';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import {
  createOnlyPreviewWindowOpenCoordinator,
  type OnlyPreviewOpenTrace
} from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import { onlyPreviewOpenDiagnostics } from '@main/miniapps/onlypreview/onlyPreviewOpenDiagnostics.runtime';

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

/**
 * 应用正在退出 —— 关窗接管必须闭嘴。
 *
 * `app.quit()` 会对**每一个**窗口发 `'close'`,所以「关掉独立窗口 → 内容回到 tab」那个钩子在退出
 * 时会被当成一次用户关窗触发,于是退出流程里凭空冒出一次建 composite 的动作。模块级的一位,
 * 由 `setOnlyPreviewShuttingDown()` 驱动(文件末尾),与 app 自己那面「真的要退了」的旗同真同假 ——
 * 挂 `before-quit` 会变成永久闩锁,因为第一发 before-quit 必然被 preventDefault 且退出可被取消。
 */
let shuttingDown = false;

/**
 * 关窗接管的两半,分开是因为它们必须发生在**两个不同的时刻**。
 *
 * `capture` 在 `'close'`:承载还活着,这是唯一还能问出转移目标的时刻(工作区注册表和预览区当前
 * 文件都会在 `'closed'` 里被吊销)。返回 `undefined` 表示这一发不接管。
 * `promote` 在 `'closed'`:承载已经吊销,升格的幂等判据和 `buildHost` 才成立。
 */
type OnlyPreviewStandaloneCloseTakeover = {
  capture: (hostToken: string) => unknown;
  promote: (captured: unknown) => void;
};

type OnlyPreviewShortcutOrigin = OnlyPreviewGlobalSearchFocusOrigin | 'search';
type OnlyPreviewNativeCommand =
  | 'choose-folder'
  | 'open-settings'
  | 'refresh'
  | 'focus-project'
  | 'focus-search'
  | 'close-global-search'
  | 'find-in-file'
  | 'close-find-in-file'
  | 'copy-project-path'
  | 'copy-project-name';

interface OnlyPreviewNativeCommandPayload {
  hostToken: string;
  command: OnlyPreviewNativeCommand;
}

interface OnlyPreviewSurfaceOpening {
  hostToken: string;
  ready: Promise<void>;
  reject(error: unknown): void;
  releaseHostListener?: () => void;
}

const closeView = (view: WebContentsView | null): void => {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.close();
  } catch {
    // The owning BaseWindow may already have destroyed this view.
  }
};

const isCommandModifier = (input: Input): boolean =>
  process.platform === 'darwin' ? input.meta : input.control;

const isGlobalSearchShortcut = (input: Input): boolean => {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.key.toLowerCase() !== 'f' ||
    !input.shift ||
    input.alt ||
    !isCommandModifier(input)
  ) {
    return false;
  }
  return process.platform === 'darwin' ? !input.control : !input.meta;
};

/**
 * Copy Path (Shift) and Copy Name (Alt), as window-wide shortcuts.
 *
 * They used to exist only as a DOM handler in the shell renderer, which required the tree row to
 * hold DOM focus. Every other OnlyPreview shortcut is Main-owned through `before-input-event` on
 * all four views precisely so it survives focus living anywhere, and these two were simply never
 * given that treatment. Plain Cmd+C is deliberately excluded: inside a document it means "copy the
 * selected text", and taking it here would break that.
 */
const isProjectItemCopyShortcut = (input: Input): boolean => {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    // **按 `code` 判,`key` 只是兜底。** macOS 把 Option 当组字修饰键:按住它敲 C,`input.key` 是
    // `'ç'`(US 布局)而不是 `'c'` —— 于是 `Cmd+Opt+C`(复制文件名)从来没有匹配过一次
    // (Ral 2026-09-10 报的就是这个;`Cmd+Shift+C` 没事,因为 Shift+C 就是 `'C'`)。
    // `code` 与布局、修饰键都无关,是这里唯一稳定的信号;`key` 留着是为了非标准布局上 `code` 不是
    // `KeyC` 的情形。同一个 `resolveNativeCommand` 里的 `Digit1` 那一条早就是这么写的。
    (input.code !== 'KeyC' && input.key.toLowerCase() !== 'c') ||
    !isCommandModifier(input) ||
    // Exactly one of Shift/Alt, matching the renderer's XOR: Shift+Alt+Cmd+C is not a copy.
    input.shift === input.alt
  ) {
    return false;
  }
  return process.platform === 'darwin' ? !input.control : !input.meta;
};

const isCurrentFileFindShortcut = (input: Input): boolean => {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.key.toLowerCase() !== 'f' ||
    input.shift ||
    input.alt ||
    !isCommandModifier(input)
  ) {
    return false;
  }
  return process.platform === 'darwin' ? !input.control : !input.meta;
};

const shouldAutoOpenOnlyPreviewDevTools = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' && process.env.BITTERLESS_E2E !== '1';

// Preview is the owner-facing test channel, so it carries the DevTools *shortcut* even though it is
// a packaged release build. Stable keeps DevTools closed.
//
// Auto-open is debug-only for every channel, shell view included (Ral 2026-09-04, reversing the
// earlier Preview-channel auto-open): a packaged build must never open DevTools by itself. Use
// `shouldAutoOpenOnlyPreviewDevTools()` for anything that opens a pane without being asked, and this
// predicate only to decide whether the keyboard shortcut is bound.
const isOnlyPreviewDevToolsEnabled = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' ||
  import.meta.env.VITE_RELEASE_CHANNEL === 'preview' ||
  (process.env.BITTERLESS_E2E === '1' && !app.isPackaged);

const isOnlyPreviewDevToolsShortcut = (input: Input): boolean => {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
  const key = input.key.toLowerCase();
  if (key === 'f12') return !input.shift && !input.control && !input.alt && !input.meta;
  if (key !== 'i') return false;
  if (process.platform === 'darwin') {
    return input.meta && input.alt && !input.control && !input.shift;
  }
  if (process.platform === 'win32') {
    return input.control && input.shift && !input.meta && !input.alt;
  }
  return false;
};

const bindOnlyPreviewDevToolsShortcut = (webContents: Electron.WebContents): void => {
  if (!isOnlyPreviewDevToolsEnabled()) return;
  webContents.on('before-input-event', (event, input) => {
    if (!isOnlyPreviewDevToolsShortcut(input)) return;
    event.preventDefault();
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
      return;
    }
    webContents.openDevTools({ mode: 'detach', activate: false });
  });
};

const settingsBoundsForParent = (
  parentBounds: Rectangle,
  width: number,
  height: number
): Rectangle => {
  const workArea = screen.getDisplayMatching(parentBounds).workArea;
  return resolveOnlyPreviewSettingsBounds({
    parentBounds,
    workArea,
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT
  });
};

export class OnlyPreviewWindowHelper {
  baseWindow: BaseWindow | null = null;
  /**
   * A host transition is in progress, so the search runtime must OUTLIVE this teardown.
   *
   * The hidden search window is project-scoped, not window-scoped. Tearing it down on every toggle
   * discarded any in-flight index build (copy-then-promote loses everything since the last promote)
   * and left a dying runtime alive just long enough to tear down its successor. Ral 2026-09-07:
   * 「来回切换的时候要不能影响索引的创建节奏,索引要能继续创建」.
   */
  private preserveSearchRuntime = false;
  // The composite's own parent. Every OnlyPreview layer is a child of this container rather than of
  // the window, so the four views move as one native object and the layer order inside them is
  // independent of whatever else a host window stacks. In this mount it simply fills the window's
  // content rect, which leaves every layer on the coordinates it had before.
  surfaceContainer: View | null = null;
  // The host, behind the seam. The composite asks this for its extent, its window and its chrome
  // capability, and never reads geometry off `baseWindow` again.
  private standaloneMount: OnlyPreviewMount | null = null;
  private shortcutContents = new WeakSet<Electron.WebContents>();
  // The overlay owners are started after the window is shown, so the first frames lay out the shell
  // before anything exists to receive an overlay rect. Without this the startup path would fan a
  // layout out to services that would refuse the host token they have not been given yet.
  private surfaceLayoutFanout = false;
  shellView: WebContentsView | null = null;
  settingsWindow: BrowserWindow | null = null;
  agentSkillGuideWindow: BrowserWindow | null = null;
  private standaloneHost: OnlyPreviewHostCapability | null = null;
  private surfaceOpening: OnlyPreviewSurfaceOpening | null = null;
  private settingsHost: OnlyPreviewHostCapability | null = null;
  private agentSkillGuideHost: OnlyPreviewHostCapability | null = null;
  private searchBootstrapToken: string | null = null;
  private baseWindowState: WindowStateController | null = null;
  private settingsWindowState: WindowStateController | null = null;
  private agentSkillGuideWindowState: WindowStateController | null = null;
  private commandHandler: ((payload: OnlyPreviewNativeCommandPayload) => void) | null = null;
  /**
   * 「这个独立窗口要没了 —— 有占位 tab 的话把内容接回去」的接收方。
   *
   * 一个注册位而不是直接 import:接管那一步要跑 dock 的那条 FIFO、要复用 `captureTarget()` /
   * `restoreTarget()`,那些都住在 `onlyPreviewHostToggle.service.ts` 里,而它 import 了本文件 ——
   * 直接反向 import 就是一个环。依赖方向照旧只有一条:toggle → helper。
   */
  private standaloneCloseTakeover: OnlyPreviewStandaloneCloseTakeover | null = null;
  /**
   * `'close'` 抓到的转移目标,等 `'closed'` 把承载吊销之后再交给升格。
   *
   * 类型是 `unknown`:目标的形状(`TransitionTarget`)属于 toggle service,helper 只负责原样带过去 ——
   * 认识它就会把依赖方向反过来。
   */
  private pendingCloseTakeover: { hostToken: string; captured: unknown } | null = null;
  private readonly diagnostics: OnlyPreviewSearchDiagnostics;
  private readonly windowOpenTraces = createOnlyPreviewWindowOpenCoordinator({
    diagnostics: onlyPreviewOpenDiagnostics
  });
  private shellStartupLease: {
    hostToken: string;
    window: BaseWindow;
    view: WebContentsView;
  } | null = null;

  constructor(diagnostics = createOnlyPreviewSearchDiagnostics()) {
    this.diagnostics = diagnostics;
  }

  setCommandHandler(handler: (payload: OnlyPreviewNativeCommandPayload) => void): void {
    this.commandHandler = handler;
  }

  setStandaloneCloseTakeover(takeover: OnlyPreviewStandaloneCloseTakeover): void {
    this.standaloneCloseTakeover = takeover;
  }

  /**
   * `'closed'` 到了 —— 承载这一刻已经被 `mount.onHostGone` 吊销,现在才是升格能跑的时刻。
   *
   * 只有 `'close'` 真的抓到过快照(`pendingCloseTakeover` 非空且 token 对得上)才升格,所以:
   * dock 方向与登出拆卸走 `destroy()`(不发 `'close'`)→ 没有快照 → 这里什么都不做;
   * `app.quit()` 发了 `'close'` 但被 `shuttingDown` 拦在抓取之前 → 同样什么都不做。
   */
  private commitStandaloneCloseTakeover(hostToken: string): void {
    const pending = this.pendingCloseTakeover;
    if (!pending || pending.hostToken !== hostToken) return;
    this.pendingCloseTakeover = null;
    this.standaloneCloseTakeover?.promote(pending.captured);
  }

  /**
   * 布防升格:这个独立窗口要没了,而承载还在 —— 现在是唯一能把转移目标快照下来的时刻。
   *
   * **`'close'` 之后、`destroyStandalone()` 之前。** 工作区注册表与预览区当前文件都会在
   * `mount.onHostGone` 里被吊销(本文件 `attachSurface` 末尾那个监听),所以晚一步就什么都问不到了。
   */
  private armStandaloneCloseTakeover(hostToken: string): void {
    // **每条早退都要留痕。** 四个条件里任何一个命中,现象都完全一样:那一格 tab 永远停在
    // 「已在独立窗口打开」的占位页。不记下来是哪一条,现场就只能靠读代码猜 —— 2026-09-22
    // 我拿着完整日志也没能定位,因为这四条全是静默 `return`。
    const skip = (reason: string): void => {
      console.info(`[onlypreview] event=deferred-tab phase=not-armed reason=${reason}`);
    };
    if (shuttingDown) return skip("shutting-down");
    if (this.standaloneHost?.hostToken !== hostToken) return skip("host-token-mismatch");
    if (this.standaloneMount?.kind !== 'standalone') {
      return skip(`mount-kind-${this.standaloneMount?.kind ?? "none"}`);
    }
    // `capture` 返回 undefined 的唯一原因是那一格不在占位态(`deferredTabState() !== deferred`)。
    const captured = this.standaloneCloseTakeover?.capture(hostToken);
    if (captured === undefined) {
      return skip(this.standaloneCloseTakeover ? "no-deferred-tab" : "takeover-unregistered");
    }
    // 只存快照,不排队升格 —— 升格由 `'closed'` 那一侧的 `commitStandaloneCloseTakeover` 触发。
    this.pendingCloseTakeover = { hostToken, captured };
  }

  bindNativeShortcuts(
    webContents: Electron.WebContents,
    host: OnlyPreviewHostCapability,
    origin: OnlyPreviewShortcutOrigin
  ): void {
    this.shortcutContents.add(webContents);
    // Recorded per view, because "no shortcut record at all" has two very different causes: the
    // handler was never installed on the view that had focus, or it was installed and the keystroke
    // never arrived. This line separates them.
    console.info(`[onlypreview] event=shortcut-bound origin=${origin}`);
    webContents.on('before-input-event', (event, input) => {
      if (event.defaultPrevented) return;
      if (this.standaloneMount?.kind === 'cowork' && !this.surfaceContainer?.getVisible()) return;
      const command = this.resolveNativeCommand(host, input);
      // The one measurement that separates "Main never saw the key" from "Main saw it and did
      // nothing". Both `Cmd+F` and `Shift+Cmd+F` reach Main only through this handler, bound on the
      // focused view's own WebContents — and a PDF renders in an out-of-process viewer frame, so it
      // is genuinely unknown whether the keystroke surfaces here at all. Only the F chord is
      // recorded, so this cannot become a keylogger or flood the log.
      if (input.type === 'keyDown' && input.key.toLowerCase() === 'f' && isCommandModifier(input)) {
        console.info(
          `[onlypreview] event=shortcut origin=${origin} pressed=f shift=${input.shift} resolved=${command ?? 'none'}`
        );
      }
      if (!command) return;
      event.preventDefault();
      this.executeNativeCommand(host, origin, command, webContents);
    });
  }

  // Shared by the two carriers of a native command: `before-input-event` (which only fires when a
  // web contents already owns keyboard focus) and the macOS menu accelerator (which fires whenever
  // the application is frontmost). Keeping one body means the menu path cannot drift from the
  // keystroke path.
  private executeNativeCommand(
    host: OnlyPreviewHostCapability,
    origin: OnlyPreviewShortcutOrigin,
    command: OnlyPreviewNativeCommand,
    opener: Electron.WebContents
  ): void {
    {
      // A dialog in the alert layer is modal: opening Find or Global Search under it would put the
      // keyboard on a surface the owner cannot see.
      if (
        (command === 'find-in-file' || command === 'focus-search') &&
        onlyPreviewAlertWindowService.isOpen(host.hostToken)
      ) {
        console.info(`[onlypreview] event=shortcut-swallowed by=alert command=${command}`);
        return;
      }
      if (command === 'find-in-file') {
        onlyPreviewGlobalSearchWindowService.closeForFind(host.hostToken);
        const opened = onlyPreviewPreviewRegionService.openFind(host.hostToken);
        if (
          opened &&
          host.kind === 'standalone' &&
          host.hostToken === this.standaloneHost?.hostToken &&
          this.shellView &&
          !this.shellView.webContents.isDestroyed()
        ) {
          this.shellView.webContents.focus();
        }
        xpcMain.broadcast(ONLY_PREVIEW_FIND_FOCUS_EVENT, { hostId: host.hostId });
        return;
      }
      if (command === 'copy-project-path' || command === 'copy-project-name') {
        // No focus move: a copy must not pull the owner out of the document they are reading.
        xpcMain.broadcast(ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT, {
          hostId: host.hostId,
          copyKind: command === 'copy-project-path' ? 'absolute-path' : 'name'
        });
        return;
      }
      if (command === 'close-find-in-file') {
        onlyPreviewPreviewRegionService.closeFind(host.hostToken);
        onlyPreviewPreviewRegionService.focusActiveContent(host.hostToken);
        return;
      }
      if (command === 'close-global-search') {
        onlyPreviewGlobalSearchWindowService.close(host.hostToken);
        return;
      }
      if (command === 'focus-search') {
        onlyPreviewPreviewRegionService.closeFind(host.hostToken);
        onlyPreviewGlobalSearchWindowService.open(host, origin, opener);
        return;
      }
      if (command === 'focus-project') {
        if (
          host.kind === 'standalone' &&
          host.hostToken === this.standaloneHost?.hostToken &&
          this.shellView &&
          !this.shellView.webContents.isDestroyed()
        ) {
          this.shellView.webContents.focus();
        }
        xpcMain.broadcast(ONLY_PREVIEW_FOCUS_PROJECT_EVENT, { hostId: host.hostId });
      } else {
        this.commandHandler?.({ hostToken: host.hostToken, command });
      }
    }
  }

  // A shared host window is insufficient: Chat and other tabs have their own Find commands.
  runMenuFindCommand(
    command: 'find-in-file' | 'focus-search',
    window: BaseWindow | null
  ): boolean {
    const baseWindow = this.baseWindow;
    const host = this.getStandaloneHost();
    if (!baseWindow || baseWindow.isDestroyed() || !host) return false;
    if (window !== baseWindow) return false;
    if (this.standaloneMount?.kind === 'cowork' && !this.surfaceContainer?.getVisible()) return false;
    if (!isApplicationFindFocusWithin(baseWindow, this.shortcutContents)) return false;
    const focused = electronWebContents.getFocusedWebContents() ?? null;
    const opener =
      focused && !focused.isDestroyed() ? focused : (this.shellView?.webContents ?? null);
    if (!opener || opener.isDestroyed()) return false;
    const origin = this.resolveFocusedOrigin(focused);
    console.info(
      `[onlypreview] event=menu-command command=${command} origin=${origin} focus=${focused ? 'view' : 'none'}`
    );
    this.executeNativeCommand(host, origin, command, opener);
    return true;
  }

  // Only used to tell the global search overlay where focus should return to. An unknown or absent
  // focus owner falls back to the project tree, which is the safe destination.
  private resolveFocusedOrigin(focused: Electron.WebContents | null): OnlyPreviewShortcutOrigin {
    if (!focused || focused.isDestroyed()) return 'shell';
    if (this.shellView && !this.shellView.webContents.isDestroyed()) {
      if (this.shellView.webContents.id === focused.id) return 'shell';
    }
    const vuePreview = onlyPreviewPreviewRegionService.getVuePreviewView();
    if (vuePreview && !vuePreview.webContents.isDestroyed()) {
      if (vuePreview.webContents.id === focused.id) return 'vue';
    }
    return 'chrome';
  }

  getStandaloneHost(): OnlyPreviewHostCapability | null {
    const host = this.standaloneHost;
    return host && onlyPreviewHostRegistry.isLive(host.hostToken) ? host : null;
  }

  getStandaloneWindow(hostToken: string): BaseWindow {
    return this.requireStandaloneWindow(hostToken);
  }

  getMountKind(hostToken: string): OnlyPreviewMountKind {
    this.requireStandaloneWindow(hostToken);
    if (!this.standaloneMount?.isAlive()) {
      throw new OnlyPreviewContractError(
        'HOST_NOT_FOUND',
        'OnlyPreview host is no longer available.'
      );
    }
    return this.standaloneMount.kind;
  }

  async ensureStandalone(route: 'api' | 'explicit' = 'api'): Promise<OnlyPreviewHostCapability> {
    if (this.surfaceOpening) {
      const opening = this.surfaceOpening;
      await opening.ready;
      this.requireReadySurface(opening.hostToken);
    }
    const currentWindow = this.baseWindow;
    const currentHost = this.getStandaloneHost();
    const mode = currentWindow && !currentWindow.isDestroyed() && currentHost ? 'existing' : 'cold';
    if (mode === 'cold') this.destroyStandalone();
    const openTrace = this.windowOpenTraces.begin(route, mode);
    if (currentWindow && !currentWindow.isDestroyed() && currentHost) {
      this.show();
      openTrace.mark({ phase: 'show' });
      this.windowOpenTraces.finish(openTrace.tag, 'success');
      return currentHost;
    }
    const host = onlyPreviewHostRegistry.issue('standalone', 'content');
    this.standaloneHost = host;
    const diagnostic = { tag: this.diagnostics.nextTag('v'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'start',
      elapsedMs: 0
    });
    const opening = this.startSurfaceOpening(host, () =>
      this.createStandaloneWindow(host, diagnostic, openTrace)
    );
    try {
      await opening.ready;
      this.requireReadySurface(host.hostToken);
      this.diagnostics.emit('visible-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'success',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      return host;
    } catch (error) {
      this.diagnostics.emit('visible-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'failure',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'fail');
      if (this.standaloneHost?.hostToken === host.hostToken) this.destroyStandalone();
      throw error;
    } finally {
      opening.releaseHostListener?.();
      if (this.surfaceOpening === opening) this.surfaceOpening = null;
    }
  }

  /**
   * Build the composite onto a host that is not a window of ours — today, a Cowork tab.
   *
   * The standalone route still owns window creation; this one is handed a mount that is already
   * attached to something. Both then run the identical `attachSurface`, which is the point of the
   * seam. Only one content surface is live at a time, so a second request brings the existing one
   * forward instead of building a rival.
   */
  async openOnMount(
    mount: OnlyPreviewMount,
    route: 'api' | 'explicit' = 'api'
  ): Promise<OnlyPreviewHostCapability> {
    if (this.surfaceOpening) {
      const opening = this.surfaceOpening;
      await opening.ready;
      this.requireReadySurface(opening.hostToken);
    }
    const current = this.getStandaloneHost();
    if (current && this.standaloneMount?.isAlive()) {
      this.show();
      return current;
    }
    this.destroyStandalone();
    const openTrace = this.windowOpenTraces.begin(route, 'cold');
    const host = onlyPreviewHostRegistry.issue('standalone', 'content');
    this.standaloneHost = host;
    const diagnostic = { tag: this.diagnostics.nextTag('v'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('visible-window', { tag: diagnostic.tag, phase: 'start', elapsedMs: 0 });
    const opening = this.startSurfaceOpening(host, () =>
      this.attachSurface(host, mount, diagnostic, openTrace)
    );
    try {
      await opening.ready;
      this.requireReadySurface(host.hostToken);
      this.diagnostics.emit('visible-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'success',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      return host;
    } catch (error) {
      this.diagnostics.emit('visible-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'failure',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'fail');
      if (this.standaloneHost?.hostToken === host.hostToken) this.destroyStandalone();
      throw error;
    } finally {
      opening.releaseHostListener?.();
      if (this.surfaceOpening === opening) this.surfaceOpening = null;
    }
  }

  private startSurfaceOpening(
    host: OnlyPreviewHostCapability,
    create: () => Promise<void>
  ): OnlyPreviewSurfaceOpening {
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const opening = { hostToken: host.hostToken, ready, reject: rejectReady };
    this.surfaceOpening = opening;
    // Publish the pending readiness before creation publishes a partially usable host/window.
    void Promise.resolve().then(() => {
      if (this.surfaceOpening !== opening || this.getStandaloneHost()?.hostToken !== host.hostToken) {
        throw new OnlyPreviewContractError('HOST_NOT_FOUND', 'OnlyPreview host closed before it was ready.');
      }
      return create();
    }).then(resolveReady, rejectReady);
    return opening;
  }

  private requireReadySurface(hostToken: string): void {
    if (
      this.getStandaloneHost()?.hostToken !== hostToken ||
      !this.baseWindow || this.baseWindow.isDestroyed() || !this.standaloneMount?.isAlive()
    ) {
      throw new OnlyPreviewContractError('HOST_NOT_FOUND', 'OnlyPreview host closed before it was ready.');
    }
  }

  /** Stop the search runtime, unless a host transition asked to keep it. */
  private stopSearchRuntimeUnlessPreserved(): void {
    if (this.preserveSearchRuntime) return;
    fileSearchWindowService.stop();
  }

  /**
   * Mark the start/end of a host transition.
   *
   * Between these two calls the search runtime survives `destroyStandalone()` and the mount's
   * `onHostGone`, and the next `attachSurface` adopts it instead of starting a new one.
   */
  beginHostTransition(): void {
    this.preserveSearchRuntime = true;
  }

  endHostTransition(): void {
    this.preserveSearchRuntime = false;
  }

  show(): void {
    // Showing is the host's business: a window shows and focuses itself, a Cowork tab activates.
    this.standaloneMount?.showSurface();
  }

  /**
   * 承载的地址栏该显示什么。只对**当前**那个 host 生效 —— 一个过期的 hostToken 推上来就丢掉。
   *
   * 独立窗口那一种的 `reportDisplayUrl` 是空操作(它没有地址栏),所以这里不分情况。
   */
  reportDisplayUrl(hostToken: string, url: string): void {
    if (!hostToken || this.standaloneHost?.hostToken !== hostToken) return;
    if (!this.standaloneMount?.isAlive()) return;
    this.standaloneMount.reportDisplayUrl(url);
  }

  reportShellMounted(
    hostToken: string,
    openTag: string,
    phase: 'renderer-script' | 'renderer-language' | 'renderer-import' | 'renderer-mount' | 'renderer-receipt',
    outcome?: 'success' | 'failure'
  ): void {
    this.requireStandaloneHost(hostToken);
    const window = this.baseWindow;
    const shellView = this.shellView;
    if (
      !window ||
      window.isDestroyed() ||
      !shellView ||
      shellView.webContents.isDestroyed() ||
      !this.isCurrentShell(hostToken, window, shellView)
    ) return;
    if (phase === 'renderer-receipt' && outcome) {
      this.settleShellStartupLease(hostToken, window, shellView);
    }
    if (this.windowOpenTraces.isActive(openTag)) this.windowOpenTraces.mark(openTag, {
      phase,
      role: 'shell',
      lifecycle: 'bootstrap',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    if (phase === 'renderer-receipt' && outcome) {
      if (outcome === 'success' && this.windowOpenTraces.isActive(openTag)) {
        this.windowOpenTraces.mark(openTag, {
          phase: 'interactive',
          role: 'shell',
          lifecycle: 'interactive',
          visible: window.isVisible(),
          focused: window.isFocused(),
          backgroundThrottling: shellView.webContents.getBackgroundThrottling()
        });
      }
      this.finishShellOpenTrace(
        openTag,
        outcome,
        outcome === 'failure' ? 'bootstrap-fail' : 'none'
      );
      // The shell is interactive, so its first paint is no longer at stake and the search overlay's
      // renderer can be built now instead of on the first Shift+Cmd+F. Building it earlier — in
      // `start()`, before the shell's own load — would contend with exactly what `first-visible`
      // exists to protect.
      if (outcome === 'success') {
        try {
          onlyPreviewGlobalSearchWindowService.preload(hostToken);
          onlyPreviewAlertWindowService.preload(hostToken);
        } catch {
          // A host that was revoked between the receipt and here simply gets no warm overlay.
        }
      }
    }
  }

  /**
   * Hand the keyboard to the shell view.
   *
   * The same move `focus-project` and `find-in-file` already make above, opened up as an entry point
   * taken by hostToken. A native menu releases focus when it closes, so the inline rename editor the
   * menu asks for comes up with a visible selection that swallows every keystroke until the row is
   * clicked again (Ral 2026-09-22). Returns false — never throws — when there is no shell view to
   * focus: a non-standalone mount simply keeps whatever focus it had.
   */
  focusShellView(hostToken: string): boolean {
    const host = this.getStandaloneHost();
    if (!host || host.kind !== 'standalone' || host.hostToken !== hostToken) return false;
    const shellView = this.shellView;
    if (!shellView || shellView.webContents.isDestroyed()) return false;
    shellView.webContents.focus();
    return true;
  }

  minimizeWindow(hostToken: string): void {
    this.requireStandaloneWindow(hostToken).minimize();
  }

  toggleMaximizeWindow(hostToken: string): void {
    const window = this.requireStandaloneWindow(hostToken);
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }

  closeWindow(hostToken: string): void {
    this.requireStandaloneWindow(hostToken).close();
  }

  updatePreviewBounds(hostToken: string, value: OnlyPreviewBounds): void {
    const host = this.requireStandaloneHost(hostToken);
    if (!this.standaloneMount?.isAlive()) {
      throw new Error(`OnlyPreview host ${host.hostId} has no active preview surface.`);
    }
    this.applySurfaceLayout(host, value);
  }

  /**
   * The one place a host's extent becomes the composite's layer rects.
   *
   * Both callers — the Shell reporting the rect it measured, and the host reporting that its extent
   * changed — end up here, so the two can no longer drift. The extent comes from
   * `mount.contentSize()`, never from a window: that single substitution is what lets a Cowork tab
   * drive the same layout with no other change on this side.
   */
  private applySurfaceLayout(
    host: OnlyPreviewHostCapability,
    measured: OnlyPreviewBounds | null
  ): void {
    const size = this.standaloneMount?.contentSize();
    if (!size) return;
    const { preview, overlay } = clampOnlyPreviewSurfaceLayout(
      measured ?? { x: 0, y: 0, width: 0, height: 0 },
      size
    );
    const shellView = this.shellView;
    if (shellView && !shellView.webContents.isDestroyed()) shellView.setBounds(overlay);
    if (!this.surfaceLayoutFanout) return;
    // Unconditional, unlike the preview's own bounds below: a dialog can be open before any file has
    // been previewed, and it still has to cover the resized composite.
    onlyPreviewAlertWindowService.updateBounds(host.hostToken, overlay);
    // Global Search needs the preview rect as its workspace inset, so neither it nor the preview
    // region can be positioned before the Shell has measured one.
    if (!measured) return;
    onlyPreviewPreviewRegionService.updateBounds(host.hostToken, preview);
    onlyPreviewGlobalSearchWindowService.updateBounds(host.hostToken, overlay, preview);
  }

  async openSettings(sourceHostToken: string): Promise<void> {
    const parentWindow = this.requireStandaloneWindow(sourceHostToken);
    const current = this.settingsWindow;
    if (current && !current.isDestroyed()) {
      current.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...current.getSize()));
      current.show();
      current.focus();
      return;
    }
    this.destroySettings();
    const host = onlyPreviewHostRegistry.issue('settings', 'settings');
    this.settingsHost = host;
    const restored = windowStateService.resolve('onlypreview-settings');
    const width = restored?.bounds.width ?? MIN_WIDTH;
    const height = restored?.bounds.height ?? MIN_HEIGHT;
    const bounds = settingsBoundsForParent(parentWindow.getBounds(), width, height);
    const target = getOnlyPreviewRendererTarget('settings', __dirname);
    const window = new BrowserWindow({
      title: 'OnlyPreview Settings',
      ...bounds,
      parent: parentWindow,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      backgroundColor: '#f5f3ee',
      webPreferences: {
        preload: join(__dirname, '../preload/onlypreview.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: getOnlyPreviewRendererArguments(host, 'settings')
      }
    });
    this.settingsWindow = window;
    this.settingsWindowState = windowStateService.register('onlypreview-settings', window);
    configureOnlyPreviewNavigationFence(window.webContents, target.url);
    window.once('ready-to-show', () => {
      if (this.settingsWindow !== window) return;
      window.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...window.getSize()));
      window.show();
      window.focus();
    });
    window.webContents.once('render-process-gone', () => {
      if (this.settingsWindow === window) this.destroySettings();
    });
    window.once('closed', () => {
      if (this.settingsWindow !== window) return;
      this.settingsWindow = null;
      this.settingsWindowState = null;
      if (this.settingsHost?.hostToken === host.hostToken) this.settingsHost = null;
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    try {
      await (is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(target.url)
        : window.loadFile(target.filePath));
    } catch (error) {
      if (this.settingsWindow === window) this.destroySettings();
      throw error;
    }
  }

  async openAgentSkillGuide(sourceHostToken: string): Promise<void> {
    const parentWindow = this.requireStandaloneWindow(sourceHostToken);
    const current = this.agentSkillGuideWindow;
    if (current && !current.isDestroyed()) {
      current.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...current.getSize()));
      current.show();
      current.focus();
      return;
    }
    this.destroyAgentSkillGuide();
    const host = onlyPreviewHostRegistry.issue('guide', 'guide');
    this.agentSkillGuideHost = host;
    const restored = windowStateService.resolve('onlypreview-guide');
    const width = restored?.bounds.width ?? MIN_WIDTH;
    const height = restored?.bounds.height ?? MIN_HEIGHT;
    const bounds = settingsBoundsForParent(parentWindow.getBounds(), width, height);
    const target = getOnlyPreviewRendererTarget('guide', __dirname);
    const window = new BrowserWindow({
      title: 'Copy the skill to your agent',
      ...bounds,
      parent: parentWindow,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f6f7fa',
      webPreferences: {
        preload: join(__dirname, '../preload/onlypreview.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: getOnlyPreviewRendererArguments(host, 'guide')
      }
    });
    this.agentSkillGuideWindow = window;
    this.agentSkillGuideWindowState = windowStateService.register('onlypreview-guide', window);
    configureOnlyPreviewNavigationFence(window.webContents, target.url, false);
    window.once('ready-to-show', () => {
      if (this.agentSkillGuideWindow !== window) return;
      window.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...window.getSize()));
      window.show();
      window.focus();
    });
    window.webContents.once('render-process-gone', () => {
      if (this.agentSkillGuideWindow === window) this.destroyAgentSkillGuide();
    });
    window.once('closed', () => {
      if (this.agentSkillGuideWindow !== window) return;
      this.agentSkillGuideWindow = null;
      this.agentSkillGuideWindowState = null;
      if (this.agentSkillGuideHost?.hostToken === host.hostToken) {
        this.agentSkillGuideHost = null;
      }
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    try {
      await (is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(target.url)
        : window.loadFile(target.filePath));
    } catch (error) {
      if (this.agentSkillGuideWindow === window) this.destroyAgentSkillGuide();
      throw error;
    }
  }

  requireAgentSkillGuideHost(hostToken: unknown): OnlyPreviewHostCapability {
    const host = onlyPreviewHostRegistry.require(hostToken, ['guide']);
    const window = this.agentSkillGuideWindow;
    if (
      host.kind !== 'guide' ||
      host.hostToken !== this.agentSkillGuideHost?.hostToken ||
      !window ||
      window.isDestroyed()
    ) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview request does not belong to the active agent skill Guide.'
      );
    }
    return host;
  }

  closeSettings(hostToken: string): void {
    const host = onlyPreviewHostRegistry.require(hostToken, ['settings']);
    if (host.hostToken !== this.settingsHost?.hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview settings host is not the active settings window.'
      );
    }
    this.settingsWindow?.close();
  }

  destroyStandalone(): void {
    const opening = this.surfaceOpening;
    this.surfaceOpening = null;
    opening?.releaseHostListener?.();
    opening?.reject(new OnlyPreviewContractError('HOST_NOT_FOUND', 'OnlyPreview host closed before it was ready.'));
    this.destroySettings();
    this.destroyAgentSkillGuide();
    const window = this.baseWindow;
    const shellView = this.shellView;
    this.windowOpenTraces.supersede();
    if (window && shellView && this.standaloneHost) {
      this.settleShellStartupLease(this.standaloneHost.hostToken, window, shellView);
    }
    onlyPreviewAlertWindowService.destroy();
    onlyPreviewGlobalSearchWindowService.destroy();
    onlyPreviewPreviewRegionService.destroy();
    const mount = this.standaloneMount;
    this.surfaceLayoutFanout = false;
    this.baseWindow = null;
    this.surfaceContainer = null;
    this.standaloneMount = null;
    this.shortcutContents = new WeakSet();
    this.shellView = null;
    this.baseWindowState = null;
    this.stopSearchRuntimeUnlessPreserved();
    onlyPreviewViewLayerService.stop();
    mount?.detach();
    closeView(shellView);
    // The host goes down the way this host goes down — the standalone window is destroyed, a Cowork
    // tab is closed — and only then are the mount's own listeners released.
    mount?.destroyHost();
    mount?.dispose();
    if (this.searchBootstrapToken) {
      onlyPreviewSearchBootstrapRegistry.revoke(this.searchBootstrapToken);
    }
    this.searchBootstrapToken = null;
    onlyPreviewGlobalSearchFocusService.clear(this.standaloneHost?.hostToken);
    if (this.standaloneHost) onlyPreviewHostRegistry.revoke(this.standaloneHost.hostToken);
    this.standaloneHost = null;
  }

  destroySettings(): void {
    const window = this.settingsWindow;
    // `flushAndDispose()` 原来漏了 —— 只把字段置空,于是 settings 窗口的尺寸/位置**从不落盘**,
    // `WindowStateController` 也不释放。同族的 `destroyAgentSkillGuide()` 一直是对的,照它写。
    const windowState = this.settingsWindowState;
    this.settingsWindow = null;
    this.settingsWindowState = null;
    windowState?.flushAndDispose();
    if (window && !window.isDestroyed()) window.destroy();
    if (this.settingsHost) onlyPreviewHostRegistry.revoke(this.settingsHost.hostToken);
    this.settingsHost = null;
  }

  destroyAgentSkillGuide(): void {
    const window = this.agentSkillGuideWindow;
    const windowState = this.agentSkillGuideWindowState;
    this.agentSkillGuideWindow = null;
    this.agentSkillGuideWindowState = null;
    windowState?.flushAndDispose();
    if (window && !window.isDestroyed()) window.destroy();
    if (this.agentSkillGuideHost) {
      onlyPreviewHostRegistry.revoke(this.agentSkillGuideHost.hostToken);
    }
    this.agentSkillGuideHost = null;
  }

  destroy(): void {
    this.destroyStandalone();
  }

  private requireStandaloneHost(hostToken: string): OnlyPreviewHostCapability {
    const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
    if (host.kind !== 'standalone' || host.hostToken !== this.standaloneHost?.hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview request does not belong to the active standalone window.'
      );
    }
    return host;
  }

  private requireStandaloneWindow(hostToken: string): BaseWindow {
    const host = this.requireStandaloneHost(hostToken);
    const window = this.baseWindow;
    if (!window || window.isDestroyed()) {
      throw new Error(`OnlyPreview host ${host.hostId} has no active standalone window.`);
    }
    return window;
  }

  private async createStandaloneWindow(
    host: OnlyPreviewHostCapability,
    diagnostic: { tag: string; startedAt: number },
    openTrace: OnlyPreviewOpenTrace
  ): Promise<void> {
    const restored = windowStateService.resolve('onlypreview');
    const window = new BaseWindow({
      title: 'OnlyPreview',
      width: restored?.bounds.width ?? DEFAULT_WIDTH,
      height: restored?.bounds.height ?? DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      backgroundColor: '#f6f7fa',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin' && { trafficLightPosition: { x: 12, y: 8 } }),
      ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : {})
    });
    this.baseWindow = window;
    openTrace.mark({
      phase: 'native',
      role: 'base',
      lifecycle: 'created',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: true
    });
    // A `BaseWindow` has no web contents, so a window with no focused child view sends keystrokes
    // nowhere: `before-input-event` has nothing to fire on. Recording focus is how we tell that
    // apart from a missing binding.
    // `keyOwner` separates the two reasons a chord never arrives: another application took over
    // (nothing this window can do), or a window of this application did — a detached DevTools
    // window, which binds Command+F and Shift+Command+F itself.
    this.baseWindowState = windowStateService.register('onlypreview', window);
    const mount = new OnlyPreviewStandaloneMount(window, this.baseWindowState);
    // The three window events this host translates for the composite: it went away, and it gained or
    // lost the owner's attention. Everything else the composite needs, it asks the mount for.
    window.once('closed' as any, () => {
      mount.reportHostGone();
      // **升格在这里落地,不在 `'close'` 里。** 上一行同步跑完 `mount.onHostGone` 那个监听,它把
      // `standaloneHost` 置 null 并 `onlyPreviewHostRegistry.revoke(...)`,所以到这一行承载确实已经
      // 没了 —— 而升格体里那道 `getStandaloneHost()` 幂等判据、以及 `buildHost('cowork')` 的
      // 「already has a live host」都要求这一点。在 `'close'` 里直接排队升格会自己撞上那道判据:
      // FIFO 是一条纯 `.then` 链,升格体在判据之前没有任何 macrotask 边界,而 Electron 在每个
      // 原生→JS 回调末尾就排空微任务,于是升格在窗口真正销毁**之前**跑完,读到的承载还活着,
      // 于是 `phase=skipped reason=live-host`,什么都不做 —— 正是本子系统那个「看起来像没反应」的
      // 静默失败形态(两路独立评审都先判到这一条)。
      this.commitStandaloneCloseTakeover(host.hostToken);
    });
    /**
     * 关掉这个独立窗口 → 内容回到那一格 tab(Ral 2026-09-17)。
     *
     * **监听可取消的 `'close'`,不是 `'closed'`** —— 这不是细节,是这个钩子的选型依据。Electron 的
     * `destroy()` 明确**不**发 `'close'`,只发 `'closed'`,所以三个非用户来源自动绕开这里:
     *  · host toggle 的 dock 方向(`destroyStandalone()` → `mount.destroyHost()` → `destroy()`)——
     *    它自己就是搬迁,再接管一次会建出第二个 cowork 承载;
     *  · 登出/鉴权拆卸;
     *  · 下面那个 `closeOnRendererFailure`。最后这一个**应该**升格(渲染进程死了,内容该回到
     *    tab 里去),所以它在调 `destroyStandalone()` 之前**显式布防**。
     *
     * 而 `app.quit()` 会对每个窗口发 `'close'`,所以退出时由 `shuttingDown` 拒绝
     * (`armStandaloneCloseTakeover` 里那一条)。
     */
    window.on('close' as any, () => {
      if (this.baseWindow !== window) return;
      this.armStandaloneCloseTakeover(host.hostToken);
    });
    window.on('focus', () => {
      console.info(
        `[onlypreview] event=window-focus state=focus focus=${electronWebContents.getFocusedWebContents() ? 'view' : 'none'}`
      );
      if (this.baseWindow === window) mount.reportActivation(true);
    });
    window.on('blur', () => {
      const keyWindow = BaseWindow.getFocusedWindow();
      const keyOwner = !keyWindow ? 'other-app' : keyWindow === window ? 'self' : 'own-window';
      console.info(`[onlypreview] event=window-focus state=blur keyOwner=${keyOwner}`);
      if (this.baseWindow === window) mount.reportActivation(false);
    });
    await this.attachSurface(host, mount, diagnostic, openTrace);
  }

  /**
   * Build the composite onto a host and wire everything that is not the host itself.
   *
   * Split out of `createStandaloneWindow` so a Cowork tab can run the identical sequence. Every
   * line below was already here; what changed is that the four host-shaped behaviours — showing the
   * surface, learning the host went away, taking the host down, and reporting extent — now come from
   * the mount instead of from a `BaseWindow` this code happened to own.
   *
   * `window` is still read from the mount and still used for the visibility and focus fields of the
   * open trace, for `isCurrentShell`, and for the DevTools guards. In the standalone host that is
   * OnlyPreview's own window; in a Cowork tab it is the window carrying the tab. Either way it is
   * "the window this composite is currently inside", which is what those checks always meant.
   */
  private async attachSurface(
    host: OnlyPreviewHostCapability,
    mount: OnlyPreviewMount,
    diagnostic: { tag: string; startedAt: number },
    openTrace: OnlyPreviewOpenTrace
  ): Promise<void> {
    const window = mount.window();
    if (!window) throw new Error('OnlyPreview mount has no window to build into.');
    this.baseWindow = window;
    this.standaloneMount = mount;
    const opening = this.surfaceOpening;
    if (opening?.hostToken === host.hostToken) {
      opening.releaseHostListener = mount.onHostGone(() => {
        if (this.surfaceOpening === opening) this.destroyStandalone();
      });
    }
    const searchBootstrap = onlyPreviewSearchBootstrapRegistry.issue(host.hostToken);
    this.searchBootstrapToken = searchBootstrap.searchToken;
    /**
     * 运行时死掉之后要能**自己起回来** —— 这是 2026-09-20 那次「preview 变砖」的修法。
     *
     * 当时:内存被打光(`freeMem=241MB(1%)`)→ 隐藏的 file-search renderer 挂掉 →
     * `onFailure` 停掉运行时 → **没有任何重启入口**(`start()` 全仓只有下面这一个调用点),于是
     * 凡是走运行时的都永久失效:`selectStandaloneFile`、`browseDirectory`(双击目录看不到内容)、
     * 复制绝对路径,以及卡死不动的索引进度条 —— 全是同一件事的不同表面。
     *
     * 重启要**重新 issue** bootstrap,不能复用旧 token:`issue()` 内部先 `revokeHost()`
     * (registry `:44`),所以重发是幂等的,也不会撞 `MAX_LIVE_SEARCH_BOOTSTRAPS`。
     */
    const startSearchRuntime = (bootstrapToken: string): Promise<void> =>
      fileSearchWindowService.start({
      host,
      bootstrapToken,
      broadcast: (eventName, params) => {
        // The relay already validated the listing and fenced its workspace/generation. Root
        // availability is independent of index completion; an empty successful listing counts.
        if (eventName === ONLY_PREVIEW_BROWSE_LISTING_EVENT) {
          const event = params as OnlyPreviewBrowseListingEvent;
          if (event.hostId === host.hostId && event.listing.relativePath === '') {
            onlyPreviewProjectIndexStateService.markBrowseReady(host.hostId, event.listing.workspaceId);
          }
        }
        if (eventName === ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT) {
          const event = params as OnlyPreviewSearchWatchCommitEvent;
          if (event.hostId === host.hostId) {
            void onlyPreviewPreviewRegionService
              .handleWatchCommit(host.hostToken, event.commit)
              .catch(() => undefined);
          }
        }
        // Main sees every snapshot before the renderers do, and the relay has already validated its
        // shape and fenced it on the active workspace generation, so this is the authoritative
        // point to record whether the Project index is finished.
        if (eventName === ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT) {
          const event = params as OnlyPreviewSearchSnapshotEvent;
          if (event.hostId === host.hostId) {
            onlyPreviewProjectIndexStateService.markObserved(
              host.hostId,
              event.snapshot.workspaceId,
              event.snapshot.state
            );
          }
        }
        xpcMain.broadcast(eventName, params);
      },
      onUnexpectedExit: (reason) => {
        // 承载本身已经不是当前这个了 —— 这一发与谁都无关,静默丢弃(旧行为)。
        if (this.standaloneHost?.hostToken !== host.hostToken) return;
        void recoverSearchRuntime(reason);
      },
      onOpenStage: (phase) => openTrace.mark({
        phase,
        role: 'hidden-search',
        lifecycle: 'ready',
        visible: false,
        focused: false,
        backgroundThrottling: false
      })
    });

    /**
     * 有界重建一次。失败就**明确记下来**,而不是留一个静默的砖。
     *
     * 只试一次:运行时挂掉最常见的原因是资源压力(那次是内存 1%),无限重试只会把机器压得更死;
     * 而一次重建足以把"渲染进程偶发崩溃"这类瞬时故障接住。重建不成时把失败落进
     * `onlyPreviewProjectIndexStateService`,让 UI 能说出「搜索子系统已停用」——
     * 进度条卡死就是因为运行时消失后再没有任何终止态送出来。
     */
    let recovering = false;
    let recovered = false;
    const recoverSearchRuntime = async (reason: string): Promise<void> => {
      if (recovering || recovered || shuttingDown) return;
      if (this.standaloneHost?.hostToken !== host.hostToken) return;
      recovering = true;
      console.warn(`[OnlyPreview] ${reason} Rebuilding the file-search runtime.`);
      try {
        const retryBootstrap = onlyPreviewSearchBootstrapRegistry.issue(host.hostToken);
        this.searchBootstrapToken = retryBootstrap.searchToken;
        await startSearchRuntime(retryBootstrap.searchToken);
        recovered = true;
        console.info('[onlypreview-search] event=runtime-recovered outcome=success');
      } catch (error) {
        console.error(
          '[onlypreview-search] event=runtime-recovered outcome=failure' +
            ` cause=${error instanceof Error ? error.name : 'unknown'}`
        );
        // 终止态:否则进度条会永远停在原地,因为事件源已经没了。
        onlyPreviewProjectIndexStateService.markRuntimeGone(host.hostId);
      } finally {
        recovering = false;
      }
    };

    // Adopt the live runtime when a transition preserved it — its index build keeps going.
    const rebound =
      this.preserveSearchRuntime &&
      fileSearchWindowService.rebindHost({ host, bootstrapToken: searchBootstrap.searchToken });
    if (!rebound) await startSearchRuntime(searchBootstrap.searchToken);
    openTrace.mark({ phase: 'runtime' });
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'runtime-ready',
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    if (this.baseWindow !== window || this.standaloneHost?.hostToken !== host.hostToken) {
      throw new Error('OnlyPreview file-search runtime startup was superseded.');
    }
    const shellView = this.createView(host, 'shell', undefined, undefined, undefined, openTrace.tag);
    openTrace.mark({
      phase: 'shell-create',
      role: 'shell',
      lifecycle: 'created',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    this.shellView = shellView;
    this.shellStartupLease = { hostToken: host.hostToken, window, view: shellView };
    const surfaceContainer = new View();
    this.surfaceContainer = surfaceContainer;
    mount.attach(surfaceContainer);
    mount.onResize(() => {
      if (this.baseWindow !== window) return;
      this.applySurfaceLayout(host, onlyPreviewPreviewRegionService.getBounds() ?? null);
    });
    // A `BaseWindow` has no web contents of its own, so the shell — the project rail, toolbar,
    // status bar and find bar — fills the composite as a `WebContentsView` and belongs in the stack
    // as its lowest layer rather than outside it.
    onlyPreviewViewLayerService.start(surfaceContainer);
    onlyPreviewViewLayerService.show('base', 'shell', shellView);
    // The constructor only carries width/height/x/y. WindowStateController.show() is what applies
    // the persisted bounds and any saved maximize/full-screen, so the listener has to exist before
    // show() or that restore resize lands with nothing watching and the content keeps the
    // constructor-time layout for the whole session.
    window.on('resize' as any, () => {
      if (this.baseWindow !== window) return;
      // The window tells its mount; the mount re-sizes the container and tells the composite. The
      // composite never listens to a window.
      mount.refresh();
    });
    this.applyInitialBounds();
    this.show();
    // maximize() and setFullScreen(true) settle asynchronously on macOS: this covers the first
    // frame, the listener above covers the settle.
    this.applyInitialBounds();
    openTrace.mark({
      phase: 'show',
      role: 'base',
      lifecycle: 'shown',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    openTrace.mark({
      phase: 'first-visible',
      role: 'base',
      lifecycle: 'shown',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    onlyPreviewAlertWindowService.start({
      isHostLive: () => mount.isAlive(),
      host,
      createView: () => this.createView(host, 'alert'),
      loadView: async (view) => await this.loadView(view, 'alert')
    });
    onlyPreviewGlobalSearchWindowService.start({
      isHostLive: () => mount.isAlive(),
      host,
      shellView,
      isCurrent: () => this.shellView === shellView && this.baseWindow === window,
      createView: () => this.createView(host, 'globalSearch'),
      loadView: async (view) => await this.loadView(view, 'globalSearch')
    });
    onlyPreviewPreviewRegionService.start({
      isHostLive: () => mount.isAlive(),
      container: surfaceContainer,
      host,
      createVuePreviewView: (
        previewRuntimeToken,
        officeBrokerCapability,
        previewReadBrokerCapability
      ) =>
        this.createView(
          host,
          'preview',
          previewRuntimeToken,
          officeBrokerCapability,
          previewReadBrokerCapability
        ),
      loadVuePreviewView: async (view) => await this.loadView(view, 'preview'),
      // No `onActiveViewAttached` any more: the preview's own show re-sorts every layer, so there
      // is nothing left for Global Search to undo afterwards.
      bindChromeShortcuts: (webContents) => {
        this.bindNativeShortcuts(webContents, host, 'chrome');
        bindOnlyPreviewDevToolsShortcut(webContents);
        // The raw Chromium surface is not built by `createView`, so it needs the same offer to the
        // host — otherwise Cmd+W with a PDF focused would still take the Cowork window.
        this.standaloneMount?.registerSurfaceView(webContents);
      }
    });
    // Every overlay owner is now listening, so layouts may fan out to them. Seeded immediately
    // rather than on the first preview: a dialog can open before any file has been selected, and the
    // alert view is not attached at all while it has no bounds. It goes through the same choke point
    // as every later layout, so the seed cannot disagree with it.
    this.surfaceLayoutFanout = true;
    this.applySurfaceLayout(host, null);

    // A dead view closes the whole standalone window, which otherwise looks like the window simply
    // vanished. Name the view and the exit reason so the cause is recoverable from the log.
    const closeOnRendererFailure = (details: Electron.RenderProcessGoneDetails): void => {
      if (!this.isCurrentShell(host.hostToken, window, shellView)) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'render-gone');
      console.warn(
        `[OnlyPreview] The shell renderer exited (${details.reason}, exitCode ${details.exitCode}); closing the standalone window.`
      );
      // **显式布防 —— 这一支够不到 `'close'` 钩子。** 下一行的 `destroyStandalone()` 走
      // `mount.destroyHost()` → `window.destroy()`,而 `destroy()` 不发 `'close'`。渲染进程死了
      // 是三个「非用户来源」里唯一**应该**升格的那一个:内容该回到那一格 tab,而不是连带消失。
      this.armStandaloneCloseTakeover(host.hostToken);
      if (this.baseWindow === window) this.destroyStandalone();
    };
    shellView.webContents.once('render-process-gone', (_event, details) =>
      closeOnRendererFailure(details)
    );
    shellView.webContents.once('dom-ready', () => {
      if (this.shellView !== shellView) return;
      openTrace.mark({ phase: 'shell-dom-ready', role: 'shell', lifecycle: 'dom-ready' });
    });
    shellView.webContents.once('did-finish-load', () => {
      if (this.baseWindow !== window || this.shellView !== shellView) return;
      openTrace.mark({ phase: 'shell-did-finish', role: 'shell', lifecycle: 'did-finish' });
    });
    shellView.webContents.once('did-fail-load', () => {
      if (!this.isCurrentShell(host.hostToken, window, shellView)) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'load-fail');
    });
    shellView.webContents.once('unresponsive', () => {
      if (!this.isCurrentShell(host.hostToken, window, shellView)) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'unresponsive');
    });
    // The host going away, not a window closing: the standalone mount raises this from its own
    // window's `closed`, and a Cowork tab raises it when the tab is closed.
    mount.onHostGone(() => {
      if (
        this.baseWindow !== window ||
        this.standaloneHost?.hostToken !== host.hostToken
      ) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'closed');
      this.destroySettings();
      this.destroyAgentSkillGuide();
      this.baseWindow = null;
      this.shellView = null;
      this.baseWindowState = null;
      this.stopSearchRuntimeUnlessPreserved();
      onlyPreviewAlertWindowService.destroy();
    onlyPreviewGlobalSearchWindowService.destroy();
      onlyPreviewPreviewRegionService.destroy();
      closeView(shellView);
      if (this.searchBootstrapToken === searchBootstrap.searchToken) {
        onlyPreviewSearchBootstrapRegistry.revoke(searchBootstrap.searchToken);
        this.searchBootstrapToken = null;
      }
      if (this.standaloneHost?.hostToken === host.hostToken) this.standaloneHost = null;
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    openTrace.mark({ phase: 'shell-load-start', role: 'shell', lifecycle: 'loading' });
    await this.loadView(shellView, 'shell');
    openTrace.mark({ phase: 'shell-load-resolved', role: 'shell', lifecycle: 'load-resolved' });
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'renderer-loaded',
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    // The owner asked for the OnlyPreview window's own DevTools on the Preview channel, not only in
    // a debug build. Detached and inactive: a detached DevTools window is a separate NSWindow, and
    // activating it takes key status away from the BaseWindow — which is how Cmd+F went dead.
    if (
      shouldAutoOpenOnlyPreviewDevTools() &&
      this.baseWindow === window &&
      this.shellView === shellView &&
      !window.isDestroyed() &&
      !shellView.webContents.isDestroyed() &&
      !shellView.webContents.isDevToolsOpened()
    ) {
      shellView.webContents.openDevTools({ mode: 'detach', activate: false });
    }
    const previewView = onlyPreviewPreviewRegionService.getVuePreviewView();
    if (
      !shouldAutoOpenOnlyPreviewDevTools() ||
      this.baseWindow !== window ||
      this.shellView !== shellView ||
      !previewView ||
      window.isDestroyed() ||
      previewView.webContents.isDestroyed() ||
      previewView.webContents.isDevToolsOpened()
    ) {
      return;
    }
    previewView.webContents.openDevTools({ mode: 'detach', activate: false });
  }

  private createView(
    host: OnlyPreviewHostCapability,
    mode: 'shell' | 'preview' | 'globalSearch' | 'alert',
    previewRuntimeToken?: string,
    officeBrokerCapability?: string,
    previewReadBrokerCapability?: string,
    openTag?: string
  ): WebContentsView {
    const target = getOnlyPreviewRendererTarget(mode, __dirname);
    const view = new WebContentsView({
      webPreferences: {
        preload: join(
          __dirname,
          mode === 'preview' ? '../preload/onlypreviewContent.js' : '../preload/onlypreview.js'
        ),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: mode !== 'shell',
        // 宿主参数摊在最后:Maestro tab 承载时带上这个 tab 的身份,给 `MAESTROSDK` 认自己的刷新
        // 广播用;独立窗口承载时是空数组,行为逐字不变。
        additionalArguments: [
          ...(this.standaloneMount?.maestroRendererArguments() ?? []),
          ...getOnlyPreviewRendererArguments(
            host,
            mode,
            previewRuntimeToken,
            officeBrokerCapability,
            previewReadBrokerCapability,
            openTag,
            // The Shell renders the window controls this host can honour, and nothing else.
            this.standaloneMount?.kind === 'cowork' ? 'cowork' : 'window'
          )
        ]
      }
    });
    if (mode === 'globalSearch') view.setBackgroundColor('#00000000');
    if (mode === 'alert') view.setBackgroundColor('#00000000');
    configureOnlyPreviewNavigationFence(view.webContents, target.url, mode === 'shell');
    // The alert view deliberately gets no native shortcuts. A dialog is modal, so Cmd+F or
    // Shift+Cmd+F while it is up would open Find or Global Search *underneath* it, and the dialog
    // already owns Enter and Escape itself.
    this.shortcutContents.add(view.webContents);
    if (mode !== 'alert') {
      this.bindNativeShortcuts(
        view.webContents,
        host,
        mode === 'shell' ? 'shell' : mode === 'preview' ? 'vue' : 'search'
      );
    }
    bindOnlyPreviewDevToolsShortcut(view.webContents);
    // Every view the composite creates is offered to the host, which is how a Cowork tab gets its
    // own chords (Cmd+W closing the tab rather than the window) over views that are not in its
    // session. The standalone host wants nothing and ignores it.
    this.standaloneMount?.registerSurfaceView(view.webContents);
    return view;
  }

  private async loadView(
    view: WebContentsView,
    mode: 'shell' | 'preview' | 'globalSearch' | 'alert'
  ): Promise<void> {
    const target = getOnlyPreviewRendererTarget(mode, __dirname);
    await (is.dev && process.env['ELECTRON_RENDERER_URL']
      ? view.webContents.loadURL(target.url)
      : view.webContents.loadFile(target.filePath));
  }

  // `maximize()` and `setFullScreen(true)` settle asynchronously on macOS: the caller uses this for
  // the first frame and the window's `resize` listener covers the settle. Both go through the mount,
  // so the container and the layers can never be sized from two different notions of the extent.
  private applyInitialBounds(): void {
    this.standaloneMount?.refresh();
  }

  private finishShellOpenTrace(
    tag: string,
    outcome: 'success' | 'failure' | 'superseded',
    reason: 'none' | 'fail' | 'closed' | 'load-fail' | 'render-gone' | 'unresponsive' | 'bootstrap-fail' = 'none'
  ): void {
    this.windowOpenTraces.finish(tag, outcome, reason);
  }

  private isCurrentShell(
    hostToken: string,
    window: BaseWindow,
    view: WebContentsView
  ): boolean {
    return this.baseWindow === window && this.shellView === view &&
      this.standaloneHost?.hostToken === hostToken;
  }

  private settleShellStartupLease(
    hostToken: string,
    window: BaseWindow,
    view: WebContentsView
  ): boolean {
    if (!this.isCurrentShell(hostToken, window, view)) return false;
    const lease = this.shellStartupLease;
    if (lease?.hostToken !== hostToken || lease.window !== window || lease.view !== view) return false;
    this.shellStartupLease = null;
    if (!view.webContents.isDestroyed()) view.webContents.setBackgroundThrottling(true);
    return true;
  }

  private resolveNativeCommand(
    host: OnlyPreviewHostCapability,
    input: Input
  ): OnlyPreviewNativeCommand | null {
    const key = input.key.toLowerCase();
    if (
      input.type === 'keyDown' &&
      (input.code === 'Digit1' || key === '1') &&
      input.alt &&
      !input.control &&
      !input.meta
    ) {
      return 'focus-project';
    }
    if (isGlobalSearchShortcut(input)) return 'focus-search';
    if (isCurrentFileFindShortcut(input)) return 'find-in-file';
    if (
      isProjectItemCopyShortcut(input) &&
      this.standaloneHost?.hostToken === host.hostToken &&
      // A keystroke typed into the Global Search field belongs to that field, not to the tree.
      !onlyPreviewGlobalSearchWindowService.isActive(host.hostToken)
    ) {
      return input.shift ? 'copy-project-path' : 'copy-project-name';
    }
    if (
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      input.key === 'Escape' &&
      !input.shift &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      this.standaloneHost?.hostToken === host.hostToken
    ) {
      if (onlyPreviewAlertWindowService.isOpen(host.hostToken)) return null;
      // Native routing also covers body/iframe focus, outside the search panel's DOM handler.
      if (onlyPreviewGlobalSearchWindowService.isActive(host.hostToken)) {
        return 'close-global-search';
      }
      if (onlyPreviewPreviewRegionService.isFindOpen(host.hostToken)) return 'close-find-in-file';
    }
    if (input.type === 'keyDown' && key === 'f5') return 'refresh';
    if (input.type !== 'keyDown' || !isCommandModifier(input)) return null;
    if (key === 'o') return 'choose-folder';
    if (key === 'r') return 'refresh';
    if (key === ',' || (process.platform !== 'darwin' && key === 's' && input.alt)) {
      return 'open-settings';
    }
    return null;
  }
}

export const onlyPreviewWindowHelper = new OnlyPreviewWindowHelper();

/**
 * 退出时 `app.quit()` 会对每个窗口发 `'close'`,而那一次不是「用户把 OnlyPreview 收起来」。
 *
 * **不能挂在 `before-quit` 上。** 这个 app 的第一发 `before-quit` 必然 `preventDefault()`
 * (`app.main.ts:704-707`),真正的退出要等 `quitAfterCleanup()` 把它自己那面 `isQuitting` 置真之后
 * 才发生 —— 而退出是**可以被取消**的:退出确认对话框点取消(`:717-720`)、清理失败
 * (`:695-699`)。挂在 `before-quit` 上,一次「取消退出」就把这一位永久钉在 true,之后整个进程
 * 生命里关窗接管都静默失效,症状和它要防的那件事一模一样,且重启前不恢复。
 *
 * 所以由 app 在设置 `isQuitting` 的同一处显式驱动,两面旗同真同假。
 */
export const setOnlyPreviewShuttingDown = (value: boolean): void => {
  shuttingDown = value;
};

// Registered at module load, not at window creation: the menu exists for the whole application
// lifetime, and an unclaimed chord has to resolve to `false` (so it can be replayed to the window
// that is actually focused) even while OnlyPreview is closed.
setApplicationFindDispatch((command, window) =>
  onlyPreviewWindowHelper.runMenuFindCommand(command, window)
);
