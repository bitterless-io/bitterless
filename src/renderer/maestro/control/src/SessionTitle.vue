<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { messageStore } from './store/message.store'
import type { MessageSession } from './store/message.type'
import './SessionTitle.less'

const props = defineProps<{ session: MessageSession }>()
const editing = ref(false)
const saving = ref(false)
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

async function edit(): Promise<void> {
  if (saving.value || props.session.archivedAt) return
  draft.value = props.session.title
  editing.value = true
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

async function save(): Promise<void> {
  if (!editing.value) return
  editing.value = false
  const title = draft.value.trim()
  if (!title) return
  saving.value = true
  try {
    if (!await messageStore.renameSession(props.session.id, title)) {
      Message.error(i18nHelper.maestroControl.chat.renameFailed)
    }
  } finally {
    saving.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') editing.value = false
    else void save()
  }
}

watch(() => props.session.id, () => { editing.value = false })
</script>

<template>
  <div name="maestro__session-title" class="session-title">
    <span v-if="editing" class="session-title__editor">
      <span class="session-title__measure" aria-hidden="true">{{ draft || ' ' }}</span>
      <input ref="inputRef" v-model="draft" name="maestro__session-title-input" class="session-title__input"
        :aria-label="i18nHelper.maestroControl.chat.renameSession" @keydown="onKeydown" @blur="save" />
    </span>
    <button v-else type="button" name="maestro__session-title-label" class="session-title__label"
      :title="session.title" :aria-label="i18nHelper.maestroControl.chat.renameSession" :disabled="saving"
      @dblclick="edit" @keydown.enter.prevent="edit" @keydown.f2.prevent="edit">{{ session.title }}</button>
  </div>
</template>
