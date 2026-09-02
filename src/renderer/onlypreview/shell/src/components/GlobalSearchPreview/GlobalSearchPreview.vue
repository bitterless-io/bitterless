<template>
  <div name="onlypreview__globalSearchPreview" class="onlypreview-search-preview">
    <div
      v-if="onlyPreviewGlobalSearchStore.previewPending"
      name="onlypreview__globalSearchPreviewPending"
      class="onlypreview-search-preview__state"
      role="status"
    >
      <span>{{ onlyPreviewI18n.globalSearch.previewPending }}</span>
      <strong v-if="previewSelectionName">{{ previewSelectionName }}</strong>
    </div>
    <div
      v-else-if="onlyPreviewGlobalSearchStore.previewError"
      name="onlypreview__globalSearchPreviewError"
      class="onlypreview-search-preview__state onlypreview-search-preview__state--error"
      role="alert"
    >
      {{ onlyPreviewGlobalSearchStore.previewError }}
    </div>
    <component
      :is="previewComponent"
      v-else-if="previewComponent && onlyPreviewGlobalSearchStore.preview"
      :key="previewComponentKey"
      v-bind="previewProps"
    />
    <div v-else class="onlypreview-search-preview__state">
      {{ onlyPreviewI18n.globalSearch.previewEmpty }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewGlobalSearchStore } from '../../onlyPreviewGlobalSearch.store';

const previewComponents: Record<string, Component> = {
  plain: defineAsyncComponent(() => import('./PlainSearchPreview.vue')),
  markdown: defineAsyncComponent(() => import('./RichSearchPreview.vue')),
  'html-static': defineAsyncComponent(() => import('./RichSearchPreview.vue')),
  directory: defineAsyncComponent(() => import('./DirectorySearchPreview.vue')),
  office: defineAsyncComponent(() => import('./OfficeSearchPreview.vue')),
  info: defineAsyncComponent(() => import('./InfoSearchPreview.vue'))
};

const previewSelectionName = computed(() => {
  const result = onlyPreviewGlobalSearchStore.selectedResult;
  return result?.section === 'files' ? result.name : result?.fileName || '';
});

const previewComponentKey = computed(() => {
  const preview = onlyPreviewGlobalSearchStore.preview;
  const identity = preview?.kind === 'office' ? preview.resultToken : preview?.name || 'empty';
  return `${onlyPreviewGlobalSearchStore.previewComponentRevision}:${identity}`;
});

const previewProps = computed(() => {
  const preview = onlyPreviewGlobalSearchStore.preview;
  if (!preview) return {};
  return preview.kind === 'office'
    ? {
        preview,
        previewRevision: onlyPreviewGlobalSearchStore.previewComponentRevision
      }
    : { preview };
});

const previewComponent = computed(() => {
  const preview = onlyPreviewGlobalSearchStore.preview;
  if (!preview) return null;
  return preview.kind === 'text'
    ? previewComponents[preview.adapter]
    : previewComponents[preview.kind];
});
</script>

<style lang="less">
@import './GlobalSearchPreview.less';
</style>
