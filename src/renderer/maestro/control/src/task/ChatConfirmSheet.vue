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
  if (!result.ok) Message.warning('This question was answered elsewhere or withdrawn.')
  answering.value = false
}

const markers = {
  grounded: { icon: IconCircleCheck, label: 'grounded' },
  unsourced: { icon: IconAlertCircle, label: 'unsourced' },
  unknown: { icon: IconHelpCircle, label: 'unknown' }
} as const
</script>

<template>
  <div v-if="card" name="maestro__chat_confirm_sheet" class="chat-confirm-sheet">
    <div class="chat-confirm-sheet__head">
      <IconAlertTriangle :size="14" stroke="1.9" />
      <span>Waiting for your decision</span>
      <span v-if="queued" class="chat-confirm-sheet__queue">{{ queued }} more queued</span>
    </div>
    <div class="chat-confirm-sheet__title">{{ card.title }}</div>
    <div v-if="card.detail" class="chat-confirm-sheet__detail">{{ card.detail }}</div>

    <div v-if="card.payload" class="chat-confirm-sheet__payload">
      <button type="button" class="chat-confirm-sheet__payload-toggle" @click="open = !open">
        <IconChevronRight :size="13" stroke="2.2" :class="{ 'chat-confirm-sheet__chevron--open': open }" />
        <span class="chat-confirm-sheet__payload-copy">
          <span class="chat-confirm-sheet__intent">{{ card.payload.intent || card.payload.summary }}</span>
          <span class="chat-confirm-sheet__risk">
            <template v-if="card.payload.intent">Agent description · </template>
            {{ fieldCount }} field{{ fieldCount === 1 ? '' : 's' }}
            <template v-if="unsourced"> · {{ unsourced }} unsourced</template>
            <template v-if="unknown"> · {{ unknown }} unknown</template>
          </span>
        </span>
      </button>
      <div v-if="open" class="chat-confirm-sheet__payload-list">
        <div class="chat-confirm-sheet__summary">{{ card.payload.summary }}</div>
        <div v-for="field in card.payload.fields" :key="field.path" class="chat-confirm-sheet__field">
          <span class="chat-confirm-sheet__field-path">{{ field.path }}</span>
          <span class="chat-confirm-sheet__field-value">{{ field.value }}</span>
          <span class="chat-confirm-sheet__field-source" :class="`chat-confirm-sheet__field-source--${field.provenance}`">
            <component :is="markers[field.provenance].icon" :size="12" stroke="2" />
            {{ markers[field.provenance].label }}
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
