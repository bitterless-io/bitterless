<script setup lang="ts">
import type { Row } from './record.types'

// Fallback body for info / error / any other record kind: plain text + optional detail.
defineProps<{ row: Row }>()
</script>

<template>
  <div>
    <div class="mt-0.5 break-words text-[12px] text-gray-700">{{ row.text }}</div>
    <pre
      v-if="row.yaml || row.body"
      class="m-0 mt-1 max-h-[150px] overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 px-2 py-1 font-mono text-[11px] text-slate-600"
      >{{ row.yaml || row.body }}</pre
    >
  </div>
</template>
