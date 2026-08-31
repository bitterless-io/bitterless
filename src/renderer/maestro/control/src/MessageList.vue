<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { IconArrowDown } from '@tabler/icons-vue'
import MessageItem from './MessageItem.vue'
import { messageStore } from './store/message.store'
import type { ChatMessage } from './store/message.type'
import './MessageList.less'

const props = defineProps<{ messages: ChatMessage[] }>()
const emit = defineEmits<{ containerReady: [el: HTMLElement | null] }>()

const containerRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const distanceFromBottom = ref(0)
const SCROLL_BOTTOM_VISIBLE_PX = 80

const measureScroll = (): void => {
  const element = listRef.value
  if (!element) return
  distanceFromBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight
}

const onScroll = (): void => {
  messageStore.onListScroll()
  measureScroll()
}

watch(
  () => props.messages.length,
  () => void nextTick(measureScroll)
)

onMounted(() => {
  messageStore.setListEl(listRef.value)
  emit('containerReady', containerRef.value)
  measureScroll()
})
onUnmounted(() => {
  messageStore.setListEl(null)
  emit('containerReady', null)
})
</script>

<template>
  <div ref="containerRef" class="message-list">
    <div ref="listRef" class="message-list__scroll" @scroll.passive="onScroll">
      <MessageItem v-for="m in messages" :key="m.id" :message="m" />
    </div>
    <button
      v-if="distanceFromBottom > SCROLL_BOTTOM_VISIBLE_PX"
      type="button"
      name="maestro__scroll_latest"
      class="message-list__scroll-bottom"
      title="Scroll to latest"
      aria-label="Scroll to latest"
      @click="messageStore.scrollToBottom(true)"
    >
      <IconArrowDown :size="16" stroke="2" />
    </button>
  </div>
</template>
