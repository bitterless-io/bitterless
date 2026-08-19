<template>
  <div name="onlypreview__previewApp" class="onlypreview-preview-app">
    <PreviewHeader />
    <PreviewSurface />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import PreviewHeader from './components/PreviewHeader/PreviewHeader.vue';
import PreviewSurface from './components/PreviewSurface/PreviewSurface.vue';
import { onlyPreviewPreviewStore } from './onlyPreviewPreview.store';

onMounted(() => {
  void onlyPreviewPreviewStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
