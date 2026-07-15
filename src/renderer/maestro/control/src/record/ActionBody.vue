<script setup lang="ts">
import type { Row } from './record.types'
import RecordThumb from './RecordThumb.vue'
import './ActionBody.less'

defineProps<{ row: Row }>()
</script>

<template>
  <div class="action-record">
    <div class="action-record__text">{{ row.text }}</div>
    <RecordThumb v-if="row.shot" :shot="row.shot" />
    <pre
      v-if="row.yaml"
      class="action-record__detail"
      >{{ row.yaml }}</pre
    >
  </div>
</template>
