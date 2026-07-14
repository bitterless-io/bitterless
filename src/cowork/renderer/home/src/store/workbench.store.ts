import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract, WorkbenchPane } from '@cowork-shared/coach.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

class WorkbenchStore {
  visible = false
  initialized = false

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe('coach/workbench-visibility', (payload) => {
      const params = payload.params as { visible?: boolean } | undefined
      this.visible = Boolean(params?.visible)
    })
    const state = await coach.getWorkbenchVisible()
    this.visible = state.visible
  }

  async toggle(): Promise<void> {
    const state = await coach.setWorkbenchVisible({ visible: !this.visible })
    this.visible = state.visible
  }

  async openPane(pane: WorkbenchPane): Promise<void> {
    const state = await coach.setWorkbenchVisible({ visible: true })
    this.visible = state.visible
    xpcRenderer.broadcast('coach/workbench-pane', { pane })
  }
}

export const workbenchStore = reactive<WorkbenchStore>(new WorkbenchStore())
