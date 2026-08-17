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
        <div
          v-if="titleEnrichmentDiagnostic"
          name="eyesOnAgents__connections__titleEnrichmentDiagnostic"
          class="eyes-connection-card__diagnostic"
          role="status"
        >
          <strong>{{ i18nHelper.eyesOnAgents.connection.titleEnrichment }}</strong>
          <span>{{ titleEnrichmentDiagnosticLabel }}</span>
        </div>
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
        <div
          name="eyesOnAgents__connections__promptRetention"
          class="eyes-connection-card__preference"
        >
          <div class="eyes-connection-card__preference-copy">
            <strong id="eyes-on-agents-prompt-retention-label">
              {{ i18nHelper.eyesOnAgents.bridge.promptRetentionLabel }}
            </strong>
            <span id="eyes-on-agents-prompt-retention-description">
              {{ i18nHelper.eyesOnAgents.bridge.promptRetentionDescription }}
            </span>
          </div>
          <a-switch
            size="small"
            :model-value="lastUserPromptCaptureEnabled"
            :loading="eyesOnAgentsStore.busyAction === 'prompt-retention'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            aria-labelledby="eyes-on-agents-prompt-retention-label"
            aria-describedby="eyes-on-agents-prompt-retention-description"
            @change="handleLastUserPromptCaptureChange"
          />
        </div>
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
          class="eyes-connection-card__trust-summary"
          role="status"
        >
          <strong>{{ reviewGuidance }}</strong>
        </div>
        <section
          name="eyesOnAgents__connections__hookGuide"
          class="eyes-connection-card__hook-guide"
          aria-labelledby="eyes-connection-hook-guide-title"
        >
          <h3 id="eyes-connection-hook-guide-title">
            {{ i18nHelper.eyesOnAgents.bridge.hookGuideTitle }}
          </h3>
          <ol class="eyes-connection-card__hook-steps">
            <li name="eyesOnAgents__connections__hookGuideStep">
              <strong>{{ i18nHelper.eyesOnAgents.bridge.hookGuideOpenTitle }}</strong>
              <span>{{ i18nHelper.eyesOnAgents.bridge.hookGuideOpenDescription }}</span>
            </li>
            <li name="eyesOnAgents__connections__hookGuideStep">
              <strong>{{ i18nHelper.eyesOnAgents.bridge.hookGuideReviewTitle }}</strong>
              <span>{{ i18nHelper.eyesOnAgents.bridge.hookGuideReviewDescription }}</span>
              <span class="eyes-connection-card__hook-cli">
                {{ i18nHelper.eyesOnAgents.bridge.hookGuideCli }}
              </span>
            </li>
            <li name="eyesOnAgents__connections__hookGuideStep">
              <strong>{{ i18nHelper.eyesOnAgents.bridge.hookGuideConfirmTitle }}</strong>
              <span>{{ i18nHelper.eyesOnAgents.bridge.hookGuideConfirmDescription }}</span>
            </li>
            <li name="eyesOnAgents__connections__hookGuideStep">
              <strong>{{ i18nHelper.eyesOnAgents.bridge.hookGuideContentTitle }}</strong>
              <span>{{ i18nHelper.eyesOnAgents.bridge.hookGuideContentDescription }}</span>
            </li>
          </ol>
          <p class="eyes-connection-card__trust-boundary">
            {{ i18nHelper.eyesOnAgents.bridge.hookGuideTrustBoundary }}
          </p>
        </section>
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

      <ClaudeObservationCard />
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconInfoCircle, IconPlugConnected, IconRefresh } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ClaudeObservationCard from './ClaudeObservationCard.vue';
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
const titleEnrichmentDiagnostic = computed(
  () => eyesOnAgentsStore.snapshot?.titleEnrichmentDiagnostic ?? null,
);
const lastUserPromptCaptureEnabled = computed(
  () => eyesOnAgentsStore.snapshot?.lastUserPromptCaptureEnabled ?? false,
);
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
const titleEnrichmentDiagnosticLabel = computed(() => {
  const diagnostic = titleEnrichmentDiagnostic.value;
  if (!diagnostic) return '';
  const threadId = diagnostic.threadId.slice(0, 8);
  switch (diagnostic.reason) {
    case 'thread_read_rejected':
      return i18nHelper.eyesOnAgents.connection.titleEnrichmentReadRejected
        .replace('{thread}', threadId);
    case 'unusable_response':
      return i18nHelper.eyesOnAgents.connection.titleEnrichmentUnusable
        .replace('{thread}', threadId);
    default:
      return i18nHelper.eyesOnAgents.connection.titleEnrichmentDeferred
        .replace('{thread}', threadId);
  }
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
const handleLastUserPromptCaptureChange = async (
  enabled: boolean | string | number,
): Promise<void> => {
  await eyesOnAgentsStore.setLastUserPromptCaptureEnabled(Boolean(enabled))
    .catch(() => undefined);
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
