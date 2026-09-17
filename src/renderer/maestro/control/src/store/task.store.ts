import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import type { MaestroTask, MaestroTaskSnapshot } from '@maestro-shared/task.api'
import { messageStore } from './message.store'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

class TaskStoreState {
  tasks: MaestroTask[] = []
  initialized = false
  private subscribed = false
  private generation = 0
  private snapshotRevision = 0

  reset(): void {
    this.generation += 1
    this.tasks = []
    this.initialized = false
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    const generation = this.generation
    const revision = this.snapshotRevision
    if (!this.subscribed) {
      this.subscribed = true
      xpcRenderer.subscribe('coach/tasks', (payload) => {
        if (!this.initialized) return
        this.snapshotRevision += 1
        this.apply(payload.params as MaestroTaskSnapshot | undefined)
      })
    }
    try {
      const tasks = await coach.listTasks()
      // A newer broadcast may have arrived while listTasks was in flight. Never replace it with the
      // older query result; the broadcast already applied the authoritative snapshot.
      if (generation === this.generation && revision === this.snapshotRevision) this.apply({ tasks, ts: Date.now() })
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
