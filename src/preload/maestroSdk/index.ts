import { contextBridge } from 'electron';
import { createXpcPreloadEmitter, xpcRenderer } from 'electron-xpc/preload';
import {
  MAESTRO_SDK_REFRESH_EVENT,
  MAESTRO_SDK_XPC_HANDLER,
  readMaestroSdkInstanceId,
  type MaestroSdk,
  type MaestroSdkConfirmRequest,
  type MaestroSdkRefreshBroadcast,
  type MaestroSdkXpcContract
} from '@shared/maestroSdk.api';

/**
 * 把 `MAESTROSDK` 注入 mini-app 的渲染进程。
 *
 * **这份文件在 bitterless 与 micromeet-cowork 两仓逐字相同**(`@shared/maestroSdk.api` 也是)。
 * 用法是**一行副作用 import**,与 `import 'electron-xpc/preload'` 同一种 —— 而不是让每个 mini-app
 * 自己 `exposeInMainWorld` 一遍。理由是纪律成本:一张「每个 surface 都要记得做一次」的名单在本仓
 * 已经漏过两次,代价是整扇窗被关掉。一行 import 漏了,只是**它自己**没有 SDK,不会波及别人。
 *
 * ```ts
 * import 'electron-xpc/preload'
 * import '@preload/maestroSdk'
 * ```
 */

/** 这个 view 属于哪个 tab。`null` = 建这个 view 时没摊身份参数。 */
const instanceId = readMaestroSdkInstanceId(process.argv);

const host = createXpcPreloadEmitter<MaestroSdkXpcContract>(MAESTRO_SDK_XPC_HANDLER);

type Handler = () => void;
const before = new Set<Handler>();
const onRefresh = new Set<Handler>();

/**
 * 一个 handler 抛异常不许拖垮其余的。
 *
 * 这一组回调是**别人的代码**:一个 mini-app 的 bug 不该让同一 phase 里另一个 handler 收不到,更不该
 * 让下一个 phase 断掉。
 */
const run = (handlers: Set<Handler>, phase: string): void => {
  for (const handler of [...handlers]) {
    try {
      handler();
    } catch (error) {
      console.error(`[maestro-sdk] ${phase} handler failed:`, error);
    }
  }
};

xpcRenderer.subscribe(MAESTRO_SDK_REFRESH_EVENT, (payload) => {
  const params = payload?.params as MaestroSdkRefreshBroadcast | undefined;
  // **广播是发给所有订阅者的**,所以过滤是这一层的职责,不是 main 的:`electron-xpc` 的
  // `handleName → webContentsId` 注册表一个名字只有一个主人,N 个 mini-app 没法各占一个点对点通道。
  if (!params || !instanceId || params.instanceId !== instanceId) return;
  if (params.phase === 'before') run(before, 'beforeRefresh');
  else if (params.phase === 'refresh') run(onRefresh, 'onRefresh');
});

const register = (handlers: Set<Handler>, handler: Handler): (() => void) => {
  if (typeof handler !== 'function') return () => undefined;
  handlers.add(handler);
  // 返回取消口,而不是只给注册:mini-app 的组件会挂载/卸载多次,没有取消口第二次挂载就双跑。
  return () => {
    handlers.delete(handler);
  };
};

const sdk: MaestroSdk = {
  beforeRefresh: (handler) => register(before, handler),
  onRefresh: (handler) => register(onRefresh, handler),
  confirm: async (request: MaestroSdkConfirmRequest) => {
    // 没有身份就没法问:main 认不出是哪个 tab 在问,也就无从判断它是不是前台。答 `false` 而不是抛 ——
    // 调用方的代码形状是 `if (await confirm(...))`,抛出去只会变成一条没人接的 rejection。
    if (!instanceId) {
      console.error('[maestro-sdk] confirm ignored: this view has no instance id');
      return false;
    }
    if (!request || typeof request.title !== 'string' || typeof request.message !== 'string') {
      console.error('[maestro-sdk] confirm ignored: title and message are required');
      return false;
    }
    return await host
      .confirm({
        instanceId,
        title: request.title,
        message: request.message,
        ...(request.confirmLabel ? { confirmLabel: request.confirmLabel } : {}),
        ...(request.cancelLabel ? { cancelLabel: request.cancelLabel } : {})
      })
      .catch((error) => {
        // 通路本身断了(main 侧 handler 没起来 / 窗口正在拆)。同样答「没确认」。
        console.error('[maestro-sdk] confirm failed:', error);
        return false;
      });
  }
};

contextBridge.exposeInMainWorld('MAESTROSDK', sdk);
