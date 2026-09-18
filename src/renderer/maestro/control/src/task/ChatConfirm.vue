<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle, IconCheck, IconClockOff, IconX } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import type { ChatMessage } from '../store/message.type'
import './ChatConfirm.less'

const props = defineProps<{ message: ChatMessage }>()
const card = computed(() => props.message.confirm)
const answered = computed(() => Boolean(card.value?.answer))
/**
 * 【第三种状态】重启后读回的那张卡。它**不是**"答过了" —— 没人答过,是主进程的任务注册表
 * 随进程消失了。所以它既不该穿琥珀色(那是"挡住流程、快来看"),也不该显示一个对勾或叉
 * (那两个符号意味着有人做了决定),更不该再指人去下面的操作面板 —— 那里已经没有这一问了。
 * 它是历史:问过什么还留着,结局如实写成"没答上"
 * (docs/issues/confirm-card-survives-restart.md)。
 */
const expired = computed(() => card.value?.answer === 'expired')
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
  if (card.value?.answer === 'expired') return i18nHelper.maestroControl.confirm.expiredDetail
  return i18nHelper.maestroControl.confirm.answeredElsewhere
})
</script>

<template>
  <div
    v-if="card"
    name="maestro__chat_confirm"
    class="chat-confirm"
    :class="{ 'chat-confirm--answered': answered && !expired, 'chat-confirm--expired': expired }"
  >
    <span class="chat-confirm__rail"></span>
    <div class="chat-confirm__content">
      <div class="chat-confirm__head">
        <IconClockOff v-if="expired" :size="14" stroke="1.9" />
        <IconAlertTriangle v-else :size="14" stroke="1.9" />
        <span>
          {{
            expired
              ? i18nHelper.maestroControl.confirm.expired
              : answered
                ? i18nHelper.maestroControl.confirm.answered
                : i18nHelper.maestroControl.confirm.waitingForYou
          }}
        </span>
      </div>
      <div class="chat-confirm__title">{{ card.title }}</div>
      <div v-if="card.detail" class="chat-confirm__detail">{{ card.detail }}</div>
      <!-- 失效那条不配对勾/叉:那两个符号的意思是"有人选了这个"。 -->
      <div v-if="expired" class="chat-confirm__answer chat-confirm__answer--expired">{{ answerText }}</div>
      <div v-else-if="answered" class="chat-confirm__answer">
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
