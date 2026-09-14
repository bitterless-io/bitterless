import type { WebContents } from 'electron'

export type BrowserNavigationAction = 'back' | 'forward' | 'reload' | 'where'

/** One native history action on an already-resolved WebContents; never consult foreground state. */
export async function navigateAgentBrowser(
  wc: WebContents,
  tabId: string,
  action: BrowserNavigationAction,
  timeoutMs = 15_000
): Promise<string> {
  const assertLive = (): void => {
    if (wc.isDestroyed()) throw new Error(`Tab ${tabId}: WebContents was destroyed.`)
    if (wc.isCrashed()) throw new Error(`Tab ${tabId}: renderer crashed.`)
  }
  const where = (): string => {
    assertLive()
    return JSON.stringify({
      ok: true, tab_id: tabId, action, url: wc.getURL(), title: wc.getTitle(),
      can_go_back: wc.navigationHistory.canGoBack(), can_go_forward: wc.navigationHistory.canGoForward()
    })
  }
  assertLive()
  if (action === 'where') return where()
  if (action === 'back' && !wc.navigationHistory.canGoBack()) throw new Error(`Tab ${tabId}: no back entry in this tab's history; no navigation occurred.`)
  if (action === 'forward' && !wc.navigationHistory.canGoForward()) throw new Error(`Tab ${tabId}: no forward entry in this tab's history; no navigation occurred.`)
  if (wc.isLoadingMainFrame()) throw new Error(`Tab ${tabId}: the page is still loading. Observe it again before navigating.`)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let started = false
    let committed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-start-navigation', onStart)
      wc.removeListener('did-finish-load', onLoad)
      wc.removeListener('did-navigate', onCommit)
      wc.removeListener('did-stop-loading', onStop)
      wc.removeListener('did-navigate-in-page', onSameDocument)
      wc.removeListener('did-fail-load', onFailure)
      wc.removeListener('render-process-gone', onCrash)
      wc.removeListener('destroyed', onDestroyed)
    }
    const finish = (error?: string): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(new Error(`Tab ${tabId}: ${action} navigation failed — ${error}`))
      else {
        try { assertLive(); resolve() } catch (cause) { reject(cause) }
      }
    }
    const onStart = (event: { isMainFrame: boolean }): void => { if (event.isMainFrame) started = true }
    const onLoad = (): void => { if (started) finish() }
    const onCommit = (): void => { committed = true }
    const onStop = (): void => { if (started && committed) finish() }
    const onSameDocument = (_event: unknown, _url: string, isMainFrame: boolean): void => { if (isMainFrame) finish() }
    const onFailure = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean): void => {
      if (isMainFrame) finish(`${description} (${code})`)
    }
    const onCrash = (_event: unknown, details: { reason: string }): void => finish(`renderer ${details.reason}`)
    const onDestroyed = (): void => finish('WebContents was destroyed')

    // Some history traversals emit completion synchronously, particularly same-document entries.
    wc.on('did-start-navigation', onStart)
    wc.on('did-finish-load', onLoad)
    wc.on('did-navigate', onCommit)
    wc.on('did-stop-loading', onStop)
    wc.on('did-navigate-in-page', onSameDocument)
    wc.on('did-fail-load', onFailure)
    wc.on('render-process-gone', onCrash)
    wc.on('destroyed', onDestroyed)
    timer = setTimeout(() => finish(`timed out after ${timeoutMs} ms; arrival was not confirmed`), timeoutMs)
    try {
      if (action === 'back') wc.navigationHistory.goBack()
      else if (action === 'forward') wc.navigationHistory.goForward()
      else wc.reload()
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error))
    }
  })
  return where()
}
