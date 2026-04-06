<template>
  <div class="todo-app">
    <MenuBar :is-standalone="isStandalone" />
    <div class="todo-app__board">
      <div class="todo-app__board-scroll">
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
      </div>
      <TodoDetail />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import draggable from 'vuedraggable';
import DomainColumn from './components/DomainColumn/DomainColumn.vue';
import AddDomainButton from './components/AddDomainButton/AddDomainButton.vue';
import TodoDetail from './components/TodoDetail/TodoDetail.vue';
import MenuBar from './components/MenuBar/MenuBar.vue';
import { todoStore } from './store/todo.store';
import { todoSettingStore } from './store/todoSetting.store';
import { initTodoSubscriber } from './xpc/update.subscriber';
import { todoEnv } from './contextBridge/todoEnv.bridge';

const isStandalone = ref(false);

const onDomainDragEnd = () => {
  const order = todoStore.domainList.map((d) => d.id);
  todoStore.saveDomainOrder(order);
};

onMounted(async () => {
  isStandalone.value = todoEnv?.isStandalone ?? false;
  initTodoSubscriber();
  await todoSettingStore.load();
  await todoStore.loadAll();
});
</script>

<style lang="less">
@import './App.less';
</style>
