<script setup lang="ts">
import './RecordThumb.less'

// Fixed-height thumbnail box: clicked element (action, 48px) or page viewport
// (snapshot, 96px). If wider than the panel it's clipped to the middle.
defineProps<{ shot: string; tall?: boolean }>()
</script>

<template>
  <div
    class="record-thumbnail"
    :class="{ 'record-thumbnail--tall': tall }"
  >
    <img :src="shot" alt="thumbnail" class="record-thumbnail__image" />
  </div>
</template>
