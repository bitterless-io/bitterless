/**
 * `await timerHelper.delay(500)` —— 用 async/await 写出同步语法的 sleep(Ral 2026-09-24)。
 *
 * 放 `shared/`:主进程(`ui_act` 的等待)与渲染进程都 import 得到(`@shared/*` 两份 tsconfig 都有)。
 * 负数与 NaN 当 0。
 *
 * 可选的 `signal`:到时或被中止都 resolve,**不抛错** —— 是哪一种由调用方看 `signal.aborted`;
 * 已经中止的立刻 resolve。中止时顺手清掉计时器，不留一个悬着的定时器。内置 `wait` 工具靠它在
 * 人停掉这一轮时立刻返回(docs/features/builtin-wait-tool.md #2)。
 */
const delay = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      ms > 0 ? ms : 0
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

export const timerHelper = {
  delay
};
