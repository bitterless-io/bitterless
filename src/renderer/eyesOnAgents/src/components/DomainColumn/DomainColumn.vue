<template>
  <section name="eyesOnAgents__domainColumn" class="agent-domain">
    <header class="agent-domain__header">
      <a-tooltip :content="searchTooltip" position="bottom" mini>
        <a-button
          name="eyesOnAgents__domainColumn__search"
          class="agent-domain__search"
          size="mini"
          type="text"
          :aria-label="i18nHelper.eyesOnAgents.actions.searchTitles"
          aria-haspopup="dialog"
          aria-controls="eyes-on-agents-thread-search-dialog"
          :aria-expanded="eyesOnAgentsStore.threadSearchVisible"
          @click="openThreadSearch"
        >
          <template #icon>
            <IconSearch :size="14" aria-hidden="true" />
          </template>
        </a-button>
      </a-tooltip>
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
        <span>{{ i18nHelper.eyesOnAgents.board.emptyFocus }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconCircleCheck, IconSearch } from '@tabler/icons-vue';
import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import ThreadCard from '../ThreadCard/ThreadCard.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

defineProps<{
  threads: EyesOnAgentsThread[];
}>();

const searchTooltip = computed(() => uaHelper.isMac
  ? i18nHelper.eyesOnAgents.actions.searchTitlesMac
  : i18nHelper.eyesOnAgents.actions.searchTitlesWindows);

const openThreadSearch = (): void => {
  eyesOnAgentsStore.openThreadSearch();
};
</script>

<style lang="less">
@import './DomainColumn.less';
</style>
