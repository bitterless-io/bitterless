<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { IconX } from '@tabler/icons-vue'
import { xpcRenderer } from 'electron-xpc/renderer'
import type { WorkbenchPane } from '@cowork-shared/coach.api'
import { isWorkbenchPane, workbenchPanes, workbenchStore as store } from './workbench.store'

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
  <div class="flex h-full min-h-0 w-full overflow-hidden bg-[#f8fafc] py-3  pl-3 pr-0">
    <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden p-2 bg-white rounded-2xl">
      <header class="flex shrink-0 flex-col bg-white">
        <div class="flex h-8 shrink-0 items-center justify-between gap-3 pl-3 pr-2">
          <h1 class="m-0 min-w-0 truncate text-[13px] font-semibold text-gray-800">Cowork Workbench</h1>
          <button
            class="grid h-7 w-7 shrink-0 place-items-center rounded-md leading-none text-gray-400 transition hover:bg-black/5 hover:text-gray-700 active:scale-95 active:bg-black/10"
            title="Close Workbench"
            aria-label="Close Workbench"
            type="button"
            @click="store.close()"
          >
            <IconX :size="17" stroke="1.8" />
          </button>
        </div>
        <nav class="flex h-8 shrink-0 min-w-0 items-center gap-5 border-b border-gray-200 pl-3 pr-2 mt-3">
          <button
            v-for="pane in workbenchPanes"
            :key="pane"
            type="button"
            class="relative h-full px-0 text-[12px] font-medium transition"
            :class="activePane === pane ? 'text-[#165dff]' : 'text-gray-500 hover:text-gray-800'"
            @click="setPane(pane)"
          >
            {{ labels[pane] }}
            <span
              class="absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-opacity"
              :class="activePane === pane ? 'bg-[#165dff] opacity-100' : 'opacity-0'"
            ></span>
          </button>
        </nav>
      </header>
      <main class="min-h-0 flex-1 overflow-hidden mt-3">
        <RouterView />
      </main>
    </div>
  </div>
</template>
