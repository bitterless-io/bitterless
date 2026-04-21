<template>
  <transition name="todo-detail-slide">
    <div
      v-if="todoStore.detailVisible && !!todoStore.selectedTodo"
      class="todo-detail__panel"
    >
    <div class="todo-detail__content">
      <div class="todo-detail__custom-header">
        <div class="todo-detail__title-row">
          <a-checkbox
            class="todo-detail__header-checkbox"
            :model-value="todoStore.selectedTodo.status === 1"
            size="mini"
            @change="handleToggleStatus"
          />
          <span
            v-if="!headerEditing"
            class="todo-detail__header-title-display"
            :class="{ 'todo-detail__header-title-display--completed': todoStore.selectedTodo.status === 1 }"
            @click="startHeaderEditing"
          >{{ todoStore.selectedTodo.title }}</span>
          <textarea
            v-else
            ref="headerTitleRef"
            v-model="headerTitleInput"
            maxlength="250"
            class="todo-detail__header-title"
            :class="{ 'todo-detail__header-title--completed': todoStore.selectedTodo.status === 1 }"
            rows="1"
            @blur="onTitleBlur"
            @keydown.enter.exact.prevent="($event.target as HTMLTextAreaElement)?.blur()"
          />
        </div>
        <a-button
          class="todo-detail__close-btn"
          size="mini"
          type="text"
          @click="todoStore.closeDetail()"
        >
          <template #icon>
            <icon-close :size="16" />
          </template>
        </a-button>
      </div>
      <div class="todo-detail__body">
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
                  @input="(e) => { onSubTitleInput(element.id, e.target as HTMLTextAreaElement); }"
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

      <!-- Remind section (hidden, reserved for future use) -->
      <!-- <div class="todo-detail__section">
        <span class="todo-detail__section-label">{{ i18nHelper.todo.remind }}</span>
        <div class="todo-detail__field-row">
          <a-date-picker
            :model-value="remindDateValue"
            size="mini"
            style="width: 100%"
            show-time
            format="YYYY-MM-DD HH:mm"
            :ok-text="i18nHelper.todo.remindConfirm"
            :shortcuts="remindShortcuts"
            @change="onRemindChange"
            allow-clear
          />
        </div>
      </div> -->

      <!-- Due date section -->
      <div class="todo-detail__section">
        <span class="todo-detail__section-label">{{ i18nHelper.todo.dueDate }}</span>
        <div class="todo-detail__field-row">
          <a-date-picker
            :model-value="dueDateValue"
            size="mini"
            style="width: 100%"
            :shortcuts="dueDateShortcuts"
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
        <div v-if="todoStore.selectedTodo.repeat_type" class="todo-detail__interval-row">
          <span class="todo-detail__interval-label">{{ i18nHelper.todo.repeatEvery }}</span>
          <div class="todo-detail__interval-picker" ref="intervalPickerRef">
            <input
              class="todo-detail__interval-input"
              :value="intervalInputText"
              maxlength="3"
              @focus="onIntervalFocus"
              @blur="onIntervalBlur"
              @input="onIntervalInput"
            />
            <div v-if="intervalDropdownVisible" class="todo-detail__interval-dropdown">
              <div
                v-for="n in 999"
                :key="n"
                class="todo-detail__interval-option"
                :class="{ 'todo-detail__interval-option--active': n === (todoStore.selectedTodo?.repeat_interval ?? 1) }"
                :ref="(el) => { if (n === (todoStore.selectedTodo?.repeat_interval ?? 1)) intervalActiveRef = el as HTMLElement; }"
                @mousedown.prevent="selectInterval(n)"
              >{{ n }}</div>
            </div>
          </div>
          <span class="todo-detail__interval-unit">{{ repeatUnitLabel }}</span>
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
          :value="_noteText"
          placeholder="Add a note..."
          @input="onNoteInput"
          @blur="onNoteBlur"
        />
      </div>
      </div>

      <div class="todo-detail__footer">
        <a-button
          size="mini"
          type="text"
          @click="handleLocate"
        >
          <template #icon>
            <icon-location :size="14" />
          </template>
        </a-button>
        <span v-if="todoStore.selectedTodo.status === 1 && todoStore.selectedTodo.last_complete_at" class="todo-detail__complete-time">
          {{ moment(todoStore.selectedTodo.last_complete_at).format('YYYY-MM-DD HH:mm:ss') }}
        </span>
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
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, watch, onUnmounted } from 'vue';
import { throttle } from 'es-toolkit';
import { Modal } from '@arco-design/web-vue';
import dayjs from 'dayjs';
import moment from 'moment';
import draggable from 'vuedraggable';
import {
  IconClose,
  IconPlus,
  IconDelete,
  IconForward,
  IconLocation,
} from '@arco-design/web-vue/es/icon';
import { todoStore } from '../../store/todo.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const TITLE_MAX_LENGTH = 250;
const headerTitleRef = ref<HTMLTextAreaElement | null>(null);
const _headerTitleText = ref('');
const headerEditing = ref(false);
const subTodoEditingTexts = reactive<Record<number, string>>({});

const autoResize = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
};

const headerTitleInput = computed({
  get: () => _headerTitleText.value,
  set: (value: string) => {
    _headerTitleText.value = value;
  },
});

const startHeaderEditing = async () => {
  _headerTitleText.value = todoStore.selectedTodo?.title ?? '';
  headerEditing.value = true;
  await nextTick();
  headerTitleRef.value?.focus();
  headerTitleRef.value?.select();
};

const onSubTitleInput = (id: number, el: HTMLTextAreaElement) => {
  const value = el.value;
  subTodoEditingTexts[id] = value.length > TITLE_MAX_LENGTH ? value.slice(0, TITLE_MAX_LENGTH) : value;
  if (value.length > TITLE_MAX_LENGTH) {
    el.value = subTodoEditingTexts[id];
  }
  autoResize(el);
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

const dueDateShortcuts = computed(() => [
  { label: i18nHelper.todo.today, value: () => dayjs().toDate() },
  { label: i18nHelper.todo.tomorrow, value: () => dayjs().add(1, 'day').toDate() },
  { label: i18nHelper.todo.nextWeek, value: () => dayjs().add((8 - dayjs().day()) % 7 || 7, 'day').startOf('day').toDate() },
]);

const remindShortcuts = computed(() => [
  { label: i18nHelper.todo.remindNow, value: () => dayjs().toDate() },
]);

const dueDateValue = computed(() => {
  if (!todoStore.selectedTodo?.due_at) return undefined;
  return dayjs(todoStore.selectedTodo.due_at).format('YYYY-MM-DD');
});

const canSkipToCurrent = computed(() => {
  const todo = todoStore.selectedTodo;
  if (!todo || !todo.repeat_type || !todo.due_at) return false;
  const dueDate = dayjs(todo.due_at).startOf('day');
  const today = todoStore.currentTime.startOf('day');
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
  const value = (e.target as HTMLTextAreaElement).value.trim();
  if (value && todoStore.selectedTodo && value !== todoStore.selectedTodo.title) {
    todoStore.updateTodo({ id: todoStore.selectedTodo.id, title: value });
  }
  headerEditing.value = false;
};

watch(() => todoStore.selectedTodo?.title, () => {
  headerEditing.value = false;
}, { immediate: true });

const _noteText = ref('');
watch(() => todoStore.selectedTodo?.id, (newId) => {
  if (newId !== undefined) {
    _noteText.value = todoStore.selectedTodo?.note ?? '';
  }
}, { immediate: true });


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
  const trimmed = (e.target as HTMLTextAreaElement).value.trim();
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

const repeatUnitLabel = computed(() => {
  const type = todoStore.selectedTodo?.repeat_type;
  const interval = todoStore.selectedTodo?.repeat_interval ?? 1;
  if (type === 'daily') return interval === 1 ? 'day' : 'days';
  if (type === 'weekly') return interval === 1 ? 'week' : 'weeks';
  if (type === 'monthly') return interval === 1 ? 'month' : 'months';
  if (type === 'yearly') return interval === 1 ? 'year' : 'years';
  return '';
});

const onRepeatChange = (value: string | number | boolean | Record<string, any> | (string | number | boolean | Record<string, any>)[]) => {
  if (!todoStore.selectedTodo) return;
  const repeatType = value === 'none' ? null : (value as string);
  todoStore.updateRepeatType(todoStore.selectedTodo.id, repeatType);
};

const intervalPickerRef = ref<HTMLElement | null>(null);
const intervalActiveRef = ref<HTMLElement | null>(null);
const intervalDropdownVisible = ref(false);
const intervalInputText = computed(() => String(todoStore.selectedTodo?.repeat_interval ?? 1));

const onIntervalFocus = () => {
  intervalDropdownVisible.value = true;
  nextTick(() => {
    intervalActiveRef.value?.scrollIntoView({ block: 'center' });
  });
};

const onIntervalBlur = (e: FocusEvent) => {
  const raw = (e.target as HTMLInputElement).value.trim();
  const parsed = parseInt(raw, 10);
  const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(999, parsed)) : 1;
  if (todoStore.selectedTodo && clamped !== todoStore.selectedTodo.repeat_interval) {
    todoStore.updateRepeatInterval(todoStore.selectedTodo.id, clamped);
  }
  intervalDropdownVisible.value = false;
};

const _saveRepeatInterval = throttle((id: number, interval: number) => {
  todoStore.updateRepeatInterval(id, interval);
}, 300, { trailing: true });

const onIntervalInput = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const raw = input.value.replace(/[^0-9]/g, '');
  input.value = raw;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 1 && todoStore.selectedTodo) {
    const clamped = Math.min(999, parsed);
    _saveRepeatInterval(todoStore.selectedTodo.id, clamped);
  }
};

const selectInterval = (n: number) => {
  if (!todoStore.selectedTodo) return;
  todoStore.updateRepeatInterval(todoStore.selectedTodo.id, n);
  intervalDropdownVisible.value = false;
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

const _saveNote = throttle((id: number, value: string) => {
  todoStore.updateTodo({ id, note: value.trim() });
}, 150, { trailing: true });

const onNoteInput = (e: Event) => {
  if (!todoStore.selectedTodo) return;
  const value = (e.target as HTMLTextAreaElement).value;
  _noteText.value = value;
  _saveNote(todoStore.selectedTodo.id, value);
};

const onNoteBlur = (e: FocusEvent) => {
  if (!todoStore.selectedTodo) return;
  const value = (e.target as HTMLTextAreaElement).value;
  _noteText.value = value;
  _saveNote.flush();
};

onUnmounted(() => {
  _saveNote.flush();
});

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

const handleToggleStatus = () => {
  if (!todoStore.selectedTodo) return;
  if (todoStore.selectedTodo.status === 1) {
    todoStore.uncompleteTodo(todoStore.selectedTodo.id);
  } else {
    todoStore.completeTodo(todoStore.selectedTodo.id);
  }
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

const handleLocate = () => {
  if (!todoStore.selectedTodo) return;
  todoStore.locateTodo(todoStore.selectedTodo.id, todoStore.selectedTodo.domain_id);
};
</script>

<style lang="less">
@import './TodoDetail.less';
</style>
