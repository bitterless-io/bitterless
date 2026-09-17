import { resolve } from 'node:path';
import type { BaseWindow } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import { getMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  OnlyPreviewContractError,
  toOnlyPreviewErrorPayload
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_HOST_TOGGLE_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewErrorPayload,
  type OnlyPreviewFocusWindowResult,
  type OnlyPreviewHostToggleState
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewWindowHelper } from './onlyPreviewWindow.helper';
import {
  getOnlyPreviewCoworkTabState,
  promoteOnlyPreviewCoworkTab,
  ONLY_PREVIEW_COWORK_TAB_ID
} from './onlyPreviewCoworkTab';
import type { OnlyPreviewMountKind } from '@main/miniapps/onlypreview/onlyPreviewSurface.mount';
import type { OnlyPreviewHostCapability } from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
import { onlyPreviewRecentDirectoryService } from '@main/miniapps/onlypreview/onlyPreviewRecentDirectory.service';
import { rememberOnlyPreviewHostMount } from '@main/miniapps/onlypreview/onlyPreviewHostMount.service';
import { onlyPreviewPreviewRegionService } from '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service';
import {
  onlyPreviewTargetMutations,
  presentOnlyPreviewExplicitFile
} from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
import { onlyPreviewLogService } from '@main/miniapps/onlypreview/onlyPreviewLog.runtime';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';

// Only native targets survive this one transition. All workspace/file capabilities are reissued.
interface TransitionTarget {
  directoryPath: string | null;
  filePath: string | null;
}

class OnlyPreviewHostToggleService {
  private pending: { hostToken: string; promise: Promise<void> } | null = null;
  private failure: { hostToken: string; error: OnlyPreviewErrorPayload } | null = null;

  getState(hostToken: string): OnlyPreviewHostToggleState {
    onlyPreviewWindowHelper.getMountKind(hostToken);
    return {
      canDock: Boolean(this.dockWindow()),
      pending: this.pending !== null,
      ...(this.failure?.hostToken === hostToken ? { error: this.failure.error } : {})
    };
  }

  toggle(hostToken: string): Promise<void> {
    onlyPreviewWindowHelper.getMountKind(hostToken);
    if (this.pending) {
      // COALESCE, do not refuse — for ANY host token (Ral 2026-09-07: repeated clicking must
      // settle). Refusing a different token was wrong in the one case that actually happens:
      // a transition REPLACES the host, so the shell that fires the second click is a different
      // shell holding a different token, and the old guard turned "clicked twice" into a thrown
      // contract error the user saw as a failure banner.
      //
      // Joining is safe because there is at most one live composite: two requests to move it are
      // the same request. What must NOT happen is a second `relocate` starting while the first is
      // mid-flight — that tears down the host the first one is still building into, which surfaces
      // as an aborted load and lands the composite back where it started.
      return this.pending.promise;
    }
    this.failure = null;
    const promise = onlyPreviewTargetMutations.run(async () => {
      try {
        await this.relocate(hostToken);
      } catch (error) {
        this.recordFailure(error);
        throw error;
      } finally {
        this.pending = null;
        this.broadcastState();
      }
    });
    this.pending = { hostToken, promise };
    this.broadcastState();
    return promise;
  }

  private dockWindow(): BaseWindow | null {
    const window = maestroWindowHelper.browserWindow;
    return window && !window.isDestroyed() && getMaestroCompositeTab(ONLY_PREVIEW_COWORK_TAB_ID)
      ? window
      : null;
  }

  private requireDockWindow(expected: BaseWindow | null): void {
    if (!expected || this.dockWindow() !== expected) {
      throw new OnlyPreviewContractError(
        'HOST_NOT_FOUND',
        'The Cowork browser window is not available.'
      );
    }
  }

  private captureTarget(hostToken: string): TransitionTarget {
    const workspace = onlyPreviewWorkspaceRegistry.restore(hostToken);
    const fileRef = onlyPreviewPreviewRegionService.snapshot(hostToken).fileRef;
    let filePath: string | null = null;
    if (fileRef) {
      const external = onlyPreviewWorkspaceRegistry.getExternalPreviewNativePath(
        hostToken,
        fileRef
      );
      if (external) filePath = external;
      else {
        const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
          hostToken,
          fileRef
        );
        const record = onlyPreviewWorkspaceRegistry.requireWorkspace(
          hostToken,
          authority.workspaceId
        );
        filePath = resolve(record.rootRealPath, authority.relativePath);
      }
    }
    return { directoryPath: workspace?.displayPath ?? null, filePath };
  }

  /**
   * Tear the current carrier's CONTENT down and wait for it, so nothing from the old host outlives
   * this call.
   *
   * **这里不再关任何 tab(Ral 2026-09-17)。** 原来 `sourceKind === 'cowork'` 时先 `getTabs()` 再把
   * 每一格 OnlyPreview `closeTab` 掉,那是 2026-09-07 的「独立窗口打开,浏览器里的 tab 就得关掉」
   * (docs/issues/onlypreview-host-toggle-leaves-empty-cowork-tab.md 的 Reversal 段)。那条决定在
   * 默认配置下**根本执行不了**:`onlyPreviewCoworkTab.ts` 声明了 `defaultHome: true`,于是那一格是
   * pinned 的固有 tab,而 `closeTab` 对 pinned 静默返回 —— 关是一个 no-op,留下的是一格关不掉的
   * 空白,外加没有任何回到那个窗口的入口(「关闭这个事情 UI 上不友好」)。
   *
   * 现在那一格留下来,由 `destroyStandalone()` → `mount.destroyHost()` → `deps.defer()` 就地换成
   * 占位页(docs/features/onlypreview-deferred-tab-placeholder.md #1,G1:undock 路径上 `closeTab`
   * 调用次数为 0)。**teardown-first 的顺序一个字不改** —— 那是 2026-09-07 同一场里另外一条没被
   * 取代的决定,理由写在下面 `relocate` 里。`destroyStandalone()` 仍然是同步把渲染进程与
   * file-search runtime 拆干净的那一步,所以「等它」这件事本身没有变。
   */
  private async teardownSource(sourceKind: OnlyPreviewMountKind): Promise<void> {
    onlyPreviewWindowHelper.destroyStandalone();
    console.info(
      `[onlypreview] event=host-toggle phase=torn-down source=${sourceKind}` +
        ` liveHost=${onlyPreviewWindowHelper.getStandaloneHost() ? 'yes' : 'null'}` +
        ` tab=${getOnlyPreviewCoworkTabState()}`
    );
  }

  private async buildHost(
    kind: OnlyPreviewMountKind,
    dockWindow: BaseWindow | null
  ): Promise<OnlyPreviewHostCapability> {
    if (kind === 'standalone') {
      const host = await onlyPreviewWindowHelper.ensureStandalone();
      if (onlyPreviewWindowHelper.getMountKind(host.hostToken) !== kind) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'OnlyPreview could not be opened in a separate window.'
        );
      }
      return host;
    }
    this.requireDockWindow(dockWindow);
    if (onlyPreviewWindowHelper.getStandaloneHost()) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview already has a live host.'
      );
    }
    // 条上已经有那一格(占位态)时**就地升格**,而不是关掉它再新开一格。
    //
    // 这一处以前是一个 `closeTab` 循环 —— 独立窗口占着承载时,条上那一格是个空白占位,dock 之前
    // 得先把它清掉。现在那一格装的是真的占位页,而它**就是要升格的那一格**:`openCompositeTab`
    // 对 singleton 只会把已有那一格摆到前台、不会重新挂载,所以两条路必须在这里分开。
    // G1:这条路上 `closeTab` 一次都不调。
    const promoted = await promoteOnlyPreviewCoworkTab();
    this.requireDockWindow(dockWindow);
    if (!promoted) {
      await maestroWindowHelper.openCompositeTab({ id: ONLY_PREVIEW_COWORK_TAB_ID });
      this.requireDockWindow(dockWindow);
    }
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (!host || onlyPreviewWindowHelper.getMountKind(host.hostToken) !== 'cowork') {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview could not be opened in a Cowork tab.'
      );
    }
    return host;
  }

  private async restoreTarget(
    host: OnlyPreviewHostCapability,
    target: TransitionTarget,
    generation: number
  ): Promise<void> {
    onlyPreviewRecentDirectoryService.bindExplicitTarget(host.hostToken, generation);
    try {
      if (target.directoryPath) {
        const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
          host.hostToken,
          target.directoryPath,
          generation
        );
        if (!workspace)
          throw new OnlyPreviewContractError(
            'WORKSPACE_NOT_FOUND',
            'The Project could not be restored.'
          );
      }
      if (target.filePath) {
        const inspected = await fileSearchWindowService.inspectTarget(target.filePath);
        onlyPreviewWindowHelper.getMountKind(host.hostToken);
        await presentOnlyPreviewExplicitFile(host, inspected);
      }
    } catch (error) {
      // A deleted/changed file must not undo a successful move or leave an old document on screen.
      // The fresh host keeps its restored Project and exposes the failure independently of sender.
      this.recordFailure(error);
    } finally {
      xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId: host.hostId });
    }
  }

  /**
   * 「tab 还存在」的判据(方案 #6)。
   *
   * 两半都要:条上**有一格**其 kind 标识 OnlyPreview,**并且**那一格的运行时报告状态为
   * `deferred`。少了前一半,用户在窗口开着时把 tab 关掉之后还会去升格一个不存在的格子;少了后一半,
   * 一格正在活着的 composite 会被当成占位页再挂一次。看运行时状态而不是看持久化偏好 —— 偏好说的
   * 是「下次开哪种」。
   */
  private async hasDeferredOnlyPreviewTab(): Promise<boolean> {
    if (getOnlyPreviewCoworkTabState() !== 'deferred') return false;
    const tabs = await maestroWindowHelper.getTabs();
    return tabs.some((tab) => tab.kind === ONLY_PREVIEW_COWORK_TAB_ID);
  }

  /**
   * 独立窗口要没了,而条上还留着那一格占位页 —— 把内容接回去。
   *
   * 由 `onlyPreviewWindowHelper` 在可取消的 `'close'` 上回调(注册见本文件末尾)。**这一刻是唯一
   * 能快照转移目标的时刻**:工作区注册表与预览区当前文件都会在 `mount.onHostGone` 里被吊销。
   * `beginHostTransition()` 让在途索引活过这次搬家 —— 不调的话 `destroyStandalone()` 里的
   * `stopSearchRuntimeUnlessPreserved()` 会把它丢掉,下一发从零重建。
   *
   * 同步返回、升格排进 FIFO:`'close'` 是一个可取消事件,在它的处理函数里 await 只会让关窗卡住。
   */
  takeOverStandaloneClose(hostToken: string): TransitionTarget | undefined {
    if (getOnlyPreviewCoworkTabState() !== 'deferred') return undefined;
    let target: TransitionTarget = { directoryPath: null, filePath: null };
    try {
      target = this.captureTarget(hostToken);
    } catch {
      // 承载已经在这一刻之前就没了 —— 空手升格,shell 自己的 `restoreWorkspace` 会兜住上次的项目。
    }
    onlyPreviewWindowHelper.beginHostTransition();
    console.info(
      `[onlypreview] event=deferred-tab phase=armed` +
        ` project=${target.directoryPath ? 'yes' : 'null'} file=${target.filePath ? 'yes' : 'null'}`
    );
    // **只返回快照,不在这里排队升格。** `'close'` 这一刻承载还活着,而升格体在它那道
    // `getStandaloneHost()` 判据之前没有任何 macrotask 边界 —— 在这里排队,它会在窗口真正销毁之前
    // 跑完并自己判成 `reason=live-host`,于是 G4 静默地什么都不做。升格改由 helper 在 `'closed'`
    // (承载已吊销)那一侧触发。
    return target;
  }

  /**
   * 占位页那一格就地升格成真正的 OnlyPreview。**只有这一条 dock 路径,不许有第二条。**
   *
   * 跑在 `relocate` 用的同一条 `onlyPreviewTargetMutations.run` FIFO 上,并且复用同样的私有步骤:
   * `buildHost('cowork')` → `restoreTarget()` → `rememberOnlyPreviewHostMount('tab')` → `show()`。
   * 同一条 FIFO 也是「排队的 dock `toggle()` 与排队的升格只建出一个 cowork 承载」的实现:先跑的
   * 那个把承载建起来,后跑的那个在下面那道 `getStandaloneHost()` 上变成 no-op。
   *
   * 不外抛:这条路没有发起它的用户动作 —— 失败只该进 `recordFailure`(日志 ＋ 下一次 `getState`),
   * 不该变成一个没人 await 的 unhandled rejection。
   */
  async promoteDeferredTab(target: TransitionTarget): Promise<void> {
    await onlyPreviewTargetMutations.run(async () => {
      try {
        // 没有那一格就什么都不做,持久化偏好保持 `'window'`(方案 #0 的 G5、#6 第一条)。
        if (!(await this.hasDeferredOnlyPreviewTab())) {
          console.info('[onlypreview] event=deferred-tab phase=skipped reason=no-deferred-tab');
          return;
        }
        // 已经有承载了(排在前面的 dock 刚把它建好,或者用户自己又开了一个)—— 幂等地什么都不做。
        if (onlyPreviewWindowHelper.getStandaloneHost()) {
          console.info('[onlypreview] event=deferred-tab phase=skipped reason=live-host');
          return;
        }
        const dockWindow = this.dockWindow();
        const generation = onlyPreviewRecentDirectoryService.beginExplicitTarget();
        try {
          const host = await this.buildHost('cowork', dockWindow);
          await this.restoreTarget(host, target, generation);
          // 升格要写持久化偏好 `'tab'`(方案 #5.1):否则关掉窗口内容回到了 tab,下一次点芯片又弹
          // 窗口,读起来像「没回来」。与 `rememberOnlyPreviewHostMount` 既有口径一致 —— 落定的
          // 承载就是真相。不 await,同 `relocate` 那一处。
          rememberOnlyPreviewHostMount('tab');
          // **不把隐藏的浏览器窗口提到前台(方案 #5.3)。** 用户刚关掉独立窗口,大概是想收起来;
          // 这时候弹一个他没点的窗口正好相反。内容确实已经回到那一格,他下次打开浏览器就看见。
          // 代价说清:浏览器窗口隐藏时关掉独立窗口,屏幕上会一瞬间什么都没有 —— 要翻这一条只改
          // 这一处判断。
          if (dockWindow?.isVisible()) onlyPreviewWindowHelper.show();
          console.info(
            `[onlypreview] event=deferred-tab phase=promoted` +
              ` shown=${dockWindow?.isVisible() ? 'yes' : 'no'}`
          );
        } finally {
          onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
        }
      } catch (error) {
        console.info(
          `[onlypreview] event=deferred-tab phase=failed` +
            ` error=${(error as Error)?.message ?? String(error)}`
        );
        this.recordFailure(error);
      } finally {
        // **每一条路都要收尾**,no-op 那两条也算:`beginHostTransition()` 是在 `'close'` 里布防时
        // 调的,不在这里放开的话索引运行时会永久逃过之后每一次拆卸。
        onlyPreviewWindowHelper.endHostTransition();
        this.broadcastState();
      }
    });
  }

  /**
   * 「前往」—— 定位到那个独立窗口,窗口已经死了就走升格。
   *
   * **不复用 `openOnlyPreviewWindow()`**:它的冷分支会**新建**一个窗口,对一张占位页来说那是错的
   * 答案(方案 #3)。活窗口那一支走既有的 `showSurface()`,于是持久化 bounds、取消最小化、
   * maximize/full-screen 与离屏保护全部照旧 —— 这里不新增任何几何逻辑。
   */
  async focusStandaloneWindow(): Promise<OnlyPreviewFocusWindowResult> {
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (host) {
      try {
        if (onlyPreviewWindowHelper.getMountKind(host.hostToken) === 'standalone') {
          onlyPreviewWindowHelper.show();
          return { focused: true };
        }
      } catch {
        // 挂载已经死了(`getMountKind` 在那种情况下抛)—— 落到升格那一支。
      }
    }
    // 空手升格:窗口已经不在了,注册表也随它一起吊销了,所以没有可快照的目标 —— 新 shell 自己的
    // `restoreWorkspace` 会把上次的项目捡回来。
    await this.promoteDeferredTab({ directoryPath: null, filePath: null });
    return { focused: false };
  }

  private async relocate(hostToken: string): Promise<void> {
    const sourceKind = onlyPreviewWindowHelper.getMountKind(hostToken);
    const sourceWindow = onlyPreviewWindowHelper.getStandaloneWindow(hostToken);
    const destinationKind = sourceKind === 'cowork' ? 'standalone' : 'cowork';
    const dockWindow = this.dockWindow();
    // Decision trace. Without it this transition's failure mode is unreadable: the `catch` below
    // rebuilds on `sourceKind`, so a failed move looks exactly like "the button did nothing" — or,
    // when the destination did get built first, like "it opened and then went back". The observed
    // report (`open in window` ending up as a reload in the tab) is that second shape, and the log
    // only showed the ERR_FAILED of an aborted load, never which side asked for what.
    console.info(
      `[onlypreview] event=host-toggle phase=plan source=${sourceKind}` +
        ` destination=${destinationKind} dock=${dockWindow ? 'yes' : 'null'}` +
        ` sourceWindow=${sourceWindow ? 'yes' : 'null'}`
    );
    if (destinationKind === 'cowork') {
      this.requireDockWindow(dockWindow);
      await maestroWindowHelper.whenReady();
      this.requireDockWindow(dockWindow);
    }
    await onlyPreviewRecentDirectoryService.flushPendingWrites();
    onlyPreviewWindowHelper.getMountKind(hostToken);
    if (destinationKind === 'cowork') this.requireDockWindow(dockWindow);
    const target = this.captureTarget(hostToken);
    const generation = onlyPreviewRecentDirectoryService.beginExplicitTarget();
    // Keep the search runtime alive across this transition: the index build in flight inside it
    // must not restart, and a runtime that is not being torn down cannot tear down its successor.
    onlyPreviewWindowHelper.beginHostTransition();
    try {
      // Tear the SOURCE host down COMPLETELY, and wait for it, before building anything
      // (Ral 2026-09-07: 「先关闭 tab 和对应的渲染进程,再触发新的 window 打开 preview」).
      //
      // This is the fix for a whole class of failure rather than one instance of it. The previous
      // order was `destroyStandalone()` then immediately `buildHost(...)`, and `destroyStandalone`
      // closes a Cowork tab through `mount.destroyHost()` — which is FIRE-AND-FORGET on the tab
      // side. So the old tab's renderers and its file-search runtime were still shutting down while
      // the new host was already starting, and a late message from the dying side would tear down
      // the runtime the new side had just built. Measured: `start()` created the new file-search
      // window, and 14ms later `rejectOfficeReadProtocol` destroyed it mid-load, which surfaced as
      // `ERR_FAILED (-2)` on a page that serves HTTP 200
      // (docs/issues/onlypreview-host-toggle-tears-down-the-new-runtime.md).
      //
      // Awaiting the carrier close first means there is nothing left alive to send that message.
      await this.teardownSource(sourceKind);
      let host: OnlyPreviewHostCapability;
      try {
        host = await this.buildHost(destinationKind, dockWindow);
      } catch (error) {
        // THIS is what turns a failed move into "it went back where it was" on screen.
        console.info(
          `[onlypreview] event=host-toggle phase=failed destination=${destinationKind}` +
            ` recoverTo=${sourceKind} error=${(error as Error)?.message ?? String(error)}`
        );
        onlyPreviewWindowHelper.destroyStandalone();
        try {
          const recovered = await this.buildHost(
            sourceKind,
            sourceKind === 'cowork' ? sourceWindow : null
          );
          await this.restoreTarget(recovered, target, generation);
          console.info(`[onlypreview] event=host-toggle phase=recovered kind=${sourceKind}`);
        } catch (recoveryError) {
          console.info(
            `[onlypreview] event=host-toggle phase=recovery-failed` +
              ` error=${(recoveryError as Error)?.message ?? String(recoveryError)}`
          );
          this.recordFailure(recoveryError);
        }
        throw error;
      }
      await this.restoreTarget(host, target, generation);
      const settledKind = onlyPreviewWindowHelper.getMountKind(host.hostToken);
      console.info(
        `[onlypreview] event=host-toggle phase=settled destination=${destinationKind}` +
          ` actual=${settledKind}`
      );
      // 记下**结算之后的**那一种,而不是 `destinationKind` —— 切换可能落在别处(`buildHost` 失败后
      // 的回退),而"下次开哪种"要跟着实际结果,不是跟着意图。
      // 不 await:一次写不进去只该影响下次的默认,不该把一次成功的切换报成失败。
      rememberOnlyPreviewHostMount(settledKind === 'standalone' ? 'window' : 'tab');
      onlyPreviewWindowHelper.show();
    } finally {
      onlyPreviewWindowHelper.endHostTransition();
      onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
    }
  }

  private recordFailure(error: unknown): void {
    const payload = toOnlyPreviewErrorPayload(error);
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (host) this.failure = { hostToken: host.hostToken, error: payload };
    onlyPreviewLogService.writeOperationFailure({
      operation: 'toggleHost',
      code: payload.code,
      error
    });
  }

  private broadcastState(): void {
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (host) xpcMain.broadcast(ONLY_PREVIEW_HOST_TOGGLE_CHANGED_EVENT, { hostId: host.hostId });
  }
}

export const onlyPreviewHostToggleService = new OnlyPreviewHostToggleService();

/**
 * 关掉独立窗口时的接管,注册在模块加载时。
 *
 * 方向只有一条:toggle → helper。反过来直接 import 就是一个环(helper 是这个文件的依赖),
 * 而接管那一步要的东西 —— dock 的那条 FIFO、`captureTarget()` / `restoreTarget()` —— 全在这边。
 */
onlyPreviewWindowHelper.setStandaloneCloseTakeover({
  // `'close'`:承载还活着,抓快照。
  capture: (hostToken) => onlyPreviewHostToggleService.takeOverStandaloneClose(hostToken),
  // `'closed'`:承载已吊销,这才是升格能跑的时刻。
  promote: (captured) => {
    void onlyPreviewHostToggleService.promoteDeferredTab(captured as TransitionTarget);
  }
});
