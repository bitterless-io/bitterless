<template>
  <header
    name="eyesOnAgents__menuBar"
    class="eyes-menu-bar"
    :class="platformClass"
    @dblclick="handleDoubleClick"
  >
    <div name="eyesOnAgents__menuBar__identity" class="eyes-menu-bar__identity">
      <IconEye :size="16" />
      <span class="eyes-menu-bar__title">{{ i18nHelper.eyesOnAgents.title }}</span>
    </div>

    <div name="eyesOnAgents__menuBar__actions" class="eyes-menu-bar__actions">
      <button
        name="eyesOnAgents__menuBar__connection"
        class="eyes-menu-bar__connection"
        type="button"
        :aria-label="i18nHelper.eyesOnAgents.actions.openConnections"
        @click="$emit('open-connections')"
      >
        <span class="eyes-menu-bar__status-dot" :class="connectionDotClass" />
        <span>{{ connectionLabel }}</span>
      </button>

      <a-button
        name="eyesOnAgents__menuBar__refresh"
        class="eyes-menu-bar__refresh"
        size="mini"
        type="text"
        :loading="eyesOnAgentsStore.busyAction === 'sync'"
        :disabled="!canRefresh"
        :aria-label="i18nHelper.eyesOnAgents.actions.refresh"
        @click="handleRefresh"
      >
        <template #icon><IconRefresh :size="16" /></template>
        {{ i18nHelper.eyesOnAgents.actions.refresh }}
      </a-button>

      <a-tooltip :content="bridgeLabel" position="br" mini>
        <a-button
          name="eyesOnAgents__menuBar__bridge"
          size="mini"
          type="text"
          :class="bridgeButtonClass"
          :aria-label="bridgeLabel"
          :aria-expanded="connectionsOpen"
          @click="$emit('toggle-connections')"
        >
          <template #icon><IconPlugConnected :size="16" /></template>
        </a-button>
      </a-tooltip>

      <a-tooltip v-if="!isOmni" :content="pinLabel" position="br" mini>
        <a-button
          name="eyesOnAgents__menuBar__pin"
          size="mini"
          type="text"
          :class="{ 'eyes-menu-bar__button--active': alwaysOnTop }"
          :aria-label="pinLabel"
          @click="handleTogglePin"
        >
          <template #icon><IconPinned :size="16" /></template>
        </a-button>
      </a-tooltip>

      <template v-if="isWindows && !isOmni">
        <a-button
          name="eyesOnAgents__menuBar__minimize"
          size="mini"
          type="text"
          :aria-label="i18nHelper.eyesOnAgents.actions.minimize"
          @click="eyesOnAgentsWindowEmitter.minimize()"
        >
          <template #icon><IconMinus :size="16" /></template>
        </a-button>
        <a-button
          name="eyesOnAgents__menuBar__maximize"
          size="mini"
          type="text"
          :aria-label="i18nHelper.eyesOnAgents.actions.maximize"
          @click="eyesOnAgentsWindowEmitter.toggleMaximize()"
        >
          <template #icon><IconMaximize :size="16" /></template>
        </a-button>
        <a-button
          name="eyesOnAgents__menuBar__close"
          size="mini"
          type="text"
          class="eyes-menu-bar__close"
          :aria-label="i18nHelper.eyesOnAgents.actions.close"
          @click="eyesOnAgentsWindowEmitter.close()"
        >
          <template #icon><IconX :size="16" /></template>
        </a-button>
      </template>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  IconEye,
  IconMaximize,
  IconMinus,
  IconPinned,
  IconPlugConnected,
  IconRefresh,
  IconX,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';
import { eyesOnAgentsWindowEmitter } from '../../emitter/eyesOnAgentsWindow.emitter';
import { eyesOnAgentsEnv } from '../../contextBridge/eyesOnAgentsEnv.bridge';

defineProps<{ connectionsOpen: boolean }>();

defineEmits<{
  (event: 'open-connections'): void;
  (event: 'toggle-connections'): void;
}>();

const isMac = uaHelper.isMac;
const isWindows = uaHelper.isWindows;
const isOmni = eyesOnAgentsEnv?.host === 'omni';
const alwaysOnTop = ref(false);
const platformClass = computed(() => ({
  'eyes-menu-bar--mac': isMac && !isOmni,
  'eyes-menu-bar--windows': isWindows && !isOmni,
  'eyes-menu-bar--omni': isOmni,
}));
const connectionState = computed(
  () => eyesOnAgentsStore.snapshot?.connection.state ?? 'disconnected',
);
const canRefresh = computed(
  () => !eyesOnAgentsStore.busyAction
    && connectionState.value !== 'connecting'
    && connectionState.value !== 'syncing',
);
const connectionDotClass = computed(
  () => `eyes-menu-bar__status-dot--${connectionState.value}`,
);
const connectionLabel = computed(() => {
  switch (connectionState.value) {
    case 'connected':
      return i18nHelper.eyesOnAgents.connection.connected;
    case 'connecting':
      return i18nHelper.eyesOnAgents.connection.connecting;
    case 'syncing':
      return i18nHelper.eyesOnAgents.connection.syncing;
    case 'error':
      return i18nHelper.eyesOnAgents.connection.error;
    default:
      return i18nHelper.eyesOnAgents.connection.disconnected;
  }
});
const bridgeState = computed(
  () => eyesOnAgentsStore.snapshot?.bridge.state ?? 'not_installed',
);
const bridgeLabel = computed(() => {
  switch (bridgeState.value) {
    case 'installed':
      return i18nHelper.eyesOnAgents.bridge.installed;
    case 'needs_trust':
      return i18nHelper.eyesOnAgents.bridge.needsTrust;
    case 'drifted':
      return i18nHelper.eyesOnAgents.bridge.drifted;
    case 'error':
      return i18nHelper.eyesOnAgents.bridge.error;
    default:
      return i18nHelper.eyesOnAgents.bridge.notInstalled;
  }
});
const bridgeButtonClass = computed(() => ({
  'eyes-menu-bar__button--active': bridgeState.value === 'installed',
  'eyes-menu-bar__button--attention': ['needs_trust', 'drifted', 'error'].includes(bridgeState.value),
}));
const pinLabel = computed(() =>
  alwaysOnTop.value
    ? i18nHelper.eyesOnAgents.actions.unpin
    : i18nHelper.eyesOnAgents.actions.pin,
);

const handleRefresh = async (): Promise<void> => {
  await eyesOnAgentsStore.syncThreads().catch(() => undefined);
};

const handleTogglePin = async (): Promise<void> => {
  alwaysOnTop.value = !alwaysOnTop.value;
  await eyesOnAgentsWindowEmitter
    .setAlwaysOnTop({ enable: alwaysOnTop.value })
    .catch(() => {
      alwaysOnTop.value = !alwaysOnTop.value;
    });
};

const handleDoubleClick = async (event: MouseEvent): Promise<void> => {
  if (isOmni) return;
  if ((event.target as HTMLElement).closest('.eyes-menu-bar__actions')) return;
  await eyesOnAgentsWindowEmitter.toggleMaximize();
};

onMounted(async () => {
  if (isOmni) return;
  alwaysOnTop.value = await eyesOnAgentsWindowEmitter.getAlwaysOnTop().catch(() => false);
});
</script>

<style lang="less">
@import './EyesOnAgentsMenuBar.less';
</style>
