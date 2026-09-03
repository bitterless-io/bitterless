<template>
  <section
    v-if="dialog"
    name="onlypreview__alertNewFolder"
    class="onlypreview-alert-panel onlypreview-alert-newfolder"
    role="dialog"
    aria-modal="true"
    :aria-label="dialog.title"
  >
    <h1 name="onlypreview__alertNewFolderTitle" class="onlypreview-alert-title">
      {{ dialog.title }}
    </h1>
    <p
      v-if="dialog.destinationLabel"
      name="onlypreview__alertNewFolderDestination"
      class="onlypreview-alert-subtitle"
    >
      {{ dialog.destinationLabel }}
    </p>
    <label name="onlypreview__alertNewFolderField" class="onlypreview-alert-field">
      <span class="onlypreview-alert-field-label">{{ dialog.nameLabel }}</span>
      <input
        ref="inputRef"
        name="onlypreview__alertNewFolderInput"
        class="onlypreview-alert-input"
        :class="{ 'onlypreview-alert-input--rejected': onlyPreviewAlertStore.nameRejected }"
        :value="onlyPreviewAlertStore.draft"
        spellcheck="false"
        autocomplete="off"
        @input="onInput"
      />
    </label>
    <p name="onlypreview__alertNewFolderHint" class="onlypreview-alert-hint">
      {{ onlyPreviewAlertStore.nameRejected ? dialog.invalidNameMessage : '' }}
    </p>
    <div name="onlypreview__alertNewFolderActions" class="onlypreview-alert-actions">
      <button
        name="onlypreview__alertNewFolderCancel"
        class="onlypreview-alert-button"
        type="button"
        @click="onlyPreviewAlertStore.cancel()"
      >
        {{ dialog.cancelLabel }}
      </button>
      <button
        name="onlypreview__alertNewFolderConfirm"
        class="onlypreview-alert-button onlypreview-alert-button--primary"
        type="button"
        :disabled="!onlyPreviewAlertStore.nameValid || onlyPreviewAlertStore.busy"
        @click="onlyPreviewAlertStore.commit()"
      >
        {{ dialog.confirmLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { onlyPreviewAlertStore } from '../../onlyPreviewAlert.store';

const inputRef = ref<HTMLInputElement | null>(null);
const dialog = computed(() => onlyPreviewAlertStore.newFolder);

const onInput = (event: Event): void => {
  onlyPreviewAlertStore.updateDraft((event.target as HTMLInputElement).value);
};

// The owner's rule: 「自动激活 input」. Selected, not just focused, so Enter alone creates the
// suggested folder and the first keystroke replaces it. The error dialog raises `focusRevision`
// again when it closes, which is what returns the caret to the rejected name.
watch(
  () => [onlyPreviewAlertStore.focusRevision, !!dialog.value, !!onlyPreviewAlertStore.error],
  async () => {
    if (!dialog.value || onlyPreviewAlertStore.error) return;
    await nextTick();
    const input = inputRef.value;
    if (!input) return;
    input.focus();
    input.select();
  },
  { immediate: true }
);
</script>

<style lang="less">
@import './AlertNewFolder.less';
</style>
