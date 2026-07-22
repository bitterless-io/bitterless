<template>
  <div class="todo-app">
    <MenuBar :is-standalone="isStandalone" />
    <SyncClockBanner />
    <div class="todo-app__board">
      <div class="todo-app__board-scroll" ref="boardScrollRef" @scroll="onBoardScroll" @click="onBoardClick">
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
      <transition name="scroll-to-left">
        <a-badge v-if="showScrollToLeft" class="todo-app__scroll-to-left-badge" :count="todoStore.focusedTodoList.length" :max-count="99">
          <button class="todo-app__scroll-to-left" @click="scrollToLeft">
            <IconArrowLeft :size="14" />
          </button>
        </a-badge>
      </transition>
      <TodoDetail />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Message } from '@arco-design/web-vue';
import draggable from 'vuedraggable';
import { IconArrowLeft } from '@tabler/icons-vue';
import DomainColumn from './components/DomainColumn/DomainColumn.vue';
import FocusedColumn from './components/FocusedColumn/FocusedColumn.vue';
import AddDomainButton from './components/AddDomainButton/AddDomainButton.vue';
import TodoDetail from './components/TodoDetail/TodoDetail.vue';
import MenuBar from './components/MenuBar/MenuBar.vue';
import SyncClockBanner from './components/SyncClockBanner/SyncClockBanner.vue';
import { todoStore } from './store/todo.store';
import { todoSettingStore } from './store/todoSetting.store';
import { observeTodoMutation } from './store/todoMutation.service';
import { initTodoSubscriber } from './xpc/update.subscriber';
import { todoEnv } from './contextBridge/todoEnv.bridge';
import { todoWindowEmitter } from './emitter/todoWindow.emitter';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import { todoistSyncStore } from './store/todoistSync.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const isStandalone = ref(false);
const boardScrollRef = ref<HTMLElement | null>(null);
const showScrollToLeft = ref(false);
let clockTimer: ReturnType<typeof setInterval> | null = null;

const onBoardScroll = () => {
  showScrollToLeft.value = (boardScrollRef.value?.scrollLeft ?? 0) > 150;
};

const scrollToLeft = () => {
  boardScrollRef.value?.scrollTo({ left: 0, behavior: 'smooth' });
};

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
    isStandalone.value = todoEnv?.isStandalone ?? false;
    initTodoSubscriber();
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
    await todoStore.loadAll();
    if (isStandalone.value && uaHelper.isMac && todoSettingStore.alwaysOnTop) {
      await todoWindowEmitter.setAlwaysOnTop({ enable: true });
    }
    document.addEventListener('keydown', onKeydown);
  } catch (error) {
    console.error('[todo] renderer initialization failed:', error);
    Message.error(i18nHelper.todo.runtimeUnavailable);
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('focus', handleWindowFocus);
  if (clockTimer) clearInterval(clockTimer);
});

const handleWindowFocus = (): void => {
  void todoistSyncStore.checkClock().catch((error) => {
    console.warn('[todoist sync] focus clock check failed:', error);
  });
};
</script>

<style lang="less">
@import './App.less';
</style>
