<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { tabAliasStore } from './tabAlias.store'
import './TabAliasApp.less'

// The rendered `<input>` rather than the Arco component instance: the component exposes `focus()`
// but not `select()`, and selecting is the half of this that makes the first keystroke replace the
// existing name instead of appending to it.
const fieldRef = ref<HTMLElement | null>(null)
const dialog = computed(() => tabAliasStore.dialog)
const text = computed(() => i18nHelper.maestroTabAlias)

// Capture phase on the window: the caret lives in the input, and Escape/Enter still have to reach
// the dialog from there. Same shape as the OnlyPreview alert layer.
const onKeydown = (event: KeyboardEvent): void => {
  if (!tabAliasStore.handleKey({ key: event.key, composing: event.isComposing })) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

// Focused AND selected: the common edit is "replace the name I gave it", so the first keystroke
// should overwrite rather than append. `nextTick` because the input only exists after the snapshot
// that opened this dialog has rendered.
watch(
  () => [tabAliasStore.focusRevision, Boolean(dialog.value)],
  async () => {
    if (!dialog.value) return
    await nextTick()
    const input = fieldRef.value?.querySelector('input')
    if (!input) return
    input.focus()
    input.select()
  },
  { immediate: true }
)

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <main v-if="dialog" name="maestro__tabAliasCanvas" class="maestro-tab-alias">
    <div name="maestro__tabAliasScrim" class="maestro-tab-alias__scrim"></div>
    <section
      name="maestro__tabAliasPanel"
      class="maestro-tab-alias__panel"
      role="dialog"
      aria-modal="true"
      :aria-label="text.title"
    >
      <h1 name="maestro__tabAliasTitle" class="maestro-tab-alias__title">{{ text.title }}</h1>
      <p name="maestro__tabAliasSubtitle" class="maestro-tab-alias__subtitle">{{ dialog.tabLabel }}</p>
      <div ref="fieldRef" name="maestro__tabAliasField" class="maestro-tab-alias__field">
        <a-input
          name="maestro__tabAliasInput"
          class="maestro-tab-alias__input"
          size="mini"
          allow-clear
          spellcheck="false"
          autocomplete="off"
          :max-length="tabAliasStore.maxLength"
          :placeholder="text.placeholder"
          :model-value="tabAliasStore.draft"
          @update:model-value="tabAliasStore.updateDraft($event)"
        />
      </div>
      <p name="maestro__tabAliasHint" class="maestro-tab-alias__hint">{{ text.hint }}</p>
      <div name="maestro__tabAliasActions" class="maestro-tab-alias__actions">
        <a-button size="mini" type="text" :disabled="tabAliasStore.busy" @click="tabAliasStore.cancel()">
          {{ text.cancel }}
        </a-button>
        <a-button size="mini" type="primary" :disabled="tabAliasStore.busy" @click="tabAliasStore.confirm()">
          {{ text.save }}
        </a-button>
      </div>
    </section>
  </main>
</template>

<style lang="less">
@import './TabAliasApp.less';
</style>
