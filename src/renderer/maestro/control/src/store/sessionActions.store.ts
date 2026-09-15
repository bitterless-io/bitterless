import { h, nextTick, reactive } from 'vue'
import { Button, Message } from '@arco-design/web-vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { channelStore } from './channel.store'
import { messageStore } from './message.store'
import type { SessionUndoRecord } from './sessionActions.type'

const NOTICE_ID = 'maestro-session-archive'
const SESSION_PATH_NOTICE_ID = 'maestro-session-path'
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

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
  lastUndo: SessionUndoRecord | null = null
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

  async showMenu(sessionId: string): Promise<void> {
    try {
      const result = await coach.showSessionMenu({ sessionId })
      if (result.ok === false) throw new Error(result.error)
      if (!result.action) return
      Message.success({
        id: SESSION_PATH_NOTICE_ID, duration: 4500,
        content: result.action === 'copy' ? i18nHelper.maestroControl.chat.slashPathCopied : i18nHelper.maestroControl.chat.sessionDirectoryOpened
      })
    } catch (error) {
      Message.error({ id: SESSION_PATH_NOTICE_ID, duration: 6000, content: error instanceof Error ? error.message : String(error) })
    }
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.actions.then(action)
    this.actions = next.then(() => undefined, () => undefined)
    return next
  }

  async undoTextEdit(): Promise<void> {
    try {
      const result = await coach.editControlText({ action: 'undo' })
      if (!result.ok) throw new Error(result.error || i18nHelper.maestroControl.chat.undoFailed)
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error))
    }
  }

  rename(id: string, title: string): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        const session = await messageStore.loadPersistedSession(id)
        const value = title.trim()
        if (!session || !value) throw new Error('rename')
        if (value === session.title && session.detail.titleCustomized) return true
        const previous = { title: session.title, titleCustomized: session.detail.titleCustomized }
        if (!await messageStore.renameSession(id, value)) throw new Error('rename')
        this.lastUndo = { kind: 'rename', id, title: value, previous }
        this.showUndoNotice(i18nHelper.maestroControl.chat.sessionRenamed.replace('{title}', value))
        return true
      } catch {
        this.showError(i18nHelper.maestroControl.chat.renameFailed)
        return false
      }
    })
  }

  archive(id: string): Promise<void> {
    if (this.pendingIds.includes(id)) return Promise.resolve()
    this.pendingIds.push(id)
    return this.enqueue(async () => {
      try {
        const title = messageStore.sessionListItems.find((item) => item.id === id)?.title || 'Maestro'
        const wasCurrent = channelStore.activeSessionId === id
        if (!await messageStore.archive(id)) throw new Error('archive')
        this.lastUndo = { kind: 'archive', id, title }
        await channelStore.selectAfterArchive(id)
        if (wasCurrent) {
          await nextTick()
          const focusTarget = (this.historyVisible ? document.querySelector<HTMLElement>('[name="maestro__history-close"]') : null)
            || document.querySelector<HTMLElement>('[name="maestro__session-title-label"]')
          focusTarget?.focus()
        }
        this.showUndoNotice(i18nHelper.maestroControl.chat.sessionArchived.replace('{title}', title))
      } catch {
        this.showError(i18nHelper.maestroControl.chat.archiveFailed)
      } finally {
        this.pendingIds = this.pendingIds.filter((pending) => pending !== id)
      }
    })
  }

  undo(): Promise<void> {
    return this.enqueue(async () => {
      const record = this.lastUndo
      if (!record) return
      try {
        let content: string
        if (record.kind === 'archive') {
          if (!await messageStore.restore(record.id)) throw new Error('restore')
          await channelStore.selectMaestroHistorySession(record.id)
          content = i18nHelper.maestroControl.chat.sessionRestored.replace('{title}', record.title)
        } else {
          if (!await messageStore.renameSession(record.id, record.previous.title, Boolean(record.previous.titleCustomized))) throw new Error('rename')
          content = i18nHelper.maestroControl.chat.sessionTitleRestored.replace('{title}', record.previous.title)
        }
        if (this.lastUndo === record) {
          this.lastUndo = null
          Message.success({ id: NOTICE_ID, content, duration: 4500, resetOnHover: true })
        }
      } catch {
        this.showError(record.kind === 'archive' ? i18nHelper.maestroControl.chat.restoreFailed : i18nHelper.maestroControl.chat.renameFailed)
      }
    })
  }

  private showUndoNotice(content: string): void {
    Message.success({
      id: NOTICE_ID,
      duration: 4500,
      resetOnHover: true,
      content: () => h('span', { class: 'session-actions__notice' }, [
        h('span', content),
        h(Button, { type: 'text', size: 'mini', onClick: () => void this.undo() },
          { default: () => `${i18nHelper.maestroControl.chat.undoArchive} (${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'}Z)` })
      ])
    })
  }

  private showError(content: string): void {
    Message.error({ id: NOTICE_ID, content, duration: 4500, resetOnHover: true })
  }
}

export const sessionActions = reactive(new SessionActionsState())
