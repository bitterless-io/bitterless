<script setup lang="ts">
import type { Row } from './record.types'
import { urlPath } from './record.format'
import RecordThumb from './RecordThumb.vue'
import './SnapshotBody.less'

defineProps<{ row: Row }>()
</script>

<template>
  <div class="snapshot-record">
    <div class="snapshot-record__summary">
      <div class="snapshot-record__text">{{ row.text }}</div>
      <div v-if="row.url" class="snapshot-record__url" :title="row.url">{{ urlPath(row.url) }}</div>
    </div>
    <RecordThumb v-if="row.shot" :shot="row.shot" tall />
    <pre
      v-if="row.yaml"
      class="snapshot-record__detail"
      >{{ row.yaml }}</pre
    >
  </div>
</template>
