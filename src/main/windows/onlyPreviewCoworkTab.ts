import { registerMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  MAESTRO_ONLY_PREVIEW_DISPLAY_URL,
  MAESTRO_ONLY_PREVIEW_TAB_ID
} from '@maestro-shared/compositeTab.identity';
import { MAESTRO_ICON_ONLY_PREVIEW } from '@maestro-shared/compositeTabIcon';
import type { MaestroCompositeTabHostApi } from '@maestro-shared/compositeTab.api';
import { openOnlyPreviewAbsoluteTarget } from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import {
  OnlyPreviewCoworkMount,
  type OnlyPreviewCoworkTabDeps
} from '@main/windows/onlyPreviewCoworkMount';
import { OnlyPreviewDeferredTabSurface } from '@main/windows/onlyPreviewDeferredTabSurface';
import { onlyPreviewPreviewRegionService } from '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service';

/**
 * Teach Cowork that OnlyPreview can live in one of its tabs.
 *
 * The glue lives here, on the Bitterless side, because only this side may know both halves: Maestro
 * offers a tab that carries a native view, OnlyPreview offers a composite that can be carried, and
 * `check:maestro`'s alias boundary forbids Maestro from reaching for the second. So the host
 * registers a spec and Maestro drives it without ever importing a mini app.
 *
 * That one tab is a **two-state runtime** (Ral 2026-09-17): `live` carries today's composite,
 * `deferred` carries a placeholder page while a standalone window owns the surface. Both states are
 * the same tab id and the same `instanceId` — see
 * docs/features/onlypreview-deferred-tab-placeholder.md #2.
 */
// Re-exported from maestro-shared so both halves name the tab the same thing exactly once.
export const ONLY_PREVIEW_COWORK_TAB_ID = MAESTRO_ONLY_PREVIEW_TAB_ID;

/**
 * 那一格现在装的是什么。
 *
 * `'live'` = OnlyPreview composite;`'deferred'` = 占位页(独立窗口占着承载);`'none'` = 条上没有
 * 这一格。**这是 #6 里「tab 还存在」判据的后半截** —— 前半截是条上有一格其 kind 标识 OnlyPreview,
 * 由调用方去问 maestro。看运行时状态而不是看持久化偏好:偏好说的是「下次开哪种」,和「现在这一格
 * 在不在」是两件事。
 */
export type OnlyPreviewCoworkTabState = 'live' | 'deferred' | 'none';

/**
 * OnlyPreview 现在有没有一个**活着的**承载(独立窗口,或者别的 tab)。
 *
 * `getStandaloneHost()` 单独问不够:挂载已经死掉时它仍然可能返回上一个 host。`getMountKind()`
 * 在那种情况下**抛** —— 这正是 `openOnMount` 内部用的那条活性判据,这里按同一条判。
 */
const hasLiveOnlyPreviewHost = (): boolean => {
  const host = onlyPreviewWindowHelper.getStandaloneHost();
  if (!host) return false;
  try {
    onlyPreviewWindowHelper.getMountKind(host.hostToken);
    return true;
  } catch {
    return false;
  }
};

/**
 * 那一格的双态运行时。
 *
 * 住在模块作用域而不是注册闭包里,是因为除了 spec 的生命周期回调之外还有两个调用方:mount 的
 * `destroyHost()`(经 `deps.defer()`)要把这一格降级成占位页,而 host toggle 的 dock 那一支要把它
 * **就地升格**回 composite —— 后者刻意不走 `spec.open`,因为条上那一格已经存在,而
 * `openCompositeTab` 对 singleton 只会把它摆到前台,不会重新挂载。
 *
 * `foreground` 是 maestro 最后一次报给这一格的前后台状态。两条换装路径(降级、升格)都不经过
 * maestro,所以没人会在换装之后替新装的那一半补这一次 `setActive` —— 不自己记住的话,切过去的
 * 那一格是一块看不见的白板,和「空条」难以区分。
 */
let live: { host: MaestroCompositeTabHostApi; mount: OnlyPreviewCoworkMount } | null = null;
let placeholder: {
  host: MaestroCompositeTabHostApi;
  surface: OnlyPreviewDeferredTabSurface;
} | null = null;
let foreground = false;

export const getOnlyPreviewCoworkTabState = (): OnlyPreviewCoworkTabState => {
  if (live?.mount.isAlive()) return 'live';
  if (placeholder) return 'deferred';
  return 'none';
};

/** 占位页装到这一格上。同一格上已经有占位页时是 no-op。 */
const mountPlaceholder = async (host: MaestroCompositeTabHostApi): Promise<void> => {
  if (placeholder?.host === host) return;
  placeholder?.surface.dispose();
  const surface = new OnlyPreviewDeferredTabSurface(host, foreground);
  placeholder = { host, surface };
  try {
    await surface.open();
  } catch (error) {
    if (placeholder?.surface === surface) placeholder = null;
    throw error;
  }
};

/**
 * composite 正在拆,但这一格要留下 —— `OnlyPreviewCoworkMount.destroyHost()` 落在这里。
 *
 * 不 await:调用点是 `destroyStandalone()` 那条同步拆卸链的一步,而占位页装不起来只该让这一格
 * 空着,不该把一次成功的拆卸变成异常。
 */
const deferTab = (host: MaestroCompositeTabHostApi): void => {
  if (live?.host !== host) return;
  live = null;
  void mountPlaceholder(host).catch((error) => {
    console.warn(
      `[onlypreview] event=deferred-tab phase=failed error=${(error as Error)?.message ?? String(error)}`
    );
  });
};

/**
 * `defer()` 之外逐字就是 maestro 给的那个 host。
 *
 * 展开而不是手抄一遍每个方法:那个 host 是一个对象字面量,方法都是不用 `this` 的箭头函数
 * (`maestroBrowserView.mountComposite` 里那一段),所以展开是安全的 —— 而手抄的副本会在下一次
 * 给 host api 加能力时静默漏掉它。
 */
const withDefer = (host: MaestroCompositeTabHostApi): OnlyPreviewCoworkTabDeps => ({
  ...host,
  defer: () => deferTab(host)
});

/** composite 真正装到这一格上。`spec.open` 与升格共用,所以两条路对「怎么挂」不可能有两种看法。 */
const mountComposite = async (host: MaestroCompositeTabHostApi): Promise<void> => {
  const next = new OnlyPreviewCoworkMount(withDefer(host));
  live = { host, mount: next };
  try {
    await onlyPreviewWindowHelper.openOnMount(next);
  } catch (error) {
    if (live?.mount === next) live = null;
    next.dispose();
    throw error;
  }
  next.reportActivation(foreground);
};

/**
 * 把占位页那一格**就地**升格成真正的 OnlyPreview —— 「关掉独立窗口就回到 tab」的落点。
 *
 * 条上没有占位页就返回 `false`,调用方据此走「新开一格」那条路,或者什么都不做(#6 的 G5:
 * 没有那一格就不升格)。升格成功之后占位页才被释放 —— 反过来的话中间有一瞬间这一格什么都不装。
 */
export const promoteOnlyPreviewCoworkTab = async (): Promise<boolean> => {
  const current = placeholder;
  if (!current) return false;
  await mountComposite(current.host);
  if (placeholder === current) placeholder = null;
  current.surface.dispose();
  return true;
};

export const registerOnlyPreviewCoworkTab = (): void => {
  registerMaestroCompositeTab({
    id: ONLY_PREVIEW_COWORK_TAB_ID,
    title: 'OnlyPreview',
    favicon: MAESTRO_ICON_ONLY_PREVIEW,
    displayUrl: MAESTRO_ONLY_PREVIEW_DISPLAY_URL,
    getDisplayedFile: () => {
      // 占位状态下**恒为 `null`** —— 这一格没有在显示任何文件。
      //
      // 真正的消费方是 `maestroBrowserView.service.ts` 的 `describeTabContent`(agent 面向的
      // `list_tabs` / 当前 tab 描述):返回 null 才不会告诉 agent「一个占位 tab 正在显示某个文件」。
      //
      // **不是**给工作区芯片路由用的 —— `isMountedOnCoworkTab()` 只看
      // `getMountKind(hostToken) === 'cowork'`,根本不读这个值;占位态下芯片之所以仍然路由到那个
      // 窗口,是因为 `getStandaloneHost()` 还指着 standalone 承载,与这里返回什么无关。
      // (这条理由第一版写错了,评审纠正;方案 #2 同步更正。)
      if (placeholder) return null;
      const host = onlyPreviewWindowHelper.getStandaloneHost();
      if (!live?.mount.isAlive() || !host || onlyPreviewWindowHelper.getMountKind(host.hostToken) !== 'cowork') return null;
      return onlyPreviewPreviewRegionService.displayedFilePath(host.hostToken);
    },
    // One bound workspace and one search runtime, so a second copy would be a second view of the
    // same thing — the closure below holds exactly one mount, which is that fact in code.
    singleton: true,
    // 没设过主页的机器,Cowork 的固有槽位装 OnlyPreview(Ral 2026-09-14)。声明在这里而不是写进
    // maestro 的默认设置:别名边界不许 maestro 认识任何一个具体 mini app,而「哪个是默认主页」
    // 和 `singleton` 一样是这个 mini app 自己的属性。见 docs/features/onlypreview-default-homepage.md。
    defaultHome: true,
    open: async (host) => {
      // 已经有一个活着的承载时**装占位页,不抛**(Ral 2026-09-17)。
      //
      // 原来这里是 `throw`:`openOnMount` 的复用分支不会 attach 这里新建的 mount,于是 `open`
      // 成功返回而这一格没有任何内容 —— 抛出去是为了让固有槽位那条路把这一发降级成内置本地
      // Home 并留 trace(onlypreview-default-homepage.md #4)。**取代它的理由**:OnlyPreview 成了
      // 默认主页之后那条降级变成一条日常路径 —— 主页槽位悄悄换成另一个页面,而且没有任何回到那个
      // 窗口的入口,Ral 2026-09-17 说的正是这个(同文档 #7 记了这次取代)。
      //
      // 现在这一格留在原地显示「已在独立窗口打开 ＋ 前往」,关掉那个窗口时就地升格回来。
      // #4 里「不 `show()`」那条理由**原样保留**并且更彻底了:提到前台现在完全由用户点「前往」触发。
      if (hasLiveOnlyPreviewHost()) {
        await mountPlaceholder(host);
        return;
      }
      await mountComposite(host);
    },
    close: (host) => {
      /**
       * 两边都要走完,**不能在占位分支里 `return`**。
       *
       * 升格进行中 `placeholder` 与 `live` 会短暂地**同时**指向同一个 host:
       * `promoteOnlyPreviewCoworkTab()` 先把 `live` 装上,然后 await `openOnMount(next)`
       * ——那是几百毫秒的建视图 ＋ 装 shell ＋ 起搜索运行时——占位页要到那之后才清。这个窗口里
       * 用户把 tab 关掉,旧写法命中占位分支就返回了:`live` 留着一个 tab 已经没了的 mount,
       * 而 composite 的「宿主没了」信号 `reportHostGone()` 与 `dispose()` 一个都不跑,teardown
       * 只能靠 `openOnMount` 自己那个 `requireReadySurface` 抛出来兜。
       *
       * 只有 OnlyPreview **不是**固有 tab 时够得到(pinned 的那一格 `closeTab` 本来就是静默 no-op)。
       */
      const closingPlaceholder = placeholder?.host === host ? placeholder : null;
      const closingLive = live?.host === host ? live : null;
      if (!closingPlaceholder && !closingLive) return;
      if (closingPlaceholder) {
        placeholder = null;
        closingPlaceholder.surface.dispose();
      }
      if (closingLive) {
        live = null;
        // The tab is already gone; this is what tells the composite its host went away, which is the
        // signal its own teardown listens on.
        closingLive.mount.reportHostGone();
        closingLive.mount.dispose();
      }
      foreground = false;
    },
    setActive: (host, active) => {
      if (placeholder?.host !== host && live?.host !== host) return;
      foreground = active;
      if (placeholder?.host === host) {
        placeholder.surface.setActive(active);
        return;
      }
      live?.mount.reportActivation(active);
    },
    refresh: (host) => {
      if (placeholder?.host === host) {
        placeholder.surface.refresh();
        return;
      }
      if (live?.host === host) live.mount.refresh();
    },
    // Only meaningful once `open` has run — Maestro calls this after the tab exists, so the
    // composite is already the live host and `ensureStandalone()` inside will resolve to it rather
    // than spawning a standalone window.
    //
    // 占位状态下照走同一条:那时活着的承载是那个独立窗口,`ensureStandalone()` 会解析到它 ——
    // 目标在它该在的地方打开,而不是被塞进一张纸里。
    openTarget: async (absolutePath) => {
      await openOnlyPreviewAbsoluteTarget(absolutePath);
    }
  });
};
