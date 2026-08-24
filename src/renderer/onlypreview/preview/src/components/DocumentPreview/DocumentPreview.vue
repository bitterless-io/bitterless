<template>
  <article
    name="onlypreview__documentPreview"
    class="onlypreview-document"
    :aria-label="onlyPreviewI18n.preview.documentLabel"
  >
    <div
      ref="documentRef"
      name="onlypreview__documentBody"
      class="onlypreview-document__body"
      role="document"
    ></div>
  </article>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { countOnlyPreviewDomSelection } from '../../onlyPreviewCharacterCount.service';
import type { OnlyPreviewDocumentRender } from '../../onlyPreviewDocument.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

const props = defineProps<{
  content: OnlyPreviewDocumentRender;
  reportingRevision: string;
}>();
const emit = defineEmits<{
  ready: [];
}>();

const documentRef = ref<HTMLElement | null>(null);
let styleElement: HTMLStyleElement | null = null;
let active = true;

const reportSelection = (): void => {
  onlyPreviewPreviewStore.reportCharacterCount(
    countOnlyPreviewDomSelection(documentRef.value, window.getSelection()),
    props.reportingRevision
  );
};

onMounted(async () => {
  const documentBody = documentRef.value;
  if (!documentBody) {
    onlyPreviewPreviewStore.reportSurfaceError(props.reportingRevision, 'DOCUMENT_SANITIZE_FAILED');
    return;
  }
  const style = document.createElement('style');
  style.textContent = props.content.cssText;
  documentBody.before(style);
  styleElement = style;
  documentBody.replaceChildren(props.content.fragment);
  await nextTick();
  if (!active) return;
  if (!documentBody.isConnected || documentBody.childNodes.length === 0) {
    style.remove();
    styleElement = null;
    documentBody.replaceChildren();
    onlyPreviewPreviewStore.reportSurfaceError(props.reportingRevision, 'DOCUMENT_SANITIZE_FAILED');
    return;
  }
  document.addEventListener('selectionchange', reportSelection);
  onlyPreviewPreviewStore.armCharacterCountReporting(props.reportingRevision);
  emit('ready');
});

onBeforeUnmount(() => {
  active = false;
  document.removeEventListener('selectionchange', reportSelection);
  onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
  styleElement?.remove();
  styleElement = null;
  documentRef.value?.replaceChildren();
});
</script>

<style lang="less">
@import './DocumentPreview.less';
</style>
