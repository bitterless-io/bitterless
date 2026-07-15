<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Button, Message } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract, LogInfo } from '@maestro-shared/coach.api'
import './WorkbenchLogView.less'

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
  <section class="workbench-log">
    <div class="workbench-log__details">
      <span class="workbench-log__label">file</span>
      <span class="workbench-log__path">
        {{ info?.file || '-' }}
      </span>
      <Button size="small" :loading="opening" :disabled="!info" title="Reveal in Finder/Explorer" @click="openDir">
        Open
      </Button>

      <span class="workbench-log__label">env</span>
      <span class="workbench-log__value">{{ info?.env || '-' }}</span>
      <span></span>
    </div>
  </section>
</template>
