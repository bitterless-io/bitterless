// Persisted browser tabs (the home tab strip). The pinned bundled Home tab is always synthesized
// at boot and is NOT stored here — only the user's additional (non-pinned) tabs persist, so they
// reopen on the next launch. Reached from MAIN via createXpcMainEmitter<TabsApi>('TabsDao').
export interface SavedTab {
  url: string
  title: string
  favicon: string
  /** 0-based order in the strip (after the pinned tab). */
  position: number
  /**
   * Tab kind, for a row that is NOT a web page.
   *
   * A composite mini-app tab (`'zellij'`) has an empty `url` and is restored through its registered
   * spec instead. Absent/empty = an ordinary browser row, restored by URL as before.
   */
  kind?: string
  /**
   * The composite tab's identity, handed back verbatim on restore so the mini app returns to its
   * own state (a Zellij tab to its own session) rather than to whatever happens to be first.
   */
  instanceId?: string
  /**
   * The operator's own name for this tab (docs/features/tab-alias.md #4).
   *
   * Persisted beside `title` rather than inside it, for the same reason it is a separate field
   * everywhere else: `title` is rewritten by the page and by the restore path, so a name stored
   * there does not survive one navigation, let alone a restart.
   */
  alias?: string
}

export interface TabsApi {
  listAll(): Promise<SavedTab[]>
  // Replace the whole saved set (delete-then-insert in a transaction). Sent debounced whenever
  // tabs are opened/closed/navigated.
  replaceAll(params: { tabs: SavedTab[] }): Promise<{ ok: boolean }>
}
