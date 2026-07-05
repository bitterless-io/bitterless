<template>
  <div class="focused-column">
    <div class="focused-column__header">
      <div class="focused-column__header-title-row">
        <span class="focused-column__header-title">{{ i18nHelper.todo.focusedDomain }}</span>
        <span v-if="todoStore.focusedTodoList.length > 0" class="focused-column__header-count">
          {{ todoStore.focusedTodoList.length }}
        </span>
      </div>
      <div class="focused-column__filter-row">
        <label class="focused-column__filter-item">
          <a-checkbox
            :model-value="todoSettingStore.focusedFilters.important"
            size="mini"
            @change="(v: boolean) => toggleFilter('important', v)"
          />
          <span class="focused-column__filter-label">{{ i18nHelper.todo.focusedFilterImportant }}</span>
        </label>
        <label class="focused-column__filter-item">
          <a-checkbox
            :model-value="todoSettingStore.focusedFilters.today"
            size="mini"
            @change="(v: boolean) => toggleFilter('today', v)"
          />
          <span class="focused-column__filter-label">{{ i18nHelper.todo.focusedFilterToday }}</span>
        </label>
        <label class="focused-column__filter-item">
          <a-checkbox
            :model-value="todoSettingStore.focusedFilters.overdue"
            size="mini"
            @change="(v: boolean) => toggleFilter('overdue', v)"
          />
          <span class="focused-column__filter-label">{{ i18nHelper.todo.focusedFilterOverdue }}</span>
        </label>
      </div>
    </div>
    <div class="focused-column__body" ref="bodyRef" @scroll="onBodyScroll">
      <div class="focused-column__todo-list">
        <TodoRow
          v-for="todo in todoStore.focusedTodoList"
          :key="todo.id"
          :todo="todo"
          :override-select="() => todoStore.selectTodoFromFocused(todo)"
        />
        <div v-if="todoStore.focusedTodoList.length === 0" class="focused-column__empty">
          {{ i18nHelper.todo.emptyDomain }}
        </div>
      </div>
      <transition name="back-to-top">
        <button v-if="showBackToTop" class="focused-column__back-to-top" @click="scrollToTop">
          <IconArrowUp :size="14" />
        </button>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { IconArrowUp } from '@tabler/icons-vue';
import TodoRow from '../TodoRow/TodoRow.vue';
import { todoStore } from '../../store/todo.store';
import { todoSettingStore } from '../../store/todoSetting.store';
import type { FocusedFilters } from '../../store/todoSetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const bodyRef = ref<HTMLElement | null>(null);
const showBackToTop = ref(false);

const onBodyScroll = () => {
  showBackToTop.value = (bodyRef.value?.scrollTop ?? 0) > 150;
};

const scrollToTop = () => {
  bodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
};

const toggleFilter = (key: keyof FocusedFilters, value: boolean) => {
  todoSettingStore.setFocusedFilters({ ...todoSettingStore.focusedFilters, [key]: value });
};
</script>

<style lang="less">
@import './FocusedColumn.less';
</style>
