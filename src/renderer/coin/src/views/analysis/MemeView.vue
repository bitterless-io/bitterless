<template>
  <section name="coin__meme" class="coin-workspace-view">
    <div name="coin__meme__toolbar" class="coin-workspace-toolbar">
      <a-radio-group
        v-model="workspace.data.drafts.meme.view"
        type="button"
        size="small"
        :disabled="requestBusy"
        @change="workspace.queuePersist()"
      >
        <a-radio value="discover">{{ i18nHelper.coin.workspace.discover }}</a-radio>
        <a-radio value="analyze">{{ i18nHelper.coin.workspace.analyze }}</a-radio>
      </a-radio-group>
      <div class="coin-control-group">
        <span>{{ i18nHelper.coin.analysis.labels.sourceMode }}</span>
        <a-select
          v-model="workspace.data.drafts.meme.mode"
          size="small"
          :aria-label="i18nHelper.coin.analysis.labels.sourceMode"
          :disabled="requestBusy || Boolean(workspace.discoverSnapshot?.running)"
          @change="onModeChange"
        >
          <a-option value="service">{{ i18nHelper.coin.analysis.modes.deployedService }}</a-option>
          <a-option value="local_cli_rpc">{{ i18nHelper.coin.analysis.modes.localReadOnly }}</a-option>
        </a-select>
      </div>
      <div class="coin-control-group">
        <span>{{ i18nHelper.coin.workspace.chain }}</span>
        <a-select
          v-model="workspace.data.drafts.meme.chain"
          size="small"
          :aria-label="i18nHelper.coin.workspace.chain"
          :disabled="requestBusy || Boolean(workspace.discoverSnapshot?.running)"
          @change="workspace.queuePersist()"
        >
          <a-option value="bsc">BSC</a-option>
          <a-option value="solana">Solana</a-option>
          <a-option value="robinhood">Robinhood</a-option>
        </a-select>
      </div>
      <span class="coin-source-mode" :class="selectedModeConfigured ? 'coin-source-mode--ready' : 'coin-source-mode--unavailable'">
        <IconServerBolt v-if="workspace.data.drafts.meme.mode === 'service'" :size="15" />
        <IconTerminal2 v-else :size="15" />
        {{ modeLabel }}
      </span>
    </div>

    <div class="coin-mode-notice" :class="{ 'coin-mode-notice--warning': !selectedModeConfigured }" role="status">
      <IconInfoCircle v-if="selectedModeConfigured" :size="15" />
      <IconAlertTriangle v-else :size="15" />
      <span>{{ selectedModeConfigured ? modeDescription : modeUnavailableReason }}</span>
      <a-button v-if="!selectedModeConfigured" size="mini" @click="shell.openSources()">
        {{ i18nHelper.coin.workspace.openSources }}
      </a-button>
    </div>

    <MemeDiscoverPanel v-if="workspace.data.drafts.meme.view === 'discover'" :source-configured="selectedModeConfigured" />
    <MemeAnalysisPanel v-else :source-configured="selectedModeConfigured" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconAlertTriangle, IconInfoCircle, IconServerBolt, IconTerminal2 } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as shell } from '../../coinShell.store';
import MemeAnalysisPanel from './MemeAnalysisPanel.vue';
import MemeDiscoverPanel from './MemeDiscoverPanel.vue';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

const requestBusy = computed(() => workspace.memeLoading || workspace.discoverStarting || workspace.discoverStopping);
const selectedModeConfigured = computed(() => {
  const mode = workspace.data.drafts.meme.mode;
  if (mode === 'service') {
    return Boolean(workspace.sourceStatuses.find((source) => source.source === 'meme-service')?.configured);
  }
  const gmgn = workspace.sourceStatuses.find((source) => source.source === 'gmgn-cli');
  return Boolean(gmgn?.configured);
});
const modeLabel = computed(() => workspace.data.drafts.meme.mode === 'service'
  ? i18nHelper.coin.analysis.modes.deployedService
  : i18nHelper.coin.analysis.modes.localReadOnly);
const modeDescription = computed(() => workspace.data.drafts.meme.mode === 'service'
  ? i18nHelper.coin.analysis.modes.serviceDescription
  : i18nHelper.coin.analysis.modes.localDescription);
const modeUnavailableReason = computed(() => workspace.data.drafts.meme.mode === 'service'
  ? i18nHelper.coin.analysis.states.memeServiceUnavailable
  : i18nHelper.coin.analysis.states.localSourcesUnavailable);

const onModeChange = (): void => {
  if (workspace.data.drafts.meme.mode === 'local_cli_rpc' && workspace.data.drafts.meme.intervalSeconds < 60) {
    workspace.data.drafts.meme.intervalSeconds = 60;
  }
  workspace.queuePersist();
};
</script>
