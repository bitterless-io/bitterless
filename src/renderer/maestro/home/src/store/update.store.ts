import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'

// Reuse the home renderer's existing coach emitter (do NOT create a new handler).
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

/**
 * Controller for the header Update button (see docs/features/desktop-auto-update.md).
 *
 * Silent background download: UpdateService (main) broadcasts update-available after both the
 * versionCode and platform-updater gates confirm availability, then downloads in the background.
 * The button shows disabled "Updating" while downloading and switches to enabled "Update" when
 * 'coach/update-downloaded' arrives.
 */
class UpdateState {
  /** True once update UI should show (downloading or ready). */
  ready = false
  /** True while the newer build is being downloaded. */
  downloading = false
  /** The found or ready build's version/versionCode. */
  info: { version: string; versionCode: string } | null = null
  private initialized = false

  init(): void {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe('coach/update-available', (payload) => {
      this.info = payload.params as { version: string; versionCode: string }
      this.downloading = true
      this.ready = true
    })
    xpcRenderer.subscribe('coach/update-downloaded', (payload) => {
      this.info = payload.params as { version: string; versionCode: string }
      this.downloading = false
      this.ready = true
    })
  }

  async install(): Promise<void> {
    await coach.quitAndInstall()
  }
}

export const updateStore = reactive<UpdateState>(new UpdateState())
