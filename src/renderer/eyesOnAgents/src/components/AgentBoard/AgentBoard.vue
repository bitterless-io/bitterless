<template>
  <div name="eyesOnAgents__board" class="agent-board">
    <DomainColumn
      ref="focusColumnRef"
      name="eyesOnAgents__focusColumn"
      :threads="eyesOnAgentsStore.filteredFocusThreads"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import DomainColumn from '../DomainColumn/DomainColumn.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

interface FocusColumnInstance {
  focusTitleSearch(): Promise<void>;
}

const focusColumnRef = ref<FocusColumnInstance | null>(null);

const focusTitleSearch = async (): Promise<void> => {
  await focusColumnRef.value?.focusTitleSearch();
};

defineExpose({ focusTitleSearch });
</script>

<style lang="less">
@import './AgentBoard.less';
</style>
