import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import {
  MAESTRO_TAB_ALIAS_MAX_LENGTH,
  MAESTRO_TAB_ALIAS_STATE_EVENT,
  type MaestroTabAliasDialog,
  type MaestroTabAliasXpcContract
} from '@maestro-shared/tabAlias.api'

const aliasDialog = createXpcRendererEmitter<MaestroTabAliasXpcContract>('MaestroTabAliasXpcHandler')

/**
 * 别名表单的控制器。**main 是唯一的真相源** —— 这里只拉快照、回答复,不自己记「有没有对话框」。
 *
 * 广播只带 revision,内容一律走 `snapshot()`:渲染进程可能在广播之后才挂载(view 是懒建的),
 * 两条路合成一条就不会出现「广播收到了但状态是旧的」。
 */
class TabAliasState {
  dialog: MaestroTabAliasDialog | null = null
  draft = ''
  /** 答复在飞 —— 两个按钮都禁用,同一个对话框不可能被答两次。 */
  busy = false
  readonly maxLength = MAESTRO_TAB_ALIAS_MAX_LENGTH
  /** 每次换到一个新对话框 +1,视图据此重新聚焦并全选输入框。 */
  focusRevision = 0

  async init(): Promise<void> {
    xpcRenderer.subscribe(MAESTRO_TAB_ALIAS_STATE_EVENT, () => void this.pull())
    await this.pull()
  }

  private async pull(): Promise<void> {
    const snapshot = await aliasDialog.snapshot().catch(() => null)
    const next = snapshot?.dialog ?? null
    const changed = next?.dialogId !== this.dialog?.dialogId
    this.dialog = next
    if (!changed) return
    this.draft = next?.alias ?? ''
    this.busy = false
    this.focusRevision += 1
  }

  updateDraft(value: string): void {
    // 在**写进状态之前**截断:chip 宽度是固定的,超长别名把整条挤变形,而 CSS 省略号只是让人
    // 看不见,宽度账已经算坏了。
    this.draft = value.slice(0, MAESTRO_TAB_ALIAS_MAX_LENGTH)
  }

  async confirm(): Promise<void> {
    const dialog = this.dialog
    if (!dialog || this.busy) return
    this.busy = true
    // 空串是**删除**别名,回到页面标题 —— 与取消是两件事,所以它也走 confirm。
    await aliasDialog.resolve({ dialogId: dialog.dialogId, outcome: 'confirm', value: this.draft.trim() })
  }

  async cancel(): Promise<void> {
    const dialog = this.dialog
    if (!dialog || this.busy) return
    this.busy = true
    await aliasDialog.resolve({ dialogId: dialog.dialogId, outcome: 'cancel' })
  }

  /** 返回是否已处理 —— 处理了的键由调用方 `preventDefault`。 */
  handleKey(event: { key: string; composing: boolean }): boolean {
    if (!this.dialog || event.composing) return false
    if (event.key === 'Escape') {
      void this.cancel()
      return true
    }
    if (event.key === 'Enter') {
      void this.confirm()
      return true
    }
    return false
  }
}

export const tabAliasStore = reactive<TabAliasState>(new TabAliasState())
