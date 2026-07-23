<template>
  <div name="menubar" class="menubar" :class="menubarClass" @dblclick="handleDoubleClick">
    <span class="menubar__title">{{ i18nHelper.todo.title }}</span>
    <div name="menubar__actions" class="menubar__actions">
      <a-tooltip :content="addDomainTooltip" position="br" mini>
        <span class="menubar__add-domain-tooltip">
          <a-button
            name="menubar__add-domain"
            class="menubar__add-domain"
            size="mini"
            type="text"
            :loading="addDomainLoading"
            :disabled="addDomainLoading || domainLimitReached"
            :title="addDomainTooltip"
            :aria-label="i18nHelper.todo.addDomain"
            @click="handleAddDomain"
          >
            <template #icon>
              <IconPlus :size="14" aria-hidden="true" />
            </template>
            <span class="menubar__add-domain-label">{{ i18nHelper.todo.addDomain }}</span>
          </a-button>
        </span>
      </a-tooltip>
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
      <a-tooltip :content="mcpGuideTooltip" position="br" mini>
        <a-badge
          class="menubar__agent-skill-badge"
          dot
          :count="todoAgentSkillStore.attention ? 1 : 0"
        >
          <a-button
            size="mini"
            type="text"
            :title="mcpGuideTooltip"
            :aria-label="mcpGuideTooltip"
            @click="handleOpenMcpGuide"
          >
            <template #icon>
              <IconRobot aria-hidden="true" />
            </template>
          </a-button>
        </a-badge>
      </a-tooltip>
      <a-popover trigger="hover" position="br">
        <a-badge :count="todoistSyncStore.failures.length" :max-count="99">
          <a-button
            size="mini"
            type="text"
            :title="i18nHelper.todo.refresh"
            :aria-label="i18nHelper.todo.refresh"
            @click="handleRefresh"
          >
            <template #icon>
              <IconRefresh :class="{ 'menubar__refresh-icon--active': todoistSyncStore.status?.syncing }" />
            </template>
          </a-button>
        </a-badge>
        <template #content>
          <div class="todo-sync-status">
            <strong>{{ i18nHelper.todo.syncStatusTitle }}</strong>
            <div class="todo-sync-status__row">
              <span class="todo-sync-status__label">{{ i18nHelper.todo.syncCurrentResult }}</span>
              <span class="todo-sync-status__value">{{ syncStatusLabel }}</span>
            </div>
            <div class="todo-sync-status__row">
              <span class="todo-sync-status__label">{{ i18nHelper.todo.syncLastSuccessful }}</span>
              <span class="todo-sync-status__value">{{ syncLastSuccessLabel }}</span>
            </div>
            <div v-if="syncErrorLabel" class="todo-sync-status__row">
              <span class="todo-sync-status__label">{{ i18nHelper.todo.syncErrorReason }}</span>
              <span class="todo-sync-status__value">{{ syncErrorLabel }}</span>
            </div>
            <div v-if="todoistSyncStore.failures.length" class="todo-sync-status__failures">
              <span class="todo-sync-status__label">{{ i18nHelper.todo.syncPermanentFailures }}</span>
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
import dayjs from 'dayjs';
import {
  IconArchive,
  IconExternalLink,
  IconMaximize,
  IconMinus,
  IconPinned,
  IconPlus,
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
import { todoAgentSkillStore } from '../../store/todoAgentSkill.store';
import { TODO_AGENT_SKILL_VERSION_CODE } from '@shared/mcp/todoAgentSkillVersion.shared';

const SNOWFLAKE_NODE_MISMATCH_ERROR = '[todoist sync] server changed this device Snowflake node';

const props = defineProps<{
  isStandalone: boolean;
  isOmni: boolean;
}>();

const isMac = uaHelper.isMac;
const isWindows = uaHelper.isWindows;
const mcpGuideVisible = ref(false);
const mcpInfo = ref<McpIntegrationInfo | null>(null);
const archivedDomainsVisible = ref(false);
const archivedDomainsLoading = ref(false);
const addDomainLoading = ref(false);
const domainLimitReached = computed(() => todoStore.domainList.length >= 17);
const addDomainTooltip = computed(() => (
  domainLimitReached.value ? i18nHelper.todo.domainLimitReached : i18nHelper.todo.addDomain
));
const mcpGuideTooltip = computed(() => {
  if (todoAgentSkillStore.status === 'loading') {
    return i18nHelper.todo.mcpSkillVersionChecking;
  }
  if (todoAgentSkillStore.status === 'install-required') {
    return i18nHelper.todo.mcpSkillInstallRequired;
  }
  if (todoAgentSkillStore.status === 'update-required') {
    return i18nHelper.todo.mcpSkillUpdateRequired;
  }
  if (todoAgentSkillStore.status === 'invalid') {
    return i18nHelper.todo.mcpSkillVersionInvalid;
  }
  return i18nHelper.todo.mcpTitle;
});
const syncStatusLabel = computed(() => {
  if (todoistSyncStore.status?.syncing) return i18nHelper.todo.syncStatusSyncing;
  if (todoistSyncStore.status?.pull_only) return i18nHelper.todo.syncStatusPullOnly;
  if (todoistSyncStore.status?.last_error) return i18nHelper.todo.syncStatusFailed;
  if (todoistSyncStore.status?.last_success_at !== null && todoistSyncStore.status?.last_success_at !== undefined) {
    return i18nHelper.todo.syncStatusSucceeded;
  }
  return i18nHelper.todo.syncStatusReady;
});
const syncLastSuccessLabel = computed(() => {
  const value = todoistSyncStore.status?.last_success_at;
  if (value === null || value === undefined) return i18nHelper.todo.syncNeverSynchronized;
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
});
const syncErrorLabel = computed(() => {
  const error = todoistSyncStore.status?.last_error;
  if (!error) return '';
  if (error === SNOWFLAKE_NODE_MISMATCH_ERROR) {
    return i18nHelper.todo.syncErrorDeviceIdentityMismatch;
  }
  return error;
});

const menubarClass = computed(() => {
  if (props.isOmni) return 'menubar--omni';
  if (isMac) return 'menubar--mac';
  if (isWindows) return 'menubar--win';
  return '';
});

const handleRefresh = () => {
  void observeTodoMutation(
    () => Promise.all([todoistSyncStore.requestSync(), todoStore.loadAll()]),
  );
};

const handleAddDomain = async (): Promise<void> => {
  if (addDomainLoading.value || domainLimitReached.value) return;

  addDomainLoading.value = true;
  const previousDomainIds = new Set(todoStore.domainList.map((domain) => domain.id));
  try {
    await observeTodoMutation(() => todoStore.createDomain());
    const createdDomain = todoStore.domainList.find((domain) => !previousDomainIds.has(domain.id));
    if (!createdDomain) return;

    await nextTick();
    document
      .querySelector<HTMLElement>(`.domain-column[data-domain-id="${createdDomain.id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } finally {
    addDomainLoading.value = false;
  }
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
    const skillState = resolveMcpIntegrationSkillState(info, TODO_AGENT_SKILL_VERSION_CODE);
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
      document
        .querySelector<HTMLElement>('.focused-column')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
