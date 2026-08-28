<template>
  <section name="onlypreview__officePreview" class="onlypreview-office-preview">
    <div ref="viewerElement" class="onlypreview-office-preview__viewer"></div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { countOnlyPreviewDomSelection } from '../../onlyPreviewCharacterCount.service';
import { onlyPreviewFindAdapterBridge } from '../../onlyPreviewFindAdapter.service';
import type { OnlyPreviewOfficeSessionApi } from '../../onlyPreviewOfficeSession.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

const props = defineProps<{
  session: OnlyPreviewOfficeSessionApi;
  reportingRevision: string;
}>();

const emit = defineEmits<{
  ready: [];
  error: [errorCode: OnlyPreviewErrorCode];
}>();

const viewerElement = ref<HTMLElement | null>(null);
let unregisterFind: (() => void) | null = null;
let mounted = true;

const reportSelection = (): void => {
  onlyPreviewPreviewStore.reportCharacterCount(
    countOnlyPreviewDomSelection(viewerElement.value, window.getSelection()),
    props.reportingRevision
  );
};

onMounted(async () => {
  const element = viewerElement.value;
  const selectionRevision = Number(props.reportingRevision);
  if (!element || !Number.isSafeInteger(selectionRevision)) {
    emit('error', 'INVALID_INPUT');
    return;
  }
  try {
    await props.session.mount(element);
    if (!mounted) return;
    unregisterFind = onlyPreviewFindAdapterBridge.register(
      'office',
      selectionRevision,
      props.session
    );
    if (props.session.supportsTextSelection) {
      document.addEventListener('selectionchange', reportSelection);
      onlyPreviewPreviewStore.armCharacterCountReporting(props.reportingRevision);
    }
    emit('ready');
  } catch (error) {
    if (!mounted) return;
    emit('error', error instanceof OnlyPreviewContractError ? error.code : 'OPERATION_FAILED');
  }
});

onBeforeUnmount(() => {
  mounted = false;
  document.removeEventListener('selectionchange', reportSelection);
  onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
  props.session.clear();
  unregisterFind?.();
  unregisterFind = null;
  props.session.dispose();
});
</script>

<style lang="less">
@import './OfficePreview.less';
</style>
