<template>
  <div
    ref="boardRef"
    name="eyesOnAgents__board"
    class="agent-board"
    @scroll="handleScroll"
  >
    <DomainColumn
      name="eyesOnAgents__focusColumn"
      :title="i18nHelper.eyesOnAgents.board.focus"
      :threads="eyesOnAgentsStore.focusThreads"
      focus
    />

    <DomainColumn
      v-if="eyesOnAgentsStore.uncategorizedDomain"
      name="eyesOnAgents__uncategorizedColumn"
      :domain="eyesOnAgentsStore.uncategorizedDomain"
      :title="i18nHelper.eyesOnAgents.board.uncategorized"
      :threads="eyesOnAgentsStore.threadsForDomain(eyesOnAgentsStore.uncategorizedDomain.id)"
    />

    <draggable
      name="eyesOnAgents__domainList"
      class="agent-board__domains"
      :model-value="eyesOnAgentsStore.customDomains"
      item-key="id"
      handle=".agent-domain__drag-handle"
      direction="horizontal"
      :animation="180"
      @end="handleDomainDragEnd"
    >
      <template #item="{ element }">
        <DomainColumn
          :domain="element"
          :title="element.title"
          :threads="eyesOnAgentsStore.threadsForDomain(element.id)"
        />
      </template>
    </draggable>

    <AddDomainColumn />

    <transition name="agent-board-jump">
      <a-badge
        v-if="showJumpToFocus"
        class="agent-board__jump-badge"
        :count="eyesOnAgentsStore.focusThreads.length"
        :max-count="99"
      >
        <button
          class="agent-board__jump"
          type="button"
          :aria-label="i18nHelper.eyesOnAgents.board.focus"
          @click="scrollToFocus"
        >
          <IconArrowLeft :size="15" />
        </button>
      </a-badge>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import draggable from 'vuedraggable';
import { IconArrowLeft } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import AddDomainColumn from '../AddDomainColumn/AddDomainColumn.vue';
import DomainColumn from '../DomainColumn/DomainColumn.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

interface DomainDragEvent {
  oldIndex?: number;
  newIndex?: number;
}

const boardRef = ref<HTMLElement | null>(null);
const showJumpToFocus = ref(false);

const handleScroll = (): void => {
  showJumpToFocus.value = (boardRef.value?.scrollLeft ?? 0) > 180;
};

const scrollToFocus = (): void => {
  boardRef.value?.scrollTo({ left: 0, behavior: 'smooth' });
};

const handleDomainDragEnd = async (event: DomainDragEvent): Promise<void> => {
  if (event.oldIndex === undefined || event.newIndex === undefined) return;
  await eyesOnAgentsStore
    .reorderCustomDomains(event.oldIndex, event.newIndex)
    .catch(() => undefined);
};
</script>

<style lang="less">
@import './AgentBoard.less';
</style>
