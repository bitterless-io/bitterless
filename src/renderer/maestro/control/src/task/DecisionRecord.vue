<script setup lang="ts">
import { computed } from 'vue'
import { IconCheck, IconHelpCircle, IconX } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import type { ChatMessage } from '../store/message.type'
import './DecisionRecord.less'

/**
 * `ask_user` 那次拍板在时间线里的**留档** —— 问了什么、人答了什么。
 *
 * 为什么必须有(Ral 2026-09-23:「答案并没有渲染在 UI 上」):底面那张
 * `DecisionSheet` 答完就收起来,于是屏幕上**一点痕迹都不剩** —— 人既看不到自己刚选了哪个,
 * 也没法滚回去查。一个把流程卡住的决定,事后查不到问答,等于这次交互没发生过。
 * 兄弟条目早就是这么做的:`confirm` 有 `ChatConfirm.vue`,`task` 有 `TaskPart`,
 * 只有 `decision` 缺这一块(`docs/issues/ask-user-answer-leaves-no-trace.md`)。
 *
 * **它只留档,不操作。** 待答时这里只写「等你拍板」,按钮仍然只在底面 ——
 * 两处都能点是有前车之鉴的(`chat-duplicate-stop-bypasses-drill-confirm.md`)。
 *
 * 消息类型**没有新增**:`type: 'decision'` 早就有了,缺的只是这个渲染分支
 * (`areas/agent-runtime/chat/message-types.html` 的 `ai · decision` 一行)。
 */
const props = defineProps<{ message: ChatMessage }>()

const card = computed(() => props.message.decision)
const declined = computed(() => card.value?.cancelled === true)
const picked = computed(() => card.value?.picked)
const answered = computed(() => Boolean(picked.value))

/** 第 q 问的答案。空数组 = 这一问没选(取消时整张卡都没有答案)。 */
const answersFor = (q: number): string[] => picked.value?.[q] || []
</script>

<template>
  <div
    v-if="card"
    name="maestro__decision_record"
    class="decision-record"
    :class="{ 'decision-record--answered': answered, 'decision-record--declined': declined }"
  >
    <span class="decision-record__rail"></span>
    <div class="decision-record__content">
      <div class="decision-record__head">
        <IconX v-if="declined" :size="14" stroke="1.9" />
        <IconCheck v-else-if="answered" :size="14" stroke="2" />
        <IconHelpCircle v-else :size="14" stroke="1.9" />
        <span>
          {{
            declined
              ? i18nHelper.maestroControl.chat.decision.notAnswered
              : answered
                ? i18nHelper.maestroControl.chat.decision.answered
                : i18nHelper.maestroControl.chat.decision.waiting
          }}
        </span>
      </div>

      <div v-for="(question, q) in card.questions" :key="q" class="decision-record__question">
        <div class="decision-record__prompt-row">
          <span class="decision-record__header">{{ question.header }}</span>
          <span class="decision-record__prompt">{{ question.question }}</span>
        </div>
        <!-- 答案:选「其他」时这里已经是人打的原文,哨兵在提交那一刻就换掉了。 -->
        <div v-if="answersFor(q).length" class="decision-record__answers">
          <span v-for="answer in answersFor(q)" :key="answer" class="decision-record__answer">{{ answer }}</span>
        </div>
      </div>

      <!-- 取消的措辞与返回给模型的那句话同义:人看见了、选择不回答 —— 不是"没人在"。 -->
      <div v-if="declined" class="decision-record__declined">
        {{ i18nHelper.maestroControl.chat.decision.declined }}
      </div>
    </div>
  </div>
</template>
