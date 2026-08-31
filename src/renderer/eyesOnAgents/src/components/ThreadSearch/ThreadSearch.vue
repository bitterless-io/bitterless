<template>
  <a-modal
    :visible="eyesOnAgentsStore.threadSearchVisible"
    :title="i18nHelper.eyesOnAgents.search.title"
    :footer="false"
    :mask-closable="true"
    :unmount-on-close="false"
    width="min(560px, calc(100vw - 32px))"
    popup-container=".eyes-on-agents__main"
    modal-class="thread-search-modal"
    body-class="thread-search-modal__body"
    @cancel="closeThreadSearch"
    @open="handleModalOpen"
  >
    <section
      id="eyes-on-agents-thread-search-dialog"
      name="eyesOnAgents__threadSearch"
      class="thread-search"
      role="search"
    >
      <div
        name="eyesOnAgents__threadSearch__inputRegion"
        class="thread-search__input-region"
      >
        <a-input
          ref="inputRef"
          name="eyesOnAgents__threadSearch__input"
          class="thread-search__input"
          size="mini"
          allow-clear
          :model-value="eyesOnAgentsStore.titleDraft"
          :placeholder="i18nHelper.eyesOnAgents.search.placeholder"
          :input-attrs="inputAttributes"
          @update:model-value="handleTitleInput"
          @clear="handleQueryClear"
          @keydown="handleKeydown"
        >
          <template #prefix>
            <IconSearch :size="13" aria-hidden="true" />
          </template>
        </a-input>
      </div>

      <div
        :id="RESULT_LIST_ID"
        ref="resultsRef"
        name="eyesOnAgents__threadSearch__results"
        class="thread-search__results"
        role="listbox"
        :aria-label="i18nHelper.eyesOnAgents.search.results"
      >
        <div
          v-for="thread in eyesOnAgentsStore.threadSearchResults"
          :id="threadSearchOptionId(thread.sessionKey)"
          :key="thread.sessionKey"
          name="eyesOnAgents__threadSearch__result"
          class="thread-search__result"
          :class="{
            'thread-search__result--selected':
              thread.sessionKey === eyesOnAgentsStore.threadSearchSelectedSessionKey,
          }"
          role="option"
          :aria-selected="
            thread.sessionKey === eyesOnAgentsStore.threadSearchSelectedSessionKey
          "
          @mousedown.prevent
          @click.capture="eyesOnAgentsStore.selectThreadSearchResult(thread.sessionKey)"
        >
          <ThreadCard :thread="thread" />
        </div>

        <div
          v-if="eyesOnAgentsStore.threadSearchResults.length === 0"
          name="eyesOnAgents__threadSearch__empty"
          class="thread-search__empty"
          role="status"
        >
          {{ emptyMessage }}
        </div>
      </div>
    </section>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { IconSearch } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ThreadCard from '../ThreadCard/ThreadCard.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const RESULT_LIST_ID = 'eyes-on-agents-thread-search-results';
const inputRef = ref<{ focus?: () => void } | null>(null);
const resultsRef = ref<HTMLElement | null>(null);

const threadSearchOptionId = (sessionKey: string): string =>
  `eyes-on-agents-thread-search-option-${encodeURIComponent(sessionKey)}`;

const selectedOptionId = computed(() => {
  const sessionKey = eyesOnAgentsStore.threadSearchSelectedSessionKey;
  return sessionKey ? threadSearchOptionId(sessionKey) : undefined;
});

const inputAttributes = computed(() => ({
  autofocus: true,
  role: 'combobox',
  'aria-label': i18nHelper.eyesOnAgents.search.placeholder,
  'aria-autocomplete': 'list',
  'aria-controls': RESULT_LIST_ID,
  'aria-expanded': eyesOnAgentsStore.threadSearchVisible,
  'aria-activedescendant': selectedOptionId.value,
}));

const emptyMessage = computed(() =>
  eyesOnAgentsStore.hasThreadSearchQueryTokens
    ? i18nHelper.eyesOnAgents.search.empty
    : i18nHelper.eyesOnAgents.search.startTyping);

const focusInput = async (): Promise<void> => {
  await nextTick();
  inputRef.value?.focus?.();
};

const scrollSelectedResultIntoView = async (): Promise<void> => {
  await nextTick();
  if (!selectedOptionId.value || !resultsRef.value) return;
  resultsRef.value
    .querySelector<HTMLElement>('.thread-search__result--selected')
    ?.scrollIntoView({ block: 'nearest' });
};

const closeThreadSearch = (): void => {
  eyesOnAgentsStore.closeThreadSearch();
};

const handleTitleInput = (value: string): void => {
  eyesOnAgentsStore.setTitleDraft(value);
};

const handleModalOpen = (): void => {
  void focusInput();
  void scrollSelectedResultIntoView();
};

const handleQueryClear = (): void => {
  eyesOnAgentsStore.clearTitleQuery();
  void focusInput();
};

const openSelectedResult = async (): Promise<void> => {
  await eyesOnAgentsStore.openSelectedThreadSearchResult().catch(() => undefined);
};

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.isComposing) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    eyesOnAgentsStore.moveThreadSearchSelection(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    eyesOnAgentsStore.moveThreadSearchSelection(-1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    void openSelectedResult();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeThreadSearch();
  }
};

watch(
  () => eyesOnAgentsStore.threadSearchSelectedSessionKey,
  () => {
    void scrollSelectedResultIntoView();
  },
);
</script>

<style lang="less">
@import './ThreadSearch.less';
</style>
