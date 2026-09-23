<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IconCheck } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { DECISION_OTHER_LABEL } from '@shared/agentDecision.api'
import { messageStore, pendingDecisionMessages } from '../store/message.store'
import type { MessageSession } from '../store/message.type'
import './DecisionSheet.less'

/**
 * `ask_user` 唤起的拍板卡。契约与取舍见 `docs/features/agent-decision-sheet.md`。
 *
 * **「其他」这一项由这里补,调用方不许自己声明** —— 逐字照 Claude 的 AskUserQuestion
 * (“There should be no 'Other' option, that will be provided automatically”)。
 * 让模型自己造一个"其他",它会写成一个普通选项,那一项点下去没有输入框。
 */
/**
 * **底面,不在时间线里**(与 `ChatConfirmSheet` 同一条规矩):一个挡住流程的问题,必须在任意
 * 滚动位置都能一步点到,而时间线条目的位置是内容量的函数、内容量由 agent 决定。
 * 时间线留档、底面留操作 —— 两边都能点是有前车之鉴的
 * (`chat-duplicate-stop-bypasses-drill-confirm.md`)。
 *
 * 一次只画**一张**:答完就收,下一张接上。
 */
const props = defineProps<{ session: MessageSession }>()

const decision = computed(() => pendingDecisionMessages(props.session)[0]?.decision)
const answered = computed(() => Boolean(decision.value?.picked || decision.value?.cancelled))
/** 每一问选中的 label 集合。多选时可有多项;"其他"用哨兵占位,提交时换成输入框里的原文。 */
const chosen = ref<string[][]>([])
const other = ref<string[]>([])
const busy = ref(false)

// 换了一张卡就重置勾选 —— 上一张的选择不能漏到下一张上。
watch(decision, (next) => {
  chosen.value = (next?.questions || []).map(() => [])
  other.value = (next?.questions || []).map(() => '')
}, { immediate: true })

const isPicked = (q: number, label: string): boolean => chosen.value[q].includes(label)

/**
 * 这一问能不能多选 —— **必须在卡上说出来**(Ral 2026-09-23)。
 *
 * `multiSelect` 从一开始就接着(契约、normalize、下面的 `toggle` 都分了两条路),但两种模式
 * **渲染得一模一样**:同一列按钮、同一种高亮。于是人没有任何线索知道自己还能点第二个;
 * 点了之后发现第一个没被取消,只能靠试出来。能力从人这一侧够不着,等于没有。
 */
const isMulti = (q: number): boolean => decision.value?.questions[q]?.multiSelect === true

const toggle = (q: number, label: string): void => {
  if (answered.value || busy.value) return
  const multi = decision.value!.questions[q].multiSelect === true
  const current = chosen.value[q]
  if (!multi) {
    chosen.value[q] = current.includes(label) ? [] : [label]
    return
  }
  chosen.value[q] = current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
}

/** 每一问都必须有答案才能提交;选了"其他"就必须把输入框填了 —— 空的"其他"不是一个决定。 */
const submittable = computed(() =>
  !answered.value && !busy.value && (decision.value?.questions || []).every((_, q) => {
    const picks = chosen.value[q]
    if (!picks.length) return false
    return !picks.includes(DECISION_OTHER_LABEL) || other.value[q].trim().length > 0
  })
)

const submit = async (): Promise<void> => {
  if (!submittable.value) return
  busy.value = true
  try {
    await messageStore.answerDecision(
      decision.value!.decisionId,
      chosen.value.map((picks, q) => picks.map((label) => (label === DECISION_OTHER_LABEL ? other.value[q].trim() : label)))
    )
  } finally {
    busy.value = false
  }
}

const cancel = async (): Promise<void> => {
  if (answered.value || busy.value) return
  busy.value = true
  try {
    await messageStore.answerDecision(decision.value!.decisionId)
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <div v-if="decision && !answered" name="decision-sheet" class="decision-sheet">
    <div
      v-for="(question, q) in decision!.questions"
      :key="q"
      name="decision-sheet__question"
      class="decision-sheet__question"
    >
      <div class="decision-sheet__prompt-row">
        <span class="decision-sheet__header">{{ question.header }}</span>
        <span class="decision-sheet__prompt">{{ question.question }}</span>
        <span v-if="isMulti(q)" name="decision-sheet__multi" class="decision-sheet__multi">
          {{ i18nHelper.maestroControl.chat.decision.multi }}
        </span>
      </div>

      <button
        v-for="option in question.options"
        :key="option.label"
        name="decision-sheet__option"
        type="button"
        class="decision-sheet__option"
        :class="{ 'decision-sheet__option--picked': isPicked(q, option.label) }"
        @click="toggle(q, option.label)"
      >
        <span class="decision-sheet__option-label">
          <!-- 多选时给选中项一个可累加的记号 —— 光靠整块变蓝读起来像「单选已经切过去了」。 -->
          <IconCheck v-if="isMulti(q) && isPicked(q, option.label)" :size="13" stroke="2.4" />
          {{ option.label }}
        </span>
        <span v-if="option.description" class="decision-sheet__option-desc">{{ option.description }}</span>
      </button>

      <!-- 自由输入那一项:界面自动补,不来自调用方。 -->
      <div
        name="decision-sheet__other"
        class="decision-sheet__other"
        :class="{ 'decision-sheet__other--picked': isPicked(q, DECISION_OTHER_LABEL) }"
      >
        <button type="button" class="decision-sheet__other-trigger" @click="toggle(q, DECISION_OTHER_LABEL)">
          {{ i18nHelper.maestroControl.chat.decision.other }}
        </button>
        <input
          v-model="other[q]"
          name="decision-sheet__other_input"
          type="text"
          :disabled="!isPicked(q, DECISION_OTHER_LABEL)"
          :placeholder="i18nHelper.maestroControl.chat.decision.otherPlaceholder"
          class="decision-sheet__other-input"
          @keydown.enter.prevent="submit"
        />
      </div>
    </div>

    <div name="decision-sheet__actions" class="decision-sheet__actions">
      <button
        name="decision-sheet__cancel"
        type="button"
        :disabled="busy"
        class="decision-sheet__button decision-sheet__button--cancel"
        @click="cancel"
      >
        {{ i18nHelper.maestroControl.chat.decision.cancel }}
      </button>
      <button
        name="decision-sheet__submit"
        type="button"
        :disabled="!submittable"
        class="decision-sheet__button decision-sheet__button--submit"
        @click="submit"
      >
        {{ i18nHelper.maestroControl.chat.decision.submit }}
      </button>
    </div>
  </div>
</template>
