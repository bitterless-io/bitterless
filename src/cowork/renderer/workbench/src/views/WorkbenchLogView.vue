<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Button, Message } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract, LogInfo } from '@cowork-shared/coach.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const info = ref<LogInfo | null>(null)
const opening = ref(false)

onMounted(async () => {
  info.value = await coach.getLogInfo()
})

const openDir = async (): Promise<void> => {
  if (opening.value) return
  opening.value = true
  try {
    const result = await coach.openLogDirectory()
    if (!result.ok) Message.error('Open failed: ' + (result.error || 'unknown'))
  } catch (err) {
    Message.error('Open failed: ' + (err as Error).message)
  } finally {
    opening.value = false
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-white p-4">
    <div class="grid max-w-[860px] grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2">
      <span class="text-[11px] font-bold uppercase tracking-wide text-gray-500">file</span>
      <span class="min-w-0 select-text break-all rounded border border-gray-300 bg-gray-50 px-2 py-1.5 font-mono text-[12px] text-gray-700">
        {{ info?.file || '-' }}
      </span>
      <Button size="small" :loading="opening" :disabled="!info" title="Reveal in Finder/Explorer" @click="openDir">
        Open
      </Button>

      <span class="text-[11px] font-bold uppercase tracking-wide text-gray-500">env</span>
      <span class="text-[12px] text-gray-700">{{ info?.env || '-' }}</span>
      <span></span>
    </div>
  </section>
</template>
