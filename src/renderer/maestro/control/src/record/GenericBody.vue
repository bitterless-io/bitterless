<script setup lang="ts">
import type { Row } from './record.types'
import './GenericBody.less'

// Fallback body for info / error / any other record kind: plain text + optional detail.
defineProps<{ row: Row }>()
</script>

<template>
  <div class="generic-record">
    <div class="generic-record__text">{{ row.text }}</div>
    <pre
      v-if="row.yaml || row.body"
      class="generic-record__detail"
      >{{ row.yaml || row.body }}</pre
    >
  </div>
</template>
