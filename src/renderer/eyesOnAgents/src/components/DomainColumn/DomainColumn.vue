<template>
  <section
    name="eyesOnAgents__domainColumn"
    class="agent-domain"
    :class="{ 'agent-domain--focus': focus }"
    :data-domain-id="domain?.id"
  >
    <header class="agent-domain__header" :class="{ 'agent-domain__drag-handle': canManage }">
      <div class="agent-domain__heading">
        <div class="agent-domain__title-row">
          <IconTargetArrow v-if="focus" :size="15" />
          <input
            v-if="editing"
            ref="titleInputRef"
            v-model="editingTitle"
            class="agent-domain__title-input"
            maxlength="80"
            @blur="commitRename"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="cancelRename"
          />
          <h2 v-else>{{ title }}</h2>
        </div>
        <span class="agent-domain__count">
          {{ countLabel }}
        </span>
      </div>

      <a-dropdown v-if="canManage" trigger="click" position="br">
        <a-button
          size="mini"
          type="text"
          :aria-label="i18nHelper.eyesOnAgents.domain.options"
          @mousedown.stop
        >
          <template #icon><IconDots :size="17" /></template>
        </a-button>
        <template #content>
          <a-doption @click="beginRename">
            <IconPencil :size="14" />
            {{ i18nHelper.eyesOnAgents.actions.rename }}
          </a-doption>
          <a-doption class="agent-domain__delete-option" @click="confirmDelete">
            <IconTrash :size="14" />
            {{ i18nHelper.eyesOnAgents.actions.delete }}
          </a-doption>
        </template>
      </a-dropdown>
    </header>

    <div name="eyesOnAgents__domainColumn__body" class="agent-domain__body">
      <draggable
        v-model="visibleThreads"
        class="agent-domain__thread-list"
        :group="dragGroup"
        item-key="threadId"
        :sort="!focus"
        :animation="160"
        @add="handleThreadAdded"
      >
        <template #item="{ element }">
          <ThreadCard :thread="element" />
        </template>
      </draggable>

      <div v-if="visibleThreads.length === 0" class="agent-domain__empty">
        <IconCircleCheck v-if="focus" :size="20" />
        <span>
          {{ focus
            ? i18nHelper.eyesOnAgents.board.emptyFocus
            : i18nHelper.eyesOnAgents.board.emptyDomain }}
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import { Modal } from '@arco-design/web-vue';
import {
  IconCircleCheck,
  IconDots,
  IconPencil,
  IconTargetArrow,
  IconTrash,
} from '@tabler/icons-vue';
import type {
  EyesOnAgentsDomain,
  EyesOnAgentsThread,
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ThreadCard from '../ThreadCard/ThreadCard.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

interface ThreadAddEvent {
  newIndex?: number;
}

const props = withDefaults(defineProps<{
  title: string;
  threads: EyesOnAgentsThread[];
  domain?: EyesOnAgentsDomain;
  focus?: boolean;
}>(), {
  domain: undefined,
  focus: false,
});

const visibleThreads = ref<EyesOnAgentsThread[]>([]);
const editing = ref(false);
const editingTitle = ref('');
const titleInputRef = ref<HTMLInputElement | null>(null);
const canManage = computed(() => Boolean(props.domain && !props.domain.isSystem));
const countLabel = computed(() => {
  const template = props.focus
    ? i18nHelper.eyesOnAgents.board.signals
    : i18nHelper.eyesOnAgents.board.threads;
  return template.replace('{count}', String(props.threads.length));
});
const dragGroup = computed(() => props.focus
  ? { name: 'eyes-on-agents-threads', pull: 'clone', put: false }
  : { name: 'eyes-on-agents-threads', pull: true, put: true });

watch(
  () => props.threads,
  (threads) => {
    visibleThreads.value = [...threads];
  },
  { immediate: true },
);

const handleThreadAdded = async (event: ThreadAddEvent): Promise<void> => {
  if (!props.domain || event.newIndex === undefined) return;
  const thread = visibleThreads.value[event.newIndex];
  if (!thread) return;
  await eyesOnAgentsStore.moveThread(thread.threadId, props.domain.id).catch(() => undefined);
  visibleThreads.value = [...props.threads];
};

const beginRename = async (): Promise<void> => {
  if (!props.domain || !canManage.value) return;
  editingTitle.value = props.domain.title;
  editing.value = true;
  await nextTick();
  titleInputRef.value?.focus();
  titleInputRef.value?.select();
};

const cancelRename = (): void => {
  editing.value = false;
  editingTitle.value = '';
};

const commitRename = async (): Promise<void> => {
  if (!props.domain || !editing.value) return;
  const value = editingTitle.value.trim();
  if (!value || value === props.domain.title) {
    cancelRename();
    return;
  }
  const duplicate = eyesOnAgentsStore.domains.some(
    (domain) => domain.id !== props.domain?.id
      && domain.title.trim().toLocaleLowerCase() === value.toLocaleLowerCase(),
  );
  if (duplicate) {
    editingTitle.value = props.domain.title;
    cancelRename();
    return;
  }
  await eyesOnAgentsStore.renameDomain(props.domain.id, value).catch(() => undefined);
  cancelRename();
};

const confirmDelete = (): void => {
  if (!props.domain || !canManage.value) return;
  const domainId = props.domain.id;
  Modal.confirm({
    title: i18nHelper.eyesOnAgents.domain.deleteTitle,
    content: i18nHelper.eyesOnAgents.domain.deleteBody,
    okText: i18nHelper.eyesOnAgents.actions.delete,
    cancelText: i18nHelper.eyesOnAgents.actions.cancel,
    okButtonProps: { status: 'danger' },
    escToClose: true,
    onOk: () => eyesOnAgentsStore.deleteDomain(domainId),
  });
};
</script>

<style lang="less">
@import './DomainColumn.less';
</style>
