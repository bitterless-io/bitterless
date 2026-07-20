<template>
  <div name="eyesOnAgents__board" class="agent-board">
    <draggable
      name="eyesOnAgents__domainList"
      class="agent-board__columns"
      :model-value="eyesOnAgentsStore.customDomains"
      item-key="id"
      handle=".agent-domain__drag-handle"
      :animation="180"
      @end="handleDomainDragEnd"
    >
      <template #header>
        <DomainColumn
          name="eyesOnAgents__focusColumn"
          :title="i18nHelper.eyesOnAgents.board.focus"
          :threads="eyesOnAgentsStore.focusThreads"
          focus
        />

        <DomainColumn
          v-if="eyesOnAgentsStore.uncategorizedDomain"
          name="eyesOnAgents__allColumn"
          :domain="eyesOnAgentsStore.uncategorizedDomain"
          :title="i18nHelper.eyesOnAgents.board.all"
          :threads="eyesOnAgentsStore.filteredAllThreads"
          :total-count="eyesOnAgentsStore.allThreads.length"
          all
          project-filter
        />
      </template>

      <template #item="{ element }">
        <DomainColumn
          :domain="element"
          :title="element.title"
          :threads="eyesOnAgentsStore.threadsForDomain(element.id)"
        />
      </template>

      <template #footer>
        <AddDomainColumn />
      </template>
    </draggable>
  </div>
</template>

<script setup lang="ts">
import draggable from 'vuedraggable';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import AddDomainColumn from '../AddDomainColumn/AddDomainColumn.vue';
import DomainColumn from '../DomainColumn/DomainColumn.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

interface DomainDragEvent {
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
}

const handleDomainDragEnd = async (event: DomainDragEvent): Promise<void> => {
  if (
    event.oldDraggableIndex === undefined
    || event.newDraggableIndex === undefined
  ) return;
  await eyesOnAgentsStore
    .reorderCustomDomains(event.oldDraggableIndex, event.newDraggableIndex)
    .catch(() => undefined);
};
</script>

<style lang="less">
@import './AgentBoard.less';
</style>
