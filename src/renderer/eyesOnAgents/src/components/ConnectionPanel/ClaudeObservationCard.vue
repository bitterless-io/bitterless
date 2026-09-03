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

      <section
        name="eyesOnAgents__connections__claudeDirectories"
        class="eyes-connection-card__directories"
        :aria-labelledby="directoryTitleId"
      >
        <div class="eyes-connection-card__directories-header">
          <h3 :id="directoryTitleId">{{ i18nHelper.eyesOnAgents.claudeEnvironment.title }}</h3>
          <a-button
            size="mini"
            :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(ADD_CLAUDE_ENVIRONMENT_KEY)"
            :disabled="addingEnvironment"
            @click="handleStartAddEnvironment"
          >
            {{ i18nHelper.eyesOnAgents.claudeEnvironment.addEnvironment }}
          </a-button>
        </div>

        <div v-if="addingEnvironment" class="eyes-connection-card__directories-add">
          <a-input
            v-model="addEnvironmentLabel"
            size="mini"
            :max-length="80"
            :placeholder="i18nHelper.eyesOnAgents.claudeEnvironment.addLabelPlaceholder"
            :aria-label="i18nHelper.eyesOnAgents.claudeEnvironment.addLabelPlaceholder"
            @keydown.enter="handleAddEnvironment"
          />
          <a-button
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(ADD_CLAUDE_ENVIRONMENT_KEY)"
            :disabled="!addEnvironmentLabel.trim()"
            @click="handleAddEnvironment"
          >
            {{ i18nHelper.eyesOnAgents.claudeEnvironment.add }}
          </a-button>
          <a-button size="mini" @click="handleCancelAddEnvironment">
            {{ i18nHelper.eyesOnAgents.claudeEnvironment.cancel }}
          </a-button>
        </div>

        <div class="eyes-connection-card__directories-list">
          <div
            v-for="environment in environmentRows"
            :key="environment.id"
            name="eyesOnAgents__connections__claudeEnvironmentRow"
            class="eyes-connection-card__directory-row"
          >
            <div class="eyes-connection-card__directories-header">
              <div>
                <a-input
                  v-if="renamingId === environment.id"
                  v-model="renameLabelDraft"
                  size="mini"
                  :max-length="80"
                  :aria-label="i18nHelper.eyesOnAgents.claudeEnvironment.renameLabelPlaceholder"
                  @keydown.enter="handleSaveRename(environment.id)"
                />
                <h4 v-else>{{ environment.label }}</h4>
                <span class="eyes-connection-card__directories-state">
                  {{ environmentModeLabel(environment) }} · {{ environmentStateLabel(environment) }}
                </span>
              </div>
              <a-switch
                v-if="environment.id"
                size="small"
                :model-value="environment.enabled"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :aria-label="environment.enabled
                  ? i18nHelper.eyesOnAgents.claudeEnvironment.disable
                  : i18nHelper.eyesOnAgents.claudeEnvironment.enable"
                @change="(enabled) => handleToggleEnabled(environment.id, Boolean(enabled))"
              />
            </div>
            <div class="eyes-connection-card__directories-path">
              <a-tooltip :content="environmentPath(environment)">
                <a-input
                  :model-value="environmentPath(environment)"
                  size="mini"
                  :aria-label="i18nHelper.eyesOnAgents.claudeDirectory.pathLabel"
                  readonly
                />
              </a-tooltip>
              <a-button
                size="mini"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                @click="handleChooseDirectory(environment.id)"
              >
                {{ i18nHelper.eyesOnAgents.claudeEnvironment.changeDirectory }}
              </a-button>
              <a-button
                v-if="canCopySetupCommand(environment)"
                name="eyesOnAgents__connections__claudeEnvironmentCopySetup"
                size="mini"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                @click="handleCopySetupCommand(environment.id)"
              >
                <span aria-live="polite">{{ setupCommandCopyLabel(environment) }}</span>
              </a-button>
              <a-button
                v-if="isEligibleForAutomatic(environment)"
                size="mini"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                @click="handleUseAutomatic(environment.id)"
              >
                {{ i18nHelper.eyesOnAgents.claudeEnvironment.useAutomatic }}
              </a-button>
              <a-button
                v-if="canRetryEnvironment(environment)"
                size="mini"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                @click="handleRetryEnvironment(environment.id)"
              >
                {{ i18nHelper.eyesOnAgents.claudeDirectory.retry }}
              </a-button>
            </div>
            <div class="eyes-connection-card__directories-meta">
              <span>{{ environmentDesktopLabel(environment) }}</span>
              <span>{{ environmentLastScanLabel(environment) }}</span>
              <span v-if="environment.nextRetryAt">{{ environmentNextRetryLabel(environment) }}</span>
            </div>
            <p v-if="environment.error" class="eyes-connection-card__directories-error" role="status">
              {{ environment.error }}
            </p>
            <div v-if="setupAction !== 'none'" class="eyes-connection-card__directories-meta">
              <span>{{ setupTitle }}</span>
              <a-button
                v-if="['enable', 'finish', 'repair'].includes(setupAction)"
                size="mini"
                type="primary"
                :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-install'"
                :disabled="Boolean(eyesOnAgentsStore.busyAction)"
                @click="handleInstallForEnvironment(environment.id)"
              >
                {{ setupActionLabel }}
              </a-button>
              <a-button
                v-else-if="setupAction === 'retry'"
                size="mini"
                type="primary"
                :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-refresh'"
                :disabled="Boolean(eyesOnAgentsStore.busyAction)"
                @click="handleRefreshForEnvironment(environment.id)"
              >
                {{ i18nHelper.eyesOnAgents.claudeBridge.retryListener }}
              </a-button>
            </div>
            <div v-if="environment.id" class="eyes-connection-card__directories-actions">
              <template v-if="renamingId === environment.id">
                <a-button size="mini" type="primary" @click="handleSaveRename(environment.id)">
                  {{ i18nHelper.eyesOnAgents.claudeEnvironment.save }}
                </a-button>
                <a-button size="mini" @click="handleCancelRename">
                  {{ i18nHelper.eyesOnAgents.claudeEnvironment.cancel }}
                </a-button>
              </template>
              <a-button v-else size="mini" @click="handleStartRename(environment)">
                {{ i18nHelper.eyesOnAgents.claudeEnvironment.rename }}
              </a-button>
              <a-button
                size="mini"
                status="danger"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="!environment.canRemove
                  || eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :title="environment.canRemove
                  ? undefined
                  : i18nHelper.eyesOnAgents.claudeEnvironment.removeLastHint"
                @click="handleRemoveEnvironment(environment.id)"
              >
                {{ i18nHelper.eyesOnAgents.claudeEnvironment.remove }}
              </a-button>
            </div>
          </div>
        </div>

        <aside
          name="eyesOnAgents__connections__claudeEnvironmentGuidance"
          class="eyes-connection-panel__boundary"
        >
          <IconInfoCircle :size="17" />
          <span>{{ i18nHelper.eyesOnAgents.claudeEnvironment.guidance }}</span>
        </aside>
      </section>

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
import { IconInfoCircle } from '@tabler/icons-vue';
import type { EyesOnAgentsClaudeEnvironmentStatus } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { ADD_CLAUDE_ENVIRONMENT_KEY, eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const bridge = computed(() => eyesOnAgentsStore.snapshot?.claudeBridge ?? null);
const provider = computed(() => eyesOnAgentsStore.snapshot?.claudeProvider ?? null);
const providerEnabled = computed(() => provider.value?.enabled === true);
const lastUserPromptCaptureEnabled = computed(
  () => eyesOnAgentsStore.snapshot?.claudeLastUserPromptCaptureEnabled ?? false,
);
const providerError = computed(() => provider.value?.error ?? null);
const state = computed(() => bridge.value?.state ?? 'not_installed');
const setupAction = computed(() => bridge.value?.setupAction ?? 'enable');
const directoryTitleId = 'eyes-connection-claude-directories-title';
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

// Task 088: the single directory computed above (`directory`) is superseded by the environment
// list below — environmentRows/environmentPath/environmentModeLabel/environmentStateLabel replace
// directoryPath/directoryModeLabel/directoryStateLabel/desktopDirectoryLabel/lastScanLabel/
// nextRetryLabel/canRetryDirectory/canUseAutomaticDirectory, which had no per-environment identity.
const environmentRows = computed(() => eyesOnAgentsStore.snapshot?.claudeDirectory ?? []);
const defaultEnvironmentId = computed(() => environmentRows.value[0]?.id ?? null);
const addingEnvironment = ref(false);
const addEnvironmentLabel = ref('');
const renamingId = ref<string | null>(null);
const renameLabelDraft = ref('');
// Task 089: the id of the row whose setup command was copied last, mirroring the card-level
// reloadCommandCopied confirmation pattern per row — copying another row moves the confirmation.
const setupCommandCopiedId = ref<string | null>(null);

const environmentPath = (environment: EyesOnAgentsClaudeEnvironmentStatus): string =>
  environment.effectiveDirectory
  ?? environment.configuredDirectory
  ?? i18nHelper.eyesOnAgents.claudeEnvironment.notConfigured;
const environmentModeLabel = (environment: EyesOnAgentsClaudeEnvironmentStatus): string =>
  environment.mode === 'custom'
    ? i18nHelper.eyesOnAgents.claudeDirectory.custom
    : i18nHelper.eyesOnAgents.claudeDirectory.automatic;
const environmentStateLabel = (environment: EyesOnAgentsClaudeEnvironmentStatus): string => {
  switch (environment.state) {
    case 'watching': return i18nHelper.eyesOnAgents.claudeDirectory.watching;
    case 'waiting': return i18nHelper.eyesOnAgents.claudeDirectory.waiting;
    case 'degraded': return i18nHelper.eyesOnAgents.claudeDirectory.degraded;
    case 'retrying': return i18nHelper.eyesOnAgents.claudeDirectory.retrying;
    case 'error': return i18nHelper.eyesOnAgents.claudeDirectory.error;
    case 'stopped': return i18nHelper.eyesOnAgents.claudeDirectory.stopped;
    default: return i18nHelper.eyesOnAgents.claudeDirectory.starting;
  }
};
// Only environments[0] is ever eligible for automatic mode (data-model rule); a custom default
// environment can switch to automatic, and one already in an error state can retry via the same
// action (a no-op when already automatic and healthy) — mirroring the pre-088 single-directory
// recovery contract's canUseAutomaticDirectory condition, generalized to the default row only.
const isEligibleForAutomatic = (environment: EyesOnAgentsClaudeEnvironmentStatus): boolean =>
  environment.id === defaultEnvironmentId.value
  && (environment.mode === 'custom' || environment.state === 'error');

// Gap 1 (post-088 review): restores the pre-088 single block's desktop-directory-count/
// last-successful-scan/next-retry metadata and manual Retry action, scoped per environment.
// canRetryEnvironment mirrors the pre-088 canRetryDirectory computed's condition exactly
// (a global provider error, or the row's own state being one that can plausibly recover).
const environmentDesktopLabel = (environment: EyesOnAgentsClaudeEnvironmentStatus): string => (
  i18nHelper.eyesOnAgents.claudeDirectory.desktopDirectories
    .replace('{count}', String(environment.desktopDirectoryCount))
);
const environmentLastScanLabel = (environment: EyesOnAgentsClaudeEnvironmentStatus): string => (
  i18nHelper.eyesOnAgents.claudeDirectory.lastSuccessfulScan
    .replace('{time}', formatTimestamp(environment.lastSuccessfulScanAt))
);
const environmentNextRetryLabel = (environment: EyesOnAgentsClaudeEnvironmentStatus): string => (
  i18nHelper.eyesOnAgents.claudeDirectory.nextRetry
    .replace('{time}', formatTimestamp(environment.nextRetryAt))
);
const canRetryEnvironment = (environment: EyesOnAgentsClaudeEnvironmentStatus): boolean => (
  providerError.value !== null
  || ['waiting', 'degraded', 'retrying', 'error'].includes(environment.state)
);

// Task 089: only a real custom environment with a configured directory can be wrapped — the
// automatic environment needs no wrapper and has a null configuredDirectory by definition, and the
// synthetic invalid-hydration row (empty id) has no environment identity to scope the copy to.
const canCopySetupCommand = (environment: EyesOnAgentsClaudeEnvironmentStatus): boolean => (
  environment.id !== ''
  && environment.mode === 'custom'
  && environment.configuredDirectory !== null
);
const setupCommandCopyLabel = (environment: EyesOnAgentsClaudeEnvironmentStatus): string => (
  setupCommandCopiedId.value === environment.id
    ? i18nHelper.eyesOnAgents.claudeBridge.copied
    : i18nHelper.eyesOnAgents.claudeEnvironment.copySetupCommand
);

const handleStartAddEnvironment = (): void => {
  addingEnvironment.value = true;
  addEnvironmentLabel.value = '';
};

const handleCancelAddEnvironment = (): void => {
  addingEnvironment.value = false;
  addEnvironmentLabel.value = '';
};

const handleAddEnvironment = async (): Promise<void> => {
  const label = addEnvironmentLabel.value.trim();
  if (!label) return;
  try {
    await eyesOnAgentsStore.addClaudeEnvironment(label);
    addingEnvironment.value = false;
    addEnvironmentLabel.value = '';
  } catch {
    // actionError already reflects the failure; keep the form open so the label is not lost.
  }
};

const handleStartRename = (environment: EyesOnAgentsClaudeEnvironmentStatus): void => {
  renamingId.value = environment.id;
  renameLabelDraft.value = environment.label;
};

const handleCancelRename = (): void => {
  renamingId.value = null;
  renameLabelDraft.value = '';
};

const handleSaveRename = async (id: string): Promise<void> => {
  const label = renameLabelDraft.value.trim();
  if (!label) return;
  try {
    await eyesOnAgentsStore.renameClaudeEnvironment(id, label);
    renamingId.value = null;
    renameLabelDraft.value = '';
  } catch {
    // actionError already reflects the failure; keep editing open so the draft is not lost.
  }
};

const handleToggleEnabled = async (id: string, enabled: boolean): Promise<void> => {
  await eyesOnAgentsStore.setClaudeEnvironmentEnabled(id, enabled).catch(() => undefined);
};

// An empty id identifies the single synthetic invalid-hydration row (task 085's
// invalidHydrationStatus — no environment identity is known yet, e.g. a malformed persisted value).
// The { id }-scoped XPC methods reject an empty id before it ever reaches the recovery-aware
// ClaudeDirectoryConfigService methods (it fails UUID validation at the shared contract parser), so
// this row's actions fall back to the legacy zero-arg store methods, which resolve entirely on the
// Main side and preserve the pre-088 "a new directory selection/Use automatic replaces a malformed
// saved value" recovery contract unchanged.
const handleChooseDirectory = async (id: string): Promise<void> => {
  if (id === '') {
    await eyesOnAgentsStore.changeClaudeDirectory().catch(() => undefined);
    return;
  }
  await eyesOnAgentsStore.chooseClaudeEnvironmentDirectory(id).catch(() => undefined);
};

const handleUseAutomatic = async (id: string): Promise<void> => {
  if (id === '') {
    await eyesOnAgentsStore.useAutomaticClaudeDirectory().catch(() => undefined);
    return;
  }
  await eyesOnAgentsStore.useAutomaticClaudeEnvironment(id).catch(() => undefined);
};

const handleRemoveEnvironment = async (id: string): Promise<void> => {
  await eyesOnAgentsStore.removeClaudeEnvironment(id).catch(() => undefined);
};

const handleRetryEnvironment = async (id: string): Promise<void> => {
  if (id === '') {
    await eyesOnAgentsStore.retryClaudeDirectory().catch(() => undefined);
    return;
  }
  await eyesOnAgentsStore.retryClaudeDirectoryForEnvironment(id).catch(() => undefined);
};

const handleCopySetupCommand = async (id: string): Promise<void> => {
  try {
    await eyesOnAgentsStore.copyClaudeEnvironmentSetupCommand(id);
    setupCommandCopiedId.value = id;
  } catch {
    setupCommandCopiedId.value = null;
  }
};

const handleInstallForEnvironment = async (environmentId: string): Promise<void> => {
  await eyesOnAgentsStore.installClaudeBridgeForEnvironment(environmentId).catch(() => undefined);
};

const handleRefreshForEnvironment = async (environmentId: string): Promise<void> => {
  await eyesOnAgentsStore.refreshClaudeBridgeStatusForEnvironment(environmentId)
    .catch(() => undefined);
};

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
