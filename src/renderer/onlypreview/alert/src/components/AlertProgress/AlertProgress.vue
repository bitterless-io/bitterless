<template>
  <section
    v-if="dialog"
    name="onlypreview__alertProgress"
    class="onlypreview-alert-panel onlypreview-alert-progress"
    role="dialog"
    aria-modal="true"
    :aria-label="dialog.title"
  >
    <h1 name="onlypreview__alertProgressTitle" class="onlypreview-alert-title">
      {{ dialog.title }}
    </h1>
    <p name="onlypreview__alertProgressMessage" class="onlypreview-alert-message">
      {{ dialog.message }}
    </p>
    <div
      name="onlypreview__alertProgressTrack"
      class="onlypreview-alert-progress__track"
      role="progressbar"
      :aria-valuemin="determinate ? 0 : undefined"
      :aria-valuemax="determinate ? dialog.total : undefined"
      :aria-valuenow="determinate ? dialog.completed : undefined"
    >
      <div
        name="onlypreview__alertProgressFill"
        :class="[
          'onlypreview-alert-progress__fill',
          determinate
            ? 'onlypreview-alert-progress__fill--determinate'
            : 'onlypreview-alert-progress__fill--indeterminate'
        ]"
        :style="determinate ? { width: `${ratio * 100}%` } : undefined"
      ></div>
    </div>
    <p
      v-if="dialog.countLabel"
      name="onlypreview__alertProgressCount"
      class="onlypreview-alert-progress__count"
    >
      {{ dialog.countLabel }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onlyPreviewAlertStore } from '../../onlyPreviewAlert.store';

const dialog = computed(() => onlyPreviewAlertStore.progress);

/**
 * A count is only shown when the run really is stepping through more than one thing.
 *
 * Deleting one big folder is a single selection entry, so a bar drawn from it would sit at zero for
 * the whole wait and then jump — it would be describing the loop, not the work. That case gets an
 * indeterminate bar instead. See docs/features/onlypreview-delete-progress.md #1.
 */
const determinate = computed(() => (dialog.value?.total ?? 0) > 1);

const ratio = computed(() => {
  const current = dialog.value;
  if (!current || current.total <= 0) return 0;
  return Math.min(1, Math.max(0, current.completed / current.total));
});
</script>

<style scoped>
@import './AlertProgress.less';
</style>
