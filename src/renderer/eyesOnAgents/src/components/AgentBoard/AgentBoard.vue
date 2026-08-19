<template>
  <div name="eyesOnAgents__board" class="agent-board">
    <DomainColumn
      ref="focusColumnRef"
      name="eyesOnAgents__focusColumn"
      :title="i18nHelper.eyesOnAgents.board.focus"
      :threads="eyesOnAgentsStore.filteredFocusThreads"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import DomainColumn from '../DomainColumn/DomainColumn.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

interface FocusColumnInstance {
  openTitleSearch(): Promise<void>;
}

const focusColumnRef = ref<FocusColumnInstance | null>(null);

const openTitleSearch = async (): Promise<void> => {
  await focusColumnRef.value?.openTitleSearch();
};

defineExpose({ openTitleSearch });
</script>

<style lang="less">
@import './AgentBoard.less';
</style>
