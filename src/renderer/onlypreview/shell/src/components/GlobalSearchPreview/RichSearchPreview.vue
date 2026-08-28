<template>
  <!-- eslint-disable vue/no-v-html -- both branches use zero-attribute allowlists. -->
  <article
    name="onlypreview__globalSearchRichPreview"
    class="onlypreview-markdown__document onlypreview-search-preview__rich"
    v-html="safeHtml"
  ></article>
  <!-- eslint-enable vue/no-v-html -->
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OnlyPreviewGlobalSearchPreview } from '@shared/onlypreview/onlyPreviewSearch.type';
import { renderOnlyPreviewMarkdown } from '../../../../preview/src/onlyPreviewMarkdown.service';
import { sanitizeOnlyPreviewStaticHtml } from './onlyPreviewStaticHtml.service';

const props = defineProps<{
  preview: Extract<OnlyPreviewGlobalSearchPreview, { kind: 'text' }>;
}>();

const safeHtml = computed(() => {
  if (props.preview.adapter === 'html-static') {
    return sanitizeOnlyPreviewStaticHtml(props.preview.text, window);
  }
  const rendered = renderOnlyPreviewMarkdown(
    props.preview.text,
    new TextEncoder().encode(props.preview.text).byteLength,
    window
  );
  return rendered.ok ? rendered.html : '';
});
</script>
