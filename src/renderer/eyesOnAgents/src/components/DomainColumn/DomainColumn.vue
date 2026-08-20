<template>
  <section name="eyesOnAgents__domainColumn" class="agent-domain">
    <header class="agent-domain__header" role="search">
      <a-input
        ref="titleSearchInputRef"
        name="eyesOnAgents__domainColumn__titleSearch"
        class="agent-domain__search-input"
        size="mini"
        allow-clear
        :model-value="eyesOnAgentsStore.titleDraft"
        :placeholder="titleSearchPlaceholder"
        :aria-label="i18nHelper.eyesOnAgents.actions.searchTitles"
        @update:model-value="handleTitleInput"
        @clear="clearTitleSearch"
        @keydown.esc.prevent.stop="clearTitleSearch"
      >
        <template #prefix>
          <IconSearch :size="12" aria-hidden="true" />
        </template>
      </a-input>

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
import { IconCircleCheck, IconSearch } from '@tabler/icons-vue';
import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import ThreadCard from '../ThreadCard/ThreadCard.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

defineProps<{
  threads: EyesOnAgentsThread[];
}>();

const titleSearchInputRef = ref<{ focus?: () => void } | null>(null);
const titleSearchPlaceholder = computed(() => uaHelper.isMac
  ? i18nHelper.eyesOnAgents.actions.searchTitlesMac
  : i18nHelper.eyesOnAgents.actions.searchTitlesWindows);
const emptyLabel = computed(() => eyesOnAgentsStore.isTitleFiltered
  ? i18nHelper.eyesOnAgents.board.emptyTitleSearch
  : i18nHelper.eyesOnAgents.board.emptyFocus);

const handleTitleInput = (value: string): void => {
  eyesOnAgentsStore.setTitleDraft(value);
};

const focusTitleSearch = async (): Promise<void> => {
  await nextTick();
  titleSearchInputRef.value?.focus?.();
};

const clearTitleSearch = async (): Promise<void> => {
  eyesOnAgentsStore.clearTitleQuery();
  await focusTitleSearch();
};

const markAllRead = async (): Promise<void> => {
  await eyesOnAgentsStore.markAllRead().catch(() => undefined);
};

onBeforeUnmount(() => {
  eyesOnAgentsStore.clearTitleQuery();
});

defineExpose({ focusTitleSearch });
</script>

<style lang="less">
@import './DomainColumn.less';
</style>
