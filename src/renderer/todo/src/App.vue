<template>
  <div class="todo-app">
    <MenuBar :is-standalone="isStandalone" :is-omni="isOmni" />
    <SyncClockBanner />
    <div
      class="todo-app__board"
      :class="{ 'todo-app__board--detail-open': todoStore.detailVisible }"
    >
      <div class="todo-app__board-scroll" @click="onBoardClick">
        <draggable
          v-model="todoStore.domainList"
          group="domains"
          item-key="id"
          handle=".domain-column__header"
          :animation="200"
          class="todo-app__board-draggable"
          @end="onDomainDragEnd"
        >
          <template #header>
            <FocusedColumn v-if="todoSettingStore.showFocused" />
          </template>
          <template #item="{ element }">
            <DomainColumn :domain="element" />
          </template>
        </draggable>
      </div>
      <TodoDetail />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Message } from '@arco-design/web-vue';
import draggable from 'vuedraggable';
import DomainColumn from './components/DomainColumn/DomainColumn.vue';
import FocusedColumn from './components/FocusedColumn/FocusedColumn.vue';
import TodoDetail from './components/TodoDetail/TodoDetail.vue';
import MenuBar from './components/MenuBar/MenuBar.vue';
import SyncClockBanner from './components/SyncClockBanner/SyncClockBanner.vue';
import { todoStore } from './store/todo.store';
import { todoSettingStore } from './store/todoSetting.store';
import {
  observeTodoMutation,
  registerTodoMutationFailureRecovery,
} from './store/todoMutation.service';
import { initTodoSubscriber } from './xpc/update.subscriber';
import { todoEnv } from './contextBridge/todoEnv.bridge';
import { todoWindowEmitter } from './emitter/todoWindow.emitter';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import { todoistSyncStore } from './store/todoistSync.store';
import { todoistSyncStatusEmitter } from './emitter/todoistSync.emitter';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { resolveTodoUnavailableReason } from './store/todoSessionState.service';
import { todoAgentSkillStore } from './store/todoAgentSkill.store';

const isStandalone = ref(false);
const isOmni = todoEnv?.host === 'omni';
let clockTimer: ReturnType<typeof setInterval> | null = null;
let unregisterMutationFailureRecovery: (() => void) | null = null;

const onBoardClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.domain-column') && !target.closest('.focused-column') && !target.closest('.todo-detail__panel')) {
    todoStore.closeDetail();
  }
};

const onDomainDragEnd = () => {
  const order = todoStore.domainList.map((d) => d.id);
  void observeTodoMutation(() => todoStore.saveDomainOrder(order));
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    todoStore.closeDetail();
  }
};

onMounted(async () => {
  try {
    unregisterMutationFailureRecovery = registerTodoMutationFailureRecovery(
      () => todoStore.requestRefresh(),
    );
    isStandalone.value = todoEnv?.isStandalone ?? false;
    initTodoSubscriber();
    void todoAgentSkillStore.initialize().catch((error) => {
      console.warn('[todo agent skill] version initialization failed:', error);
    });
    void todoistSyncStore.initialize().catch((error) => {
      console.warn('[todoist sync] renderer clock initialization failed:', error);
    });
    window.addEventListener('focus', handleWindowFocus);
    clockTimer = setInterval(() => {
      void todoistSyncStore.checkClock().catch((error) => {
        console.warn('[todoist sync] scheduled clock check failed:', error);
      });
    }, 15 * 60 * 1000);
    await todoSettingStore.load();
    await todoStore.requestRefresh();
    if (isStandalone.value && uaHelper.isMac && todoSettingStore.alwaysOnTop) {
      await todoWindowEmitter.setAlwaysOnTop({ enable: true });
    }
    document.addEventListener('keydown', onKeydown);
  } catch (error) {
    console.error('[todo] renderer initialization failed:', error);
    Message.error(i18nHelper.todo[await resolveTodoUnavailableReason(todoistSyncStatusEmitter)]);
  }
});

onUnmounted(() => {
  unregisterMutationFailureRecovery?.();
  unregisterMutationFailureRecovery = null;
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('focus', handleWindowFocus);
  if (clockTimer) clearInterval(clockTimer);
});

const handleWindowFocus = (): void => {
  void todoStore.requestRefresh().catch((error) => {
    console.warn('[todo] focus data refresh failed:', error);
  });
  void todoistSyncStore.checkClock().catch((error) => {
    console.warn('[todoist sync] focus clock check failed:', error);
  });
};
</script>

<style lang="less">
@import './App.less';
</style>
