<template>
  <div class="menubar" :class="menubarClass" @dblclick="handleDoubleClick">
    <span class="menubar__title">{{ i18nHelper.todo.title }}</span>
    <div class="menubar__actions">
      <a-tooltip :content="i18nHelper.todo.archivedDomains" position="br" mini>
        <a-button size="mini" type="text" @click="handleOpenArchivedDomains">
          <template #icon>
            <icon-delete />
          </template>
        </a-button>
      </a-tooltip>
      <a-tooltip :content="i18nHelper.todo.mcpTitle" position="br" mini>
        <a-button size="mini" type="text" @click="handleOpenMcpGuide">
          <template #icon>
            <icon-robot />
          </template>
        </a-button>
      </a-tooltip>
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
    <McpGuideModal
      :visible="mcpGuideVisible"
      :info="mcpInfo"
      @close="mcpGuideVisible = false"
    />
    <ArchivedDomainsModal
      :visible="archivedDomainsVisible"
      @close="archivedDomainsVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { Message } from '@arco-design/web-vue';
import { IconDelete, IconLaunch, IconSettings, IconMinus, IconExpand, IconClose, IconRefresh, IconToTop, IconRobot } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoSettingStore } from '../../store/todoSetting.store';
import { todoStore } from '../../store/todo.store';
import { todoWindowEmitter } from '../../emitter/todoWindow.emitter';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import { mcpEmitter } from '../../emitter/mcp.emitter';
import McpGuideModal from '../McpGuideModal/McpGuideModal.vue';
import ArchivedDomainsModal from '../ArchivedDomainsModal/ArchivedDomainsModal.vue';
import type { McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';

const props = defineProps<{
  isStandalone: boolean;
}>();

const isMac = uaHelper.isMac;
const isWindows = uaHelper.isWindows;
const mcpGuideVisible = ref(false);
const mcpInfo = ref<McpIntegrationInfo | null>(null);
const archivedDomainsVisible = ref(false);

const menubarClass = computed(() => {
  if (isMac) return 'menubar--mac';
  if (isWindows) return 'menubar--win';
  return '';
});

const handleRefresh = async () => {
  await todoWindowEmitter.reloadTodoData();
};

const handleOpenMcpGuide = async () => {
  try {
    mcpInfo.value = await mcpEmitter.getIntegrationInfo();
    mcpGuideVisible.value = true;
  } catch (err: any) {
    Message.error(err?.message ?? i18nHelper.todo.mcpLoadFailed);
  }
};

const handleOpenArchivedDomains = async () => {
  await todoStore.loadArchivedDomains();
  archivedDomainsVisible.value = true;
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

</script>

<style lang="less">
@import './MenuBar.less';
</style>
