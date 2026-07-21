<template>
  <section
    name="eyesOnAgents__domainColumn"
    class="agent-domain"
    :class="{ 'agent-domain--focus': focus }"
    :data-domain-id="domain?.id"
  >
    <header class="agent-domain__header" :class="{ 'agent-domain__drag-handle': canManage }">
      <div class="agent-domain__title-row">
        <IconTargetArrow v-if="focus" :size="15" />
        <input
          v-if="editing"
          ref="titleInputRef"
          v-model="titleInput"
          class="agent-domain__title-input"
          :style="{ width: `${inputWidth}px` }"
          maxlength="80"
          @blur="commitRename"
          @click.stop
          @mousedown.stop
          @keydown.enter.prevent="blurTitleInput"
          @keydown.esc.prevent.stop="cancelRename"
        />
        <button
          v-else-if="canManage"
          class="agent-domain__title agent-domain__title--editable"
          type="button"
          @click.stop="beginRename"
          @mousedown.stop
        >
          {{ title }}
        </button>
        <h2 v-else class="agent-domain__title">{{ title }}</h2>
        <span ref="titleSizerRef" class="agent-domain__title-sizer">{{ editingTitle }}</span>
      </div>

      <a-button
        v-if="all"
        ref="titleSearchButtonRef"
        name="eyesOnAgents__domainColumn__titleSearchToggle"
        class="agent-domain__search-trigger"
        size="mini"
        type="text"
        :aria-label="i18nHelper.eyesOnAgents.actions.searchTitles"
        :aria-expanded="titleSearchOpen"
        aria-controls="eyes-on-agents-all-title-search"
        @click="toggleTitleSearch"
      >
        <template #icon><IconSearch :size="13" aria-hidden="true" /></template>
      </a-button>

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
          <a-doption class="agent-domain__delete-option" @click="confirmDelete">
            <IconTrash :size="14" />
            {{ i18nHelper.eyesOnAgents.actions.delete }}
          </a-doption>
        </template>
      </a-dropdown>
    </header>

    <div
      v-if="all && titleSearchOpen"
      id="eyes-on-agents-all-title-search"
      name="eyesOnAgents__domainColumn__titleSearch"
      class="agent-domain__search-row"
      role="search"
      :aria-label="i18nHelper.eyesOnAgents.actions.searchTitles"
      @keydown.esc.prevent.stop="closeTitleSearch"
    >
      <a-input
        ref="titleSearchInputRef"
        v-model="eyesOnAgentsStore.allTitleQuery"
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

    <ProjectFilter v-if="projectFilter" />

    <div name="eyesOnAgents__domainColumn__body" class="agent-domain__body">
      <draggable
        v-model="visibleThreads"
        class="agent-domain__thread-list"
        :group="dragGroup"
        item-key="threadId"
        :sort="!focus && !all"
        :animation="160"
        @add="handleThreadAdded"
      >
        <template #item="{ element }">
          <ThreadCard :thread="element" />
        </template>
      </draggable>

      <div v-if="visibleThreads.length === 0" class="agent-domain__empty">
        <IconCircleCheck v-if="focus" :size="20" />
        <span>{{ emptyLabel }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import { Modal } from '@arco-design/web-vue';
import {
  IconCircleCheck,
  IconDots,
  IconSearch,
  IconTargetArrow,
  IconTrash,
  IconX,
} from '@tabler/icons-vue';
import type {
  EyesOnAgentsDomain,
  EyesOnAgentsThread,
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ThreadCard from '../ThreadCard/ThreadCard.vue';
import ProjectFilter from '../ProjectFilter/ProjectFilter.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

interface ThreadAddEvent {
  newIndex?: number;
}

const props = withDefaults(defineProps<{
  title: string;
  threads: EyesOnAgentsThread[];
  domain?: EyesOnAgentsDomain;
  focus?: boolean;
  all?: boolean;
  projectFilter?: boolean;
}>(), {
  domain: undefined,
  focus: false,
  all: false,
  projectFilter: false,
});

const visibleThreads = ref<EyesOnAgentsThread[]>([]);
const editing = ref(false);
const editingTitle = ref('');
const titleSearchOpen = ref(false);
const titleInputRef = ref<HTMLInputElement | null>(null);
const titleSizerRef = ref<HTMLSpanElement | null>(null);
const titleSearchButtonRef = ref<{ $el?: HTMLElement } | null>(null);
const titleSearchInputRef = ref<{ focus?: () => void } | null>(null);
const inputWidth = ref(40);
const canManage = computed(() => Boolean(props.domain && !props.domain.isSystem));
const emptyLabel = computed(() => {
  if (props.focus) return i18nHelper.eyesOnAgents.board.emptyFocus;
  if (props.all && eyesOnAgentsStore.isAllTitleFiltered) {
    return i18nHelper.eyesOnAgents.board.emptyTitleSearch;
  }
  if (!props.projectFilter || !eyesOnAgentsStore.isAllProjectFiltered) {
    return i18nHelper.eyesOnAgents.board.emptyDomain;
  }
  return eyesOnAgentsStore.allProjectFilter.type === 'none'
    ? i18nHelper.eyesOnAgents.board.emptyNoProject
    : i18nHelper.eyesOnAgents.board.emptyProject;
});
const dragGroup = computed(() => props.focus || props.all
  ? { name: 'eyes-on-agents-threads', pull: 'clone', put: false }
  : { name: 'eyes-on-agents-threads', pull: true, put: true });

const focusTitleSearchInput = async (): Promise<void> => {
  await nextTick();
  titleSearchInputRef.value?.focus?.();
};

const closeTitleSearch = async (): Promise<void> => {
  eyesOnAgentsStore.clearAllTitleQuery();
  titleSearchOpen.value = false;
  await nextTick();
  titleSearchButtonRef.value?.$el?.focus();
};

const toggleTitleSearch = async (): Promise<void> => {
  if (titleSearchOpen.value) {
    await closeTitleSearch();
    return;
  }
  titleSearchOpen.value = true;
  await focusTitleSearchInput();
};

const clearTitleSearch = async (): Promise<void> => {
  eyesOnAgentsStore.clearAllTitleQuery();
  await focusTitleSearchInput();
};

const measureTitleInput = (): void => {
  void nextTick(() => {
    const measured = (titleSizerRef.value?.offsetWidth ?? 0) + 8;
    inputWidth.value = Math.min(Math.max(measured, 40), 200);
  });
};

const titleInput = computed({
  get: () => editingTitle.value,
  set: (value: string) => {
    editingTitle.value = value;
    measureTitleInput();
  },
});

watch(
  () => props.threads,
  (threads) => {
    visibleThreads.value = [...threads];
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (props.all) eyesOnAgentsStore.clearAllTitleQuery();
});

const handleThreadAdded = async (event: ThreadAddEvent): Promise<void> => {
  if (props.focus || props.all || !props.domain || event.newIndex === undefined) return;
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
  measureTitleInput();
  titleInputRef.value?.focus();
  titleInputRef.value?.select();
};

const blurTitleInput = (): void => {
  titleInputRef.value?.blur();
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
  const reserved = value.toLocaleLowerCase() === 'all';
  if (duplicate || reserved) {
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
