<template>
  <div class="todo-app">
    <MenuBar :is-standalone="isStandalone" />
    <div class="todo-app__board">
      <div class="todo-app__board-scroll" @click="onBoardClick">
        <FocusedColumn v-if="todoSettingStore.showFocused" />
        <draggable
          v-model="todoStore.domainList"
          group="domains"
          item-key="id"
          handle=".domain-column__header"
          direction="horizontal"
          :animation="200"
          class="todo-app__board-draggable"
          @end="onDomainDragEnd"
        >
          <template #item="{ element }">
            <DomainColumn :domain="element" />
          </template>
        </draggable>
        <AddDomainButton />
        <div v-if="todoStore.detailVisible" class="todo-app__detail-spacer" />
      </div>
      <TodoDetail />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import draggable from 'vuedraggable';
import DomainColumn from './components/DomainColumn/DomainColumn.vue';
import FocusedColumn from './components/FocusedColumn/FocusedColumn.vue';
import AddDomainButton from './components/AddDomainButton/AddDomainButton.vue';
import TodoDetail from './components/TodoDetail/TodoDetail.vue';
import MenuBar from './components/MenuBar/MenuBar.vue';
import { todoStore } from './store/todo.store';
import { todoSettingStore } from './store/todoSetting.store';
import { initTodoSubscriber } from './xpc/update.subscriber';
import { todoEnv } from './contextBridge/todoEnv.bridge';

const isStandalone = ref(false);

const onBoardClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.domain-column') && !target.closest('.focused-column') && !target.closest('.todo-detail__panel')) {
    todoStore.closeDetail();
  }
};

const onDomainDragEnd = () => {
  const order = todoStore.domainList.map((d) => d.id);
  todoStore.saveDomainOrder(order);
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    todoStore.closeDetail();
  }
};

onMounted(async () => {
  isStandalone.value = todoEnv?.isStandalone ?? false;
  initTodoSubscriber();
  await todoSettingStore.load();
  await todoStore.loadAll();
  document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<style lang="less">
@import './App.less';
</style>
