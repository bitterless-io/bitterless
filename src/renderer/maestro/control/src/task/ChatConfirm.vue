<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle, IconCheck, IconX } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import type { ChatMessage } from '../store/message.type'
import './ChatConfirm.less'

const props = defineProps<{ message: ChatMessage }>()
const card = computed(() => props.message.confirm)
const answered = computed(() => Boolean(card.value?.answer))
const answerText = computed(() => {
  if (card.value?.answer === 'confirm') {
    return i18nHelper.maestroControl.confirm.selected.replace(
      '{label}',
      card.value.confirmLabel
    )
  }
  if (card.value?.answer === 'cancel') {
    return i18nHelper.maestroControl.confirm.selected.replace(
      '{label}',
      card.value.cancelLabel
    )
  }
  return i18nHelper.maestroControl.confirm.answeredElsewhere
})
</script>

<template>
  <div v-if="card" name="maestro__chat_confirm" class="chat-confirm" :class="{ 'chat-confirm--answered': answered }">
    <span class="chat-confirm__rail"></span>
    <div class="chat-confirm__content">
      <div class="chat-confirm__head">
        <IconAlertTriangle :size="14" stroke="1.9" />
        <span>
          {{
            answered
              ? i18nHelper.maestroControl.confirm.answered
              : i18nHelper.maestroControl.confirm.waitingForYou
          }}
        </span>
      </div>
      <div class="chat-confirm__title">{{ card.title }}</div>
      <div v-if="card.detail" class="chat-confirm__detail">{{ card.detail }}</div>
      <div v-if="answered" class="chat-confirm__answer">
        <IconCheck v-if="card.answer === 'confirm'" :size="13" stroke="2" />
        <IconX v-else :size="13" stroke="2" />
        <span>{{ answerText }}</span>
      </div>
      <div v-else class="chat-confirm__waiting">
        {{ i18nHelper.maestroControl.confirm.answerInActionPanel }}
      </div>
    </div>
  </div>
</template>
