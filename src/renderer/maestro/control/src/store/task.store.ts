import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import type { MaestroTask, MaestroTaskSnapshot } from '@maestro-shared/task.api'
import { messageStore } from './message.store'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

class TaskStoreState {
  tasks: MaestroTask[] = []
  initialized = false

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe('coach/tasks', (payload) => {
      this.apply(payload.params as MaestroTaskSnapshot | undefined)
    })
    try {
      this.apply({ tasks: await coach.listTasks(), ts: Date.now() })
    } catch {
      /* Main may not be ready yet; the next snapshot broadcast self-heals the store. */
    }
  }

  get(taskId: string): MaestroTask | undefined {
    return this.tasks.find((task) => task.id === taskId)
  }

  private apply(snapshot?: MaestroTaskSnapshot): void {
    this.tasks = snapshot?.tasks || []
    messageStore.applyTaskSnapshot(this.tasks)
  }
}

export const taskStore = reactive<TaskStoreState>(new TaskStoreState())
