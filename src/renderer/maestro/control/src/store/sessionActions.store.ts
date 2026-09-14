import { h, nextTick, reactive } from 'vue'
import { Button, Message } from '@arco-design/web-vue'
import { xpcRenderer } from 'electron-xpc/renderer'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { channelStore } from './channel.store'
import { messageStore } from './message.store'

const NOTICE_ID = 'maestro-session-archive'

export const matchesSessionTitle = (title: string, query: string): boolean => {
  const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase()
  const tokens = normalize(query).trim().split(/\s+/u).filter(Boolean)
  const normalizedTitle = normalize(title)
  return tokens.length > 0 && tokens.every((token) => normalizedTitle.includes(token))
}

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))

export class SessionActionsState {
  historyVisible = false
  searchVisible = false
  searchRevision = 0
  lastArchived: { id: string; title: string } | null = null
  pendingIds: string[] = []
  private initialized = false
  private actions: Promise<void> = Promise.resolve()

  init(): void {
    if (this.initialized) return
    this.initialized = true
    // XPC subscriptions live for the renderer lifetime; ChatPanel remounts when the session changes.
    xpcRenderer.subscribe('maestro/session-search', () => this.openSearch())
  }

  toggleHistory(): void {
    this.closeSearch()
    this.historyVisible = !this.historyVisible
  }

  openSearch(): void {
    this.historyVisible = false
    this.searchVisible = true
    this.searchRevision += 1
    void messageStore.refreshHistory()
  }

  closeSearch(): void {
    this.searchVisible = false
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.actions.then(action)
    this.actions = next.catch(() => undefined)
    return next
  }

  archive(id: string): Promise<void> {
    if (this.pendingIds.includes(id)) return Promise.resolve()
    this.pendingIds.push(id)
    return this.enqueue(async () => {
      try {
        const title = messageStore.sessionListItems.find((item) => item.id === id)?.title || 'Maestro'
        const wasCurrent = channelStore.activeSessionId === id
        if (!await messageStore.archive(id)) throw new Error('archive')
        this.lastArchived = { id, title }
        await channelStore.selectAfterArchive(id)
        if (wasCurrent) {
          await nextTick()
          const focusTarget = (this.historyVisible ? document.querySelector<HTMLElement>('[name="maestro__history-close"]') : null)
            || document.querySelector<HTMLElement>('[name="maestro__session-title-label"]')
          focusTarget?.focus()
        }
        this.showArchivedNotice(title)
      } catch {
        this.showError(i18nHelper.maestroControl.chat.archiveFailed)
      } finally {
        this.pendingIds = this.pendingIds.filter((pending) => pending !== id)
      }
    })
  }

  undoArchive(): Promise<void> {
    return this.enqueue(async () => {
      const archived = this.lastArchived
      if (!archived) return
      try {
        if (!await messageStore.restore(archived.id)) throw new Error('restore')
        this.lastArchived = null
        await channelStore.selectMaestroHistorySession(archived.id)
        Message.success({ id: NOTICE_ID, content: i18nHelper.maestroControl.chat.sessionRestored.replace('{title}', archived.title), duration: 4500, resetOnHover: true })
      } catch {
        this.showError(i18nHelper.maestroControl.chat.restoreFailed)
      }
    })
  }

  private showArchivedNotice(title: string): void {
    Message.success({
      id: NOTICE_ID,
      duration: 4500,
      resetOnHover: true,
      content: () => h('span', { class: 'session-actions__notice' }, [
        h('span', i18nHelper.maestroControl.chat.sessionArchived.replace('{title}', title)),
        h(Button, { type: 'text', size: 'mini', onClick: () => void this.undoArchive() },
          { default: () => `${i18nHelper.maestroControl.chat.undoArchive} (${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'}Z)` })
      ])
    })
  }

  private showError(content: string): void {
    Message.error({ id: NOTICE_ID, content, duration: 4500, resetOnHover: true })
  }
}

export const sessionActions = reactive(new SessionActionsState())
