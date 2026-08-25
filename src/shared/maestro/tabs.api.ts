// Persisted browser tabs (the home tab strip). The pinned bundled Home tab is always synthesized
// at boot and is NOT stored here — only the user's additional (non-pinned) tabs persist, so they
// reopen on the next launch. Reached from MAIN via createXpcMainEmitter<TabsApi>('TabsDao').
export interface SavedTab {
  url: string
  title: string
  favicon: string
  /** 0-based order in the strip (after the pinned tab). */
  position: number
}

export interface TabsApi {
  listAll(): Promise<SavedTab[]>
  // Replace the whole saved set (delete-then-insert in a transaction). Sent debounced whenever
  // tabs are opened/closed/navigated.
  replaceAll(params: { tabs: SavedTab[] }): Promise<{ ok: boolean }>
}
