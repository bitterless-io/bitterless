<template>
  <a-modal
    :visible="eyesOnAgentsStore.threadSearchVisible"
    :title="i18nHelper.eyesOnAgents.search.title"
    :footer="false"
    :unmount-on-close="false"
    width="min(560px, calc(100vw - 32px))"
    modal-class="thread-search-modal"
    body-class="thread-search-modal__body"
    @cancel="closeThreadSearch"
    @open="handleModalOpen"
  >
    <section
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
          class="thread-search__input"
          size="mini"
          allow-clear
          :model-value="eyesOnAgentsStore.threadSearchQuery"
          :placeholder="i18nHelper.eyesOnAgents.search.placeholder"
          :input-attrs="inputAttributes"
          @update:model-value="handleQueryUpdate"
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
        <button
          v-for="thread in eyesOnAgentsStore.threadSearchResults"
          :id="threadSearchOptionId(thread.threadId)"
          :key="thread.threadId"
          name="eyesOnAgents__threadSearch__result"
          class="thread-search__result"
          :class="{
            'thread-search__result--selected':
              thread.threadId === eyesOnAgentsStore.threadSearchSelectedThreadId,
          }"
          type="button"
          role="option"
          tabindex="-1"
          :aria-label="resultAriaLabel(thread)"
          :aria-selected="
            thread.threadId === eyesOnAgentsStore.threadSearchSelectedThreadId
          "
          @mousedown.prevent
          @click="handleResultClick(thread.threadId)"
        >
          <span class="thread-search__result-title" :title="displayTitle(thread)">
            {{ displayTitle(thread) }}
          </span>
          <span
            class="thread-search__result-domain"
            :title="customDomainTitle(thread) ?? undefined"
          >
            {{ customDomainTitle(thread) ?? '-' }}
          </span>
          <span class="thread-search__result-state">
            {{ runtimeLabel(thread) }}
          </span>
        </button>

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
import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const RESULT_LIST_ID = 'eyes-on-agents-thread-search-results';
const inputRef = ref<{ focus: () => void } | null>(null);
const resultsRef = ref<HTMLElement | null>(null);

const threadSearchOptionId = (threadId: string): string =>
  `eyes-on-agents-thread-search-option-${encodeURIComponent(threadId)}`;

const selectedOptionId = computed(() => {
  const threadId = eyesOnAgentsStore.threadSearchSelectedThreadId;
  return threadId ? threadSearchOptionId(threadId) : undefined;
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

const displayTitle = (thread: EyesOnAgentsThread): string =>
  thread.title?.trim()
  || `${i18nHelper.eyesOnAgents.thread.untitled} · ${thread.threadId.slice(0, 8)}`;

const customDomainTitle = (thread: EyesOnAgentsThread): string | null =>
  eyesOnAgentsStore.customDomainTitle(thread.domainId);

const domainAriaLabel = (thread: EyesOnAgentsThread): string => {
  const title = customDomainTitle(thread);
  if (!title) return i18nHelper.eyesOnAgents.search.noDomain;
  return i18nHelper.eyesOnAgents.search.domainContext.replace('{domain}', title);
};

const runtimeLabel = (thread: EyesOnAgentsThread): string => {
  switch (thread.runtimeState) {
    case 'working': return i18nHelper.eyesOnAgents.thread.working;
    case 'waiting_approval': return i18nHelper.eyesOnAgents.thread.waitingApproval;
    case 'waiting_input': return i18nHelper.eyesOnAgents.thread.waitingInput;
    case 'idle': return i18nHelper.eyesOnAgents.thread.idle;
    case 'failed': return i18nHelper.eyesOnAgents.thread.failed;
    case 'ended': return i18nHelper.eyesOnAgents.thread.ended;
    default: return i18nHelper.eyesOnAgents.thread.unknown;
  }
};

const resultAriaLabel = (thread: EyesOnAgentsThread): string => [
  displayTitle(thread),
  domainAriaLabel(thread),
  runtimeLabel(thread),
  thread.isUnread ? i18nHelper.eyesOnAgents.thread.new : '',
].filter(Boolean).join(', ');

const focusInput = async (): Promise<void> => {
  await nextTick();
  inputRef.value?.focus();
};

const scrollSelectedResultIntoView = async (): Promise<void> => {
  await nextTick();
  const optionId = selectedOptionId.value;
  if (!optionId || !resultsRef.value) return;
  document.getElementById(optionId)?.scrollIntoView({ block: 'nearest' });
};

const closeThreadSearch = (): void => {
  eyesOnAgentsStore.closeThreadSearch();
};

const handleQueryUpdate = (query: string): void => {
  eyesOnAgentsStore.setThreadSearchQuery(query);
};

const handleModalOpen = (): void => {
  void focusInput();
  void scrollSelectedResultIntoView();
};

const openSelectedResult = async (): Promise<void> => {
  await eyesOnAgentsStore.openSelectedThreadSearchResult().catch(() => undefined);
  await focusInput();
};

const handleResultClick = async (threadId: string): Promise<void> => {
  await eyesOnAgentsStore.openThreadSearchResult(threadId).catch(() => undefined);
  await focusInput();
};

const handleKeydown = (event: KeyboardEvent): void => {
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
  () => eyesOnAgentsStore.threadSearchSelectedThreadId,
  () => {
    void scrollSelectedResultIntoView();
  },
);

defineExpose({ focusInput });
</script>

<style lang="less">
@import './ThreadSearch.less';
</style>
