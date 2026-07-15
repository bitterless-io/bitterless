<script setup lang="ts">
import type { Row } from './record.types'
import { statusBadge } from './record.format'
import './NetRequestBody.less'

defineProps<{ row: Row }>()
</script>

<template>
  <div class="network-request">
    <div class="network-request__summary">
      <span class="network-request__method">{{ row.method }}</span>
      <span v-if="row.status" class="network-request__status" :class="statusBadge(row.status)">{{ row.status }}</span>
      <span class="network-request__url">{{ row.url }}</span>
    </div>
  </div>
</template>
