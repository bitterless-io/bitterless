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

// 聚焦即全选 —— 两条路都要。
//
// `v-if="onlyPreviewFindStore.open"`(PreviewToolbar)意味着关掉再开是一次重新挂载,所以
// 「重新打开」走 onMounted,「已经开着再按一次 Cmd+F」走 focusRevision
// (`handleFocusRequest` 只在 `open` 已为真时递增它)。两种情形下人要做的事都一样:
// 直接打新的词。只聚焦不全选,就得先自己把旧词选掉。
//
// 同一个 shell 里的 Global Search 早就是 focus + select(`GlobalSearchWorkspace.vue`),
// 这里只是把它对齐 —— 两个搜索框在同一个界面上却行为不同,本身就是缺陷。
const focusAndSelect = (): void => {
  const input = inputRef.value;
  if (!input) return;
  input.focus();
  input.select();
};

onMounted(focusAndSelect);

watch(
  () => onlyPreviewFindStore.focusRevision,
  () => void nextTick(focusAndSelect)
);
</script>

<style lang="less">
@import './FindBar.less';
</style>
