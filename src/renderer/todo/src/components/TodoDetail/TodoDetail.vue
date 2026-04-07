<template>
  <a-drawer
    :visible="todoStore.detailVisible && !!todoStore.selectedTodo"
    :width="320"
    placement="right"
    :footer="false"
    :mask="true"
    :mask-closable="true"
    unmount-on-close
    popup-container=".todo-app__board"
    @cancel="todoStore.closeDetail()"
  >
    <template #title>
      <input
        class="todo-detail__header-title"
        :value="todoStore.selectedTodo?.title"
        @blur="onTitleBlur"
        @keydown.enter="($event.target as HTMLInputElement)?.blur()"
      />
    </template>
    <div v-if="todoStore.selectedTodo" class="todo-detail__body">
      <!-- Sub-todos section -->
      <div class="todo-detail__section">
        <span class="todo-detail__section-label">Steps</span>
        <div class="todo-detail__subtodo-list">
          <draggable
            v-model="todoStore.subTodos"
            item-key="id"
            :animation="200"
            @end="onSubTodoDragEnd"
          >
            <template #item="{ element }">
              <div class="todo-detail__subtodo-item">
                <a-checkbox
                  :model-value="element.status === 1"
                  size="mini"
                  @change="todoStore.toggleSubTodoStatus(element.id, { wasCompleted: element.status === 1 })"
                />
                <textarea
                  class="todo-detail__subtodo-title"
                  :class="{ 'todo-detail__subtodo-title--completed': element.status === 1 }"
                  :value="subTodoEditingTexts[element.id] ?? element.title"
                  :placeholder="i18nHelper.todo.stepPlaceholder"
                  rows="1"
                  @blur="(e) => onSubTitleBlur(e, element.id)"
                  @input="(e) => { setSubTitleValue(element.id, (e.target as HTMLTextAreaElement).value); autoResize(e.target as HTMLTextAreaElement); }"
                  @keydown.enter.exact.prevent="onSubTitleEnter($event, element.id)"
                />
                <a-button
                  class="todo-detail__subtodo-delete"
                  size="mini"
                  type="text"
                  status="danger"
                  @click="handleDeleteSubTodo(element.id)"
                >
                  <template #icon>
                    <icon-close :size="12" />
                  </template>
                </a-button>
              </div>
            </template>
          </draggable>
        </div>
        <div v-if="!addingStep" class="todo-detail__add-step" @click="startAddStep">
          <icon-plus :size="14" />
          <span>Add step</span>
        </div>
        <div v-else class="todo-detail__add-step-input">
          <a-input
            ref="addStepInputRef"
            v-model="newStepTitle"
            size="mini"
            :placeholder="i18nHelper.todo.stepPlaceholder"
            @press-enter="handleAddStep"
            @blur="handleAddStepBlur"
          />
        </div>
      </div>

      <!-- Remind section -->
      <div class="todo-detail__section">
        <span class="todo-detail__section-label">Remind</span>
        <div class="todo-detail__field-row">
          <a-date-picker
            :model-value="remindDateValue"
            size="mini"
            style="width: 100%"
            show-time
            format="YYYY-MM-DD HH:mm"
            @change="onRemindChange"
            allow-clear
          />
        </div>
      </div>

      <!-- Due date section -->
      <div class="todo-detail__section">
        <span class="todo-detail__section-label">Due date</span>
        <div class="todo-detail__field-row">
          <a-date-picker
            :model-value="dueDateValue"
            size="mini"
            style="width: 100%"
            @change="onDueDateChange"
            allow-clear
          />
        </div>
      </div>

      <!-- Repeat section -->
      <div class="todo-detail__section">
        <span class="todo-detail__section-label">Repeat</span>
        <div class="todo-detail__field-row">
          <a-select
            :model-value="todoStore.selectedTodo.repeat_type ?? 'none'"
            size="mini"
            style="width: 100%"
            @change="onRepeatChange"
          >
            <a-option value="none">None</a-option>
            <a-option value="daily">Daily</a-option>
            <a-option value="weekly">Weekly</a-option>
            <a-option value="monthly">Monthly</a-option>
            <a-option value="yearly">Yearly</a-option>
          </a-select>
        </div>
        <div
          v-if="canSkipToCurrent"
          class="todo-detail__skip-btn"
          @click="handleSkipToCurrent"
        >
          <icon-forward :size="14" />
          <span>Skip to current</span>
        </div>
      </div>

      <!-- Note section -->
      <div class="todo-detail__section">
        <span class="todo-detail__section-label">Note</span>
        <textarea
          class="todo-detail__note"
          :value="todoStore.selectedTodo.note"
          placeholder="Add a note..."
          @blur="onNoteBlur"
        />
      </div>

      <div class="todo-detail__footer">
        <a-button
          size="mini"
          type="text"
          status="danger"
          @click="handleDelete"
        >
          <template #icon>
            <icon-delete />
          </template>
          Delete
        </a-button>
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, watch } from 'vue';
import { Modal } from '@arco-design/web-vue';
import dayjs from 'dayjs';
import draggable from 'vuedraggable';
import {
  IconClose,
  IconPlus,
  IconDelete,
  IconForward,
} from '@arco-design/web-vue/es/icon';
import { todoStore } from '../../store/todo.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const subTodoEditingTexts = reactive<Record<number, string>>({});

const autoResize = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
};

const setSubTitleValue = (id: number, value: string) => {
  subTodoEditingTexts[id] = value;
};

watch(() => todoStore.subTodos, (subs) => {
  for (const sub of subs) {
    subTodoEditingTexts[sub.id] = sub.title;
  }
  nextTick(() => {
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('.todo-detail__subtodo-title');
    for (const ta of textareas) {
      autoResize(ta);
    }
  });
}, { immediate: true });

const addingStep = ref(false);
const newStepTitle = ref('');
const addStepInputRef = ref<any>(null);

const dueDateValue = computed(() => {
  if (!todoStore.selectedTodo?.due_at) return undefined;
  return dayjs(todoStore.selectedTodo.due_at).format('YYYY-MM-DD');
});

const canSkipToCurrent = computed(() => {
  const todo = todoStore.selectedTodo;
  if (!todo || !todo.repeat_type || !todo.due_at) return false;
  const dueDate = dayjs(todo.due_at).startOf('day');
  const today = dayjs().startOf('day');
  return dueDate.isBefore(today);
});

const handleSkipToCurrent = () => {
  if (!todoStore.selectedTodo) return;
  todoStore.skipToCurrent(todoStore.selectedTodo.id);
};

const remindDateValue = computed(() => {
  if (!todoStore.selectedTodo?.remind_at) return undefined;
  return dayjs(todoStore.selectedTodo.remind_at).format('YYYY-MM-DD HH:mm');
});

const onTitleBlur = (e: FocusEvent) => {
  const value = (e.target as HTMLInputElement).value.trim();
  if (value && todoStore.selectedTodo && value !== todoStore.selectedTodo.title) {
    todoStore.updateTodo({ id: todoStore.selectedTodo.id, title: value });
  }
};

const STEP_MAX_LENGTH = 200;

const onSubTitleEnter = async (e: KeyboardEvent, id: number) => {
  const ta = e.target as HTMLTextAreaElement;
  ta.blur();
  await nextTick();
  const allTextareas = Array.from(
    document.querySelectorAll<HTMLTextAreaElement>('.todo-detail__subtodo-title'),
  );
  const idx = allTextareas.findIndex((el) => el === ta);
  if (idx !== -1 && idx + 1 < allTextareas.length) {
    allTextareas[idx + 1].focus();
  } else {
    startAddStep();
  }
};

const onSubTitleBlur = (e: FocusEvent, id: number) => {
  const trimmed = (e.target as HTMLTextAreaElement).value.trim().slice(0, STEP_MAX_LENGTH);
  subTodoEditingTexts[id] = trimmed;
  if (trimmed) {
    todoStore.updateSubTodoTitle(id, trimmed);
  }
};

const startAddStep = async () => {
  addingStep.value = true;
  await nextTick();
  addStepInputRef.value?.focus();
};

const handleAddStep = () => {
  const title = newStepTitle.value.trim();
  if (!title || !todoStore.selectedTodo) return;
  todoStore.createSubTodo(todoStore.selectedTodo.id, title);
  newStepTitle.value = '';
};

const handleAddStepBlur = () => {
  const title = newStepTitle.value.trim();
  if (title && todoStore.selectedTodo) {
    todoStore.createSubTodo(todoStore.selectedTodo.id, title);
  }
  newStepTitle.value = '';
  addingStep.value = false;
};

const onDueDateChange = (value: string | Date | undefined) => {
  if (!todoStore.selectedTodo) return;
  if (!value) {
    todoStore.updateTodo({ id: todoStore.selectedTodo.id, due_at: null });
    return;
  }
  const ts = dayjs(value as string).startOf('day').valueOf();
  todoStore.updateTodo({ id: todoStore.selectedTodo.id, due_at: ts });
};

const onRepeatChange = (value: string | number | boolean | Record<string, any> | (string | number | boolean | Record<string, any>)[]) => {
  if (!todoStore.selectedTodo) return;
  const repeatType = value === 'none' ? null : (value as string);
  todoStore.updateRepeatType(todoStore.selectedTodo.id, repeatType);
};

const onRemindChange = (value: string | Date | undefined) => {
  if (!todoStore.selectedTodo) return;
  if (!value) {
    todoStore.updateTodo({ id: todoStore.selectedTodo.id, remind_at: null });
    return;
  }
  const ts = dayjs(value as string).valueOf();
  todoStore.updateTodo({ id: todoStore.selectedTodo.id, remind_at: ts });
};

const onNoteBlur = (e: FocusEvent) => {
  const value = (e.target as HTMLTextAreaElement).value;
  if (!todoStore.selectedTodo) return;
  if (value !== todoStore.selectedTodo.note) {
    todoStore.updateTodo({ id: todoStore.selectedTodo.id, note: value });
  }
};

const handleDeleteSubTodo = (id: number) => {
  const doAction = () => todoStore.deleteSubTodo(id);

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
    title: 'Delete Step',
    content: 'Are you sure you want to delete this step?',
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

const handleDelete = () => {
  if (!todoStore.selectedTodo) return;
  const todoId = todoStore.selectedTodo.id;
  const domainId = todoStore.selectedTodo.domain_id;
  const doAction = () => todoStore.deleteTodo(todoId, domainId);

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

const onSubTodoDragEnd = () => {
  if (!todoStore.selectedTodo) return;
  const order = todoStore.subTodos.map((s) => s.id);
  todoStore.saveSubTodoOrder(todoStore.selectedTodo.id, order);
};
</script>

<style lang="less">
@import './TodoDetail.less';
</style>
