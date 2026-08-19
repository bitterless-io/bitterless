<template>
  <header name="onlypreview__previewHeader" class="onlypreview-preview-header">
    <div
      v-if="relativePath"
      name="onlypreview__previewIdentity"
      class="onlypreview-preview-header__identity"
    >
      <span class="onlypreview-preview-header__file-name">{{ fileName }}</span>
      <span class="onlypreview-preview-header__file-path" :title="relativePath">
        {{ relativePath }}
      </span>
    </div>
    <div
      v-if="onlyPreviewPreviewStore.currentRef"
      name="onlypreview__previewHeaderTrailing"
      class="onlypreview-preview-header__trailing"
    >
      <span
        v-if="onlyPreviewPreviewStore.descriptorType"
        name="onlypreview__previewType"
        class="onlypreview-preview-header__badge"
      >
        {{ onlyPreviewPreviewStore.descriptorType }}
      </span>
      <FileActions />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import FileActions from '../FileActions/FileActions.vue';

// The descriptor is absent while a file is loading and after a failed describe, so identity and the
// native file actions fall back to the current selection instead of disappearing.
const relativePath = computed(
  () =>
    onlyPreviewPreviewStore.descriptor?.relativePath ||
    onlyPreviewPreviewStore.currentRef?.relativePath ||
    ''
);

const fileName = computed(
  () => onlyPreviewPreviewStore.descriptor?.name || relativePath.value.split('/').at(-1) || ''
);
</script>

<style lang="less">
@import './PreviewHeader.less';
</style>
