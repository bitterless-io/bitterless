<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { IconX } from '@tabler/icons-vue'
import { xpcRenderer } from 'electron-xpc/renderer'
import type { WorkbenchPane } from '@maestro-shared/coach.api'
import { isWorkbenchPane, workbenchPanes, workbenchStore as store } from './workbench.store'
import './WorkbenchApp.less'

const router = useRouter()
const route = useRoute()

const labels: Record<WorkbenchPane, string> = {
  recording: 'Capture',
  skills: 'Skills',
  integrations: 'Integrations',
  injections: 'Injections',
  tools: 'Tools',
  models: 'Models',
  about: 'About',
  log: 'Log'
}

const activePane = computed<WorkbenchPane>(() => {
  const name = String(route.name || '').toLowerCase()
  return isWorkbenchPane(name) ? name : 'recording'
})

const setPane = (pane: WorkbenchPane): void => {
  if (pane === activePane.value) return
  void router.push({ name: pane })
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

const onUndoKey = (event: KeyboardEvent): void => {
  if (activePane.value !== 'recording') return
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || (event.key !== 'z' && event.key !== 'Z')) return
  if (isEditableTarget(event.target)) return
  if (!store.rows.some((row) => row.is_deleted)) return
  event.preventDefault()
  store.undoDelete()
}

watch(
  activePane,
  (pane) => {
    store.setPane(pane)
  },
  { immediate: true }
)

watch(
  () => store.activePane,
  (pane) => {
    if (pane !== activePane.value) void router.push({ name: pane })
  }
)

onMounted(() => {
  xpcRenderer.subscribe('coach/workbench-pane', (payload) => {
    const pane = (payload.params as { pane?: string } | undefined)?.pane || ''
    if (isWorkbenchPane(pane)) setPane(pane)
  })
  window.addEventListener('keydown', onUndoKey)
  void store.init()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onUndoKey)
  store.destroy()
})
</script>

<template>
  <div class="workbench-app">
    <div class="workbench-app__shell">
      <header class="workbench-app__header">
        <div class="workbench-app__titlebar">
          <h1 class="workbench-app__title">Maestro Workbench</h1>
          <button
            class="workbench-app__close"
            title="Close Workbench"
            aria-label="Close Workbench"
            type="button"
            @click="store.close()"
          >
            <IconX :size="17" stroke="1.8" />
          </button>
        </div>
        <nav class="workbench-app__tabs">
          <button
            v-for="pane in workbenchPanes"
            :key="pane"
            type="button"
            class="workbench-app__tab"
            :class="{ 'workbench-app__tab--active': activePane === pane }"
            @click="setPane(pane)"
          >
            {{ labels[pane] }}
            <span
              class="workbench-app__tab-indicator"
            ></span>
          </button>
        </nav>
      </header>
      <main class="workbench-app__content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
