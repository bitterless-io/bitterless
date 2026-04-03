<template>
  <div class="chat-history">
    <SessionList @toggle-search="messageSearchStore.showSearch = true" />
    <MessageSearch v-model:visible="messageSearchStore.showSearch" />
  </div>
</template>

<script setup lang="ts">
import SessionList from '../SessionList/SessionList.vue';
import MessageSearch from '../MessageSearch/MessageSearch.vue';
import { messageSearchStore } from '../MessageSearch/messageSearch.store';
</script>

<style lang="less">
@import './ChatHistory.less';
</style>
