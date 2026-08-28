<template>
  <GlobalSearchWorkspace />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import GlobalSearchWorkspace from '../../shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue';
import { onlyPreviewGlobalSearchStore } from '../../shell/src/onlyPreviewGlobalSearch.store';

const dismissFromBodyGutter = (event: MouseEvent): void => {
  if (event.target !== document.body) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void onlyPreviewGlobalSearchStore.dismiss();
};

onMounted(() => document.body.addEventListener('click', dismissFromBodyGutter));
onUnmounted(() => document.body.removeEventListener('click', dismissFromBodyGutter));
</script>

<style lang="less">
@import './App.less';
</style>
