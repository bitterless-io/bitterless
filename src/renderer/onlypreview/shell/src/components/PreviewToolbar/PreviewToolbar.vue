<template>
  <header name="onlypreview__previewToolbar" class="onlypreview-preview-toolbar">
    <div
      v-if="relativePath"
      name="onlypreview__previewIdentity"
      class="onlypreview-preview-toolbar__identity"
    >
      <span class="onlypreview-preview-toolbar__file-name">{{ fileName }}</span>
      <span class="onlypreview-preview-toolbar__file-path" :title="relativePath">
        {{ relativePath }}
      </span>
    </div>
    <div
      v-if="presentation?.fileRef"
      name="onlypreview__previewToolbarTrailing"
      class="onlypreview-preview-toolbar__trailing"
    >
      <span
        v-if="descriptorType"
        name="onlypreview__previewType"
        class="onlypreview-preview-toolbar__badge"
      >
        {{ descriptorType }}
      </span>
      <FileActions />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
import FileActions from '../FileActions/FileActions.vue';

const presentation = computed(() => onlyPreviewShellStore.previewPresentation);
const relativePath = computed(
  () =>
    presentation.value?.descriptor?.relativePath || presentation.value?.fileRef?.relativePath || ''
);
const fileName = computed(
  () => presentation.value?.descriptor?.name || relativePath.value.split('/').at(-1) || ''
);
const descriptorType = computed(() => {
  const descriptor = presentation.value?.descriptor;
  if (descriptor) {
    return (
      descriptor.language ||
      descriptor.extension.replace(/^\./, '').toUpperCase() ||
      descriptor.kind
    );
  }
  return relativePath.value.split('.').at(-1)?.toUpperCase() || '';
});
</script>

<style lang="less">
@import './PreviewToolbar.less';
</style>
