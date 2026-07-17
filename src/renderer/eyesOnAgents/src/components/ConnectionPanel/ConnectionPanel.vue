<template>
  <a-drawer
    v-model:visible="drawerVisible"
    class="eyes-connection-panel"
    placement="right"
    :width="420"
    :footer="false"
    :mask-closable="true"
    unmount-on-close
  >
    <template #title>
      <div name="eyesOnAgents__connections__title" class="eyes-connection-panel__title">
        <IconPlugConnected :size="18" />
        <span>{{ i18nHelper.eyesOnAgents.connection.title }}</span>
      </div>
    </template>

    <div name="eyesOnAgents__connections__body" class="eyes-connection-panel__body">
      <section name="eyesOnAgents__connections__appServer" class="eyes-connection-card">
        <div class="eyes-connection-card__header">
          <div>
            <span class="eyes-connection-card__eyebrow">
              {{ i18nHelper.eyesOnAgents.connection.appServer }}
            </span>
            <h2>{{ i18nHelper.eyesOnAgents.connection.managedTitle }}</h2>
          </div>
          <span class="eyes-connection-card__status" :class="connectionStatusClass">
            {{ connectionLabel }}
          </span>
        </div>
        <p>{{ i18nHelper.eyesOnAgents.connection.managedDescription }}</p>
        <dl class="eyes-connection-card__facts">
          <div>
            <dt>{{ i18nHelper.eyesOnAgents.connection.lastSync }}</dt>
            <dd>{{ lastSyncedLabel }}</dd>
          </div>
        </dl>
        <div v-if="connection?.error" class="eyes-connection-card__error" role="alert">
          {{ connection.error }}
        </div>
        <div class="eyes-connection-card__actions">
          <a-button
            v-if="!isConnected"
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyAction === 'connect'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleConnect"
          >
            {{ connectionState === 'error'
              ? i18nHelper.eyesOnAgents.connection.retry
              : i18nHelper.eyesOnAgents.connection.connect }}
          </a-button>
          <a-button
            v-if="canDisconnect"
            size="mini"
            status="danger"
            :loading="eyesOnAgentsStore.busyAction === 'disconnect'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleDisconnect"
          >
            {{ i18nHelper.eyesOnAgents.connection.disconnect }}
          </a-button>
          <a-button
            size="mini"
            :loading="eyesOnAgentsStore.busyAction === 'sync'"
            :disabled="!isConnected || Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleSync"
          >
            <template #icon><IconRefresh :size="15" /></template>
            {{ i18nHelper.eyesOnAgents.actions.sync }}
          </a-button>
        </div>
      </section>

      <aside name="eyesOnAgents__connections__boundary" class="eyes-connection-panel__boundary">
        <IconInfoCircle :size="17" />
        <span>{{ i18nHelper.eyesOnAgents.connection.desktopNote }}</span>
      </aside>

      <section name="eyesOnAgents__connections__bridge" class="eyes-connection-card">
        <div class="eyes-connection-card__header">
          <div>
            <span class="eyes-connection-card__eyebrow">
              {{ i18nHelper.eyesOnAgents.bridge.eyebrow }}
            </span>
            <h2>{{ i18nHelper.eyesOnAgents.bridge.title }}</h2>
          </div>
          <span class="eyes-connection-card__status" :class="bridgeStatusClass">
            {{ bridgeLabel }}
          </span>
        </div>
        <p>{{ i18nHelper.eyesOnAgents.bridge.description }}</p>
        <dl class="eyes-connection-card__facts">
          <div>
            <dt>{{ i18nHelper.eyesOnAgents.bridge.listener }}</dt>
            <dd>{{ listenerLabel }}</dd>
          </div>
          <div v-if="bridge?.listeningSince">
            <dt>{{ i18nHelper.eyesOnAgents.bridge.listeningSince }}</dt>
            <dd>{{ formatTimestamp(bridge.listeningSince) }}</dd>
          </div>
          <div>
            <dt>{{ i18nHelper.eyesOnAgents.bridge.lastInspected }}</dt>
            <dd>{{ formatTimestamp(bridge?.lastInspectedAt) }}</dd>
          </div>
          <div>
            <dt>{{ i18nHelper.eyesOnAgents.bridge.lastEvent }}</dt>
            <dd>{{ formatTimestamp(bridge?.lastEventAt) }}</dd>
          </div>
        </dl>
        <div
          v-if="showReviewGuidance"
          class="eyes-connection-card__trust"
          role="status"
        >
          <strong>{{ reviewGuidance }}</strong>
          <span>{{ i18nHelper.eyesOnAgents.bridge.reviewInstructions }}</span>
        </div>
        <div v-if="bridge?.error" class="eyes-connection-card__error" role="alert">
          {{ bridge.error }}
        </div>
        <div v-if="showBridgeActions" class="eyes-connection-card__actions">
          <a-button
            v-if="canEnableBridge"
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyAction === 'bridge-install'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleInstallBridge"
          >
            {{ i18nHelper.eyesOnAgents.bridge.enable }}
          </a-button>
          <a-button
            v-if="canRepairBridge"
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyAction === 'bridge-install'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleInstallBridge"
          >
            {{ i18nHelper.eyesOnAgents.bridge.repair }}
          </a-button>
          <a-button
            v-if="canReviewBridge"
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyAction === 'bridge-review'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleReviewBridge"
          >
            {{ reviewActionLabel }}
          </a-button>
          <a-button
            v-if="canRefreshBridge"
            size="mini"
            :loading="eyesOnAgentsStore.busyAction === 'bridge-refresh'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleRefreshBridge"
          >
            {{ bridgeState === 'installed'
              ? i18nHelper.eyesOnAgents.bridge.checkStatus
              : i18nHelper.eyesOnAgents.bridge.checkAgain }}
          </a-button>
          <a-button
            v-if="canDisableBridge"
            size="mini"
            status="danger"
            :loading="eyesOnAgentsStore.busyAction === 'bridge-remove'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleRemoveBridge"
          >
            {{ i18nHelper.eyesOnAgents.bridge.disable }}
          </a-button>
        </div>
      </section>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconInfoCircle, IconPlugConnected, IconRefresh } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (event: 'close'): void }>();

const drawerVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => {
    if (!value) emit('close');
  },
});
const connection = computed(() => eyesOnAgentsStore.snapshot?.connection ?? null);
const bridge = computed(() => eyesOnAgentsStore.snapshot?.bridge ?? null);
const connectionState = computed(() => connection.value?.state ?? 'disconnected');
const bridgeState = computed(() => bridge.value?.state ?? 'not_installed');
const isConnected = computed(() => ['connected', 'syncing'].includes(connectionState.value));
const canDisconnect = computed(
  () => isConnected.value || connection.value?.autoConnectEnabled === true,
);
const bridgeReviewReason = computed(() => bridge.value?.reviewReason ?? null);
const canEnableBridge = computed(() => bridgeState.value === 'not_installed');
const canRepairBridge = computed(() => bridgeState.value === 'drifted');
const canReviewBridge = computed(
  () => bridgeState.value === 'needs_trust' || bridgeState.value === 'error',
);
const canRefreshBridge = computed(
  () => ['installed', 'needs_trust', 'error'].includes(bridgeState.value),
);
const canDisableBridge = computed(() => bridgeState.value !== 'not_installed');
const showBridgeActions = computed(
  () => canEnableBridge.value
    || canRepairBridge.value
    || canReviewBridge.value
    || canRefreshBridge.value
    || canDisableBridge.value,
);
const showReviewGuidance = computed(
  () => bridgeState.value === 'needs_trust' || bridgeState.value === 'error',
);
const connectionStatusClass = computed(
  () => `eyes-connection-card__status--${connectionState.value}`,
);
const bridgeStatusClass = computed(
  () => `eyes-connection-card__status--${bridgeState.value}`,
);
const connectionLabel = computed(() => {
  switch (connectionState.value) {
    case 'connected': return i18nHelper.eyesOnAgents.connection.connected;
    case 'connecting': return i18nHelper.eyesOnAgents.connection.connecting;
    case 'syncing': return i18nHelper.eyesOnAgents.connection.syncing;
    case 'error': return i18nHelper.eyesOnAgents.connection.error;
    default: return i18nHelper.eyesOnAgents.connection.disconnected;
  }
});
const bridgeLabel = computed(() => {
  switch (bridgeState.value) {
    case 'installed':
      return bridge.value?.listening
        ? i18nHelper.eyesOnAgents.bridge.observing
        : i18nHelper.eyesOnAgents.bridge.installedPaused;
    case 'needs_trust':
      return bridgeReviewReason.value === 'disabled'
        ? i18nHelper.eyesOnAgents.bridge.disabled
        : i18nHelper.eyesOnAgents.bridge.needsReview;
    case 'drifted': return i18nHelper.eyesOnAgents.bridge.drifted;
    case 'error': return i18nHelper.eyesOnAgents.bridge.error;
    default: return i18nHelper.eyesOnAgents.bridge.notInstalled;
  }
});
const listenerLabel = computed(() => bridge.value?.listening
  ? i18nHelper.eyesOnAgents.bridge.listenerActive
  : i18nHelper.eyesOnAgents.bridge.listenerPaused,
);
const reviewGuidance = computed(() => {
  switch (bridgeReviewReason.value) {
    case 'disabled': return i18nHelper.eyesOnAgents.bridge.disabledReview;
    case 'modified': return i18nHelper.eyesOnAgents.bridge.modifiedReview;
    case 'untrusted': return i18nHelper.eyesOnAgents.bridge.untrustedReview;
    default: return i18nHelper.eyesOnAgents.bridge.manualReview;
  }
});
const reviewActionLabel = computed(() => bridgeReviewReason.value === 'disabled'
  ? i18nHelper.eyesOnAgents.bridge.reEnableAndReview
  : i18nHelper.eyesOnAgents.bridge.reviewInCodex,
);
const lastSyncedLabel = computed(() => {
  const value = connection.value?.lastSyncedAt;
  if (!value) return i18nHelper.eyesOnAgents.connection.neverSynced;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? i18nHelper.eyesOnAgents.connection.neverSynced
    : parsed.toLocaleString();
});
const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) return i18nHelper.eyesOnAgents.bridge.never;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? i18nHelper.eyesOnAgents.bridge.never
    : parsed.toLocaleString();
};

const handleConnect = async (): Promise<void> => {
  await eyesOnAgentsStore.connectAppServer().catch(() => undefined);
};
const handleDisconnect = async (): Promise<void> => {
  await eyesOnAgentsStore.disconnectAppServer().catch(() => undefined);
};
const handleSync = async (): Promise<void> => {
  await eyesOnAgentsStore.syncThreads().catch(() => undefined);
};
const handleInstallBridge = async (): Promise<void> => {
  await eyesOnAgentsStore.installCodexBridge().catch(() => undefined);
};
const handleReviewBridge = async (): Promise<void> => {
  await eyesOnAgentsStore.reviewCodexBridge().catch(() => undefined);
};
const handleRefreshBridge = async (): Promise<void> => {
  await eyesOnAgentsStore.refreshCodexBridgeStatus().catch(() => undefined);
};
const handleRemoveBridge = async (): Promise<void> => {
  await eyesOnAgentsStore.removeCodexBridge().catch(() => undefined);
};
</script>

<style lang="less">
@import './ConnectionPanel.less';
</style>
