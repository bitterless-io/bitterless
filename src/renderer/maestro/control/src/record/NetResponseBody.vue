<script setup lang="ts">
import type { Row } from './record.types'
import { statusBadge } from './record.format'
import './NetResponseBody.less'

defineProps<{ row: Row }>()
</script>

<template>
  <div class="network-response">
    <div class="network-response__summary">
      <span class="network-response__status" :class="statusBadge(row.status)">{{ row.status }}</span>
      <span class="network-response__url">{{ row.url }}</span>
    </div>
  </div>
</template>
