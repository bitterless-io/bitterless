<template>
  <div class="session-list">
    <div class="session-list__search-bar">
      <div class="session-list__search-input" @click="emit('toggle-search')">
        <icon-search class="session-list__search-icon" />
        <span class="session-list__search-placeholder">{{ i18nHelper.chat.searchPlaceholder }}</span>
      </div>
    </div>
    <div v-if="sessionStore.loading" class="session-list__loading">
      <a-spin size="small" />
    </div>
    <div v-else-if="sortedSessions.length === 0" class="session-list__empty">
      {{ i18nHelper.chat.noSessions || 'No sessions' }}
    </div>
    <div v-else class="session-list__content">
      <SessionItemComponent
        v-for="session in sortedSessions"
        :key="session.sessionId"
        :session="session"
        :is-active="session.sessionId === sessionStore.currentSessionId"
        @select="onSelectSession"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconSearch } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { sessionStore, selectSession, type SessionItem } from '../../store/session.store';
import { messageStore } from '../../store/message.store';
import SessionItemComponent from '../SessionItem/SessionItem.vue';

const emit = defineEmits<{
  'toggle-search': [];
}>();

const sortedSessions = computed(() => {
  const sessions = [...sessionStore.sessionList];
  return sessions.sort((a: SessionItem, b: SessionItem) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) {
      return new Date(b.pinnedAt || b.createdAt).getTime() - new Date(a.pinnedAt || a.createdAt).getTime();
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
});

const onSelectSession = async (sessionId: string): Promise<void> => {
  selectSession(sessionId);
  await messageStore.messageListService.loadPage(sessionId);
};
</script>

<style lang="less">
@import './SessionList.less';
</style>
