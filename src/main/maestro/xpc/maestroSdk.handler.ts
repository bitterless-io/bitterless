import { XpcMainHandler } from 'electron-xpc/main'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import type { MaestroSdkConfirmCall, MaestroSdkXpcContract } from '@shared/maestroSdk.api'

/**
 * `MAESTROSDK` 的 mini-app ↔ main 通路。实例化即注册 `xpc:MaestroSdkXpcHandler/<method>`。
 *
 * **类名是契约的一部分**(`MAESTRO_SDK_XPC_HANDLER`),两仓必须一致 —— preload 那一份是逐字相同的,
 * 它按这个字符串找 main。
 *
 * 刷新那两个事件不走这里:它们是 main → mini-app 的广播,不需要回值。这里只有需要**答案**的调用。
 */
export class MaestroSdkXpcHandler extends XpcMainHandler implements MaestroSdkXpcContract {
  async confirm(params: MaestroSdkConfirmCall): Promise<boolean> {
    if (!params?.instanceId) return false
    return await maestroWindowHelper.requestSdkConfirm(params)
  }
}

export const maestroSdkXpcHandler = new MaestroSdkXpcHandler()
