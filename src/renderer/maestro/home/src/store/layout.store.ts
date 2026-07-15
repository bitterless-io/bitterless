import { reactive } from 'vue'

// Home-view layout prefs. Owns the right control/AI panel's visibility: MenuBar's header toggle
// flips `sidebarOpen`; Layout.vue binds the control placeholder's width to it (open → 480px,
// closed → 0) and its ResizeObserver reflows the native operation view to full width. The pref is
// a pure UI choice → persisted in renderer-local localStorage (NOT the encrypted config DB).
const KEY = 'coach.sidebarOpen'

class LayoutStore {
  // Read at module load (not in an onMounted init) so first render already reflects the saved
  // state — no open→collapse flash. Default open; only an explicit '0' starts collapsed.
  sidebarOpen = localStorage.getItem(KEY) !== '0'

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen
    localStorage.setItem(KEY, this.sidebarOpen ? '1' : '0')
  }
}

export const layoutStore = reactive<LayoutStore>(new LayoutStore())
