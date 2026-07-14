<script setup lang="ts">
import type { Row } from './record.types'
import { statusBadge } from './record.format'

defineProps<{ row: Row }>()
</script>

<template>
  <div>
    <div class="mt-0.5 flex items-center gap-1.5 text-[12px]">
      <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" :class="statusBadge(row.status)">{{ row.status }}</span>
      <span class="truncate text-gray-700">{{ row.url }}</span>
    </div>
  </div>
</template>
