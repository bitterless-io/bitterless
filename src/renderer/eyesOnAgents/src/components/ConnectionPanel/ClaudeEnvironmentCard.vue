<template>
  <section
    name="eyesOnAgents__connections__claudeEnvironment"
    class="eyes-connection-card eyes-connection-card--claude"
    :aria-labelledby="directoryTitleId"
  >
    <div class="eyes-connection-card__header">
      <div>
        <span class="eyes-connection-card__eyebrow">
          {{ i18nHelper.eyesOnAgents.claudeBridge.eyebrow }}
        </span>
        <h2 :id="directoryTitleId">{{ i18nHelper.eyesOnAgents.claudeEnvironment.title }}</h2>
      </div>
      <a-button
        v-if="providerEnabled"
        size="mini"
        :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(ADD_CLAUDE_ENVIRONMENT_KEY)"
        :disabled="addingEnvironment"
        @click="handleStartAddEnvironment"
      >
        {{ i18nHelper.eyesOnAgents.claudeEnvironment.addEnvironment }}
      </a-button>
    </div>

    <template v-if="providerEnabled">
      <div
        name="eyesOnAgents__connections__claudeDirectories"
        class="eyes-connection-card__directories"
      >
        <div v-if="addingEnvironment" class="eyes-connection-card__directories-add">
          <a-input
            v-model="addEnvironmentDirectory"
            size="mini"
            :max-length="4096"
            :placeholder="i18nHelper.eyesOnAgents.claudeEnvironment.addDirectoryPlaceholder"
            :aria-label="i18nHelper.eyesOnAgents.claudeEnvironment.addDirectoryPlaceholder"
            @keydown.enter="handleAddEnvironment"
          />
          <a-button
            size="mini"
            type="primary"
            :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(ADD_CLAUDE_ENVIRONMENT_KEY)"
            :disabled="!addEnvironmentDirectory.trim()"
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
              <a-input
                v-if="editingDirectoryId === environment.id"
                v-model="directoryDraft"
                size="mini"
                :max-length="4096"
                :placeholder="i18nHelper.eyesOnAgents.claudeEnvironment.addDirectoryPlaceholder"
                :aria-label="i18nHelper.eyesOnAgents.claudeDirectory.pathLabel"
                @keydown.enter="handleSaveDirectory(environment.id)"
              />
              <a-tooltip v-else :content="environmentPath(environment)">
                <a-input
                  :model-value="environmentPath(environment)"
                  size="mini"
                  :aria-label="i18nHelper.eyesOnAgents.claudeDirectory.pathLabel"
                  readonly
                />
              </a-tooltip>
              <template v-if="editingDirectoryId === environment.id">
                <a-button
                  size="mini"
                  type="primary"
                  :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                  :disabled="!directoryDraft.trim()
                    || eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                  @click="handleSaveDirectory(environment.id)"
                >
                  {{ i18nHelper.eyesOnAgents.claudeEnvironment.save }}
                </a-button>
                <a-button size="mini" @click="handleCancelEditDirectory">
                  {{ i18nHelper.eyesOnAgents.claudeEnvironment.cancel }}
                </a-button>
              </template>
              <a-button
                v-else
                size="mini"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                @click="handleChooseDirectory(environment)"
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
              <span>{{ environmentLastScanLabel(environment) }}</span>
              <span v-if="environment.nextRetryAt">{{ environmentNextRetryLabel(environment) }}</span>
            </div>
            <p v-if="environment.error" class="eyes-connection-card__directories-error" role="status">
              {{ environment.error }}
            </p>
            <div
              v-if="environment.id"
              name="eyesOnAgents__connections__claudeEnvironmentPlugin"
              class="eyes-connection-card__directories-meta"
            >
              <span class="eyes-connection-card__status" :class="presenceClass(environment)">
                {{ presenceLabel(environment) }}
              </span>
              <a-button
                v-if="environmentInstallable(environment)"
                size="mini"
                type="primary"
                :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-install'"
                :disabled="Boolean(eyesOnAgentsStore.busyAction)"
                @click="handleInstallForEnvironment(environment.id)"
              >
                {{ i18nHelper.eyesOnAgents.claudeEnvironment.installPlugin }}
              </a-button>
              <a-button
                v-else-if="environmentSetupActionable"
                size="mini"
                type="primary"
                :loading="eyesOnAgentsStore.busyAction === 'claude-bridge-install'"
                :disabled="Boolean(eyesOnAgentsStore.busyAction)"
                @click="handleInstallForEnvironment(environment.id)"
              >
                {{ setupActionLabel }}
              </a-button>
              <a-button
                v-else-if="environment.pluginPresence === 'unknown'"
                size="mini"
                :loading="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                :disabled="eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)"
                @click="handleCheckPlugin(environment.id)"
              >
                {{ i18nHelper.eyesOnAgents.claudeEnvironment.checkPlugin }}
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
      </div>
    </template>

    <p v-else class="eyes-connection-card__provider-paused" role="status">
      {{ providerPausedCopy }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IconInfoCircle } from '@tabler/icons-vue';
import type { EyesOnAgentsClaudeEnvironmentStatus } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { ADD_CLAUDE_ENVIRONMENT_KEY, eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

// Claude environments are configuration profiles for observation and plugin setup. They belong to
// the Claude connection page regardless of which terminal or app launches Claude Code.
const bridge = computed(() => eyesOnAgentsStore.snapshot?.claudeBridge ?? null);
const provider = computed(() => eyesOnAgentsStore.snapshot?.claudeProvider ?? null);
// Gating is unchanged: the one `Claude support` switch in the Claude section governs this section
// too, so turning Claude off folds this card to the same paused line rather than leaving an
// interactive but dead list.
const providerEnabled = computed(() => provider.value?.enabled === true);
const providerError = computed(() => provider.value?.error ?? null);
const setupAction = computed(() => bridge.value?.setupAction ?? 'enable');
const directoryTitleId = 'eyes-connection-claude-directories-title';

const providerPausedCopy = computed(() => providerError.value
  ? i18nHelper.eyesOnAgents.claudeBridge.pausedError.replace('{error}', providerError.value)
  : i18nHelper.eyesOnAgents.claudeBridge.paused);

const setupActionLabel = computed(() => {
  if (setupAction.value === 'finish') return i18nHelper.eyesOnAgents.claudeBridge.finishSetup;
  if (setupAction.value === 'repair') return i18nHelper.eyesOnAgents.claudeBridge.repair;
  return i18nHelper.eyesOnAgents.claudeBridge.enable;
});

const environmentRows = computed(() => eyesOnAgentsStore.snapshot?.claudeDirectory ?? []);
const defaultEnvironmentId = computed(() => environmentRows.value[0]?.id ?? null);
const addingEnvironment = ref(false);
const addEnvironmentDirectory = ref('');
const renamingId = ref<string | null>(null);
const renameLabelDraft = ref('');
// Task 092: at most one row edits its directory at a time, mirroring renamingId.
const editingDirectoryId = ref<string | null>(null);
const directoryDraft = ref('');
// Task 089: the id of the row whose setup command was copied last, mirroring the card-level
// reloadCommandCopied confirmation pattern per row — copying another row moves the confirmation.
const setupCommandCopiedId = ref<string | null>(null);

const environmentPath = (environment: EyesOnAgentsClaudeEnvironmentStatus): string =>
  environment.effectiveDirectory
  ?? environment.configuredDirectory
  ?? i18nHelper.eyesOnAgents.claudeEnvironment.notConfigured;
// Task 090: a row offers Install when its own directory is known to lack an enabled plugin.
const environmentInstallable = (environment: EyesOnAgentsClaudeEnvironmentStatus): boolean =>
  environment.pluginPresence === 'not_installed' || environment.pluginPresence === 'disabled';
// A profile-wide setup action still has to be applied per CLAUDE_CONFIG_DIR, because installation
// is per-directory. Without a row-scoped button, a drifted second environment would be
// unreachable: presence stays 'installed' (the plugin IS present and enabled, it is the profile's
// artifacts that drifted) while the card-level action resolves to environments[0]. The card-level
// action stays too — it is the familiar entry point and the only one for listener/reload concerns —
// so in this one state the action does appear card-level and per row. That is the cost of keeping
// every directory repairable; the common from-scratch case is driven by per-row presence instead.
const environmentSetupActionable = computed(() =>
  ['enable', 'finish', 'repair'].includes(setupAction.value));
// This environment's OWN plugin presence, from the cached read-only probe. Distinct from the
// Claude section's status pill, which reports the one profile-wide installation and listener.
const presenceLabel = (environment: EyesOnAgentsClaudeEnvironmentStatus): string => {
  switch (environment.pluginPresence) {
    case 'installed': return i18nHelper.eyesOnAgents.claudeEnvironment.pluginInstalled;
    case 'disabled': return i18nHelper.eyesOnAgents.claudeEnvironment.pluginDisabled;
    case 'not_installed': return i18nHelper.eyesOnAgents.claudeEnvironment.pluginNotInstalled;
    default: return i18nHelper.eyesOnAgents.claudeEnvironment.pluginUnknown;
  }
};
const presenceClass = (environment: EyesOnAgentsClaudeEnvironmentStatus): string => {
  switch (environment.pluginPresence) {
    case 'installed': return 'eyes-connection-card__status--installed';
    case 'not_installed': return 'eyes-connection-card__status--stopped';
    // 'disabled' and 'unknown' both mean "needs your attention, but nothing is broken yet".
    default: return 'eyes-connection-card__status--needs_review';
  }
};
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

// Gap 1 (post-088 review): restores the pre-088 single block's last-successful-scan/next-retry
// metadata and manual Retry action, scoped per environment. canRetryEnvironment mirrors the pre-088
// canRetryDirectory computed's condition exactly (a global provider error, or the row's own state
// being one that can plausibly recover).
// Task 093: the desktop-directory count is deliberately NOT here — it is the same platform-fixed
// number on every row, so the Claude section shows it once instead.
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
  addEnvironmentDirectory.value = '';
};

const handleCancelAddEnvironment = (): void => {
  addingEnvironment.value = false;
  addEnvironmentDirectory.value = '';
};

const handleAddEnvironment = async (): Promise<void> => {
  const configDirectory = addEnvironmentDirectory.value.trim();
  if (!configDirectory) return;
  try {
    await eyesOnAgentsStore.addClaudeEnvironment(configDirectory);
    addingEnvironment.value = false;
    addEnvironmentDirectory.value = '';
  } catch {
    // actionError already reflects the failure (a non-absolute path, or one that is not an existing
    // directory); keep the form open with the typed path so a typo can be corrected rather than
    // retyped.
  }
};

const handleStartRename = (environment: EyesOnAgentsClaudeEnvironmentStatus): void => {
  // Only one inline editor at a time: starting a rename closes an open directory edit rather than
  // stacking two inputs on the same row.
  editingDirectoryId.value = null;
  directoryDraft.value = '';
  renamingId.value = environment.id;
  renameLabelDraft.value = environment.label;
};

const handleStartEditDirectory = (environment: EyesOnAgentsClaudeEnvironmentStatus): void => {
  renamingId.value = null;
  renameLabelDraft.value = '';
  editingDirectoryId.value = environment.id;
  // Prefill with the configured directory so a small correction is a small edit. An unconfigured
  // row has nothing to prefill, so it starts empty rather than with the "Not configured" placeholder.
  directoryDraft.value = environment.configuredDirectory ?? '';
};

const handleCancelEditDirectory = (): void => {
  editingDirectoryId.value = null;
  directoryDraft.value = '';
};

const handleSaveDirectory = async (id: string): Promise<void> => {
  const configDirectory = directoryDraft.value.trim();
  if (!configDirectory) return;
  try {
    await eyesOnAgentsStore.chooseClaudeEnvironmentDirectory(id, configDirectory);
    editingDirectoryId.value = null;
    directoryDraft.value = '';
  } catch {
    // actionError already reflects the failure (not absolute, or not an existing directory); keep
    // the editor open with the typed path so a typo is corrected rather than retyped.
  }
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
// Task 092: a real row now edits its path inline. The synthetic invalid-hydration row has no
// environment id to address, so it keeps the legacy zero-arg picker as its recovery affordance.
const handleChooseDirectory = async (
  environment: EyesOnAgentsClaudeEnvironmentStatus
): Promise<void> => {
  if (environment.id === '') {
    await eyesOnAgentsStore.changeClaudeDirectory().catch(() => undefined);
    return;
  }
  handleStartEditDirectory(environment);
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

// Task 090: re-probes only this row's plugin presence. Deliberately NOT a full bridge refresh,
// which can run a trusted automatic upgrade and rewrite the profile-wide inspection state — the
// opposite of what a per-row "check this directory" action should do. This replaced the row's
// former refreshClaudeBridgeStatusForEnvironment call, which is now unused from this card.
const handleCheckPlugin = async (environmentId: string): Promise<void> => {
  await eyesOnAgentsStore.refreshClaudeEnvironmentPluginPresence(environmentId)
    .catch(() => undefined);
};

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) return i18nHelper.eyesOnAgents.claudeBridge.never;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? i18nHelper.eyesOnAgents.claudeBridge.never
    : parsed.toLocaleString();
};
</script>
