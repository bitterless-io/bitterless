<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button } from '@arco-design/web-vue'
import { IconBrowser } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { agentBrowserStore as store } from './store/agentBrowser.store'
import './AgentBrowserTabs.less'

const props = defineProps<{ sessionId: string; running: boolean }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const copy = computed(() => i18nHelper.maestroControl.chat.browserTabs)
const countLabel = computed(() => copy.value.associated.replace('{count}', String(store.state?.tabs.length ?? 0)))
watch(() => props.sessionId, (id) => { open.value = false; void store.select(id) }, { immediate: true })
const outside = (event: PointerEvent): void => { if (!root.value?.contains(event.target as Node)) open.value = false }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" name="maestro__browser-tabs" class="agent-browser-tabs" @keydown.esc="open = false">
    <Button type="text" size="mini" class="agent-browser-tabs__trigger" :aria-expanded="open" aria-controls="agent-browser-tabs-list" @click="open = !open">
      <template #icon><IconBrowser :size="15" stroke="1.8" /></template>
      <span class="agent-browser-tabs__label">{{ store.loading ? copy.loading : countLabel }}</span>
    </Button>
    <div v-if="open" id="agent-browser-tabs-list" name="maestro__browser-tabs__list" class="agent-browser-tabs__list" role="region" :aria-label="countLabel">
      <p v-if="store.loading" class="agent-browser-tabs__message">{{ copy.loading }}</p>
      <p v-else-if="!store.state?.tabs.length" class="agent-browser-tabs__message">{{ copy.empty }}</p>
      <p v-if="store.error" class="agent-browser-tabs__error" role="alert">{{ copy.failed }}: {{ store.error }}</p>
      <button v-for="tab in store.state?.tabs ?? []" :key="tab.id" type="button" name="maestro__browser-tabs__row" class="agent-browser-tabs__row" :title="`${tab.title}\n${tab.url}\n${tab.id}`" @click="store.show(tab.id)">
        <span class="agent-browser-tabs__heading">
          <span class="agent-browser-tabs__title">{{ tab.title || tab.url || tab.id }}</span>
          <span class="agent-browser-tabs__status">{{ copy.status[tab.status] }}</span>
        </span>
        <span class="agent-browser-tabs__url">{{ tab.url }}</span>
        <span class="agent-browser-tabs__meta">{{ tab.id }}{{ store.state?.selectedTabId === tab.id ? ` · ${copy.selected}` : '' }}</span>
        <span v-if="tab.error" class="agent-browser-tabs__error">{{ tab.error }}</span>
      </button>
    </div>
  </div>
</template>
