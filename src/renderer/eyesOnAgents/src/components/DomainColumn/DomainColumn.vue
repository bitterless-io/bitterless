<template>
  <section
    name="eyesOnAgents__domainColumn"
    class="agent-domain agent-domain--focus"
  >
    <header class="agent-domain__header">
      <div class="agent-domain__title-row">
        <IconTargetArrow :size="15" />
        <h2 class="agent-domain__title">{{ title }}</h2>
      </div>

      <a-button
        ref="titleSearchButtonRef"
        name="eyesOnAgents__domainColumn__titleSearchToggle"
        class="agent-domain__search-trigger"
        size="mini"
        type="text"
        :aria-label="i18nHelper.eyesOnAgents.actions.searchTitles"
        :aria-expanded="titleSearchOpen"
        aria-controls="eyes-on-agents-focus-title-search"
        @click="toggleTitleSearch"
      >
        <template #icon><IconSearch :size="13" aria-hidden="true" /></template>
      </a-button>

      <a-button
        name="eyesOnAgents__domainColumn__readAll"
        class="agent-domain__read-all"
        size="mini"
        type="text"
        :disabled="
          eyesOnAgentsStore.readableFocusThreads.length === 0
            || Boolean(eyesOnAgentsStore.busyAction)
        "
        :loading="eyesOnAgentsStore.busyAction === 'focus-read-all'"
        @click="markAllRead"
      >
        {{ i18nHelper.eyesOnAgents.actions.readAll }}
      </a-button>
    </header>

    <div
      v-if="titleSearchOpen"
      id="eyes-on-agents-focus-title-search"
      name="eyesOnAgents__domainColumn__titleSearch"
      class="agent-domain__search-row"
      role="search"
      :aria-label="i18nHelper.eyesOnAgents.actions.searchTitles"
      @keydown.esc.prevent.stop="closeTitleSearch"
    >
      <a-input
        ref="titleSearchInputRef"
        v-model="eyesOnAgentsStore.titleQuery"
        class="agent-domain__search-input"
        size="mini"
        :placeholder="i18nHelper.eyesOnAgents.board.titleSearchPlaceholder"
        :aria-label="i18nHelper.eyesOnAgents.actions.searchTitles"
      />
      <a-button
        name="eyesOnAgents__domainColumn__clearTitleSearch"
        class="agent-domain__search-clear"
        size="mini"
        type="text"
        :aria-label="i18nHelper.eyesOnAgents.actions.clearTitleSearch"
        @click="clearTitleSearch"
      >
        <template #icon><IconX :size="12" aria-hidden="true" /></template>
      </a-button>
    </div>

    <ProjectFilter />

    <div name="eyesOnAgents__domainColumn__body" class="agent-domain__body">
      <div class="agent-domain__thread-list">
        <ThreadCard
          v-for="thread in threads"
          :key="thread.sessionKey"
          :thread="thread"
        />
      </div>

      <div v-if="threads.length === 0" class="agent-domain__empty">
        <IconCircleCheck :size="20" />
        <span>{{ emptyLabel }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import {
  IconCircleCheck,
  IconSearch,
  IconTargetArrow,
  IconX,
} from '@tabler/icons-vue';
import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ThreadCard from '../ThreadCard/ThreadCard.vue';
import ProjectFilter from '../ProjectFilter/ProjectFilter.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

defineProps<{
  title: string;
  threads: EyesOnAgentsThread[];
}>();

const titleSearchOpen = ref(false);
const titleSearchButtonRef = ref<{ $el?: HTMLElement } | null>(null);
const titleSearchInputRef = ref<{ focus?: () => void } | null>(null);
const emptyLabel = computed(() => {
  if (eyesOnAgentsStore.isTitleFiltered) {
    return i18nHelper.eyesOnAgents.board.emptyTitleSearch;
  }
  if (!eyesOnAgentsStore.isProjectFiltered) {
    return i18nHelper.eyesOnAgents.board.emptyFocus;
  }
  return eyesOnAgentsStore.projectFilter.type === 'none'
    ? i18nHelper.eyesOnAgents.board.emptyNoProject
    : i18nHelper.eyesOnAgents.board.emptyProject;
});

const focusTitleSearchInput = async (): Promise<void> => {
  await nextTick();
  titleSearchInputRef.value?.focus?.();
};

const closeTitleSearch = async (): Promise<void> => {
  eyesOnAgentsStore.clearTitleQuery();
  titleSearchOpen.value = false;
  await nextTick();
  titleSearchButtonRef.value?.$el?.focus();
};

const openTitleSearch = async (): Promise<void> => {
  titleSearchOpen.value = true;
  await focusTitleSearchInput();
};

const toggleTitleSearch = async (): Promise<void> => {
  if (titleSearchOpen.value) {
    await closeTitleSearch();
    return;
  }
  await openTitleSearch();
};

const clearTitleSearch = async (): Promise<void> => {
  eyesOnAgentsStore.clearTitleQuery();
  await focusTitleSearchInput();
};

const markAllRead = async (): Promise<void> => {
  await eyesOnAgentsStore.markAllRead().catch(() => undefined);
};

onBeforeUnmount(() => {
  eyesOnAgentsStore.clearTitleQuery();
});

defineExpose({ openTitleSearch });
</script>

<style lang="less">
@import './DomainColumn.less';
</style>
