import { injectable } from 'inversify';
import { nextTick } from 'vue';
import { CommonService } from '../../../../../../shared/iocHelper/ioc.helper';
import type { MessageController } from './message.store';
import { messageEmitter } from '@/emitter/message.emitter';

const pageSize = 20;

export type LastAction = 'idle' | 'send' | 'scrollToTop' | 'scrollToBottom' | 'search'|'init';

@injectable()
export class MessageListService extends CommonService<MessageController> {
  isFirstPageLoaded = false;
  isBrowsingHistory = false;
  lastAction: LastAction = 'idle';
  hasMoreBefore = true;
  hasMoreAfter = true;
  loadingBefore = false;
  loadingAfter = false;
  hasNew = false;

  async loadPage(sessionId: string, options?: { msgId?: string; direction?: 1 | -1 }): Promise<void> {
    console.log('loadPage', sessionId, options);
    const { msgId, direction } = options ?? {};

    // ── Initial load: no msgId or no direction → load latest page and scroll to bottom ──
    if (!msgId || !direction) {
      this._state.showedMessageList = [];
      this._state.streamingContent = '';
      this._state.isStreaming = false;
      this._state.isResponding = false;
      this.hasMoreBefore = true;
      this.hasMoreAfter = true;
      this.isBrowsingHistory = false;
      this.lastAction = 'init';
      this.hasNew = false;

      const rows = await messageEmitter.getMessagesPaginated({ sessionId, limit: pageSize });
      if (Array.isArray(rows)) {
        this._state.showedMessageList = rows
          .sort((a, b) => a.id - b.id)
          .map((row) => ({
            id: row.id,
            sessionId,
            role: row.role as 'user' | 'assistant',
            content: row.content,
            createdAt: row.created_at,
          }));
      }
      this.isFirstPageLoaded = true;

      nextTick(() => {
        this.scrollToBottom()
      });
      return;
    }

    // ── direction: -1 → load page before msgId ──
    if (direction === -1) {
      if (this.loadingBefore || !this.hasMoreBefore) return;
      if (this._state.showedMessageList.length === 0) return;
      const anchorMsg = this._state.showedMessageList.find((m) => m.id === msgId)
        ?? this._state.showedMessageList[0];
      if (!anchorMsg) return;

      this.loadingBefore = true;
      this.lastAction = 'scrollToTop';

      const el = this._state.getMessageListRef();
      const prevScrollHeight = el?.scrollHeight ?? 0;
      const prevScrollTop = el?.scrollTop ?? 0;

      try {
        const rows = await messageEmitter.getMessagesBefore({
          sessionId,
          beforeId: anchorMsg.id,
          limit: pageSize,
        });

        if (Array.isArray(rows) && rows.length > 0) {
          const newMessages = rows
            .sort((a, b) => a.id - b.id)
            .map((row) => ({
              id: row.id,
              sessionId,
              role: row.role as 'user' | 'assistant',
              content: row.content,
              createdAt: row.created_at,
            }));
          const existingIds = new Set(this._state.showedMessageList.map((m) => m.id));
          const uniqueNew = newMessages.filter((m) => !existingIds.has(m.id));
          this._state.showedMessageList.unshift(...uniqueNew);
          this._state.showedMessageList.sort((a, b) => a.id - b.id);
          this.hasMoreBefore = rows.length >= pageSize;

          nextTick(() => {
            if (el) {
              el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop;
            }
          });
        } else {
          this.hasMoreBefore = false;
        }
      } finally {
        this.loadingBefore = false;
      }
      return;
    }

    // ── direction: 1 → load page after msgId ──
    if (this.loadingAfter) return;
    if (this._state.isStreaming) {
      console.log('[loadPage] skip loadAfter during streaming');
      return;
    }
    if (this.lastAction === 'init') {
      this.lastAction = 'idle';
      return;
    }
    if (this._state.showedMessageList.length === 0) return;
    console.log('do load after');

    const anchorMsg = this._state.showedMessageList.find((m) => m.id === msgId)
      ?? this._state.showedMessageList[this._state.showedMessageList.length - 1];
    if (!anchorMsg) return;

    this.loadingAfter = true;
    this.lastAction = 'scrollToBottom';

    try {
      const rows = await messageEmitter.getMessagesAfter({
        sessionId,
        afterId: anchorMsg.id,
        limit: pageSize,
      });

      if (Array.isArray(rows) && rows.length > 0) {
        const newMessages = rows
          .sort((a, b) => a.id - b.id)
          .map((row) => ({
            id: row.id,
            sessionId,
            role: row.role as 'user' | 'assistant',
            content: row.content,
            createdAt: row.created_at,
          }));
        const existingIds = new Set(this._state.showedMessageList.map((m) => m.id));
        const uniqueNew = newMessages.filter((m) => !existingIds.has(m.id));
        this._state.showedMessageList.push(...uniqueNew);
        this._state.showedMessageList.sort((a, b) => a.id - b.id);
        if (rows.length < pageSize) {
          this.isFirstPageLoaded = true;
        }
        this.hasMoreAfter = rows.length >= pageSize;
      } else {
        this.isFirstPageLoaded = true;
        this.hasMoreAfter = false;
      }
    } finally {
      this.loadingAfter = false;
    }
  }

  async loadMessagesAround(sessionId: string, messageId: string): Promise<void> {
    console.log('loadMessagesAround', sessionId,messageId);
    this._state.showedMessageList = [];
    this._state.streamingContent = '';
    this._state.isStreaming = false;
    this._state.isResponding = false;
    this.isBrowsingHistory = true;
    this.lastAction = 'search';

    const rows = await messageEmitter.getMessagesAroundId({ sessionId, messageId, limit: 10 });
    if (Array.isArray(rows)) {
      this._state.showedMessageList = rows.map((row) => ({
        id: row.id,
        sessionId,
        role: row.role as 'user' | 'assistant',
        content: row.content,
        createdAt: row.created_at,
      }));
      this.hasMoreBefore = rows.length > 0;
      this.hasMoreAfter = rows.length > 0;
      this.isFirstPageLoaded = false;
    }
    nextTick(() => {
      setTimeout(() => {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    });


  }

  /**
   * Called before sending a message.
   * If isFirstPageLoaded is false, load the first page first and keep only that data.
   */
  async prepareForSend(sessionId: string): Promise<void> {
    if (this.isFirstPageLoaded) return;

    const rows = await messageEmitter.getMessagesPaginated({ sessionId, limit: pageSize });
    if (Array.isArray(rows)) {
      this._state.showedMessageList = rows
        .sort((a, b) => a.id - b.id)
        .map((row) => ({
          id: row.id,
          sessionId,
          role: row.role as 'user' | 'assistant',
          content: row.content,
          createdAt: row.created_at,
        }));
      this.isFirstPageLoaded = rows.length < pageSize;
      this.hasMoreBefore = true;
      this.hasMoreAfter = true;
    }
  }

  clear(): void {
    this._state.showedMessageList = [];
    this.isFirstPageLoaded = true;
    this.isBrowsingHistory = false;
    this.lastAction = 'idle';
    this.hasMoreBefore = true;
    this.hasMoreAfter = true;
    this.hasNew = false;
  }

  scrollToBottom(): void {
    const el = this._state.getMessageListRef();
    if (!el) return;
    nextTick(() => {
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight - el.clientHeight;
      }
    });
  }
}
