<template>
  <div name="onlypreview__markdownPreview" class="onlypreview-markdown">
    <!-- eslint-disable vue/no-v-html -- renderResult is sanitized with a zero-attribute allowlist. -->
    <article
      v-if="renderResult.ok"
      ref="documentRef"
      name="onlypreview__markdownDocument"
      class="onlypreview-markdown__document"
      v-html="renderResult.html"
    ></article>
    <div v-else name="onlypreview__markdownError" class="onlypreview-markdown__error" role="alert">
      {{ markdownError }}
    </div>
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { OnlyPreviewTextContent } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { countOnlyPreviewDomSelection } from '../../onlyPreviewCharacterCount.service';
import { renderOnlyPreviewMarkdown } from '../../onlyPreviewMarkdown.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

const props = defineProps<{
  content: OnlyPreviewTextContent;
  reportingRevision: string;
}>();
const documentRef = ref<HTMLElement | null>(null);

const renderResult = computed(() =>
  renderOnlyPreviewMarkdown(props.content.text, props.content.size, window)
);

const markdownError = computed(() =>
  !renderResult.value.ok && renderResult.value.reason === 'too-large'
    ? onlyPreviewI18n.preview.markdownLimit
    : onlyPreviewI18n.preview.failedTitle
);

const reportSelection = (): void => {
  onlyPreviewPreviewStore.reportCharacterCount(
    countOnlyPreviewDomSelection(documentRef.value, window.getSelection()),
    props.reportingRevision
  );
};

watch(
  () => [
    props.content.workspaceId,
    props.content.relativePath,
    props.content.text,
    props.reportingRevision
  ],
  () => onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision),
  { immediate: true }
);

onMounted(() => {
  document.addEventListener('selectionchange', reportSelection);
  if (renderResult.value.ok) {
    onlyPreviewPreviewStore.armCharacterCountReporting(props.reportingRevision);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', reportSelection);
  onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
});
</script>

<style lang="less">
@import './MarkdownPreview.less';
</style>
