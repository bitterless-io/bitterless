<template>
  <section
    v-if="dialog"
    name="onlypreview__alertError"
    class="onlypreview-alert-panel onlypreview-alert-panel--error onlypreview-alert-error"
    role="alertdialog"
    aria-modal="true"
    :aria-label="dialog.title"
  >
    <h1 name="onlypreview__alertErrorTitle" class="onlypreview-alert-title">{{ dialog.title }}</h1>
    <p name="onlypreview__alertErrorMessage" class="onlypreview-alert-message">
      {{ dialog.message }}
    </p>
    <div name="onlypreview__alertErrorActions" class="onlypreview-alert-actions">
      <button
        ref="confirmRef"
        name="onlypreview__alertErrorConfirm"
        class="onlypreview-alert-button onlypreview-alert-button--primary"
        type="button"
        :disabled="onlyPreviewAlertStore.busy"
        @click="onlyPreviewAlertStore.dismissError()"
      >
        {{ dialog.confirmLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { onlyPreviewAlertStore } from '../../onlyPreviewAlert.store';

const confirmRef = ref<HTMLButtonElement | null>(null);
const dialog = computed(() => onlyPreviewAlertStore.error);

// One button, one outcome. Focusing it means Enter reaches it natively as well as through the
// window-level handler, and a screen reader announces the dialog with its action.
watch(
  () => [onlyPreviewAlertStore.focusRevision, !!dialog.value],
  async () => {
    if (!dialog.value) return;
    await nextTick();
    confirmRef.value?.focus();
  },
  { immediate: true }
);
</script>

<style lang="less">
@import './AlertError.less';
</style>
