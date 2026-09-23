import { reactive } from 'vue'
import { Message } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@shared/maestro/coach.api'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

/**
 * 聊天正文里文件链接的右键菜单。
 *
 * 只管**状态与动作**,`FileLinkContextMenu.vue` 只负责画。
 * 见 `docs/features/chat-file-link-context-menu.md`(与 micromeet-cowork 同一份契约)。
 */
export interface FileLinkMenuTarget {
  /** 已解码的本地绝对路径。菜单里复制出去的就是它。 */
  path: string
  x: number
  y: number
}

class FileLinkMenuState {
  menu: FileLinkMenuTarget | null = null

  /** 返回是否真的接管了这次右击;拿不到路径就返回 false,让默认菜单照常出。 */
  open(path: string, x: number, y: number): boolean {
    const target = String(path || '').trim()
    if (!target) return false
    this.menu = { path: target, x, y }
    return true
  }

  close(): void {
    this.menu = null
  }

  /**
   * 复制路径。**走 main** —— 打包后 renderer 在 `file://` 下,`navigator.clipboard` 不可靠。
   * 失败要说出来:一次无声的失败与一次成功在界面上长得一模一样。
   */
  async copyPath(): Promise<void> {
    const path = this.menu?.path
    this.close()
    if (!path) return
    const result = await coach.copyText({ text: path }).catch(() => null)
    if (result?.ok) Message.success(i18nHelper.maestroControl.chat.pathCopied)
    else Message.error(i18nHelper.maestroControl.chat.pathCopyFailed)
  }
}

export const fileLinkMenuStore = reactive<FileLinkMenuState>(new FileLinkMenuState())
