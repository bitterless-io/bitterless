<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle, IconCheck, IconX } from '@tabler/icons-vue'
import type { ChatMessage } from '../store/message.type'
import './ChatConfirm.less'

const props = defineProps<{ message: ChatMessage }>()
const card = computed(() => props.message.confirm)
const answered = computed(() => Boolean(card.value?.answer))
const answerText = computed(() => {
  if (card.value?.answer === 'confirm') return `Selected “${card.value.confirmLabel}”`
  if (card.value?.answer === 'cancel') return `Selected “${card.value.cancelLabel}”`
  return 'This question was answered elsewhere or withdrawn.'
})
</script>

<template>
  <div v-if="card" name="maestro__chat_confirm" class="chat-confirm" :class="{ 'chat-confirm--answered': answered }">
    <span class="chat-confirm__rail"></span>
    <div class="chat-confirm__content">
      <div class="chat-confirm__head">
        <IconAlertTriangle :size="14" stroke="1.9" />
        <span>{{ answered ? 'answered' : 'waiting for you' }}</span>
      </div>
      <div class="chat-confirm__title">{{ card.title }}</div>
      <div v-if="card.detail" class="chat-confirm__detail">{{ card.detail }}</div>
      <div v-if="answered" class="chat-confirm__answer">
        <IconCheck v-if="card.answer === 'confirm'" :size="13" stroke="2" />
        <IconX v-else :size="13" stroke="2" />
        <span>{{ answerText }}</span>
      </div>
      <div v-else class="chat-confirm__waiting">↓ Answer in the action panel below</div>
    </div>
  </div>
</template>
