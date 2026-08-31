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
    let receivedBroadcast = false
    xpcRenderer.subscribe('coach/tasks', (payload) => {
      receivedBroadcast = true
      this.apply(payload.params as MaestroTaskSnapshot | undefined)
    })
    try {
      const tasks = await coach.listTasks()
      // A newer broadcast may have arrived while listTasks was in flight. Never replace it with the
      // older query result; the broadcast already applied the authoritative snapshot.
      if (!receivedBroadcast) this.apply({ tasks, ts: Date.now() })
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
