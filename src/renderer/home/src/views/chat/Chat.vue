<template>
  <div id="mainChat" class="bl-full-container chat">
    <ChatDetail @toggle-history="sessionStore.showHistory = true" />
    <a-drawer
      v-model:visible="sessionStore.showHistory"
      :width="300"
      placement="left"
      :header="false"
      :footer="false"
      unmount-on-close
      popup-container="#mainChat"
    >
      <ChatHistory />
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import ChatHistory from './components/ChatHistory/ChatHistory.vue';
import ChatDetail from './components/ChatDetail/ChatDetail.vue';
import { initMessageListeners } from './store/message.store';
import { loadSessions, sessionStore } from './store/session.store';

onMounted(async () => {
  initMessageListeners();
  await loadSessions();
});
</script>

<style lang="less">
@import './Chat.less';
</style>
