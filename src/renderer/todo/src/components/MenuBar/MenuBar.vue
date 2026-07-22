<template>
  <div name="menubar" class="menubar" :class="menubarClass" @dblclick="handleDoubleClick">
    <span class="menubar__title">{{ i18nHelper.todo.title }}</span>
    <div name="menubar__actions" class="menubar__actions">
      <a-tooltip :content="i18nHelper.todo.archivedDomains" position="br" mini>
        <a-button
          size="mini"
          type="text"
          :loading="archivedDomainsLoading"
          :title="i18nHelper.todo.archivedDomains"
          :aria-label="i18nHelper.todo.archivedDomains"
          @click="handleOpenArchivedDomains"
        >
          <template #icon>
            <IconArchive />
          </template>
        </a-button>
      </a-tooltip>
      <a-tooltip :content="i18nHelper.todo.mcpTitle" position="br" mini>
        <a-button size="mini" type="text" @click="handleOpenMcpGuide">
          <template #icon>
            <IconRobot />
          </template>
        </a-button>
      </a-tooltip>
      <a-button size="mini" type="text" :title="i18nHelper.todo.refresh" @click="handleRefresh">
        <template #icon>
          <IconRefresh />
        </template>
      </a-button>
      <a-popover trigger="click" position="br">
        <a-badge :count="todoistSyncStore.failures.length" :max-count="99">
          <a-button size="mini" type="text" :title="i18nHelper.todo.syncStatusTitle">
            <template #icon>
              <IconCloud :class="{ 'menubar__sync-icon--active': todoistSyncStore.status?.syncing }" />
            </template>
          </a-button>
        </a-badge>
        <template #content>
          <div class="todo-sync-status">
            <strong>{{ i18nHelper.todo.syncStatusTitle }}</strong>
            <span>{{ syncStatusLabel }}</span>
            <div v-if="todoistSyncStore.failures.length" class="todo-sync-status__failures">
              <div v-for="failure in todoistSyncStore.failures" :key="failure.uuid" class="todo-sync-status__failure">
                <span>{{ failure.command_type }} · {{ failure.error_message || failure.error_code }}</span>
                <div class="todo-sync-status__actions">
                  <a-button size="mini" @click="handleRetrySync(failure.uuid)">{{ i18nHelper.todo.syncRetry }}</a-button>
                  <a-button size="mini" status="danger" @click="handleDiscardSync(failure.uuid)">{{ i18nHelper.todo.syncDiscard }}</a-button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </a-popover>
      <a-dropdown trigger="click" position="br">
        <a-button size="mini" type="text">
          <template #icon>
            <IconSettings />
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
          <IconExternalLink />
        </template>
      </a-button>
      <a-tooltip v-if="isStandalone && isMac" :content="i18nHelper.todo.pinOnTop" position="br" mini>
        <a-button size="mini" type="text" :class="{ 'menubar__pin-btn--active': todoSettingStore.alwaysOnTop }" @click="handleTogglePin">
          <template #icon>
            <IconPinned />
          </template>
        </a-button>
      </a-tooltip>
      <a-button v-if="isStandalone && isWindows" size="mini" type="text" @click="handleMinimize">
        <template #icon>
          <IconMinus />
        </template>
      </a-button>
      <a-button v-if="isStandalone && isWindows" size="mini" type="text" @click="handleMaximize">
        <template #icon>
          <IconMaximize />
        </template>
      </a-button>
      <a-button v-if="isStandalone && isWindows" size="mini" type="text" @click="handleClose">
        <template #icon>
          <IconX />
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
import {
  IconArchive,
  IconCloud,
  IconExternalLink,
  IconMaximize,
  IconMinus,
  IconPinned,
  IconRefresh,
  IconRobot,
  IconSettings,
  IconX
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoSettingStore } from '../../store/todoSetting.store';
import { todoStore } from '../../store/todo.store';
import { observeTodoMutation } from '../../store/todoMutation.service';
import { todoWindowEmitter } from '../../emitter/todoWindow.emitter';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import { mcpEmitter } from '../../emitter/mcp.emitter';
import McpGuideModal from '../McpGuideModal/McpGuideModal.vue';
import ArchivedDomainsModal from '../ArchivedDomainsModal/ArchivedDomainsModal.vue';
import type { McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';
import { resolveMcpIntegrationSkillState } from '@shared/mcp/mcpIntegrationInfo.shared';
import { todoistSyncStore } from '../../store/todoistSync.store';

const props = defineProps<{
  isStandalone: boolean;
}>();

const isMac = uaHelper.isMac;
const isWindows = uaHelper.isWindows;
const mcpGuideVisible = ref(false);
const mcpInfo = ref<McpIntegrationInfo | null>(null);
const archivedDomainsVisible = ref(false);
const archivedDomainsLoading = ref(false);
const syncStatusLabel = computed(() => {
  if (todoistSyncStore.status?.syncing) return i18nHelper.todo.syncStatusSyncing;
  if (todoistSyncStore.status?.pull_only) return i18nHelper.todo.syncStatusPullOnly;
  if (todoistSyncStore.status?.last_error) return todoistSyncStore.status.last_error;
  return i18nHelper.todo.syncStatusReady;
});

const menubarClass = computed(() => {
  if (isMac) return 'menubar--mac';
  if (isWindows) return 'menubar--win';
  return '';
});

const handleRefresh = () => {
  void observeTodoMutation(
    () => Promise.all([todoistSyncStore.requestSync(), todoStore.loadAll()]),
  );
};

const handleRetrySync = (uuid: string): void => {
  void observeTodoMutation(() => todoistSyncStore.retry(uuid));
};

const handleDiscardSync = (uuid: string): void => {
  void observeTodoMutation(() => todoistSyncStore.discard(uuid));
};

const handleOpenMcpGuide = async () => {
  try {
    const info = await mcpEmitter.getIntegrationInfo();
    const skillState = resolveMcpIntegrationSkillState(info);
    if (skillState.status !== 'ready') {
      Message.error(i18nHelper.todo.mcpRestartRequiredDescription);
      return;
    }

    mcpInfo.value = { ...info, skillPath: skillState.skillPath };
    mcpGuideVisible.value = true;
  } catch (err: any) {
    Message.error(err?.message ?? i18nHelper.todo.mcpLoadFailed);
  }
};

const handleOpenArchivedDomains = async () => {
  if (archivedDomainsLoading.value) return;

  archivedDomainsLoading.value = true;
  try {
    await todoStore.loadArchivedDomains();
    archivedDomainsVisible.value = true;
  } catch {
    archivedDomainsVisible.value = false;
    Message.error(i18nHelper.todo.archivedDomainsLoadFailed);
  } finally {
    archivedDomainsLoading.value = false;
  }
};

const handleToggleShowCompleted = () => {
  void observeTodoMutation(async () => {
    await todoSettingStore.toggleShowCompleted();
    await todoStore.loadAll();
  });
};

const handleToggleShowFocused = () => {
  void observeTodoMutation(async () => {
    await todoSettingStore.toggleShowFocused();
    if (todoSettingStore.showFocused) {
      await nextTick();
      const boardScroll = document.querySelector<HTMLElement>('.todo-app__board-scroll');
      boardScroll?.scrollTo({ left: 0, behavior: 'smooth' });
    }
  });
};

const handleOpenInWindow = () => {
  void observeTodoMutation(() => todoWindowEmitter.openTodoWindow());
};

const handleDoubleClick = () => {
  if (!props.isStandalone) return;
  void observeTodoMutation(() => todoWindowEmitter.toggleMaximize());
};

const handleMinimize = () => {
  void observeTodoMutation(() => todoWindowEmitter.minimize());
};

const handleMaximize = () => {
  void observeTodoMutation(() => todoWindowEmitter.toggleMaximize());
};

const handleClose = () => {
  void observeTodoMutation(() => todoWindowEmitter.close());
};

const handleTogglePin = () => {
  void observeTodoMutation(async () => {
    await todoSettingStore.setAlwaysOnTop(!todoSettingStore.alwaysOnTop);
    await todoWindowEmitter.setAlwaysOnTop({ enable: todoSettingStore.alwaysOnTop });
  });
};

</script>

<style lang="less">
@import './MenuBar.less';
</style>
