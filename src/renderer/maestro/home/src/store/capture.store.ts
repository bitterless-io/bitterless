import { reactive } from 'vue'
import { Message } from '@arco-design/web-vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CaptureOptions, CoachXpcContract } from '@maestro-shared/coach.api'

// Capture state, surfaced in the tab strip as a read-only recording indicator.
// Main owns capture and broadcasts coach/capture-started + coach/capture-stopped; this store mirrors
// them so the indicator reflects capture state no matter which agent-owned flow toggled it.
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

class CaptureStore {
  recording = false
  snapshotting = false
  recordActions = true
  // Starting capture includes a writer handshake and multiple CDP round trips. Keep the retained
  // programmatic toggle capability single-flight so concurrent callers cannot restart a new trace.
  toggling = false

  init(): void {
    xpcRenderer.subscribe('coach/capture-started', () => {
      this.recording = true
    })
    xpcRenderer.subscribe('coach/capture-stopped', () => {
      this.recording = false
    })
    xpcRenderer.subscribe('coach/capture-options', (payload) => {
      this.applyOptions(payload.params as CaptureOptions)
    })
    void this.loadOptions()
    void this.syncState()
  }

  // Toggle capture. Main echoes the new state back via the broadcast above (→ all renderers),
  // and the call's return value sets it immediately for snappy feedback.
  async toggle(): Promise<void> {
    if (this.toggling) return
    this.toggling = true
    try {
      const result = this.recording ? await coach.stopCapture() : await coach.startCapture({})
      this.recording = result.capturing
    } finally {
      this.toggling = false
    }
  }

  async snapshot(): Promise<void> {
    if (!this.recording || this.snapshotting) return
    if (!this.recordActions) {
      Message.warning('Action capture is off')
      return
    }
    this.snapshotting = true
    try {
      const result = await coach.captureSnapshot()
      if (result.ok) Message.success(`Snapshot captured · ${result.nodeCount} elements`)
      else Message.error(result.error || 'Snapshot failed')
    } finally {
      this.snapshotting = false
    }
  }

  private async loadOptions(): Promise<void> {
    try {
      this.applyOptions(await coach.getCaptureOptions())
    } catch {
      /* main window not ready yet */
    }
  }

  private async syncState(): Promise<void> {
    try {
      const state = await coach.getCaptureState()
      this.recording = state.capturing
    } catch {
      /* main window not ready yet */
    }
  }

  private applyOptions(options: CaptureOptions): void {
    this.recordActions = options.recordActions
  }
}

export const captureStore = reactive<CaptureStore>(new CaptureStore())
