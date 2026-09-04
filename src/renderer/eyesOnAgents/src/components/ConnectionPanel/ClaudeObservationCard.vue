<template>
  <section
    name="eyesOnAgents__connections__claudeBridge"
    class="eyes-connection-card eyes-connection-card--claude"
  >
    <div class="eyes-connection-card__header">
      <div>
        <span class="eyes-connection-card__eyebrow">
          {{ i18nHelper.eyesOnAgents.claudeBridge.eyebrow }}
        </span>
        <h2>{{ i18nHelper.eyesOnAgents.claudeBridge.title }}</h2>
      </div>
      <div class="eyes-connection-card__header-actions">
        <span class="eyes-connection-card__status" :class="statusClass">
          {{ statusLabel }}
        </span>
        <label class="eyes-connection-card__provider-toggle">
          <span>{{ i18nHelper.eyesOnAgents.claudeBridge.provider }}</span>
          <a-switch
            size="small"
            :model-value="providerEnabled"
            :aria-label="i18nHelper.eyesOnAgents.claudeBridge.provider"
            :loading="eyesOnAgentsStore.busyAction === 'claude-provider-toggle'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @change="handleProviderChange"
          />
        </label>
      </div>
    </div>

    <template v-if="providerEnabled">
      <p>{{ i18nHelper.eyesOnAgents.claudeBridge.description }}</p>

      <p
        v-if="desktopDirectoryLabel"
        name="eyesOnAgents__connections__claudeDesktopDirectories"
        class="eyes-connection-card__desktop-meta"
      >
        {{ desktopDirectoryLabel }}
      </p>

      <dl class="eyes-connection-card__facts">
        <div>
          <dt>{{ i18nHelper.eyesOnAgents.claudeBridge.plugin }}</dt>
          <dd>{{ pluginLabel }}</dd>
        </div>
        <div>
          <dt>{{ i18nHelper.eyesOnAgents.claudeBridge.listener }}</dt>
          <dd>{{ listenerLabel }}</dd>
        </div>
        <div>
          <dt>{{ i18nHelper.eyesOnAgents.claudeBridge.observationProof }}</dt>
          <dd>{{ observationProofLabel }}</dd>
        </div>
        <div v-if="bridge?.listeningSince">
          <dt>{{ i18nHelper.eyesOnAgents.claudeBridge.listeningSince }}</dt>
          <dd>{{ formatTimestamp(bridge.listeningSince) }}</dd>
        </div>
        <div>
          <dt>{{ i18nHelper.eyesOnAgents.claudeBridge.firstReceipt }}</dt>
          <dd>{{ formatTimestamp(bridge?.firstReceiptAt) }}</dd>
        </div>
        <div>
          <dt>{{ i18nHelper.eyesOnAgents.claudeBridge.lastReceipt }}</dt>
          <dd>{{ formatTimestamp(bridge?.lastReceiptAt) }}</dd>
        </div>
        <div>
          <dt>{{ i18nHelper.eyesOnAgents.claudeBridge.lastInspected }}</dt>
          <dd>{{ formatTimestamp(bridge?.lastInspectedAt) }}</dd>
        </div>
      </dl>

      <div class="eyes-connection-card__settings-list">
        <div
          name="eyesOnAgents__connections__claudePromptRetention"
          class="eyes-connection-card__setting-row"
        >
          <div class="eyes-connection-card__setting-copy">
            <strong id="eyes-on-agents-claude-prompt-retention-label">
              {{ i18nHelper.eyesOnAgents.claudeBridge.promptRetentionLabel }}
            </strong>
            <span id="eyes-on-agents-claude-prompt-retention-description">
              {{ i18nHelper.eyesOnAgents.claudeBridge.promptRetentionDescription }}
            </span>
          </div>
          <div class="eyes-connection-card__setting-action">
            <a-switch
              size="small"
              :model-value="lastUserPromptCaptureEnabled"
              :loading="eyesOnAgentsStore.busyAction === 'claude-prompt-retention'"
              :disabled="Boolean(eyesOnAgentsStore.busyAction)"
              aria-labelledby="eyes-on-agents-claude-prompt-retention-label"
              aria-describedby="eyes-on-agents-claude-prompt-retention-description"
              @change="handleLastUserPromptCaptureChange"
            />
          </div>
        </div>
      </div>

      <section
        v-if="setupAction !== 'none'"
        name="eyesOnAgents__connections__claudeSetupAction"
        class="eyes-connection-card__setup"
        :aria-labelledby="setupTitleId"
      >
        <h3 :id="setupTitleId">{{ setupTitle }}</h3>
        <p>{{ setupDescription }}</p>
        <div class="eyes-connection-card__setup-actions">
          <template v-if="setupAction === 'reload'">
            <a-button
              size="mini"
              type="primary"
              :loading="eyesOnAgentsStore.busyAction === 'claude-session-open'"
              :disabled="Boolean(eyesOnAgentsStore.busyAction)"
              @click="handleOpenNewClaudeSession"
            >
              {{ i18nHelper.eyesOnAgents.claudeBridge.openNewSession }}
            </a-button>
            <a-button
              size="mini"
              :loading="eyesOnAgentsStore.busyAction === 'claude-reload-copy'"
              :disabled="Boolean(eyesOnAgentsStore.busyAction)"
              @click="handleCopyReloadCommand"
            >
              <span aria-live="polite">{{ reloadCommandCopyLabel }}</span>
            </a-button>
          </template>
          <a-button
            v-else-if="setupAction === 'retry'"
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-refresh'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleRefresh"
          >
            {{ i18nHelper.eyesOnAgents.claudeBridge.retryListener }}
          </a-button>
          <a-button
            v-else
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-install'"
            :disabled="Boolean(eyesOnAgentsStore.busyAction)"
            @click="handleInstall"
          >
            {{ setupActionLabel }}
          </a-button>
        </div>
        <template v-if="setupAction === 'reload'">
          <a-button
            class="eyes-connection-card__troubleshooting-toggle"
            size="mini"
            type="text"
            :aria-expanded="troubleshootingVisible"
            :aria-controls="troubleshootingId"
            @click="troubleshootingVisible = !troubleshootingVisible"
          >
            {{ i18nHelper.eyesOnAgents.claudeBridge.stillNotWorking }}
          </a-button>
          <div
            v-if="troubleshootingVisible"
            :id="troubleshootingId"
            class="eyes-connection-card__troubleshooting"
          >
            <span>{{ i18nHelper.eyesOnAgents.claudeBridge.hooksDiagnostic }}</span>
            <code>{{ i18nHelper.eyesOnAgents.claudeBridge.hooksCommand }}</code>
          </div>
          <p class="eyes-connection-card__setup-note">
            {{ i18nHelper.eyesOnAgents.claudeBridge.updatesAutomatically }}
          </p>
        </template>
      </section>

      <div v-if="providerError || bridge?.error" class="eyes-connection-card__error" role="alert">
        {{ providerError || bridge?.error }}
      </div>

      <div class="eyes-connection-card__actions eyes-connection-card__actions--diagnostic">
        <a-button
          v-if="setupAction !== 'retry'"
          size="mini"
          :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-refresh'"
          :disabled="Boolean(eyesOnAgentsStore.busyAction)"
          @click="handleRefresh"
        >
          {{ i18nHelper.eyesOnAgents.claudeBridge.checkStatus }}
        </a-button>
        <a-button
          v-if="canDisable"
          size="mini"
          status="danger"
          :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-remove'"
          :disabled="Boolean(eyesOnAgentsStore.busyAction)"
          @click="handleRemove"
        >
          {{ i18nHelper.eyesOnAgents.claudeBridge.removePlugin }}
        </a-button>
      </div>
    </template>

    <p v-else class="eyes-connection-card__provider-paused" role="status">
      {{ providerPausedCopy }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const bridge = computed(() => eyesOnAgentsStore.snapshot?.claudeBridge ?? null);
const provider = computed(() => eyesOnAgentsStore.snapshot?.claudeProvider ?? null);
const providerEnabled = computed(() => provider.value?.enabled === true);
const lastUserPromptCaptureEnabled = computed(
  () => eyesOnAgentsStore.snapshot?.claudeLastUserPromptCaptureEnabled ?? false,
);
const providerError = computed(() => provider.value?.error ?? null);
const state = computed(() => bridge.value?.state ?? 'not_installed');
const setupAction = computed(() => bridge.value?.setupAction ?? 'enable');
const setupTitleId = 'eyes-connection-claude-setup-title';
const troubleshootingId = 'eyes-connection-claude-troubleshooting';
const troubleshootingVisible = ref(false);
const reloadCommandCopied = ref(false);
const canDisable = computed(() => bridge.value?.configured === true);
const statusClass = computed(() => {
  if (!providerEnabled.value) return 'eyes-connection-card__status--stopped';
  if (['finish', 'reload', 'retry'].includes(setupAction.value)) {
    return 'eyes-connection-card__status--needs_review';
  }
  return `eyes-connection-card__status--${state.value}`;
});

const statusLabel = computed(() => {
  if (!providerEnabled.value) return i18nHelper.eyesOnAgents.claudeBridge.off;
  if (setupAction.value === 'finish') {
    return i18nHelper.eyesOnAgents.claudeBridge.finishSetup;
  }
  if (setupAction.value === 'reload') {
    return i18nHelper.eyesOnAgents.claudeBridge.reloadInClaude;
  }
  if (setupAction.value === 'retry') {
    return i18nHelper.eyesOnAgents.claudeBridge.listenerPaused;
  }
  switch (state.value) {
    case 'observing': return i18nHelper.eyesOnAgents.claudeBridge.observing;
    case 'installed': return i18nHelper.eyesOnAgents.claudeBridge.installed;
    case 'needs_review': return i18nHelper.eyesOnAgents.claudeBridge.needsReview;
    case 'drifted': return i18nHelper.eyesOnAgents.claudeBridge.drifted;
    case 'error': return i18nHelper.eyesOnAgents.claudeBridge.error;
    default: return i18nHelper.eyesOnAgents.claudeBridge.notInstalled;
  }
});

const setupTitle = computed(() => {
  switch (setupAction.value) {
    case 'finish': return i18nHelper.eyesOnAgents.claudeBridge.finishSetup;
    case 'reload': return i18nHelper.eyesOnAgents.claudeBridge.reloadInClaude;
    case 'retry': return i18nHelper.eyesOnAgents.claudeBridge.listenerPaused;
    case 'repair': return i18nHelper.eyesOnAgents.claudeBridge.repair;
    default: return i18nHelper.eyesOnAgents.claudeBridge.enable;
  }
});

const setupDescription = computed(() => {
  switch (setupAction.value) {
    case 'finish': return i18nHelper.eyesOnAgents.claudeBridge.finishDescription;
    case 'reload': return i18nHelper.eyesOnAgents.claudeBridge.reloadDescription;
    case 'retry': return i18nHelper.eyesOnAgents.claudeBridge.listenerPausedDescription;
    case 'repair': return i18nHelper.eyesOnAgents.claudeBridge.repairDescription;
    default: return i18nHelper.eyesOnAgents.claudeBridge.enableDescription;
  }
});

const setupActionLabel = computed(() => {
  if (setupAction.value === 'finish') return i18nHelper.eyesOnAgents.claudeBridge.finishSetup;
  if (setupAction.value === 'repair') return i18nHelper.eyesOnAgents.claudeBridge.repair;
  return i18nHelper.eyesOnAgents.claudeBridge.enable;
});

const reloadCommandCopyLabel = computed(() => reloadCommandCopied.value
  ? i18nHelper.eyesOnAgents.claudeBridge.copied
  : i18nHelper.eyesOnAgents.claudeBridge.copyReloadCommand);

watch(setupAction, (action) => {
  if (action !== 'reload') {
    troubleshootingVisible.value = false;
    reloadCommandCopied.value = false;
  }
});

const providerPausedCopy = computed(() => providerError.value
  ? i18nHelper.eyesOnAgents.claudeBridge.pausedError.replace('{error}', providerError.value)
  : i18nHelper.eyesOnAgents.claudeBridge.paused);

const pluginLabel = computed(() => {
  if (!bridge.value?.configured) return i18nHelper.eyesOnAgents.claudeBridge.notConfigured;
  return bridge.value.enabled
    ? i18nHelper.eyesOnAgents.claudeBridge.enabled
    : i18nHelper.eyesOnAgents.claudeBridge.disabled;
});

const listenerLabel = computed(() => bridge.value?.listening
  ? i18nHelper.eyesOnAgents.claudeBridge.listenerActive
  : i18nHelper.eyesOnAgents.claudeBridge.listenerPaused);

const observationProofLabel = computed(() => {
  if (state.value === 'observing' && bridge.value?.observationProof === 'receipt') {
    return i18nHelper.eyesOnAgents.claudeBridge.proofConfirmed;
  }
  if (bridge.value?.observationProof === 'receipt') {
    return i18nHelper.eyesOnAgents.claudeBridge.proofPrevious;
  }
  if (state.value === 'needs_review') {
    return i18nHelper.eyesOnAgents.claudeBridge.proofNeedsReview;
  }
  return i18nHelper.eyesOnAgents.claudeBridge.proofAwaiting;
});

// Task 093: the environment list moved to ClaudeIterm2Card.vue — a CLI Claude environment is an
// iTerm2 concern, and Claude Desktop discovery never consults an environment's CLAUDE_CONFIG_DIR
// (resolveClaudeDesktopRoots is platform-fixed). What stays here is the one global fact those rows
// used to repeat: every environment watcher watches the SAME Desktop metadata root, so the count is
// identical on every row. It is read from the environments array rather than from a new Main-side
// field, and renders nothing at all when no environment reports a usable number.
const desktopDirectoryCount = computed<number | null>(() => {
  const [environment] = eyesOnAgentsStore.snapshot?.claudeDirectory ?? [];
  const count = environment?.desktopDirectoryCount;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
});

const desktopDirectoryLabel = computed(() => desktopDirectoryCount.value === null
  ? null
  : i18nHelper.eyesOnAgents.claudeDirectory.desktopDirectories
    .replace('{count}', String(desktopDirectoryCount.value)));

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) return i18nHelper.eyesOnAgents.claudeBridge.never;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? i18nHelper.eyesOnAgents.claudeBridge.never
    : parsed.toLocaleString();
};

const handleInstall = async (): Promise<void> => {
  await eyesOnAgentsStore.installClaudeBridge().catch(() => undefined);
};

const handleRefresh = async (): Promise<void> => {
  await eyesOnAgentsStore.refreshClaudeBridgeStatus().catch(() => undefined);
};

const handleRemove = async (): Promise<void> => {
  await eyesOnAgentsStore.removeClaudeBridge().catch(() => undefined);
};

const handleOpenNewClaudeSession = async (): Promise<void> => {
  await eyesOnAgentsStore.openNewClaudeSession().catch(() => undefined);
};

const handleCopyReloadCommand = async (): Promise<void> => {
  try {
    await eyesOnAgentsStore.copyClaudeReloadCommand();
    reloadCommandCopied.value = true;
  } catch {
    reloadCommandCopied.value = false;
  }
};

const handleProviderChange = async (enabled: boolean | string | number): Promise<void> => {
  if (typeof enabled !== 'boolean') return;
  await eyesOnAgentsStore.setClaudeProviderEnabled(enabled).catch(() => undefined);
};

const handleLastUserPromptCaptureChange = async (
  enabled: boolean | string | number,
): Promise<void> => {
  if (typeof enabled !== 'boolean') return;
  await eyesOnAgentsStore.setClaudeLastUserPromptCaptureEnabled(enabled).catch(() => undefined);
};
</script>
