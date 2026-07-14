<script setup lang="ts">
// Fixed-height thumbnail box: clicked element (action, 48px) or page viewport
// (snapshot, 96px). If wider than the panel it's clipped to the middle.
defineProps<{ shot: string; tall?: boolean }>()
</script>

<template>
  <div
    class="mt-1.5 flex max-w-full justify-center overflow-hidden rounded border border-gray-200 bg-gray-50"
    :class="tall ? 'h-24' : 'h-12'"
  >
    <img :src="shot" alt="thumbnail" class="h-full w-auto max-w-none" />
  </div>
</template>
