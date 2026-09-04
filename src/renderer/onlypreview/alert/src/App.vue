<template>
  <main
    v-if="onlyPreviewAlertStore.keyboardLayer !== 'none'"
    name="onlypreview__alertCanvas"
    class="onlypreview-alert-canvas"
  >
    <div name="onlypreview__alertScrim" class="onlypreview-alert-scrim"></div>
    <AlertNewFolder v-if="onlyPreviewAlertStore.newFolder" />
    <AlertConfirm v-else-if="onlyPreviewAlertStore.confirm" />
    <AlertProgress v-else-if="onlyPreviewAlertStore.progress" />
    <AlertError v-if="onlyPreviewAlertStore.error" />
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import AlertConfirm from './components/AlertConfirm/AlertConfirm.vue';
import AlertError from './components/AlertError/AlertError.vue';
import AlertProgress from './components/AlertProgress/AlertProgress.vue';
import AlertNewFolder from './components/AlertNewFolder/AlertNewFolder.vue';
import { onlyPreviewAlertStore } from './onlyPreviewAlert.store';

// Capture phase, on the window: the dialog's own input handles typing, and Escape has to reach the
// dialog even while the caret is in that input.
const handleKeydown = (event: KeyboardEvent): void => {
  const handled = onlyPreviewAlertStore.handleKey({
    key: event.key,
    meta: event.metaKey,
    control: event.ctrlKey,
    alt: event.altKey,
    composing: event.isComposing
  });
  if (!handled) return;
  event.preventDefault();
  event.stopImmediatePropagation();
};

onMounted(() => window.addEventListener('keydown', handleKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown, true));
</script>

<style lang="less">
@import './App.less';
</style>
