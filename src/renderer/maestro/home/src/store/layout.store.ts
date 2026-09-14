import { reactive } from 'vue'
import { xpcRenderer } from 'electron-xpc/renderer'

// Home owns Chat visibility and desired width. Its measured placeholder remains the single bounds
// authority; UI preferences live in renderer-local localStorage, not the encrypted config DB.
const KEY = 'coach.sidebarOpen'
const WIDTH_KEY = 'coach.sidebarWidth'

// Keep Maestro's default equal to Main's first-frame SIDEBAR_W; use Cowork's current drag limits.
export const DEFAULT_SIDEBAR_W = 480
export const MIN_SIDEBAR_W = 380
export const MAX_SIDEBAR_W = 480

const clampWidth = (value: number): number =>
  Math.round(Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, Number.isFinite(value) ? value : DEFAULT_SIDEBAR_W)))

class LayoutStore {
  // Read at module load (not in an onMounted init) so first render already reflects the saved
  // state — no open→collapse flash. Default open; only an explicit '0' starts collapsed.
  sidebarOpen = localStorage.getItem(KEY) !== '0'
  sidebarWidth = clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_SIDEBAR_W)
  sidebarResizing = false
  private initialized = false

  // The control panel lives in a separate renderer. Its header close button broadcasts here;
  // this store remains the single owner of the placeholder width and persisted preference.
  init(): void {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe('maestro/session-search', () => {
      if (!this.sidebarOpen) this.toggleSidebar()
    })
    xpcRenderer.subscribe('coach/sidebar-close', () => {
      this.closeSidebar()
    })
    xpcRenderer.subscribe('coach/sidebar-width', (payload) => {
      const params = payload.params as { width?: number; resizing?: boolean } | undefined
      this.setSidebarWidth(params?.width, params?.resizing)
    })
  }

  setSidebarWidth(width?: number, resizing?: boolean): void {
    if (typeof resizing === 'boolean') this.sidebarResizing = resizing
    if (typeof width === 'number') this.sidebarWidth = clampWidth(width)
    // A gesture can deliver many pointer moves; save only its settled width.
    if (resizing === false) localStorage.setItem(WIDTH_KEY, String(this.sidebarWidth))
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen
    localStorage.setItem(KEY, this.sidebarOpen ? '1' : '0')
  }

  closeSidebar(): void {
    if (!this.sidebarOpen) return
    this.sidebarOpen = false
    localStorage.setItem(KEY, '0')
  }
}

export const layoutStore = reactive<LayoutStore>(new LayoutStore())
