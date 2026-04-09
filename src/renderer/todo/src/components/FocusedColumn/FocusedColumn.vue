<template>
  <div class="focused-column">
    <div class="focused-column__header">
      <span class="focused-column__header-title">{{ i18nHelper.todo.focusedDomain }}</span>
      <span v-if="todoStore.focusedTodoList.length > 0" class="focused-column__header-count">
        {{ todoStore.focusedTodoList.length }}
      </span>
      <a-dropdown trigger="click" position="br" @select="onFilterSelect">
        <a-button
          class="focused-column__filter-btn"
          :class="{ 'focused-column__filter-btn--active': isFiltered }"
          size="mini"
          type="text"
        >
          <template #icon>
            <icon-filter :size="14" />
          </template>
        </a-button>
        <template #content>
          <a-doption value="important">
            <template #icon>
              <icon-check v-if="todoSettingStore.focusedFilters.important" :size="12" />
              <span v-else class="focused-column__filter-placeholder" />
            </template>
            {{ i18nHelper.todo.focusedFilterImportant }}
          </a-doption>
          <a-doption value="overdue">
            <template #icon>
              <icon-check v-if="todoSettingStore.focusedFilters.overdue" :size="12" />
              <span v-else class="focused-column__filter-placeholder" />
            </template>
            {{ i18nHelper.todo.focusedFilterOverdue }}
          </a-doption>
          <a-doption value="today">
            <template #icon>
              <icon-check v-if="todoSettingStore.focusedFilters.today" :size="12" />
              <span v-else class="focused-column__filter-placeholder" />
            </template>
            {{ i18nHelper.todo.focusedFilterToday }}
          </a-doption>
        </template>
      </a-dropdown>
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
          <icon-arrow-up :size="14" />
        </button>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { IconArrowUp, IconFilter, IconCheck } from '@arco-design/web-vue/es/icon';
import TodoRow from '../TodoRow/TodoRow.vue';
import { todoStore } from '../../store/todo.store';
import { todoSettingStore } from '../../store/todoSetting.store';
import type { FocusedFilters } from '../../store/todoSetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const bodyRef = ref<HTMLElement | null>(null);
const showBackToTop = ref(false);

const isFiltered = computed(() => {
  const f = todoSettingStore.focusedFilters;
  return !f.important || !f.overdue || !f.today;
});

const onBodyScroll = () => {
  showBackToTop.value = (bodyRef.value?.scrollTop ?? 0) > 150;
};

const scrollToTop = () => {
  bodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' });
};

const onFilterSelect = (value: string | number | Record<string, any>) => {
  const key = value as keyof FocusedFilters;
  const current = todoSettingStore.focusedFilters;
  todoSettingStore.setFocusedFilters({ ...current, [key]: !current[key] });
};
</script>

<style lang="less">
@import './FocusedColumn.less';
</style>
