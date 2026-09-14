import { registerMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  MAESTRO_ONLY_PREVIEW_DISPLAY_URL,
  MAESTRO_ONLY_PREVIEW_TAB_ID
} from '@maestro-shared/compositeTab.identity';
import { MAESTRO_ICON_ONLY_PREVIEW } from '@maestro-shared/compositeTabIcon';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { openOnlyPreviewAbsoluteTarget } from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { OnlyPreviewCoworkMount } from '@main/windows/onlyPreviewCoworkMount';

/**
 * Teach Cowork that OnlyPreview can live in one of its tabs.
 *
 * The glue lives here, on the Bitterless side, because only this side may know both halves: Maestro
 * offers a tab that carries a native view, OnlyPreview offers a composite that can be carried, and
 * `check:maestro`'s alias boundary forbids Maestro from reaching for the second. So the host
 * registers a spec and Maestro drives it without ever importing a mini app.
 *
 * One mount instance per open tab, held by the closure the spec builds — there is at most one, since
 * only one OnlyPreview content surface is live at a time.
 */
// Re-exported from maestro-shared so both halves name the tab the same thing exactly once.
export const ONLY_PREVIEW_COWORK_TAB_ID = MAESTRO_ONLY_PREVIEW_TAB_ID;

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

export const registerOnlyPreviewCoworkTab = (): void => {
  let mount: OnlyPreviewCoworkMount | null = null;
  registerMaestroCompositeTab({
    id: ONLY_PREVIEW_COWORK_TAB_ID,
    title: 'OnlyPreview',
    favicon: MAESTRO_ICON_ONLY_PREVIEW,
    displayUrl: MAESTRO_ONLY_PREVIEW_DISPLAY_URL,
    // One bound workspace and one search runtime, so a second copy would be a second view of the
    // same thing — the closure below holds exactly one mount, which is that fact in code.
    singleton: true,
    // 没设过主页的机器,Cowork 的固有槽位装 OnlyPreview(Ral 2026-09-14)。声明在这里而不是写进
    // maestro 的默认设置:别名边界不许 maestro 认识任何一个具体 mini app,而「哪个是默认主页」
    // 和 `singleton` 一样是这个 mini app 自己的属性。见 docs/features/onlypreview-default-homepage.md。
    defaultHome: true,
    open: async (host) => {
      // 已经有一个活着的承载时**拒绝**,而不是让 `openOnMount` 把那个 host 原样返回:那条复用分支
      // 不会 attach 这里新建的 mount,于是 `open` 成功返回而这一格没有任何内容 —— 用户看到一格
      // 空白,同时那个独立窗口被 `show()` 提到前台。抛出去之后,固有槽位那条路会把这一发降级成
      // 内置本地 Home 并留下 trace(onlypreview-default-homepage.md #4)。
      if (hasLiveOnlyPreviewHost()) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'OnlyPreview already has a live host.'
        );
      }
      const next = new OnlyPreviewCoworkMount(host);
      mount = next;
      try {
        await onlyPreviewWindowHelper.openOnMount(next);
      } catch (error) {
        if (mount === next) mount = null;
        next.dispose();
        throw error;
      }
    },
    close: () => {
      const current = mount;
      mount = null;
      // The tab is already gone; this is what tells the composite its host went away, which is the
      // signal its own teardown listens on.
      current?.reportHostGone();
      current?.dispose();
    },
    setActive: (_host, active) => mount?.reportActivation(active),
    refresh: () => mount?.refresh(),
    // Only meaningful once `open` has run — Maestro calls this after the tab exists, so the
    // composite is already the live host and `ensureStandalone()` inside will resolve to it rather
    // than spawning a standalone window.
    openTarget: async (absolutePath) => {
      await openOnlyPreviewAbsoluteTarget(absolutePath);
    }
  });
};
