<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronRight,
  IconCircleCheck,
  IconHelpCircle
} from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { messageStore } from '../store/message.store'
import type { ChatMessage, MessageSession } from '../store/message.type'
import './ChatConfirmSheet.less'

const props = defineProps<{ session: MessageSession }>()
const pending = computed<ChatMessage[]>(() =>
  props.session.messages.filter(
    (message) => message.type === 'confirm' && message.confirm && !message.confirm.answer
  )
)
const current = computed(() => pending.value[0] || null)
const card = computed(() => current.value?.confirm || null)
const queued = computed(() => Math.max(0, pending.value.length - 1))
const open = ref(false)
const answering = ref(false)
const unsourced = computed(
  () => card.value?.payload?.fields.filter((field) => field.provenance === 'unsourced').length || 0
)
const unknown = computed(
  () => card.value?.payload?.fields.filter((field) => field.provenance === 'unknown').length || 0
)
const fieldCount = computed(() => card.value?.payload?.fields.length || 0)
const queuedLabel = computed(() =>
  i18nHelper.maestroControl.confirm.moreQueued.replace('{count}', String(queued.value))
)
const fieldCountLabel = computed(() =>
  (fieldCount.value === 1
    ? i18nHelper.maestroControl.confirm.field
    : i18nHelper.maestroControl.confirm.fields
  ).replace('{count}', String(fieldCount.value))
)
const unsourcedLabel = computed(() =>
  i18nHelper.maestroControl.confirm.unsourcedCount.replace('{count}', String(unsourced.value))
)
const unknownLabel = computed(() =>
  i18nHelper.maestroControl.confirm.unknownCount.replace('{count}', String(unknown.value))
)

watch(
  () => card.value?.confirmId,
  () => {
    open.value = false
    answering.value = false
  }
)

const answer = async (confirm: boolean): Promise<void> => {
  const message = current.value
  if (!message || answering.value) return
  answering.value = true
  const result = await messageStore.answerConfirm(message, confirm)
  if (!result.ok) Message.warning(i18nHelper.maestroControl.confirm.answeredElsewhere)
  answering.value = false
}

const markerIcons = {
  grounded: IconCircleCheck,
  unsourced: IconAlertCircle,
  unknown: IconHelpCircle
} as const
const markerLabel = (provenance: keyof typeof markerIcons): string =>
  i18nHelper.maestroControl.confirm.provenance[provenance]
</script>

<template>
  <div v-if="card" name="maestro__chat_confirm_sheet" class="chat-confirm-sheet">
    <div class="chat-confirm-sheet__head">
      <IconAlertTriangle :size="14" stroke="1.9" />
      <span>{{ i18nHelper.maestroControl.confirm.waitingDecision }}</span>
      <span v-if="queued" class="chat-confirm-sheet__queue">{{ queuedLabel }}</span>
    </div>
    <div class="chat-confirm-sheet__title">{{ card.title }}</div>
    <div v-if="card.detail" class="chat-confirm-sheet__detail">{{ card.detail }}</div>

    <div v-if="card.payload" class="chat-confirm-sheet__payload">
      <button type="button" class="chat-confirm-sheet__payload-toggle" @click="open = !open">
        <IconChevronRight :size="13" stroke="2.2" :class="{ 'chat-confirm-sheet__chevron--open': open }" />
        <span class="chat-confirm-sheet__payload-copy">
          <span class="chat-confirm-sheet__intent">{{ card.payload.intent || card.payload.summary }}</span>
          <span class="chat-confirm-sheet__risk">
            <template v-if="card.payload.intent">
              {{ i18nHelper.maestroControl.confirm.agentDescription }} ·
            </template>
            {{ fieldCountLabel }}
            <template v-if="unsourced"> · {{ unsourcedLabel }}</template>
            <template v-if="unknown"> · {{ unknownLabel }}</template>
          </span>
        </span>
      </button>
      <div v-if="open" class="chat-confirm-sheet__payload-list">
        <div class="chat-confirm-sheet__summary">{{ card.payload.summary }}</div>
        <div v-for="field in card.payload.fields" :key="field.path" class="chat-confirm-sheet__field">
          <span class="chat-confirm-sheet__field-path">{{ field.path }}</span>
          <span class="chat-confirm-sheet__field-value">{{ field.value }}</span>
          <span class="chat-confirm-sheet__field-source" :class="`chat-confirm-sheet__field-source--${field.provenance}`">
            <component :is="markerIcons[field.provenance]" :size="12" stroke="2" />
            {{ markerLabel(field.provenance) }}
          </span>
          <span v-if="field.source" class="chat-confirm-sheet__field-note" :title="field.source">{{ field.source }}</span>
        </div>
      </div>
    </div>

    <div class="chat-confirm-sheet__actions">
      <button type="button" class="chat-confirm-sheet__cancel" :disabled="answering" @click="answer(false)">
        {{ card.cancelLabel }}
      </button>
      <button type="button" class="chat-confirm-sheet__confirm" :disabled="answering" @click="answer(true)">
        {{ card.confirmLabel }}
      </button>
    </div>
  </div>
</template>
