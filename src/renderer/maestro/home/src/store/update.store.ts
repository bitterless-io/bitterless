import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract, UpdateInfo } from '@maestro-shared/coach.api'

// Reuse the home renderer's existing coach emitter (do NOT create a new handler).
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

const parseUpdateInfo = (value: unknown): UpdateInfo | null => {
  if (typeof value !== 'object' || value === null) return null

  const candidate = value as Partial<Record<keyof UpdateInfo, unknown>>
  if (
    typeof candidate.version !== 'string' ||
    typeof candidate.versionCode !== 'string'
  ) {
    return null
  }

  return { version: candidate.version, versionCode: candidate.versionCode }
}

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
  info: UpdateInfo | null = null
  private initialized = false
  private liveStateReceived = false

  init(): void {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe('coach/update-available', (payload) => {
      const info = parseUpdateInfo(payload.params)
      if (!info) {
        console.error('[MaestroUpdateStore] Ignoring malformed update-available payload:', payload.params)
        return
      }

      this.liveStateReceived = true
      this.info = info
      this.downloading = true
      this.ready = true
    })
    xpcRenderer.subscribe('coach/update-downloaded', (payload) => {
      const info = parseUpdateInfo(payload.params)
      if (!info) {
        console.error('[MaestroUpdateStore] Ignoring malformed update-downloaded payload:', payload.params)
        return
      }

      this.liveStateReceived = true
      this.info = info
      this.downloading = false
      this.ready = true
    })
    this.requestReadyUpdate()
  }

  private requestReadyUpdate(): void {
    try {
      const readyUpdateRequest = coach.getReadyUpdate()
      void readyUpdateRequest
        .then((snapshot: unknown) => {
          if (snapshot === null) return

          const info = parseUpdateInfo(snapshot)
          if (!info) {
            console.error('[MaestroUpdateStore] Ignoring malformed update-ready snapshot:', snapshot)
            return
          }
          if (this.liveStateReceived) return

          this.info = info
          this.downloading = false
          this.ready = true
        })
        .catch((error: unknown) => {
          console.error('[MaestroUpdateStore] Failed to replay update-ready snapshot:', error)
        })
    } catch (error) {
      console.error('[MaestroUpdateStore] Failed to request update-ready snapshot:', error)
    }
  }

  async install(): Promise<void> {
    await coach.quitAndInstall()
  }
}

export const updateStore = reactive<UpdateState>(new UpdateState())
