<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  IconPointFilled,
  IconSquares
} from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { isTaskLive, type MaestroTask } from '@maestro-shared/task.api'
import { workflowActivityFacts } from './workflow.presentation'
import type { MessageSession } from './store/message.type'
import { isRejection } from './store/turn.service'
import { messageStore, pendingConfirmMessages, pendingDecisionMessages } from './store/message.store'
import { taskStore } from './store/task.store'
import { workflowStore } from './store/workflow.store'
import './ResponseStatus.less'

const props = defineProps<{ session: MessageSession }>()

interface StatusView {
  tone: 'wait' | 'run'
  text: string
  meta?: string
  // 【没有 background 角标了】Ral 2026-09-22:「background 也去掉吧先」。
}

const tick = ref(Date.now())
const turn = computed(() => props.session.turn)
const live = computed(() => taskStore.tasks.filter((task) => task.sessionId === props.session.id && isTaskLive(task)))
/**
 * "Waiting on you" has to come from the same place the clickable card does.
 *
 * Reading the task registry alone fails in both directions: it can announce a question before any
 * answerable card exists (the state Ral screenshotted — a status line pointing at no button), and it
 * keeps announcing one after the click, because the answer lands on the card first and a
 * `resolveConfirm` that does not match returns `ok:false` and leaves `pendingConfirm` set forever.
 *
 * Ral 2026-09-18:「不能只有 waiting on you 而没 confirm 入口，点击允许/拒绝后 waiting on you
 * 也就不能再被显示」. So the predicate is now exactly ChatConfirmSheet's: an unanswered confirm
 * message in this session. Paired with micromeet-cowork.
 */
const answerableTaskIds = computed(
  () => new Set(pendingConfirmMessages(props.session).map((m) => m.confirm!.taskId))
)
const awaitingAnswer = (task: MaestroTask): boolean => Boolean(task.state.pendingConfirm) && answerableTaskIds.value.has(task.id)
const confirming = computed(() => live.value.find(awaitingAnswer))
const waiting = computed(() => live.value.find((task) => task.state.waitingFor))

const taskLabel = (task: MaestroTask): string => task.state.title || task.name
const retryProgress = (attempt: number, max: number): string =>
  i18nHelper.maestroControl.responseStatus.retryProgress
    .replace('{attempt}', String(attempt))
    .replace('{max}', String(max))

const elapsed = (from: number): string => {
  const ms = Math.max(0, tick.value - from)
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1_000)).padStart(2, '0')}s`
}

const taskMeta = (task: MaestroTask): string => {
  const progress = task.state.progress
  const parts: string[] = []
  if (progress?.total) parts.push(`${progress.done ?? 0}/${progress.total}`)
  if (progress?.subject) parts.push(progress.subject)
  // 【不报 token 消耗】Ral 2026-09-22:「meta 中 34K tokens token 消耗的显示先去掉」。
  // `task.state.progress.tokens` 仍在上报,只是不往这一行放。Paired with micromeet-cowork。
  parts.push(elapsed(task.state.time.start))
  return parts.join(' · ')
}

/**
 * **status 是一组词,不是一句话**(Ral 2026-09-22:「status bar status 本身需要分类,例如 thinking
 * wait for response 算一类,如果是执行工具不要展示工具的命令字符串了,统一用 tooling 还有
 * compacting 这一类统一就叫做 status」)。先匹配先赢。细节搬到下面的 `action`。
 *
 * **tone 的判据换成「要不要人动手」**:只有拍板和审批是 `wait`;压缩、重试、任务在等外部环节
 * 都会自己往前走,用「等你」的颜色(主题蓝,原来是琥珀色)是在喊一个不需要人处理的狼。
 *
 * **没有「正在停止」这一档了**(「停止失败 就不该有 stop 必须能停止成功」)。停止现在是同步的,
 * 生命周期 0ms —— `stopError` / `stopStalledAt` 连同按钮一起删掉了。
 * 见 docs/features/chat-status-bar-status-and-action.md。Paired with micromeet-cowork。
 */
const status = computed<StatusView | null>(() => {
  const copy = i18nHelper.maestroControl.responseStatus
  const decision = pendingDecisionMessages(props.session)[0]?.decision
  if (decision) {
    return {
      tone: 'wait',
      text: copy.needsYourCall,
      meta: decision.questions[0]?.question || decision.questions[0]?.header || i18nHelper.maestroControl.chat.decision.pickBelow
    }
  }
  const confirm = confirming.value
  if (confirm) {
    return {
      tone: 'wait',
      text: copy.waitingOnYou,
      meta: confirm.state.pendingConfirm?.title || copy.actionPanelBelow
    }
  }
  if (props.session.compacting) {
    const retry = props.session.compactionRetry
    const seconds = retry ? Math.ceil(Math.max(0, retry.startedAt + retry.delayMs - tick.value) / 1000) : 0
    return {
      tone: 'run',
      text: copy.compacting,
      meta: retry
        ? retryProgress(retry.attempt, retry.maxAttempts) + ' · ' + copy.compactionWait.replace('{seconds}', String(seconds)) + (retry.error ? ' · ' + retry.error : '')
        : turn.value?.steering?.pending ? copy.compactionQueued : undefined
    }
  }
  const retry = turn.value?.retry
  if (retry) return { tone: 'run', text: copy.retrying, meta: `${retry.attempt}/${retry.max}` }
  const active = turn.value
  /**
   * **人插话这一档 —— 最后触发的赢**(Ral 2026-09-22:「反正就是触发显示什么状态都会覆盖之前的
   * 状态 …… 如果现在是 thinking 触发了 steering 就显示 steering,queueing 亦然」)。
   *
   * `steeringEvent` 由 `sendSteering` 置位,**下一条 agent 事件**(活动行 / 流式 / thinking)
   * 把它清掉 —— 所以能走到这里就说明它是最新的那一个。原来它挂在状态条下面单独一行,已删。
   */
  const steeringEvent = active?.steeringEvent
  if (steeringEvent) {
    return {
      tone: 'run',
      text: steeringEvent.kind === 'queueing' ? copy.queueing : copy.steering,
      meta: elapsed(active!.startedAt)
    }
  }
  if (active?.thinking) return { tone: 'run', text: copy.thinking, meta: elapsed(active.startedAt) }
  // 工具:**不再把命令字符串放进 status**。谁在跑、跑到哪一步,全在下面的 `action`。
  const runningTask = waiting.value || live.value[0]
  if (runningTask) {
    return { tone: 'run', text: copy.tooling, meta: taskMeta(runningTask) }
  }
  if (!active) return null
  if (active.activity.length) return { tone: 'run', text: copy.tooling, meta: elapsed(active.startedAt) }
  return {
    tone: 'run',
    text: active.phase === 'streaming' ? copy.responding : copy.waitingForResponse,
    meta: elapsed(active.startedAt)
  }
})

/**
 * **`action` —— agent 最新的动作**(Ral 2026-09-22:「statusbar 中增加个 action 组件显示 agent
 * 最新的 action」)。整条里变化最快的一行,所以排在 `status` **上面** —— 贴着输入框的那一行留给
 * 最稳定的信息。都没有就整行不渲染。
 */
const action = computed<{ text: string; meta?: string } | null>(() => {
  const held = waiting.value
  if (held) {
    return {
      text: i18nHelper.maestroControl.responseStatus.waitingFor.replace('{task}', taskLabel(held)).replace('{target}', held.state.waitingFor || '')
    }
  }
  const running = live.value[0]
  if (running) return { text: taskLabel(running) }
  /**
   * **本回合的工具活动【不】进这一行**(Ral 2026-09-22:「messageItem__activity 类的消息已经足够
   * 展示工具动作了……这个是多余的」)。重复是**结构上保证的**:`ensureSink` 把 `turn.activity`
   * 按引用交给气泡,消息气泡渲染整份清单,而这里原来取的是同一个数组的最后一项。
   * Paired with micromeet-cowork。
   */
  return null
})

/**
 * Background Agents get their own row instead of a phase in `status`.
 *
 * They are not this turn's work, so they must neither replace "Thinking…" nor vanish when the
 * turn settles — a finished turn with Agents still running previously left the bar empty, and
 * the user could not tell what the chat was waiting on.
 */
const activityFacts = computed(() => workflowActivityFacts(workflowStore.runs, props.session.id))
const pendingWait = computed(() => workflowStore.waitFor(props.session.id))
// `meta` 已随 `response-status__agents__meta` 一起去掉(Ral 2026-09-21:「去掉,多余了」)。
// 模板不再渲染它,类型里也不该再留 —— 之前只删了一支的返回值,类型和另一支没跟上,
// 结果是第二个 return 少一个必填字段的 `TS2769`。
const backgroundAgents = computed<{ tone: 'wait' | 'run'; text: string } | null>(() => {
  const facts = activityFacts.value
  const wait = pendingWait.value
  // The chat having declared a wait is the more specific fact, and it is the host's own registry
  // state — so this line cannot outlive a cancelled wait, and no agent can claim one it never made.
  if (wait) {
    return {
      tone: 'wait',
      text: i18nHelper.workflow.activityWaiting.replace('{count}', String(wait.runIds.length))
    }
  }
  if (!facts.agents) return null
  const counts = facts.awaitingUser
    ? i18nHelper.workflow.activityApproval.replace('{count}', String(facts.awaitingUser))
    : i18nHelper.workflow.activityWorking.replace('{count}', String(facts.agents))
  // The model sentence says what the work is; the localized counts stay as the always-true meta.
  const sentence = workflowStore.activityFor(props.session.id)?.text?.trim() || ''
  return {
    tone: facts.awaitingUser ? 'wait' : 'run',
    text: sentence || counts
  }
})

const canRetry = computed(() =>
  Boolean(props.session.retryable && !props.session.turn && !messageStore.turnService.busyElsewhere(props.session.id))
)
const retriedLabel = computed(() => {
  const retry = props.session.retryable
  return retry ? retryProgress(retry.attempt, retry.max) : ''
})
const retryAgain = async (): Promise<void> => {
  const previous = props.session.retryable
  if (!previous) return
  const root = props.session.messages.find((message) => message.id === previous.rootHumanMessageId)
  const text = root?.content || previous.rootText
  if (!text.trim()) return
  props.session.retryable = undefined
  const result = await messageStore.turnService.send(props.session.id, text)
  if (!result || isRejection(result)) props.session.retryable = previous
}

/**
 * 【没有 roster,也没有 `+N`】Ral 2026-09-22:「`__others` 这种设计也去掉」。
 *
 * 原来状态行右侧有一个 `+3` 角标,点开是一张"同时在跑的其它任务"浮层。两样一起删掉了 ——
 * 角标没了入口就没有意义,浮层没了角标就够不着。想看全部任务去 Workbench;这一行只回答
 * 「现在处于哪一档」。随之不再需要:`status` / `action` 上的 `subject`、点外面/按 Esc 收起浮层的
 * 两个 document 监听、以及那个 `rootEl`。Paired with micromeet-cowork。
 */

/**
 * **状态条一变高,就补一次滚动到底**(Ral 2026-09-22:「发消息滚动条是滚动了,但是 statusbar
 * 从不显示到显示,是发生在后面,这个时候应该再往底部滚动一次」)。
 *
 * `send()` 的顺序本身没错 —— 先置 `session.turn`(状态条的 `v-if` 从那一刻起为真),再
 * `scrollToBottom(true)`。错的是**那之后状态条还会继续长高**:`Waiting for a response` 换成
 * `Thinking…`、`action` 行出现、后台 Agent / steering 行出现、文案换行 —— 每一次都只缩小列表的
 * 可视高度,而**改高度不触发 `scroll` 事件**,所以既没人重算 `stickToBottom`,也没人补滚。
 *
 * 三个要点:
 * · **不 force** —— 由 `stickToBottom` 把关,人自己往上滚过就不该被拽回来。这里安全的理由正是
 *   上面那条:改高度不发 `scroll`,所以 `stickToBottom` 保持着变高之前的值。
 * · **观察 ref 而不是在 `onMounted` 里 observe** —— 根元素带 `v-if`,空闲时不存在;而
 *   `ResizeObserver` 在 `observe()` 时会立刻回调一次,所以「从不显示到显示」这一跳自然被覆盖。
 * · **`ResizeObserver` 可能不存在** —— renderer 测试装置(linkedom)里没有它,不兜底就是整套守卫红。
 *
 * Paired with micromeet-cowork。见 docs/issues/status-bar-appearing-pushes-the-last-message-out-of-view.md。
 */
const rootEl = ref<HTMLElement | null>(null)
let sizeObserver: ResizeObserver | undefined
let lastHeight = 0
watch(
  rootEl,
  (el) => {
    sizeObserver?.disconnect()
    sizeObserver = undefined
    lastHeight = 0
    if (!el || typeof ResizeObserver === 'undefined') return
    sizeObserver = new ResizeObserver(() => {
      const height = el.offsetHeight
      if (height === lastHeight) return
      lastHeight = height
      messageStore.scrollToBottom()
    })
    sizeObserver.observe(el)
  },
  { flush: 'post' }
)

let clock: ReturnType<typeof setInterval> | undefined
const stopClock = (): void => {
  if (!clock) return
  clearInterval(clock)
  clock = undefined
}

watch(
  () => Boolean(status.value) || Boolean(backgroundAgents.value),
  (active) => {
    if (!active) return stopClock()
    if (!clock) clock = setInterval(() => (tick.value = Date.now()), 1_000)
  },
  { immediate: true }
)
onUnmounted(() => {
  stopClock()
  sizeObserver?.disconnect()
  sizeObserver = undefined
})
</script>

<template>
  <div
    v-if="status || action || canRetry || backgroundAgents"
    ref="rootEl"
    name="maestro__response_status"
    class="response-status"
  >

    <!-- 没有警示三角(Ral 2026-09-22:「bl cowork 中都不要 IconAlertTriangle」)——
         红字 + 按钮已经把性质说完了。Paired with micromeet-cowork。 -->
    <div v-if="canRetry" class="response-status__retry">
      <span class="response-status__retry-count">{{ retriedLabel }}</span>
      <button type="button" class="response-status__retry-button" @click="retryAgain">
        {{ i18nHelper.maestroControl.responseStatus.tryAgain }}
      </button>
    </div>

    <div
      v-if="backgroundAgents"
      name="maestro__response_status__agents"
      class="response-status__agents"
      :class="`response-status__agents--${backgroundAgents.tone}`"
    >
      <IconSquares :size="13" stroke="1.9" />
      <span class="response-status__agents-text" :title="backgroundAgents.text">{{ backgroundAgents.text }}</span>
    </div>

    <!-- **action —— agent 最新的动作**(Ral 2026-09-22)。工具调用的原文从 status 里搬出来,
         单独一行;它是整条里变化最快的一行,所以排在 status **上面** —— 贴着输入框的那一行
         留给最稳定的信息。 -->
    <div v-if="action" name="maestro__response_status__action" class="response-status__action">
      <IconPointFilled :size="11" stroke="1.9" />
      <span class="response-status__action-text" :title="action.text">{{ action.text }}</span>
      <span v-if="action.meta" class="response-status__action-meta">{{ action.meta }}</span>
    </div>

    <div v-if="status" class="response-status__bar">
      <span
        class="response-status__dot"
        :class="{
          'response-status__dot--wait': status.tone === 'wait',
          'response-status__dot--run': status.tone === 'run'
        }"
      ></span>
      <!-- 没有警示三角。`wait` 仍有两条通道:主题蓝的圆点/文字(不脉冲),以及行尾那个时钟。 -->
      <div class="response-status__copy">
        <span class="response-status__text" :class="`response-status__text--${status.tone}`" :title="status.text">
          {{ status.text }}
        </span>
        <span v-if="status.meta" class="response-status__meta">{{ status.meta }}</span>
      </div>
    </div>
  </div>
</template>
