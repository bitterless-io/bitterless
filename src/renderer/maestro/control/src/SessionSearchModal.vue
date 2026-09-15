<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Message, Modal } from '@arco-design/web-vue'
import { IconSearch } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { messageStore } from './store/message.store'
import { channelStore } from './store/channel.store'
import { matchesSessionTitle, sessionActions } from './store/sessionActions.store'
import './SessionSearchModal.less'

const emit = defineEmits<{ close: [] }>()
const query = ref('')
const cursor = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)
const composing = ref(false)
const selecting = ref(false)
const results = computed(() => messageStore.sessionListItems.filter((item) => matchesSessionTitle(item.title, query.value)))
const selectedId = computed(() => results.value[cursor.value]?.id)
const optionId = (id: string): string => `maestro-session-search-${encodeURIComponent(id)}`

function close(): void {
  sessionActions.closeSearch()
  emit('close')
}

async function focusInput(): Promise<void> {
  await nextTick()
  if (sessionActions.searchVisible) inputRef.value?.focus()
}

async function select(id: string): Promise<void> {
  if (selecting.value) return
  selecting.value = true
  try {
    if (!await channelStore.selectMaestroHistorySession(id)) {
      Message.error(i18nHelper.maestroControl.chat.openSessionFailed)
      return
    }
    close()
  } finally {
    selecting.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || composing.value || event.keyCode === 229) {
    event.stopPropagation()
    return
  }
  if (!['Escape', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') close()
  else if (event.key === 'Enter') {
    if (!event.repeat && selectedId.value) void select(selectedId.value)
  } else if (results.value.length) {
    cursor.value = (cursor.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) % results.value.length
  }
}

watch(query, () => { cursor.value = 0 })
watch(results, () => { cursor.value = Math.min(cursor.value, Math.max(0, results.value.length - 1)) })
watch(selectedId, async () => {
  await nextTick()
  resultsRef.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
})
watch(() => sessionActions.searchRevision, () => {
  query.value = ''
  cursor.value = 0
  composing.value = false
  void focusInput()
})
</script>

<template>
  <Modal :visible="sessionActions.searchVisible" :title="i18nHelper.maestroControl.chat.searchSessions"
    :footer="false" :esc-to-close="false" width="min(560px, calc(100vw - 32px))"
    modal-class="session-search-modal" body-class="session-search-modal__body" @cancel="close" @open="focusInput">
    <section name="maestro__session-search" class="session-search" role="search">
      <div name="maestro__session-search-field" class="session-search__field">
        <IconSearch :size="16" aria-hidden="true" />
        <input ref="inputRef" v-model="query" name="maestro__session-search-input" class="session-search__input"
          :placeholder="i18nHelper.maestroControl.chat.searchSessionPlaceholder" :aria-label="i18nHelper.maestroControl.chat.searchSessionPlaceholder"
          autocomplete="off" role="combobox" aria-autocomplete="list" :aria-expanded="sessionActions.searchVisible"
          aria-controls="maestro-session-search-results" :aria-activedescendant="selectedId ? optionId(selectedId) : undefined"
          @compositionstart="composing = true" @compositionend="composing = false" @keydown="onKeydown" />
      </div>
      <div id="maestro-session-search-results" ref="resultsRef" name="maestro__session-search-results"
        class="session-search__results" role="listbox" :aria-label="i18nHelper.maestroControl.chat.searchSessions">
        <div v-for="(item, index) in results" :id="optionId(item.id)" :key="item.id" name="maestro__session-search-result"
          class="session-search__result" :class="{ 'session-search__result--selected': index === cursor }"
          role="option" :aria-selected="index === cursor" @mousedown.prevent @click="select(item.id)"
          @contextmenu.prevent.stop="sessionActions.showMenu(item.id)">
          <span class="session-search__title">{{ item.title }}</span>
          <span v-if="item.running" class="chat-panel__history-item-running" :title="i18nHelper.maestroControl.chat.sessionRunning" :aria-label="i18nHelper.maestroControl.chat.sessionRunning"></span>
          <span v-else-if="item.unread" class="chat-panel__history-item-unread" :title="i18nHelper.maestroControl.chat.sessionUnread" :aria-label="i18nHelper.maestroControl.chat.sessionUnread"></span>
        </div>
        <div v-if="!results.length" class="session-search__empty" role="status">
          {{ query.trim() ? i18nHelper.maestroControl.chat.searchSessionEmpty : i18nHelper.maestroControl.chat.searchSessionStart }}
        </div>
      </div>
    </section>
  </Modal>
</template>
