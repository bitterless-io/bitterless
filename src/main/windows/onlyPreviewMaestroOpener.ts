import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { OnlyPreviewFileTabSurface } from '@main/windows/onlyPreviewFileTab.service';

import { registerMaestroPreviewOpener } from '@maestro-main/windows/main/previewOpener.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
import { clearOnlyPreviewWorkspace } from '@main/miniapps/onlypreview/onlyPreviewClearWorkspace.service';
import { registerOnlyPreviewDisplayUrlSink } from '@main/miniapps/onlypreview/onlyPreviewDisplayUrl.registry';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { resolveLocalPathTarget } from '@main/windows/onlyPreviewLocalPathTarget';
import {
  peekOnlyPreviewHostMount,
  readOnlyPreviewHostMount
} from '@main/miniapps/onlypreview/onlyPreviewHostMount.service';
import { openRegisteredOnlyPreviewExplicitTarget } from '@main/miniapps/onlypreview/onlyPreviewExplicitTarget.registry';

/**
 * Make OnlyPreview the application Cowork's workspace tools show files in.
 *
 * Registered from the host side because only this side may know both halves — Maestro offers the
 * slot, OnlyPreview fills it — and because `openRegisteredOnlyPreviewExplicitTarget` is the seam
 * that already exists for exactly this: a one-slot indirection so another subsystem can open a
 * preview target without importing the window helper. EyesOnAgents already uses it.
 *
 * The target may be a directory or a file. The explicit-open route handles both: it inspects the
 * target, authorizes it, and opens the Project rooted at the directory — selecting the file when the
 * target was one.
 */
/**
 * 当前承载是不是 Cowork 的那个 composite tab。
 *
 * `getMountKind` 在挂载已经不活着时**抛** —— 那种竞态下(tab 刚关掉)当成「不是 tab」处理:
 * 落到窗口那一支去,`ensureStandalone()` 会造一个新的,这比让芯片报错好。
 */
const isMountedOnCoworkTab = (hostToken: string): boolean => {
  try {
    return onlyPreviewWindowHelper.getMountKind(hostToken) === 'cowork';
  } catch {
    return false;
  }
};

export const registerOnlyPreviewMaestroOpener = (): void => {
  // 地址栏跟着预览走(Ral 2026-09-10:「只要看起来像真实浏览器就好」)。
  //
  // 填在这里,因为这是宿主把「OnlyPreview」和「maestro 的 tab」接起来的那一处 —— 算 URL 要问
  // 注册表,而把它显示到哪里只有宿主知道。独立窗口那一支最终落到一个**空操作**(窗口没有地址栏),
  // 所以这里不必分情况。
  registerOnlyPreviewDisplayUrlSink((hostToken) => {
    onlyPreviewWindowHelper.reportDisplayUrl(
      hostToken,
      onlyPreviewWorkspaceRegistry.describeDisplayUrl(hostToken)
    );
  });
  registerMaestroPreviewOpener({
    displayName: 'OnlyPreview',
    openInTab: openOnlyPreviewOsTarget,
    createFileTabSpec: (absolutePath) => {
      let surface: OnlyPreviewFileTabSurface | null = null;
      return {
        id: 'file',
        title: basename(absolutePath),
        favicon: '',
        displayUrl: pathToFileURL(absolutePath).href,
        open: async (host) => {
          const window = host.window();
          if (!window) throw new Error('The file preview window is unavailable.');
          surface = new OnlyPreviewFileTabSurface({
            window,
            path: absolutePath,
            isOpen: () => host.isOpen(),
            bounds: () => {
              const bounds = host.contentRect();
              if (!bounds) throw new Error('The file preview tab has no content bounds.');
              return bounds;
            },
            attach: (container) => host.attach(container)
          });
          await surface.open();
        },
        close: () => { surface?.dispose(); surface = null; },
        setActive: (_host, active) => surface?.setActive(active),
        refresh: () => surface?.refresh()
      };
    },
    open: async (absolutePath: string) => {
      // **承载已经存在、只是它现在是一个窗口时,不要再建 tab。**
      //
      // OnlyPreview 被顶栏那个按钮切成独立窗口之后,那个 composite tab 就没了 —— 于是
      // `openWorkspaceInPreview` 里的 `openCompositeTab` 会**新建**一个,结果是同时存在两个
      // OnlyPreview(Ral 2026-09-09 报的就是这个)。`openRegisteredOnlyPreviewExplicitTarget`
      // 下游的 `ensureStandalone()` 本来就会返回已有 host 并把它摆到前台。
      //
      // 判断只能落在**宿主侧**:maestro 那棵树不许 import OnlyPreview(`check:maestro` 的别名边界,
      // `onlyPreviewCoworkTab.ts` 顶部说明了为什么胶水住在这里),所以 `openCompositeTabTarget`
      // 里问不了 `getStandaloneHost()`。
      // 详见 `docs/issues/onlypreview-detached-window-gets-a-second-tab.md`。
      const mountedHost = onlyPreviewWindowHelper.getStandaloneHost();
      if (mountedHost) {
        // 承载已经存在 —— 但**它是 tab 还是窗口,决定了怎么把它摆到前台**。
        //
        // tab 那一支必须走 maestro 自己的 `activateTab`(`openCompositeTabTarget` 里那一步)。
        // 原来这里两种情况都交给 `openRegisteredOnlyPreviewExplicitTarget`,靠它下游的
        // `ensureStandalone()` → `show()` 去激活;而 `show()` 是
        // `this.standaloneMount?.showSurface()` —— **末端一个 `?.`**,挂载对象不在时它静默什么都不做,
        // 和成功完全一样。目录那一支在「打开的就是当前项目根」时(点芯片最常见的那次)`show()` 是
        // 唯一发生的事,所以那一次的整个可见效果都押在这一条委派链上。
        // Ral 2026-09-10 报的就是它:「tab 中打开时点 workspace 按钮应该激活这个 tab,现在不行」。
        //
        // 换成显式的:tab 就让**知道 tab id 的那一侧**去激活。少四层委派,也不再有能被 `?.` 吞掉的
        // 无操作。窗口那一支保持原样 —— 它本来就是对的。
        if (isMountedOnCoworkTab(mountedHost.hostToken)) {
          const result = await maestroWindowHelper.openWorkspaceInPreview({ path: absolutePath });
          if (!result.ok) throw new Error(result.error || 'OnlyPreview could not open that path.');
          return;
        }
        await openRegisteredOnlyPreviewExplicitTarget(absolutePath);
        return;
      }
      // 没有承载 → **按上次那一种开**(Ral 2026-09-09:「上次 tab 下次也 tab,上次窗口下次也窗口」)。
      //
      // 先看同步那一份:预热过就**不 await**。这条路上多插一次存储读会让芯片像卡住,
      // 所以带就绪等待的读只在启动预热里做(`hydrateOnlyPreviewHostMount`)。
      //
      // 窗口那一支不用自己建窗口:`openRegisteredOnlyPreviewExplicitTarget` 下游的
      // `ensureStandalone()` 没有 host 时就会造一个,而它造出来的窗口会从 `windowStateService` 的
      // `'onlypreview'` 键恢复上次的尺寸/位置/所在屏幕 —— 也就是他要的「复用上次的位置」。
      const mount = peekOnlyPreviewHostMount() ?? (await readOnlyPreviewHostMount());
      if (mount === 'window') {
        await openRegisteredOnlyPreviewExplicitTarget(absolutePath);
        return;
      }
      // tab 那一支:开 tab 再交目标。**那个顺序是承重的**,理由写在
      // `maestroBrowserView.openCompositeTabTarget` 上,所以这里调它而不是自己拼一遍。
      const result = await maestroWindowHelper.openWorkspaceInPreview({ path: absolutePath });
      if (!result.ok) throw new Error(result.error || 'OnlyPreview could not open that path.');
    },
    /**
     * 会话不再用这个工作区时只解除匹配的 Project 绑定,保留当前 OnlyPreview tab/窗口。
     *
     * 比对是在**真实路径**上做的,两边都经过 `realpath`:芯片给的是人选的那一串,而绑定时存的是
     * `inspectTarget` 产出的 `rootRealPath` —— 不统一的话,一个软链拼法或 macOS 的
     * `/tmp` vs `/private/tmp` 就会比不上。最终匹配与解绑在同一目标变更 FIFO 中进行。
     */
    closeForPath: async (absolutePath: string) => {
      const host = onlyPreviewWindowHelper.getStandaloneHost();
      if (!host) return;
      const rootRealPath = await realpath(absolutePath).catch(() => absolutePath);
      await clearOnlyPreviewWorkspace(host.hostToken, rootRealPath);
    },
    /**
     * 地址栏那一串是不是一条本机文件路径,以及该怎么落。
     *
     * **判据留在宿主侧**:什么算绝对路径、哪些格式普通 tab 自己渲染得了,都是 OnlyPreview 的知识,
     * 而 `check:maestro` 的别名边界禁止 maestro 去拿它。曾经有一版是 maestro 直接 import 那两个
     * 模块 —— 断言拦下了它,而且那些 import 还把宿主整棵 onlypreview 子树拖进了 maestro 的测试打包。
     */
    resolveLocalTarget: (input: string) => resolveLocalPathTarget(input)
  });
};

/** OS regular files always receive a fresh tab; directories retain the existing Project route. */
export const openOnlyPreviewOsTarget = async (
  absolutePath: string,
  options: { tabId?: string } = {}
): Promise<void> => {
  const inspected = await fileSearchWindowService.inspectTarget(absolutePath);
  if (!inspected.selectedRelativePath) {
    await openRegisteredOnlyPreviewExplicitTarget(absolutePath);
    return;
  }
  await maestroWindowHelper.openFilePreviewTab({ path: absolutePath, ...options });
};
