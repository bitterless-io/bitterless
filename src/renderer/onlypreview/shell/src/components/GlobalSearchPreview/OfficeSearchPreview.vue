ke<template>
  <section name="onlypreview__globalSearchOfficePreview" class="onlypreview-office-preview">
    <div ref="viewerElement" class="onlypreview-office-preview__viewer"></div>
    <div
      v-if="loading"
      name="onlypreview__globalSearchOfficePending"
      class="onlypreview-search-preview__office-state"
      role="status"
    >
      <span>{{ onlyPreviewI18n.globalSearch.previewPending }}</span>
      <strong>{{ preview.name }}</strong>
    </div>
    <div
      v-else-if="errorMessage"
      name="onlypreview__globalSearchOfficeError"
      class="onlypreview-search-preview__office-state onlypreview-search-preview__office-state--error"
      role="alert"
    >
      {{ errorMessage }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewGlobalSearchPreview } from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewEnv } from '../../../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { OnlyPreviewOfficeSession } from '../../../../preview/src/onlyPreviewOfficeSession.service';
import { OnlyPreviewGlobalSearchOfficeReadSession } from '../../onlyPreviewGlobalSearchOfficeRead.service';

const props = defineProps<{
  preview: Extract<OnlyPreviewGlobalSearchPreview, { kind: 'office' }>;
  previewRevision: number;
}>();

const viewerElement = ref<HTMLElement | null>(null);
const loading = ref(true);
const errorMessage = ref('');
let mounted = true;
const readSession = new OnlyPreviewGlobalSearchOfficeReadSession(props.preview);
const officeSession = new OnlyPreviewOfficeSession({
  hostId: onlyPreviewEnv.hostId || 'global-search',
  selectionRevision: props.previewRevision,
  kind: props.preview.adapter,
  sourceExtension: props.preview.sourceExtension,
  expectedSize: props.preview.size,
  readBytes: () => readSession.readBytes(),
  onRuntimeError: (errorCode) => {
    if (!mounted) return;
    loading.value = false;
    errorMessage.value = getOnlyPreviewErrorMessage(errorCode);
  }
});

onMounted(async () => {
  const element = viewerElement.value;
  if (!element || !Number.isSafeInteger(props.previewRevision)) {
    loading.value = false;
    errorMessage.value = getOnlyPreviewErrorMessage('INVALID_INPUT');
    void readSession.cancel();
    return;
  }
  try {
    await officeSession.mount(element);
    if (mounted) loading.value = false;
  } catch (error) {
    if (!mounted) return;
    officeSession.dispose();
    loading.value = false;
    errorMessage.value = getOnlyPreviewErrorMessage(
      error instanceof OnlyPreviewContractError ? error.code : 'OPERATION_FAILED'
    );
  }
});

onBeforeUnmount(() => {
  mounted = false;
  void readSession.cancel();
  officeSession.dispose();
});
</script>

<style lang="less">
@import '../../../../preview/src/components/OfficePreview/OfficePreview.less';
</style>
