import { reactive } from 'vue';
import router from '@/router';
import { messageEmitter } from '@/emitter/message.emitter';
import { sessionStore } from '../../store/session.store';
import { messageStore } from '../../store/message.store';

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  search_text: string;
  platform: string;
  created_at: number;
}

interface SearchResultItem extends MessageRow {
  snippet: string;
}

class MessageSearchStore {
  visible = false;
  showSearch = false;
  highlightMessageId: string | null = null;
  keyword = '';
  results: SearchResultItem[] = [];
  loading = false;
  currentPage = 1;
  pageSize = 20;
  hasMore = true;
}

export const messageSearchStore = reactive<MessageSearchStore>(new MessageSearchStore());


export const handleSearch = async (): Promise<void> => {
  if (!messageSearchStore.keyword.trim()) {
    messageSearchStore.results = [];
    messageSearchStore.hasMore = true;
    messageSearchStore.currentPage = 1;
    return;
  }

  messageSearchStore.loading = true;
  messageSearchStore.currentPage = 1;

  const data = await messageEmitter.search({
    keyword: messageSearchStore.keyword,
    page: messageSearchStore.currentPage,
    pageSize: messageSearchStore.pageSize,
  });

  messageSearchStore.results = (data || []).map((row) => ({
    ...row,
    snippet: row.search_text,
  }));

  messageSearchStore.hasMore = data.length >= messageSearchStore.pageSize;
  messageSearchStore.loading = false;
};

export const loadMore = async (): Promise<void> => {
  if (messageSearchStore.loading || !messageSearchStore.hasMore) return;

  messageSearchStore.loading = true;
  messageSearchStore.currentPage++;

  const data = await messageEmitter.search({
    keyword: messageSearchStore.keyword,
    page: messageSearchStore.currentPage,
    pageSize: messageSearchStore.pageSize,
  });

  const newResults = (data || []).map((row) => ({
    ...row,
    snippet: row.search_text,
  }));

  messageSearchStore.results.push(...newResults);
  messageSearchStore.hasMore = data.length >= messageSearchStore.pageSize;
  messageSearchStore.loading = false;
};

const scrollToMessageCenter = (messageId: string): void => {
  const el = document.getElementById(`msg-${messageId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

export const handleMessageClick = async (msg: MessageRow): Promise<void> => {
  if (router.currentRoute.value.name !== 'chat') {
    await router.push({ name: 'chat' });
  }

  sessionStore.currentSessionId = msg.session_id;

  const alreadyLoaded = messageStore.showedMessageList.some((m) => m.id === msg.id);
  if (alreadyLoaded) {
    scrollToMessageCenter(msg.id);
  } else {
    await messageStore.messageListService.loadMessagesAround(msg.session_id, msg.id);
  }

  messageSearchStore.visible = false;
  messageSearchStore.showSearch = false;
  messageSearchStore.highlightMessageId = msg.id;
  setTimeout(() => {
    messageSearchStore.highlightMessageId = null;
  }, 1900);

  messageStore.focusMessageInput();
};

export const handleClose = (): void => {
  messageSearchStore.keyword = '';
  messageSearchStore.results = [];
  messageSearchStore.currentPage = 1;
  messageSearchStore.hasMore = true;
};

const isMac = navigator.platform.toUpperCase().includes('MAC');

const onKeydown = (e: KeyboardEvent): void => {
  const matchMac = isMac && e.metaKey && e.key === 'f';
  const matchWin = !isMac && e.altKey && e.key === 'f';
  if (matchMac || matchWin) {
    e.preventDefault();
    messageSearchStore.visible = true;
  }
};

export const initSearchShortcut = (): void => {
  window.addEventListener('keydown', onKeydown);
};

export const destroySearchShortcut = (): void => {
  window.removeEventListener('keydown', onKeydown);
};
