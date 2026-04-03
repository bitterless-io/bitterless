<template>
  <div class="chat-header">
    <div class="chat-header__left">
      <a-tooltip :content="searchTooltip" position="bl">
        <a-button type="text" size="small" @click="emit('toggle-search')">
          <template #icon>
            <icon-search />
          </template>
        </a-button>
      </a-tooltip>
      <a-button type="text" size="small" @click="emit('toggle-history')">
        <template #icon>
          <icon-menu />
        </template>
      </a-button>
      <a-button type="text" size="small" :disabled="!sessionStore.currentSessionId" @click="onNewChat">
        <template #icon>
          <icon-plus />
        </template>
      </a-button>
    </div>
    <div class="chat-header__title">
      {{ currentSession?.title || i18nHelper.chat.untitled }}
    </div>
    <div class="chat-header__right"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconMenu, IconPlus, IconSearch } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { currentSession, sessionStore, startNewSession } from '../../store/session.store';
import { messageStore } from '../../store/message.store';

const searchTooltip = computed(() =>
  navigator.platform.toUpperCase().includes('MAC')
    ? i18nHelper.chat.searchShortcutTipMac
    : i18nHelper.chat.searchShortcutTipWin
);

const emit = defineEmits<{
  'toggle-history': [];
  'toggle-search': [];
}>();

const onNewChat = (): void => {
  if (!sessionStore.currentSessionId) return;
  startNewSession();
  messageStore.showedMessageList = [];
  messageStore.streamingContent = '';
  messageStore.isStreaming = false;
  messageStore.isResponding = false;
};
</script>

<style lang="less">
@import './ChatHeader.less';
</style>
