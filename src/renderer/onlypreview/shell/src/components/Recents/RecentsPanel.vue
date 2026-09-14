<template>
  <section
    id="onlypreview-panel-recents"
    name="onlypreview__recentsPanel"
    class="onlypreview-recents"
    role="tabpanel"
    aria-labelledby="onlypreview-tab-recents"
    :aria-busy="onlyPreviewRecentsStore.loading"
  >
    <div
      v-if="onlyPreviewRecentsStore.errorMessage"
      class="onlypreview-recents__state onlypreview-recents__state--error"
      role="alert"
    >
      {{ onlyPreviewRecentsStore.errorMessage }}
      <a-button
        v-if="onlyPreviewRecentsStore.loadError"
        size="mini"
        @click="onlyPreviewRecentsStore.refresh()"
        >{{ onlyPreviewI18n.recents.retry }}</a-button
      >
    </div>
    <div
      v-if="onlyPreviewRecentsStore.loading && !onlyPreviewRecentsStore.snapshot"
      class="onlypreview-recents__state"
      role="status"
    >
      {{ onlyPreviewI18n.recents.loading }}
    </div>
    <div v-else-if="!onlyPreviewRecentsStore.entries.length" class="onlypreview-recents__state">
      {{ onlyPreviewI18n.recents.empty }}
    </div>
    <div
      v-else
      ref="listRef"
      name="onlypreview__recentsList"
      class="onlypreview-recents__list"
      role="listbox"
      :aria-label="onlyPreviewI18n.recents.label"
    >
      <button
        v-for="entry in onlyPreviewRecentsStore.entries"
        :key="entry.id"
        name="onlypreview__recentRow"
        class="onlypreview-recents__row"
        :class="{
          'onlypreview-recents__row--selected': entry.id === onlyPreviewRecentsStore.snapshot?.activeEntryId
        }"
        :data-recent-id="entry.id"
        :title="entry.relativePath"
        type="button"
        role="option"
        :aria-selected="entry.id === onlyPreviewRecentsStore.snapshot?.activeEntryId"
        :tabindex="entry.id === onlyPreviewRecentsStore.selectedEntryId ? 0 : -1"
        @click="onlyPreviewRecentsStore.select(entry.id)"
        @dblclick.prevent="open(entry.id)"
        @keydown="handleKeydown($event, entry.id)"
      >
        <span class="onlypreview-recents__identity">
          <span class="onlypreview-recents__name">{{ entry.name }}</span>
          <span class="onlypreview-recents__path">{{ entry.relativePath }}</span>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewRecentsStore } from '../../onlyPreviewRecents.store';

const listRef = ref<HTMLElement | null>(null);
const open = (entryId: string): void => {
  onlyPreviewRecentsStore.select(entryId);
  void onlyPreviewRecentsStore.openSelected();
};
const handleKeydown = (event: KeyboardEvent, entryId: string): void => {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    open(entryId);
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const entries = onlyPreviewRecentsStore.entries;
  const index = entries.findIndex((entry) => entry.id === entryId);
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? entries.length - 1
        : Math.max(0, Math.min(entries.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
  const next = entries[nextIndex];
  if (!next) return;
  onlyPreviewRecentsStore.select(next.id);
  void nextTick(() => {
    for (const row of listRef.value?.querySelectorAll<HTMLElement>('[data-recent-id]') ?? []) {
      if (row.dataset.recentId === next.id) row.focus();
    }
  });
};
</script>
