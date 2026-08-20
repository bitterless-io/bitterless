<template>
  <a-drawer
    v-model:visible="drawerVisible"
    class="eyes-connection-panel"
    placement="right"
    popup-container=".eyes-on-agents__main"
    :width="540"
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
      <nav
        ref="providerTablistRef"
        name="eyesOnAgents__connections__providerRail"
        class="eyes-connection-panel__provider-rail"
        role="tablist"
        aria-orientation="vertical"
        :aria-label="i18nHelper.eyesOnAgents.connection.providerNavigation"
      >
        <button
          v-for="provider in connectionProviders"
          :id="getProviderTabId(provider)"
          :key="provider"
          type="button"
          name="eyesOnAgents__connections__providerTab"
          class="eyes-connection-panel__provider-tab"
          :class="{ 'eyes-connection-panel__provider-tab--active': activeProvider === provider }"
          role="tab"
          :aria-selected="activeProvider === provider"
          :aria-controls="getProviderPanelId(provider)"
          :tabindex="activeProvider === provider ? 0 : -1"
          :title="getProviderLabel(provider)"
          @click="selectProvider(provider)"
          @keydown="handleProviderKeydown($event, provider)"
        >
          <img
            v-if="provider === 'codex'"
            class="eyes-connection-panel__provider-logo eyes-connection-panel__provider-logo--codex"
            :src="codexLogo"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <img
            v-else
            class="eyes-connection-panel__provider-logo eyes-connection-panel__provider-logo--claude"
            :src="claudeLogo"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <span class="eyes-connection-panel__provider-label">
            {{ getProviderLabel(provider) }}
          </span>
        </button>
      </nav>

      <div
        :id="getProviderPanelId('codex')"
        v-show="activeProvider === 'codex'"
        name="eyesOnAgents__connections__codexPanel"
        class="eyes-connection-panel__detail"
        role="tabpanel"
        :aria-labelledby="getProviderTabId('codex')"
      >
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
              {{
                connectionState === 'error'
                  ? i18nHelper.eyesOnAgents.connection.retry
                  : i18nHelper.eyesOnAgents.connection.connect
              }}
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

        <section
          name="eyesOnAgents__connections__bridge"
          class="eyes-connection-card eyes-connection-card--codex-observation"
        >
          <div class="eyes-connection-card__header">
            <h2>{{ i18nHelper.eyesOnAgents.bridge.title }}</h2>
            <div class="eyes-connection-card__header-actions">
              <span class="eyes-connection-card__status" :class="bridgeStatusClass">
                {{ bridgeLabel }}
              </span>
              <a-button
                size="mini"
                :loading="eyesOnAgentsStore.busyAction === 'bridge-refresh'"
                :disabled="Boolean(eyesOnAgentsStore.busyAction)"
                @click="handleRefreshBridge"
              >
                {{ i18nHelper.eyesOnAgents.bridge.checkStatus }}
              </a-button>
            </div>
          </div>
          <p class="eyes-connection-card__status-copy" role="status">
            {{ bridgeStatusDescription }}
          </p>

          <div class="eyes-connection-card__settings-list">
            <div
              v-if="canEnableBridge || canRepairBridge"
              name="eyesOnAgents__connections__installHooks"
              class="eyes-connection-card__setting-row"
            >
              <div class="eyes-connection-card__setting-copy">
                <strong>{{ i18nHelper.eyesOnAgents.bridge.installHooks }}</strong>
              </div>
              <div class="eyes-connection-card__setting-action">
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
              </div>
            </div>

            <div
              v-if="showHookSettingsAttention"
              name="eyesOnAgents__connections__codexHookSettings"
              class="eyes-connection-card__setting-row eyes-connection-card__setting-row--external eyes-connection-card__setting-row--attention"
            >
              <div class="eyes-connection-card__setting-copy">
                <strong>{{ i18nHelper.eyesOnAgents.bridge.codexHookSettings }}</strong>
                <span>{{ i18nHelper.eyesOnAgents.bridge.codexHookSettingsDescription }}</span>
              </div>
            </div>

            <div
              name="eyesOnAgents__connections__promptRetention"
              class="eyes-connection-card__setting-row"
            >
              <div class="eyes-connection-card__setting-copy">
                <strong id="eyes-on-agents-prompt-retention-label">
                  {{ i18nHelper.eyesOnAgents.bridge.promptRetentionLabel }}
                </strong>
                <span id="eyes-on-agents-prompt-retention-description">
                  {{ i18nHelper.eyesOnAgents.bridge.promptRetentionDescription }}
                </span>
              </div>
              <div class="eyes-connection-card__setting-action">
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
            </div>

            <div
              v-if="canDisableBridge"
              name="eyesOnAgents__connections__removeHooks"
              class="eyes-connection-card__setting-row"
            >
              <div class="eyes-connection-card__setting-copy">
                <strong>{{ i18nHelper.eyesOnAgents.bridge.removeObservation }}</strong>
              </div>
              <div class="eyes-connection-card__setting-action">
                <a-button
                  size="mini"
                  status="danger"
                  :loading="eyesOnAgentsStore.busyAction === 'bridge-remove'"
                  :disabled="Boolean(eyesOnAgentsStore.busyAction)"
                  @click="handleRemoveBridge"
                >
                  {{ i18nHelper.eyesOnAgents.bridge.remove }}
                </a-button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div
        :id="getProviderPanelId('claude')"
        v-show="activeProvider === 'claude'"
        name="eyesOnAgents__connections__claudePanel"
        class="eyes-connection-panel__detail"
        role="tabpanel"
        :aria-labelledby="getProviderTabId('claude')"
      >
        <ClaudeObservationCard />
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { IconInfoCircle, IconPlugConnected, IconRefresh } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import claudeLogo from '@renderer/common/assets/icons/providers/claude.png';
import codexLogo from '@renderer/common/assets/icons/providers/codex.png';
import ClaudeObservationCard from './ClaudeObservationCard.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

type ConnectionProvider = 'codex' | 'claude';

const connectionProviders = ['codex', 'claude'] as const satisfies readonly ConnectionProvider[];
const activeProvider = ref<ConnectionProvider>('codex');
const providerTablistRef = ref<HTMLElement | null>(null);

const getProviderLabel = (provider: ConnectionProvider): string =>
  provider === 'codex'
    ? i18nHelper.eyesOnAgents.provider.codex
    : i18nHelper.eyesOnAgents.provider.claude;
const getProviderTabId = (provider: ConnectionProvider): string =>
  `eyes-connection-provider-tab-${provider}`;
const getProviderPanelId = (provider: ConnectionProvider): string =>
  `eyes-connection-provider-panel-${provider}`;
const selectProvider = (provider: ConnectionProvider): void => {
  activeProvider.value = provider;
};
const focusProvider = (provider: ConnectionProvider): void => {
  activeProvider.value = provider;
  void nextTick(() => {
    providerTablistRef.value
      ?.querySelector<HTMLButtonElement>(`#${getProviderTabId(provider)}`)
      ?.focus();
  });
};
const handleProviderKeydown = (event: KeyboardEvent, provider: ConnectionProvider): void => {
  const providerIndex = connectionProviders.indexOf(provider);
  let targetProvider: ConnectionProvider | null = null;

  switch (event.key) {
    case 'ArrowUp':
      targetProvider =
        connectionProviders[
          (providerIndex - 1 + connectionProviders.length) % connectionProviders.length
        ];
      break;
    case 'ArrowDown':
      targetProvider = connectionProviders[(providerIndex + 1) % connectionProviders.length];
      break;
    case 'Home':
      [targetProvider] = connectionProviders;
      break;
    case 'End':
      targetProvider = connectionProviders[connectionProviders.length - 1];
      break;
    default:
      return;
  }

  event.preventDefault();
  focusProvider(targetProvider);
};

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
const canDisableBridge = computed(() => bridgeState.value !== 'not_installed');
const showHookSettingsAttention = computed(() => bridgeState.value === 'needs_trust');
const connectionStatusClass = computed(
  () => `eyes-connection-card__status--${connectionState.value}`,
);
const bridgeStatusClass = computed(() => {
  if (bridgeState.value !== 'installed') {
    return `eyes-connection-card__status--${bridgeState.value}`;
  }
  return bridge.value?.listening
    ? 'eyes-connection-card__status--observing'
    : 'eyes-connection-card__status--paused';
});
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
const bridgeStatusDescription = computed(() => {
  switch (bridgeState.value) {
    case 'installed':
      return bridge.value?.listening
        ? i18nHelper.eyesOnAgents.bridge.statusObserving
        : i18nHelper.eyesOnAgents.bridge.statusPaused;
    case 'needs_trust':
      switch (bridgeReviewReason.value) {
        case 'disabled': return i18nHelper.eyesOnAgents.bridge.statusDisabled;
        case 'modified': return i18nHelper.eyesOnAgents.bridge.statusModified;
        default: return i18nHelper.eyesOnAgents.bridge.statusNeedsReview;
      }
    case 'drifted': return i18nHelper.eyesOnAgents.bridge.statusDrifted;
    case 'error':
      return bridge.value?.error ?? i18nHelper.eyesOnAgents.bridge.statusError;
    default: return i18nHelper.eyesOnAgents.bridge.statusNotInstalled;
  }
});
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
