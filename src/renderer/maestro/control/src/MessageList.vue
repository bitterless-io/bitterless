<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import MessageItem from './MessageItem.vue'
import { messageStore } from './store/message.store'
import type { ChatMessage } from './store/message.type'
import './MessageList.less'

defineProps<{ messages: ChatMessage[] }>()
const emit = defineEmits<{ containerReady: [el: HTMLElement | null] }>()

const containerRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

onMounted(() => {
  messageStore.setListEl(listRef.value)
  emit('containerReady', containerRef.value)
})
onUnmounted(() => {
  messageStore.setListEl(null)
  emit('containerReady', null)
})
</script>

<template>
  <div ref="containerRef" class="message-list">
    <div ref="listRef" class="message-list__scroll" @scroll.passive="messageStore.onListScroll()">
      <MessageItem v-for="m in messages" :key="m.id" :message="m" />
    </div>
  </div>
</template>
