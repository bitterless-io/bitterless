<template>
  <section
    v-if="dialog"
    name="onlypreview__alertConfirm"
    class="onlypreview-alert-panel onlypreview-alert-confirm"
    role="dialog"
    aria-modal="true"
    :aria-label="dialog.title"
  >
    <h1 name="onlypreview__alertConfirmTitle" class="onlypreview-alert-title">
      {{ dialog.title }}
    </h1>
    <ul
      v-if="dialog.entries.length"
      name="onlypreview__alertConfirmEntries"
      class="onlypreview-alert-entries onlypreview-alert-confirm-entries"
    >
      <li
        v-for="entry in dialog.entries"
        :key="entry.relativePath"
        name="onlypreview__alertConfirmEntry"
        class="onlypreview-alert-entry"
      >
        <span class="onlypreview-alert-entry-path">{{ entry.relativePath }}</span>
        <span v-if="entry.nodeKind === 'directory'" class="onlypreview-alert-entry-tag">
          {{ dialog.folderTag }}
        </span>
      </li>
      <li
        v-if="dialog.moreLabel"
        name="onlypreview__alertConfirmEntryMore"
        class="onlypreview-alert-entry-more"
      >
        {{ dialog.moreLabel }}
      </li>
    </ul>
    <p name="onlypreview__alertConfirmMessage" class="onlypreview-alert-message">
      {{ dialog.message }}
    </p>
    <div name="onlypreview__alertConfirmActions" class="onlypreview-alert-actions">
      <button
        ref="cancelRef"
        name="onlypreview__alertConfirmCancel"
        class="onlypreview-alert-button"
        type="button"
        :disabled="onlyPreviewAlertStore.busy"
        @click="onlyPreviewAlertStore.cancel()"
      >
        {{ dialog.cancelLabel }}
      </button>
      <button
        name="onlypreview__alertConfirmConfirm"
        class="onlypreview-alert-button"
        :class="
          dialog.destructive
            ? 'onlypreview-alert-button--destructive'
            : 'onlypreview-alert-button--primary'
        "
        type="button"
        :disabled="onlyPreviewAlertStore.busy"
        @click="onlyPreviewAlertStore.commit()"
      >
        {{ dialog.confirmLabel }}
        <span v-if="dialog.confirmHint" class="onlypreview-alert-button-hint">
          {{ dialog.confirmHint }}
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { onlyPreviewAlertStore } from '../../onlyPreviewAlert.store';

const cancelRef = ref<HTMLButtonElement | null>(null);
const dialog = computed(() => onlyPreviewAlertStore.confirm);

// Cancel holds the initial focus, so the default gesture on a permanent delete is the safe one. The
// confirm gesture is the Cmd/Ctrl+Enter shown on the other button.
watch(
  () => [onlyPreviewAlertStore.focusRevision, !!dialog.value, !!onlyPreviewAlertStore.error],
  async () => {
    if (!dialog.value || onlyPreviewAlertStore.error) return;
    await nextTick();
    cancelRef.value?.focus();
  },
  { immediate: true }
);
</script>

<style lang="less">
@import './AlertConfirm.less';
</style>
