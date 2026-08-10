<template>
  <div name="onlypreview__htmlPreview" class="onlypreview-html">
    <!-- eslint-disable vue/no-v-html -- renderResult is sanitized with a zero-attribute allowlist. -->
    <article
      v-if="renderResult.ok"
      ref="documentRef"
      name="onlypreview__htmlDocument"
      class="onlypreview-html__document"
      v-html="renderResult.html"
    ></article>
    <div v-else name="onlypreview__htmlError" class="onlypreview-html__error" role="alert">
      {{ htmlError }}
    </div>
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { OnlyPreviewTextContent } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { countOnlyPreviewDomSelection } from '../../onlyPreviewCharacterCount.service';
import { renderOnlyPreviewHtml } from '../../onlyPreviewHtml.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

const props = defineProps<{
  content: OnlyPreviewTextContent;
  reportingRevision: string;
}>();
const documentRef = ref<HTMLElement | null>(null);
let mounted = false;
let disposeSelectionListener: (() => void) | null = null;

const renderResult = computed(() =>
  renderOnlyPreviewHtml(props.content.text, props.content.size, window)
);

const htmlError = computed(() =>
  !renderResult.value.ok && renderResult.value.reason === 'too-large'
    ? onlyPreviewI18n.preview.htmlLimit
    : onlyPreviewI18n.preview.failedTitle
);

const reportSelection = (): void => {
  onlyPreviewPreviewStore.reportCharacterCount(
    countOnlyPreviewDomSelection(documentRef.value, window.getSelection()),
    props.reportingRevision
  );
};

const disposeSelection = (): void => {
  disposeSelectionListener?.();
  disposeSelectionListener = null;
  onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
};

const activateSuccessfulRender = (): void => {
  disposeSelection();
  if (!mounted || !renderResult.value.ok) return;
  document.addEventListener('selectionchange', reportSelection);
  disposeSelectionListener = () => document.removeEventListener('selectionchange', reportSelection);
  onlyPreviewPreviewStore.armCharacterCountReporting(props.reportingRevision);
};

watch(
  () => [
    props.content.workspaceId,
    props.content.relativePath,
    props.content.text,
    props.content.size,
    props.reportingRevision
  ],
  activateSuccessfulRender,
  { flush: 'post' }
);

onMounted(() => {
  mounted = true;
  activateSuccessfulRender();
});
onBeforeUnmount(() => {
  mounted = false;
  disposeSelection();
});
</script>

<style lang="less">
@import './HtmlPreview.less';
</style>
