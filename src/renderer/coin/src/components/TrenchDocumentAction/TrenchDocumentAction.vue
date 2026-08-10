<template>
  <div :name="`trench__detail__document-${kind}`" class="trench-document-action">
    <div class="trench-document-action__identity">
      <span>{{ title }}</span>
      <small v-if="contentHash">{{ contentHash }}</small>
    </div>
    <button
      :name="`trench__detail__copy-${kind}`"
      type="button"
      :aria-label="t('trench.actions.copyDocument', { document: title })"
      @click="copyDocument"
    >
      {{
        copyState === 'copied'
          ? t('trench.actions.copied')
          : copyState === 'failed'
            ? t('trench.actions.copyFailed')
            : t('trench.actions.copyJson')
      }}
    </button>
    <span
      :name="`trench__detail__copy-status-${kind}`"
      class="trench-document-action__status"
      role="status"
    >
      {{
        copyState === 'copied'
          ? t('trench.actions.copied')
          : copyState === 'failed'
            ? t('trench.actions.copyFailed')
            : ''
      }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrenchContentHash } from '@shared/trench/trench.type';

const props = defineProps<{
  document: string;
  title: string;
  kind: 'analysis' | 'tag' | 'holdings';
  contentHash?: TrenchContentHash | null;
}>();

const { t } = useI18n();
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');

watch(
  () => props.document,
  () => {
    copyState.value = 'idle';
  }
);

const copyDocument = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(props.document);
    copyState.value = 'copied';
  } catch {
    copyState.value = 'failed';
  }
};
</script>

<style lang="less">
@import './TrenchDocumentAction.less';
</style>
