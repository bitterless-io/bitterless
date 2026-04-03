<template>
  <div class="todo-app">
    <div class="todo-app__toolbar" :class="toolbarClass" @dblclick="handleToolbarDoubleClick">
      <span class="todo-app__toolbar-title">Todo</span>
      <div class="todo-app__toolbar-actions">
        <a-dropdown trigger="click" position="br">
          <a-button size="mini" type="text">
            <template #icon>
              <icon-settings />
            </template>
          </a-button>
          <template #content>
            <a-doption @click="handleToggleShowCompleted">
              {{ todoSettingStore.showCompleted ? i18nHelper.todo.hideCompleted : i18nHelper.todo.showCompleted }}
            </a-doption>
          </template>
        </a-dropdown>
        <a-button v-if="!isStandalone" size="mini" type="text" @click="openInWindow">
          <template #icon>
            <icon-launch />
          </template>
        </a-button>
        <a-button v-if="isStandalone && isWindows" size="mini" type="text" @click="handleMinimize">
          <template #icon>
            <icon-minus />
          </template>
        </a-button>
        <a-button v-if="isStandalone && isWindows" size="mini" type="text" @click="handleMaximize">
          <template #icon>
            <icon-expand />
          </template>
        </a-button>
        <a-button v-if="isStandalone && isWindows" size="mini" type="text" @click="handleClose">
          <template #icon>
            <icon-close />
          </template>
        </a-button>
      </div>
    </div>
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
import { ref, computed, onMounted } from 'vue';
import draggable from 'vuedraggable';
import { IconLaunch, IconSettings, IconMinus, IconExpand, IconClose } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import DomainColumn from './components/DomainColumn/DomainColumn.vue';
import AddDomainButton from './components/AddDomainButton/AddDomainButton.vue';
import TodoDetail from './components/TodoDetail/TodoDetail.vue';
import { todoStore } from './store/todo.store';
import { todoSettingStore } from './store/todoSetting.store';
import { todoWindowEmitter } from './emitter/todoWindow.emitter';
import { initTodoSubscriber } from './xpc/update.subscriber';
import { todoEnv } from './contextBridge/todoEnv.bridge';
import { windowControlEmitter } from './emitter/windowControl.emitter';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';

const isStandalone = ref(false);
const isMac = ref(uaHelper.isMac);
const isWindows = ref(uaHelper.isWindows);

const toolbarClass = computed(() => {
  if (isMac.value) return 'todo-app__toolbar--mac';
  if (isWindows.value) return 'todo-app__toolbar--win';
  return '';
});

const handleToggleShowCompleted = async () => {
  await todoSettingStore.toggleShowCompleted();
  await todoStore.loadAll();
};

const openInWindow = () => {
  todoWindowEmitter.openTodoWindow();
};

const onDomainDragEnd = () => {
  const order = todoStore.domainList.map((d) => d.id);
  todoStore.saveDomainOrder(order);
};

const handleToolbarDoubleClick = async () => {
  if (!isStandalone.value) return;
  const windowId = todoEnv.getWindowId();
  if (windowId) {
    await windowControlEmitter.maximizeWindow({ windowId });
  }
};

const handleMinimize = async () => {
  const windowId = todoEnv.getWindowId();
  if (windowId) {
    await windowControlEmitter.minimizeWindow({ windowId });
  }
};

const handleMaximize = async () => {
  const windowId = todoEnv.getWindowId();
  if (windowId) {
    await windowControlEmitter.maximizeWindow({ windowId });
  }
};

const handleClose = async () => {
  const windowId = todoEnv.getWindowId();
  if (windowId) {
    await windowControlEmitter.closeWindow({ windowId });
  }
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
