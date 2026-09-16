import { XpcMainHandler } from 'electron-xpc/main'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import { moduleLog } from '@main/logging/moduleLog'
import type {
  MaestroTabAliasSnapshot,
  MaestroTabAliasXpcContract
} from '@maestro-shared/tabAlias.api'

/** 与 main 侧覆盖层同一个 scope —— 这两行证明「渲染层确实在跟 main 说话」。 */
const tabAliasLog = moduleLog('tab-alias')

/**
 * 别名表单渲染进程 ↔ main。实例化即注册 `xpc:MaestroTabAliasXpcHandler/<method>`。
 *
 * 单独一个 handler 而不是并进 `CoachXpcHandler`:那个 handler 是 Home / Control / Workbench 的
 * 全量能力面,而这个覆盖层只该够得着两件事 —— 读当前对话框、答复它。
 */
export class MaestroTabAliasXpcHandler extends XpcMainHandler implements MaestroTabAliasXpcContract {
  async snapshot(): Promise<MaestroTabAliasSnapshot> {
    const snapshot = maestroWindowHelper.tabAliasSnapshot()
    tabAliasLog.info('snapshot pulled', { revision: snapshot.revision, open: Boolean(snapshot.dialog) })
    return snapshot
  }

  async resolve(params: {
    dialogId: string
    outcome: 'confirm' | 'cancel'
    value?: string
  }): Promise<void> {
    maestroWindowHelper.resolveTabAlias(params)
  }
}

export const maestroTabAliasXpcHandler = new MaestroTabAliasXpcHandler()
