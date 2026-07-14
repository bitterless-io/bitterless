<script setup lang="ts">
import type { Row } from './record.types'
import RecordThumb from './RecordThumb.vue'

defineProps<{ row: Row }>()
</script>

<template>
  <div>
    <div class="mt-0.5 break-words text-[12px] text-gray-700">{{ row.text }}</div>
    <RecordThumb v-if="row.shot" :shot="row.shot" />
    <pre
      v-if="row.yaml"
      class="m-0 mt-1 max-h-[150px] overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 px-2 py-1 font-mono text-[11px] text-slate-600"
      >{{ row.yaml }}</pre
    >
  </div>
</template>
