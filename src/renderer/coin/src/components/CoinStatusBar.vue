<template>
  <footer name="coin__statusBar" class="coin-status-bar" aria-live="polite">
    <span class="coin-status-bar__item" :class="{ 'coin-status-bar__item--ready': configuredCount > 0 && readyCount === configuredCount }">
      <IconDatabase v-if="readyCount" :size="14" stroke-width="1.8" aria-hidden="true" />
      <IconDatabaseOff v-else :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ sourceStatusLabel }}
    </span>
    <span class="coin-status-bar__separator" aria-hidden="true"></span>
    <span class="coin-status-bar__item" :class="{ 'coin-status-bar__item--active': workspace.activeJobCount > 0 }">
      <IconActivity :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ jobLabel }}
    </span>
    <span class="coin-status-bar__separator" aria-hidden="true"></span>
    <button name="coin__statusBar__ai" class="coin-status-bar__action" :class="aiStatusClass" type="button" @click="shell.openResources()">
      <IconBrandOpenai :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ aiStatusLabel }}
    </button>
    <span class="coin-status-bar__spacer"></span>
    <span v-if="statusError" class="coin-status-bar__error">{{ statusError }}</span>
    <span v-else-if="statusLoading" class="coin-status-bar__item"><a-spin :size="11" />{{ i18nHelper.coin.loading }}</span>
    <span v-else class="coin-status-bar__item coin-status-bar__item--ready"><IconCircleCheck :size="14" stroke-width="1.8" aria-hidden="true" />{{ i18nHelper.coin.shellReady }}</span>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconActivity, IconBrandOpenai, IconCircleCheck, IconDatabase, IconDatabaseOff } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as shell } from '../coinShell.store';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';
import { coinResourcesStore as resources } from '../views/resources/coinResources.store';

const configuredCount = computed(() => workspace.sourceStatuses.filter((source) => source.configured).length);
const readyCount = computed(() => workspace.sourceStatuses.filter((source) => source.configured && ['ready', 'partial', 'stale'].includes(source.state)).length);
const sourceStatusLabel = computed(() => i18nHelper.coin.sourceStatusSummary.replace('{ready}', String(readyCount.value)).replace('{total}', String(configuredCount.value)));
const jobLabel = computed(() => workspace.activeJobCount
  ? i18nHelper.coin.analysis.labels.activeJobs.replace('{count}', String(workspace.activeJobCount))
  : i18nHelper.coin.noActiveJobs);
const aiStatusLabel = computed(() => workspace.aiLoading
  ? i18nHelper.coin.aiStatusRunning
  : resources.status?.codex.errorCode
    ? i18nHelper.coin.aiStatusError
    : resources.status?.codex.connected
      ? i18nHelper.coin.aiStatusConnected
      : i18nHelper.coin.aiStatusSignIn);
const aiStatusClass = computed(() => ({
  'coin-status-bar__action--ready': Boolean(resources.status?.codex.connected || workspace.aiLoading),
  'coin-status-bar__action--danger': Boolean(resources.status?.codex.errorCode),
}));
const statusError = computed(() => workspace.sourceError || shell.statusError || resources.statusError);
const statusLoading = computed(() => workspace.sourceLoading || shell.statusLoading || resources.statusLoading);
</script>
