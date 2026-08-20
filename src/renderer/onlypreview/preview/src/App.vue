<template>
  <div name="onlypreview__previewApp" class="onlypreview-preview-app">
    <PreviewSurface />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import PreviewSurface from './components/PreviewSurface/PreviewSurface.vue';
import { onlyPreviewPreviewStore } from './onlyPreviewPreview.store';

onMounted(() => {
  void onlyPreviewPreviewStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
