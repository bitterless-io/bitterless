<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, Drawer } from '@arco-design/web-vue'
import { IconArchive, IconSearch, IconX } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import IconBtn from '../../../common/components/IconBtn/IconBtn.vue'
import { channelStore } from './store/channel.store'
import { messageStore } from './store/message.store'
import { isEditableTarget, sessionActions } from './store/sessionActions.store'
import './SessionsDrawer.less'

const emit = defineEmits<{ close: [] }>()
const historyVisible = computed({ get: () => sessionActions.historyVisible, set: (visible: boolean) => { sessionActions.historyVisible = visible } })
const historyList = ref<HTMLElement | null>(null)
// 游标记的是**会话 id**,不是下标:`sessionListItems` 会按 未读 → 进行中 → 已读 重排,而打开
// 抽屉时还会异步 `refreshHistory()` —— 打开那一刻算出来的下标,等刷新落地就指向另一个会话了
// (表现为「打开时没有默认选中当前会话」)。游标那条会话离开列表(归档/删除)时退回第一行。
const cursorSessionId = ref('')
const historyCursor = computed(() => {
  const index = messageStore.sessionListItems.findIndex((item) => item.id === cursorSessionId.value)
  return index >= 0 ? index : 0
})
const shortcut = (key: string): string => `${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'}${key}`

const formatSessionTime = (ts: number): string => {
  if (!ts) return ''
  const date = new Date(ts)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function closeHistory(): void {
  historyVisible.value = false
}

async function selectHistory(sessionId: string): Promise<void> {
  if (await channelStore.selectMaestroHistorySession(sessionId)) closeHistory()
}

function scrollHistoryCursor(): void {
  void nextTick(() => historyList.value?.querySelector<HTMLElement>('[data-history-cursor="true"]')?.scrollIntoView({ block: 'nearest' }))
}

watch(historyVisible, (visible) => {
  if (!visible) { emit('close'); return }
  cursorSessionId.value = channelStore.activeSessionId
  scrollHistoryCursor()
  void messageStore.refreshHistory().then(scrollHistoryCursor)
})

function onDrawerKeydown(event: KeyboardEvent): void {
  if (!document.hasFocus() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
  const key = event.key.toLowerCase()
  if (command && (key === 'h' || key === 'f')) {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) {
      if (key === 'h') sessionActions.toggleHistory()
      else sessionActions.openSearch()
    }
    return
  }
  if (command && key === 'z') {
    if (isEditableTarget(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      void sessionActions.undoTextEdit()
    } else if (sessionActions.lastUndo) {
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) void sessionActions.undo()
    }
    return
  }
  if (!historyVisible.value || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  if (!['Escape', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') closeHistory()
  else if (event.key === 'Enter') {
    if (event.repeat) return
    const item = messageStore.sessionListItems[historyCursor.value]
    if (item) void selectHistory(item.id)
  } else {
    const items = messageStore.sessionListItems
    if (!items.length) return
    cursorSessionId.value = items[(historyCursor.value + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].id
    scrollHistoryCursor()
  }
}

onMounted(() => window.addEventListener('keydown', onDrawerKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onDrawerKeydown, true))
</script>

<template>
    <Drawer
      v-model:visible="historyVisible"
      placement="left"
      :width="280"
      popup-container="#control-card"
      :header="false"
      :footer="false"
      :body-style="{ padding: '0', overflow: 'hidden' }"
      unmount-on-close
      :esc-to-close="false"
      @cancel="closeHistory"
    >
      <div class="chat-panel__history">
        <div class="chat-panel__history-header">
          <div class="chat-panel__history-title">{{ i18nHelper.maestroControl.chat.history }}</div>
          <IconBtn name="maestro__history-search" :title="`${i18nHelper.maestroControl.chat.searchSessions} (${shortcut('F')})`" :aria-label="i18nHelper.maestroControl.chat.searchSessions" @click="sessionActions.openSearch()">
            <IconSearch :size="16" stroke="1.8" />
          </IconBtn>
          <IconBtn
            name="maestro__history-close"
            class="chat-panel__history-close"
            :title="i18nHelper.maestroControl.chat.closeHistory"
            :aria-label="i18nHelper.maestroControl.chat.closeHistory"
            @click="closeHistory"
          >
            <IconX class="chat-panel__button-icon" :size="16" stroke="1.8" />
          </IconBtn>
        </div>
        <div ref="historyList" name="maestro__history-list" class="chat-panel__history-list">
          <div v-if="!messageStore.sessionListItems.length" class="chat-panel__history-empty">
            {{ i18nHelper.maestroControl.chat.noHistory }}
          </div>
          <!-- 数据源是 `sessionListItems` 而不是 `historySessions`:后者只有库里的概要,
               **刚新建、还没发过消息的会话不在里面** —— 那会让「新建后它不在列表里」。
               排序是未读 → 进行中 → 已读(store 的 getter 负责)。
               行内右侧只有一个指示物:转圈(在跑)或蓝点(未读),两者不会同时出现 ——
               回合结束的那一刻才置未读。 -->
          <div
            v-for="(item, index) in messageStore.sessionListItems"
            :key="item.id"
            class="chat-panel__history-item"
            :class="{
              'chat-panel__history-item--active': item.id === channelStore.activeSessionId,
              'chat-panel__history-item--cursor': index === historyCursor
            }"
            name="maestro__history-item"
            :data-history-cursor="index === historyCursor"
            :aria-current="item.id === channelStore.activeSessionId ? 'true' : undefined"
            @contextmenu.prevent.stop="sessionActions.showMenu(item.id)"
          >
            <Button class="chat-panel__history-select" type="text" @click="selectHistory(item.id)">
            <!-- 包裹层照 cowork 的 `session-list__item` 结构(Ral 2026-09-09):行本身是横排
                 `flex items-center gap`,**两行文字靠这一层**在里面 block 堆叠。
                 少了它,title 与 preview 就是行的直接 flex 子元素 —— 那时 `display: block`
                 管不了排布(flex 子元素按主轴排),于是挤在一行。 -->
            <span class="chat-panel__history-item-body">
              <span class="chat-panel__history-item-title">{{ item.title || 'Maestro' }}</span>
              <span class="chat-panel__history-item-preview">{{ item.preview || formatSessionTime(item.updatedAt) }}</span>
            </span>
            <span
              v-if="item.awaitingConfirm"
              name="maestro__history-item-confirm"
              class="chat-panel__history-item-confirm"
              :title="i18nHelper.maestroControl.chat.awaitingConfirmSession"
            ></span>
            <span
              v-else-if="item.running"
              name="maestro__history-item-running"
              class="chat-panel__history-item-running"
              :title="i18nHelper.maestroControl.chat.sessionRunning"
            ></span>
            <span
              v-else-if="item.unread"
              name="maestro__history-item-unread"
              class="chat-panel__history-item-unread"
              :title="i18nHelper.maestroControl.chat.sessionUnread"
            ></span>
            </Button>
            <IconBtn name="maestro__history-archive" class="chat-panel__history-archive"
              :disabled="item.running || sessionActions.pendingIds.includes(item.id)"
              :title="item.running ? i18nHelper.maestroControl.chat.archiveRunning : i18nHelper.maestroControl.chat.archiveSession"
              :aria-label="i18nHelper.maestroControl.chat.archiveSession" @click.stop="sessionActions.archive(item.id)">
              <IconArchive :size="14" stroke="1.8" />
            </IconBtn>
          </div>
        </div>
      </div>
    </Drawer>
</template>
