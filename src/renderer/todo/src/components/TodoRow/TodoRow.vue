<template>
  <div
    class="todo-row"
    :class="{
      'todo-row--active': todoStore.detailVisible && todoStore.selectedTodo?.id === todo.id,
      'todo-row--new': todoStore.newlyCreatedTodoId === todo.id
    }"
    :data-todo-id="todo.id"
    @click="handleRowClick"
    @contextmenu.prevent="onContextMenu"
  >
    <a-checkbox
      class="todo-row__checkbox"
      :model-value="todo.status === 1"
      size="mini"
      @change="handleToggleStatus"
      @click.stop
    />
    <div class="todo-row__content">
      <div class="todo-row__title-row">
        <span
          v-if="!editing"
          class="todo-row__title"
          :class="{
            'todo-row__title--completed': todo.status === 1,
            'todo-row__title--text-cursor':
              todoStore.detailVisible && todoStore.selectedTodo?.id === todo.id
          }"
          @click.stop="handleTitleClick"
          >{{ todo.title }}</span
        >
        <textarea
          v-else
          ref="titleInputRef"
          v-model="titleInput"
          maxlength="250"
          class="todo-row__title-input"
          :class="{ 'todo-row__title-input--completed': todo.status === 1 }"
          rows="1"
          @blur="onTitleBlur"
          @keydown.enter.exact.prevent="($event.target as HTMLTextAreaElement)?.blur()"
          @pointerdown.stop
          @click.stop
        />
      </div>
      <div v-if="hasSubtitle" class="todo-row__subtitle">
        <span v-if="subTodoProgress" class="todo-row__subtodo-progress">
          <icon-list :size="12" />
          {{ subTodoProgress }}
        </span>
        <span
          v-if="dueDateText"
          class="todo-row__due-date"
          :class="{
            'todo-row__due-date--overdue': isOverdue,
            'todo-row__due-date--future': isFutureOrToday
          }"
        >
          <icon-calendar :size="12" />
          {{ dueDateText }}
        </span>
      </div>
    </div>
    <div
      class="todo-row__star"
      :class="{ 'todo-row__star--active': todo.important === 1 }"
      @click.stop="handleToggleImportant"
    >
      <icon-star-fill v-if="todo.important === 1" :size="14" />
      <icon-star v-else :size="14" />
    </div>

    <ContextMenu
      :visible="contextMenuVisible"
      :anchor-el="contextAnchorEl"
      :offset-x="contextOffsetX"
      :offset-y="contextOffsetY"
      @update:visible="contextMenuVisible = $event"
    >
      <div
        v-if="canSkipToCurrent"
        class="context-menu__item context-menu__item--skip"
        @click="handleSkipToCurrent"
      >
        <icon-forward :size="14" />
        <span>Skip to current</span>
      </div>
      <div class="context-menu__item context-menu__item--danger" @click="handleDelete">
        <icon-delete :size="14" />
        <span>Delete</span>
      </div>
    </ContextMenu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Modal } from '@arco-design/web-vue';
import dayjs from 'dayjs';
import {
  IconList,
  IconCalendar,
  IconStar,
  IconStarFill,
  IconDelete,
  IconForward
} from '@arco-design/web-vue/es/icon';
import ContextMenu from '../ContextMenu/ContextMenu.vue';
import { todoStore } from '../../store/todo.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { TodoItem } from '../../store/todo.store';

const props = defineProps<{
  todo: TodoItem;
  overrideSelect?: () => void;
}>();

const editing = ref(false);
const _editingText = ref('');
const titleInputRef = ref<HTMLTextAreaElement | null>(null);
const contextMenuVisible = ref(false);
const contextAnchorEl = ref<HTMLElement | null>(null);
const contextOffsetX = ref(0);
const contextOffsetY = ref(0);

const subTodoProgress = computed(() => {
  const counts = todoStore.subTodoCounts[props.todo.id];
  if (!counts || counts.total === 0) return '';
  return `${counts.done}/${counts.total}`;
});

const dueDateText = computed(() => {
  console.log('todoStore.currentTime', todoStore.currentTime);
  if (!props.todo.due_at) return '';
  const due = dayjs(props.todo.due_at);
  const today = todoStore.currentTime.startOf('day');
  const tomorrow = today.add(1, 'day');

  if (due.isSame(today, 'day')) return i18nHelper.todo.today;
  if (due.isSame(tomorrow, 'day')) return i18nHelper.todo.tomorrow;
  return due.format('ddd, MMM D');
});

const isOverdue = computed(() => {
  if (!props.todo.due_at) return false;
  return dayjs(props.todo.due_at).isBefore(todoStore.currentTime.startOf('day'));
});

const isFutureOrToday = computed(() => {
  if (!props.todo.due_at) return false;
  return !isOverdue.value;
});

const hasSubtitle = computed(() => {
  return !!subTodoProgress.value || !!dueDateText.value;
});

const titleInput = computed({
  get: () => _editingText.value,
  set: (value: string) => {
    _editingText.value = value;
  }
});

const startEditing = async () => {
  _editingText.value = props.todo.title;
  editing.value = true;
  await nextTick();
  titleInputRef.value?.focus();
  titleInputRef.value?.select();
};

const onTitleBlur = () => {
  const value = _editingText.value.trim();
  if (value && value !== props.todo.title) {
    todoStore.updateTodo({ id: props.todo.id, title: value });
  }
  editing.value = false;
};

const handleTitleClick = () => {
  if (!todoStore.detailVisible || todoStore.selectedTodo?.id !== props.todo.id) {
    if (props.overrideSelect) {
      props.overrideSelect();
    } else {
      todoStore.selectTodo(props.todo);
    }
  } else {
    startEditing();
  }
};

const handleRowClick = () => {
  if (!editing.value) {
    if (props.overrideSelect) {
      props.overrideSelect();
    } else {
      todoStore.selectTodo(props.todo);
    }
  }
};

const onContextMenu = (e: MouseEvent) => {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  contextAnchorEl.value = target;
  contextOffsetX.value = e.clientX - rect.left;
  contextOffsetY.value = e.clientY - rect.top;
  contextMenuVisible.value = true;
};

const canSkipToCurrent = computed(() => {
  if (!props.todo.repeat_type || !props.todo.due_at) return false;
  return dayjs(props.todo.due_at).startOf('day').isBefore(todoStore.currentTime.startOf('day'));
});

const handleSkipToCurrent = () => {
  contextMenuVisible.value = false;
  todoStore.skipToCurrent(props.todo.id);
};

const handleDelete = () => {
  contextMenuVisible.value = false;
  const doAction = () => todoStore.deleteTodo(props.todo.id, props.todo.domain_id);

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
    title: 'Delete Todo',
    content: 'Are you sure you want to delete this todo?',
    okText: i18nHelper.common.confirm,
    cancelText: i18nHelper.common.cancel,
    escToClose: true,
    okButtonProps: { status: 'danger', size: 'mini' },
    cancelButtonProps: { size: 'mini' },
    onOk: () => {
      cleanup();
      doAction();
    },
    onCancel: cleanup
  });

  document.addEventListener('keydown', onKeydown);
};

const handleToggleStatus = () => {
  if (props.todo.status === 0) {
    todoStore.completeTodo(props.todo.id);
  } else {
    todoStore.uncompleteTodo(props.todo.id);
  }
};

const handleToggleImportant = () => {
  todoStore.toggleImportant(props.todo.id);
};
</script>

<style lang="less">
@import './TodoRow.less';
</style>
