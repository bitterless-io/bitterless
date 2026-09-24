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
const contentRef = ref<HTMLElement | null>(null)
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

/**
 * **高度一变就补钉底** —— 一个观察者盯两样东西(`docs/issues/scroll-to-bottom-falls-short-after-send.md`):
 *
 * · **内容元素**:内容变高(AI 回复的 markdown 分批渲染、状态条换文案、代码块高亮完成);
 * · **滚动容器本身**:可视区变矮(`ChatConfirmSheet` / `DecisionSheet` 在滚动容器外面冒出来)。
 *
 * 两种变化都不触发 scroll 事件,原来只有状态条自己挂了一个观察者。钉不钉由 store 的
 * `stickToBottom` 决定 —— 人往上滚过就不拽回来。测试装置里可能没有 `ResizeObserver`,所以兜底。
 */
let sizeObserver: ResizeObserver | undefined

onMounted(() => {
  messageStore.setListEl(listRef.value)
  emit('containerReady', containerRef.value)
  measureScroll()
  if (typeof ResizeObserver === 'undefined') return
  sizeObserver = new ResizeObserver(() => {
    messageStore.followBottom()
    measureScroll()
  })
  if (listRef.value) sizeObserver.observe(listRef.value)
  if (contentRef.value) sizeObserver.observe(contentRef.value)
})
onUnmounted(() => {
  sizeObserver?.disconnect()
  sizeObserver = undefined
  messageStore.setListEl(null)
  emit('containerReady', null)
})
</script>

<template>
  <div ref="containerRef" class="message-list">
    <div ref="listRef" class="message-list__scroll" @scroll.passive="onScroll">
      <!-- 内容包一层,只为让 `ResizeObserver` 量得到「内容有多高」—— 滚动容器自己的尺寸是可视区,
           内容长高时它不变。条目间距的规则跟着挪到 `.message-list__content`。 -->
      <div ref="contentRef" name="maestro__message_list_content" class="message-list__content">
      <MessageItem v-for="m in messages" :key="m.id" :message="m" />
      <!-- 状态条落在这里 —— **跟着最后一条消息走**(Ral 2026-09-22)。用插槽而不是让 MessageList
           自己引入 ResponseStatus:这个组件的契约一直是 `props: { messages }` + 纯渲染。
           见 areas/agent-runtime/chat/decision/manual-decision.html #3。 -->
      <slot name="tail" />
      </div>
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
