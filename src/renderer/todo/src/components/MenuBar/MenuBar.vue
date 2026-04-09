<template>
  <div class="menubar" :class="menubarClass" @dblclick="handleDoubleClick">
    <span class="menubar__title">{{ i18nHelper.todo.title }}</span>
    <div class="menubar__actions">
      <a-button size="mini" type="text" :title="i18nHelper.todo.refresh" @click="handleRefresh">
        <template #icon>
          <icon-refresh />
        </template>
      </a-button>
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
          <a-doption @click="handleToggleShowFocused">
            {{ todoSettingStore.showFocused ? i18nHelper.todo.hideFocused : i18nHelper.todo.showFocused }}
          </a-doption>
        </template>
      </a-dropdown>
      <a-button v-if="!isStandalone" size="mini" type="text" @click="handleOpenInWindow">
        <template #icon>
          <icon-launch />
        </template>
      </a-button>
      <a-tooltip v-if="isStandalone && isMac" :content="i18nHelper.todo.pinOnTop" position="br" mini>
        <a-button size="mini" type="text" :class="{ 'menubar__pin-btn--active': todoSettingStore.alwaysOnTop }" @click="handleTogglePin">
          <template #icon>
            <icon-to-top />
          </template>
        </a-button>
      </a-tooltip>
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
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted } from 'vue';
import { IconLaunch, IconSettings, IconMinus, IconExpand, IconClose, IconRefresh, IconToTop } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoSettingStore } from '../../store/todoSetting.store';
import { todoStore } from '../../store/todo.store';
import { todoWindowEmitter } from '../../emitter/todoWindow.emitter';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';

const props = defineProps<{
  isStandalone: boolean;
}>();

const isMac = uaHelper.isMac;
const isWindows = uaHelper.isWindows;

const menubarClass = computed(() => {
  if (isMac) return 'menubar--mac';
  if (isWindows) return 'menubar--win';
  return '';
});

const handleRefresh = async () => {
  await todoWindowEmitter.reloadTodoData();
};

const handleToggleShowCompleted = async () => {
  await todoSettingStore.toggleShowCompleted();
  await todoStore.loadAll();
};

const handleToggleShowFocused = async () => {
  await todoSettingStore.toggleShowFocused();
  if (todoSettingStore.showFocused) {
    await nextTick();
    const boardScroll = document.querySelector<HTMLElement>('.todo-app__board-scroll');
    boardScroll?.scrollTo({ left: 0, behavior: 'smooth' });
  }
};

const handleOpenInWindow = () => {
  todoWindowEmitter.openTodoWindow();
};

const handleDoubleClick = async () => {
  if (!props.isStandalone) return;
  await todoWindowEmitter.toggleMaximize();
};

const handleMinimize = async () => {
  await todoWindowEmitter.minimize();
};

const handleMaximize = async () => {
  await todoWindowEmitter.toggleMaximize();
};

const handleClose = async () => {
  await todoWindowEmitter.close();
};

const handleTogglePin = async () => {
  await todoSettingStore.setAlwaysOnTop(!todoSettingStore.alwaysOnTop);
  await todoWindowEmitter.setAlwaysOnTop({ enable: todoSettingStore.alwaysOnTop });
};

onMounted(async () => {
  if (props.isStandalone && isMac && todoSettingStore.alwaysOnTop) {
    await todoWindowEmitter.setAlwaysOnTop({ enable: true });
  }
});
</script>

<style lang="less">
@import './MenuBar.less';
</style>
