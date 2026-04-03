<template>
  <div class="chat-detail">
    <div class="chat-detail__header">
      <ChatHeader @toggle-history="emit('toggle-history')" @toggle-search="messageSearchStore.visible = true" @new-chat="onNewChat" />
    </div>
    <div class="chat-detail__list">
      <MessageList />
    </div>
    <div class="chat-detail__input">
      <MessageInput ref="messageInputRef" @sent="onSent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import ChatHeader from '../ChatHeader/ChatHeader.vue';
import MessageList from '../MessageList/MessageList.vue';
import MessageInput from '../MessageInput/MessageInput.vue';
import { sessionStore, createSession } from '../../store/session.store';
import { messageSearchStore } from '../MessageSearch/messageSearch.store';

const messageInputRef = ref<InstanceType<typeof MessageInput> | null>(null);

const emit = defineEmits<{
  'toggle-history': [];
}>();

const onSent = (): void => {
};

const onNewChat = async (): Promise<void> => {
  await createSession();
};

const focusInput = (): void => {
  nextTick(() => messageInputRef.value?.focus());
};

onMounted(() => {
  focusInput();
});

watch(() => sessionStore.currentSessionId, (id) => {
  if (id) focusInput();
});
</script>

<style lang="less">
@import './ChatDetail.less';
</style>
