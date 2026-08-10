<template>
  <header name="onlypreview__previewHeader" class="onlypreview-preview-header">
    <div
      v-if="onlyPreviewPreviewHeaderStore.metadata"
      name="onlypreview__previewIdentity"
      class="onlypreview-preview-header__identity"
    >
      <span class="onlypreview-preview-header__file-name">
        {{ onlyPreviewPreviewHeaderStore.metadata.fileName }}
      </span>
      <span class="onlypreview-preview-header__file-path">
        {{ onlyPreviewPreviewHeaderStore.metadata.relativePath }}
      </span>
    </div>
    <span
      v-if="onlyPreviewPreviewHeaderStore.metadata"
      name="onlypreview__previewType"
      class="onlypreview-preview-header__badge"
    >
      {{ onlyPreviewPreviewHeaderStore.descriptorType }}
    </span>
  </header>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { onlyPreviewPreviewHeaderStore } from './onlyPreviewPreviewHeader.store';

onMounted(() => {
  onlyPreviewPreviewHeaderStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
