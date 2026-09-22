import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { MaestroSdk } from '@shared/maestroSdk.api';

/**
 * 宿主的刷新按钮落到 Zellij 身上时:**先问,再重载这一层渲染进程**(Ral 2026-09-22)。
 *
 * 为什么要问:这一格看着像一个网页,但它背后挂着一条活的 shell 会话。人按刷新时想的多半是「让这个
 * 界面重新来一遍」,而不是「把我正在跑的东西怎么样」—— 先说清楚代价,再动。
 *
 * 为什么重载的是**渲染进程**而不是终端:会话活在 Zellij 服务端,`location.reload()` 只是把这一层
 * chrome 重新挂一遍,重新连回去。会话、scrollback、正在跑的进程都不受影响,这也是确认文案里写的那句。
 *
 * 为什么 confirm 走 `MAESTROSDK` 而不是这一层自己画一个:终端是一张**原生 view,画在这一层之上**,
 * 页面里居中的 DOM 卡片会被它整块盖住。宿主那一层是唯一能画在操作区之上的对话框层。
 */
export const bindMaestroRefresh = (): (() => void) => {
  const sdk = (globalThis as { MAESTROSDK?: MaestroSdk }).MAESTROSDK;
  // 没有 SDK = 这一份 chrome 不是跑在宿主的 tab 里(独立 Zellij 窗口就是),那儿没有宿主刷新按钮。
  if (!sdk) return () => undefined;
  let asking = false;
  const off = sdk.onRefresh(() => {
    // 连点两下刷新只问一次:第二个对话框会被覆盖层按「已经有一个开着」拒掉,人看到的是第一次那个
    // 点了没反应。
    if (asking) return;
    asking = true;
    const text = i18nHelper.zellij;
    void sdk
      .confirm({
        title: text.refreshConfirmTitle,
        message: text.refreshConfirmMessage,
        confirmLabel: text.refreshConfirmOk,
        cancelLabel: text.refreshConfirmCancel
      })
      .then((confirmed) => {
        if (confirmed) window.location.reload();
      })
      .finally(() => {
        asking = false;
      });
  });
  return off;
};
