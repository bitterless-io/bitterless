<template>
  <div ref="listRef" class="message-list">
    <MessageItem
      v-for="(msg, index) in messageStore.showedMessageList"
      :key="msg.id || `streaming-${index}`"
      :id="msg.id ? `msg-${msg.id}` : undefined"
      :ref="index === messageStore.showedMessageList.length - 1 ? 'lastMsgRef' : undefined"
      :role="msg.role"
      :content="msg.content.trim()"
      :is-last="index === lastUserMsgIndex && !messageStore.isStreaming"
      :is-streaming="!msg.id && msg.role === 'assistant' && messageStore.isStreaming"
      :highlight="msg.id === messageSearchStore.highlightMessageId"
      @recall="recallMessage(index)"
    />

    <div
      v-if="svc.hasNew || svc.isBrowsingHistory"
      class="message-list__scroll-bottom"
      :class="{ 'message-list__scroll-bottom--new': svc.hasNew }"
      :title="svc.hasNew ? i18nHelper.chat.newResponse : undefined"
      @click="svc.hasNew ? onClickNewResponse() : svc.scrollToBottom()"
    >
      <icon-to-bottom />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue';
import { useScroll } from '@vueuse/core';
import { IconRobot, IconToBottom } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { messageStore, recallMessage } from '../../store/message.store';
import { sessionStore } from '../../store/session.store';
import { messageSearchStore } from '../MessageSearch/messageSearch.store';
import MessageItem from '../MessageItem/MessageItem.vue';

const svc = computed(() => messageStore.messageListService);

const lastUserMsgIndex = computed(() => {
  const list = messageStore.showedMessageList;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'user') return i;
  }
  return -1;
});

const listRef = ref<HTMLElement | null>(null);
const lastMsgRef = ref<InstanceType<typeof MessageItem> | null>(null);
let lastMsgObserver: IntersectionObserver | null = null;

const setupLastMsgObserver = (): void => {
  if (lastMsgObserver) {
    lastMsgObserver.disconnect();
    lastMsgObserver = null;
  }
  if (!svc.value.hasNew) return;
  const el = (lastMsgRef.value as any)?.$el as HTMLElement | undefined;
  if (!el) return;
  lastMsgObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        svc.value.hasNew = false;
        lastMsgObserver?.disconnect();
        lastMsgObserver = null;
      }
    },
    { root: listRef.value, threshold: 0.8 }
  );
  lastMsgObserver.observe(el);
};

onMounted(() => {
  nextTick(() => messageStore.setMessageListRef(listRef.value));
});
onUnmounted(() => {
  messageStore.setMessageListRef(null);
  lastMsgObserver?.disconnect();
});

watch(
  () => svc.value.hasNew,
  (val) => {
    if (val) nextTick(() => setupLastMsgObserver());
  }
);

watch(
  () => messageStore.showedMessageList.length,
  () => {
    if (svc.value.hasNew) nextTick(() => setupLastMsgObserver());
  }
);

// ── New response button ──────────────────────────────────────────────────────
const onClickNewResponse = async (): Promise<void> => {
  const sessionId = sessionStore.currentSessionId;
  if (sessionId) {
    await messageStore.messageListService.loadPage(sessionId);
  }
  svc.value.hasNew = false;
};

// ── Auto scroll to bottom ────────────────────────────────────────────────────
// Trigger: showedMessageList length change or streamingContent change
// Condition: lastAction is 'send' or 'idle', isFirstPageLoaded=true, not isBrowsingHistory
const shouldAutoScroll = (): boolean => {
  const s = svc.value;
  if (s.lastAction === 'send') {
    return true;
  }
  if (s.lastAction === 'idle' && s.isFirstPageLoaded && !s.isBrowsingHistory) {
    return true;
  }
  return false;
};

watch(
  () => messageStore.showedMessageList.length,
  () => {
    if (shouldAutoScroll()) {
      console.log('scrollToBottom:showedMessageList.length');
      nextTick(() => svc.value.scrollToBottom());
    }
  }
);

watch(
  () => {
    const lastMsg = messageStore.showedMessageList[messageStore.showedMessageList.length - 1];
    return lastMsg?.content || '';
  },
  () => {
    if (shouldAutoScroll()) {
      console.log('scrollToBottom:lastMsg.content');
      nextTick(() => svc.value.scrollToBottom());
    }
  }
);

// ── Scroll handler ────────────────────────────────────────────────────────────
const SCROLL_GAP_TIME = 100;
let lastToTopTime = 0;
let lastToBottomTime = 0;

const onScrollToTop = async (): Promise<void> => {
  console.log('scrollToTop');
  const now = Date.now();
  if (now - lastToTopTime < SCROLL_GAP_TIME) return;
  lastToTopTime = now;
  console.log('onScrollToTop', lastToTopTime);

  if (!sessionStore.currentSessionId) return;
  const list = messageStore.showedMessageList;
  if (!list.length) return;
  const firstId = list[0].id;
  if (!firstId) return;
  await messageStore.messageListService.loadPage(sessionStore.currentSessionId, {
    msgId: firstId,
    direction: -1
  });
};

const onScrollToBottom = async (): Promise<void> => {
  console.log('onScrollToBottom');
  const now = Date.now();
  if (now - lastToBottomTime < SCROLL_GAP_TIME) return;
  lastToBottomTime = now;
  console.log('onScrollToBottom', lastToBottomTime);
  if (!sessionStore.currentSessionId) return;
  const list = messageStore.showedMessageList;
  if (!list.length) return;
  const lastId = list[list.length - 1].id;
  if (!lastId) return;
  await messageStore.messageListService.loadPage(sessionStore.currentSessionId, {
    msgId: lastId,
    direction: 1
  });
};

const onScroll = async (): Promise<void> => {
  if (!listRef.value) return;
  const { scrollTop, scrollHeight, clientHeight } = listRef.value;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  // Update isBrowsingHistory in service
  if (distanceFromBottom < 30) {
    svc.value.isBrowsingHistory = false;
  } else if (scrollTop < scrollHeight - clientHeight - 30) {
    svc.value.isBrowsingHistory = true;
  }

  if (scrollTop <= 60 && directions.top) {
    await onScrollToTop();
  }

  if (distanceFromBottom <= 60 && directions.bottom) {
    await onScrollToBottom();
  }
};

const { directions } = useScroll(listRef, { onScroll, behavior: 'smooth' });
</script>

<style lang="less">
@import './MessageList.less';
</style>
