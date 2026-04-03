<template>
  <div
    class="todo-row"
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
          :class="{ 'todo-row__title--completed': todo.status === 1 }"
          @click.stop="startEditing"
        >{{ todo.title }}</span>
        <input
          v-else
          ref="titleInputRef"
          class="todo-row__title-input"
          v-model="titleInput"
          :style="{ width: inputWidth + 'px' }"
          @blur="onTitleBlur"
          @keydown.enter="($event.target as HTMLInputElement)?.blur()"
          @click.stop
        />
        <span ref="sizerRef" class="todo-row__title-sizer">{{ titleInput }}</span>
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
            'todo-row__due-date--future': isFutureOrToday,
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
      <div v-if="canSkipToCurrent" class="context-menu__item context-menu__item--skip" @click="handleSkipToCurrent">
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
import { IconList, IconCalendar, IconStar, IconStarFill, IconDelete, IconForward } from '@arco-design/web-vue/es/icon';
import ContextMenu from '../ContextMenu/ContextMenu.vue';
import { todoStore } from '../../store/todo.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { TodoItem } from '../../store/todo.store';

const props = defineProps<{
  todo: TodoItem;
}>();

const editing = ref(false);
const _editingText = ref('');
const titleInputRef = ref<HTMLInputElement | null>(null);
const sizerRef = ref<HTMLSpanElement | null>(null);
const inputWidth = ref(40);
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
  if (!props.todo.due_at) return '';
  const due = dayjs(props.todo.due_at);
  const today = dayjs().startOf('day');
  const tomorrow = today.add(1, 'day');

  if (due.isSame(today, 'day')) return 'Today';
  if (due.isSame(tomorrow, 'day')) return 'Tomorrow';
  return due.format('ddd, MMM D');
});

const isOverdue = computed(() => {
  if (!props.todo.due_at) return false;
  return dayjs(props.todo.due_at).isBefore(dayjs().startOf('day'));
});

const isFutureOrToday = computed(() => {
  if (!props.todo.due_at) return false;
  return !isOverdue.value;
});

const hasSubtitle = computed(() => {
  return !!subTodoProgress.value || !!dueDateText.value;
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
  _editingText.value = props.todo.title;
  editing.value = true;
  await nextTick();
  measureWidth();
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

const handleRowClick = () => {
  if (!editing.value) {
    todoStore.selectTodo(props.todo);
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
  return dayjs(props.todo.due_at).startOf('day').isBefore(dayjs().startOf('day'));
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
    onOk: () => { cleanup(); doAction(); },
    onCancel: cleanup,
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
