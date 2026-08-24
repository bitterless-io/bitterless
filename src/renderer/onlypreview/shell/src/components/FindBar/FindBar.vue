<template>
  <div
    name="onlypreview__findBar"
    class="onlypreview-find-bar"
    role="search"
    :aria-label="onlyPreviewI18n.preview.findLabel"
  >
    <input
      ref="inputRef"
      name="onlypreview__findInput"
      class="onlypreview-find-bar__input"
      type="search"
      autocomplete="off"
      spellcheck="false"
      :value="onlyPreviewFindStore.query"
      :placeholder="onlyPreviewI18n.preview.findPlaceholder"
      :aria-label="onlyPreviewI18n.preview.findLabel"
      :aria-busy="onlyPreviewFindStore.pending"
      @input="handleInput"
      @compositionstart="onlyPreviewFindStore.beginComposition()"
      @compositionend="handleCompositionEnd"
      @keydown.enter="handleEnter"
      @keydown.esc.prevent.stop="onlyPreviewFindStore.close()"
    />
    <button
      name="onlypreview__findCaseSensitive"
      class="onlypreview-find-bar__button onlypreview-find-bar__case"
      :class="{ 'onlypreview-find-bar__button--active': onlyPreviewFindStore.caseSensitive }"
      type="button"
      :disabled="onlyPreviewFindStore.pending || onlyPreviewFindStore.composing"
      :aria-label="onlyPreviewI18n.preview.findCaseSensitive"
      :aria-pressed="onlyPreviewFindStore.caseSensitive"
      :title="onlyPreviewI18n.preview.findCaseSensitive"
      @click="onlyPreviewFindStore.toggleCaseSensitive()"
    >
      Aa
    </button>
    <button
      name="onlypreview__findPrevious"
      class="onlypreview-find-bar__button"
      type="button"
      :disabled="!canNavigate"
      :aria-label="onlyPreviewI18n.preview.findPrevious"
      :title="onlyPreviewI18n.preview.findPrevious"
      @click="onlyPreviewFindStore.previous()"
    >
      <IconChevronUp :size="15" />
    </button>
    <button
      name="onlypreview__findNext"
      class="onlypreview-find-bar__button"
      type="button"
      :disabled="!canNavigate"
      :aria-label="onlyPreviewI18n.preview.findNext"
      :title="onlyPreviewI18n.preview.findNext"
      @click="onlyPreviewFindStore.next()"
    >
      <IconChevronDown :size="15" />
    </button>
    <span
      name="onlypreview__findCount"
      class="onlypreview-find-bar__count"
      :title="onlyPreviewFindStore.pending ? onlyPreviewI18n.preview.findPending : undefined"
    >
      {{ countLabel }}
    </span>
    <button
      name="onlypreview__findClose"
      class="onlypreview-find-bar__button"
      type="button"
      :aria-label="onlyPreviewI18n.preview.findClose"
      :title="onlyPreviewI18n.preview.findClose"
      @click="onlyPreviewFindStore.close()"
    >
      <IconX :size="15" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewFindStore } from '../../onlyPreviewFind.store';

const inputRef = ref<HTMLInputElement | null>(null);
const canNavigate = computed(
  () =>
    !onlyPreviewFindStore.composing &&
    onlyPreviewFindStore.ready &&
    onlyPreviewFindStore.query.length > 0
);
const countLabel = computed(() => {
  if (onlyPreviewFindStore.pending || !onlyPreviewFindStore.query) return '';
  const result = onlyPreviewFindStore.result;
  if (!result) return '';
  const count = `${result.activeMatchOrdinal}/${result.matches}`;
  return onlyPreviewFindStore.partial ? `${count} · ${onlyPreviewI18n.preview.findPartial}` : count;
});

const handleInput = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  onlyPreviewFindStore.acceptInput(input.value, (event as InputEvent).isComposing);
};

const handleCompositionEnd = (event: CompositionEvent): void => {
  onlyPreviewFindStore.endComposition((event.target as HTMLInputElement).value);
};

const handleEnter = (event: KeyboardEvent): void => {
  if (event.isComposing || onlyPreviewFindStore.composing || !canNavigate.value) return;
  event.preventDefault();
  if (event.shiftKey) onlyPreviewFindStore.previous();
  else onlyPreviewFindStore.next();
};

onMounted(() => inputRef.value?.focus());

watch(
  () => onlyPreviewFindStore.focusRevision,
  () => void nextTick(() => inputRef.value?.focus())
);
</script>

<style lang="less">
@import './FindBar.less';
</style>
