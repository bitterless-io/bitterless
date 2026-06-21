<template>
  <div
    class="domain-column"
    :data-domain-id="domain.id"
  >
    <div
      class="domain-column__header"
      @contextmenu.prevent="onHeaderContextMenu"
    >
      <span
        v-if="!editing"
        class="domain-column__header-title"
        @click.stop="startEditing"
      >{{ domain.title }}</span>
      <input
        v-else
        ref="titleInputRef"
        class="domain-column__header-title-input"
        v-model="titleInput"
        :style="{ width: inputWidth + 'px' }"
        @blur="onTitleBlur"
        @keydown.enter="($event.target as HTMLInputElement)?.blur()"
        @click.stop
      />
      <span ref="sizerRef" class="domain-column__header-title-sizer">{{ titleInput }}</span>
      <span v-if="todoList.length > 0" class="domain-column__header-count">{{ todoList.length }}</span>
    </div>
    <div class="domain-column__description">
      <textarea
        class="domain-column__description-input"
        v-model="_descriptionText"
        :placeholder="i18nHelper.todo.domainDescriptionPlaceholder"
        rows="2"
        maxlength="500"
        @blur="onDescriptionBlur"
        @click.stop
      />
    </div>
    <div class="domain-column__body" ref="bodyRef" @scroll="onBodyScroll">
      <div class="domain-column__todo-list">
        <draggable
          class="domain-column__draggable"
          :model-value="todoList"
          group="todos"
          item-key="id"
          :animation="200"
          @add="onTodoAdd"
          @end="onTodoDragEnd"
          @update:model-value="onTodoListUpdate"
        >
          <template #item="{ element }">
            <TodoRow :todo="element" />
          </template>
        </draggable>
        <div v-if="todoList.length === 0" class="domain-column__empty">
          {{ i18nHelper.todo.emptyDomain }}
        </div>
        <template v-if="todoSettingStore.showCompleted && completedTodoList.length > 0">
          <div class="domain-column__completed-divider">
            <span class="domain-column__completed-label">{{ i18nHelper.todo.completed }}</span>
            <span class="domain-column__completed-count">{{ completedTodoList.length }}</span>
          </div>
          <TodoRow v-for="todo in completedTodoList" :key="todo.id" :todo="todo" />
        </template>
      </div>
    </div>
    <div class="domain-column__footer">
      <div class="domain-column__add-input">
        <a-input
          v-model="newTodoTitle"
          size="mini"
          :placeholder="i18nHelper.todo.addTodo"
          @press-enter="handleAddTodo"
        >
          <template #prefix>
            <icon-plus />
          </template>
        </a-input>
      </div>
    </div>

    <ContextMenu
      :visible="contextMenuVisible"
      :anchor-el="contextAnchorEl"
      :offset-x="contextOffsetX"
      :offset-y="contextOffsetY"
      @update:visible="contextMenuVisible = $event"
    >
      <div class="context-menu__item" @click="handleArchiveDomain">
        <icon-archive :size="14" />
        <span>{{ i18nHelper.todo.archiveDomain }}</span>
      </div>
      <div class="context-menu__item context-menu__item--danger" @click="handleDeleteDomain">
        <icon-delete :size="14" />
        <span>{{ i18nHelper.todo.deleteDomain }}</span>
      </div>
    </ContextMenu>
    <transition name="back-to-top">
      <button v-if="showBackToTop" class="domain-column__back-to-top" @click="scrollToTop">
        <icon-arrow-up :size="14" />
      </button>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { Modal } from '@arco-design/web-vue';
import draggable from 'vuedraggable';
import { IconArchive, IconDelete, IconPlus, IconArrowUp } from '@arco-design/web-vue/es/icon';
import ContextMenu from '../ContextMenu/ContextMenu.vue';
import TodoRow from '../TodoRow/TodoRow.vue';
import { todoStore } from '../../store/todo.store';
import { todoSettingStore } from '../../store/todoSetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { DomainItem } from '../../store/todo.store';

const props = defineProps<{
  domain: DomainItem;
}>();

const newTodoTitle = ref('');
const editing = ref(false);
const _editingText = ref('');
const _descriptionText = ref(props.domain.description ?? '');
const titleInputRef = ref<HTMLInputElement | null>(null);
const sizerRef = ref<HTMLSpanElement | null>(null);
const inputWidth = ref(40);
const contextMenuVisible = ref(false);
const contextAnchorEl = ref<HTMLElement | null>(null);
const contextOffsetX = ref(0);
const contextOffsetY = ref(0);
const bodyRef = ref<HTMLElement | null>(null);
const showBackToTop = ref(false);

const onBodyScroll = () => {
  showBackToTop.value = (bodyRef.value?.scrollTop ?? 0) > 150;
};

const scrollToTop = () => {
  bodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
};

const todoList = computed(() => {
  return todoStore.todosByDomain[props.domain.id] ?? [];
});

const completedTodoList = computed(() => {
  return todoStore.completedTodosByDomain[props.domain.id] ?? [];
});

watch(() => props.domain.description, (description) => {
  _descriptionText.value = description ?? '';
});

const measureWidth = () => {
  nextTick(() => {
    if (sizerRef.value) {
      const measured = sizerRef.value.offsetWidth + 8;
      inputWidth.value = Math.min(Math.max(measured, 40), 200);
    }
  });
};

const titleInput = computed({
  get: () => _editingText.value,
  set: (value: string) => {
    _editingText.value = value;
    measureWidth();
  },
});

const startEditing = async () => {
  _editingText.value = props.domain.title;
  editing.value = true;
  await nextTick();
  measureWidth();
  titleInputRef.value?.focus();
  titleInputRef.value?.select();
};

const onTitleBlur = () => {
  const value = _editingText.value.trim();
  if (value && value !== props.domain.title) {
    todoStore.updateDomainTitle(props.domain.id, value);
  }
  editing.value = false;
};

const onDescriptionBlur = () => {
  const value = _descriptionText.value.trim();
  if (value !== (props.domain.description ?? '')) {
    todoStore.updateDomainDescription(props.domain.id, value);
  }
};

const onHeaderContextMenu = (e: MouseEvent) => {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  contextAnchorEl.value = target;
  contextOffsetX.value = e.clientX - rect.left;
  contextOffsetY.value = e.clientY - rect.top;
  contextMenuVisible.value = true;
};

const handleArchiveDomain = () => {
  contextMenuVisible.value = false;
  todoStore.archiveDomain(props.domain.id);
};

const handleDeleteDomain = () => {
  contextMenuVisible.value = false;
  const doAction = () => todoStore.deleteDomain(props.domain.id);

  let onKeydown: (e: KeyboardEvent) => void;
  const cleanup = () => document.removeEventListener('keydown', onKeydown);

  onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      cleanup();
      doAction();
      modal.close();
    }
  };

  const modal = Modal.confirm({
    title: 'Delete Domain',
    content: 'Are you sure you want to delete this domain and all its todos?',
    okText: i18nHelper.common.confirm,
    cancelText: i18nHelper.common.cancel,
    escToClose: true,
    okButtonProps: { status: 'danger', size: 'mini' },
    cancelButtonProps: { size: 'mini' },
    onOk: () => { cleanup(); doAction(); },
    onCancel: cleanup,
  });

  document.addEventListener('keydown', onKeydown);
};

const handleAddTodo = async () => {
  const title = newTodoTitle.value.trim();
  if (!title) return;
  newTodoTitle.value = '';
  await todoStore.createTodo(props.domain.id, title);
  await nextTick();
  bodyRef.value?.scrollTo({ top: bodyRef.value.scrollHeight, behavior: 'smooth' });
};

const onTodoListUpdate = (newList: any[]) => {
  todoStore.todosByDomain[props.domain.id] = newList;
};

const onTodoAdd = async (evt: any) => {
  const currentList = todoStore.todosByDomain[props.domain.id] ?? [];
  const moved = currentList[evt.newIndex];
  if (moved && moved.domain_id !== props.domain.id) {
    const targetOrder = currentList.map((t) => t.id);
    await todoStore.moveTodoToDomain(moved.id, moved.domain_id, props.domain.id, { targetOrder });
  }
};

const onTodoDragEnd = () => {
  const currentList = todoStore.todosByDomain[props.domain.id] ?? [];
  const order = currentList.map((t) => t.id);
  todoStore.saveTodoOrder(props.domain.id, order);
};
</script>

<style lang="less">
@import './DomainColumn.less';
</style>
