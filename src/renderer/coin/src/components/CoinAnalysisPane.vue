<template>
  <main id="coin-analysis-pane" name="coin__analysisPane" class="coin-analysis-pane">
    <div v-if="workspace.stateError" name="coin__stateBanner" class="coin-state-banner" :class="{ 'coin-state-banner--danger': workspace.stateMalformed }" role="alert">
      <IconAlertTriangle :size="16" />
      <span>{{ workspace.stateError }}</span>
      <a-button
        v-if="workspace.stateMalformed"
        size="mini"
        :loading="workspace.stateRecovering"
        :disabled="workspace.stateRecovering"
        @click="workspace.recoverState()"
      >
        {{ i18nHelper.coin.analysis.actions.recover }}
      </a-button>
      <a-button
        v-else-if="workspace.stateConflict"
        size="mini"
        :loading="workspace.stateLoading"
        :disabled="workspace.stateLoading"
        @click="workspace.reloadState()"
      >
        {{ i18nHelper.coin.analysis.actions.reload }}
      </a-button>
    </div>

    <a-tabs
      :active-key="shell.resourcesActive ? '' : shell.activeTab"
      class="coin-analysis-tabs"
      :class="{ 'coin-analysis-tabs--resources': shell.resourcesActive }"
      type="line"
      :animation="false"
      @change="handleTabChange"
    >
      <template #extra>
        <button
          name="coin__resourcesNav"
          class="coin-resources-nav"
          :class="{ 'coin-resources-nav--active': shell.resourcesActive }"
          type="button"
          :aria-pressed="shell.resourcesActive"
          @click="workspace.setActivePage('resources')"
        >
          <IconSettings :size="15" stroke-width="1.8" aria-hidden="true" />
          <span>{{ i18nHelper.coin.resources }}</span>
        </button>
      </template>

      <a-tab-pane key="monitor" :title="i18nHelper.coin.tabs.monitor"><MonitorView /></a-tab-pane>
      <a-tab-pane key="screener" :title="i18nHelper.coin.tabs.screener"><ScreenerView /></a-tab-pane>
      <a-tab-pane key="meme" :title="i18nHelper.coin.tabs.meme"><MemeView /></a-tab-pane>
      <a-tab-pane key="strategy" :title="i18nHelper.coin.tabs.strategy"><StrategyView /></a-tab-pane>
      <a-tab-pane key="history" :title="i18nHelper.coin.tabs.history"><HistoryView /></a-tab-pane>
    </a-tabs>

    <CoinResourcesView v-if="shell.resourcesActive" />
    <CoinSourcesDrawer />
  </main>
</template>

<script setup lang="ts">
import { IconAlertTriangle, IconSettings } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as shell } from '../coinShell.store';
import type { CoinTab } from '../coinShell.type';
import HistoryView from '../views/analysis/HistoryView.vue';
import MemeView from '../views/analysis/MemeView.vue';
import MonitorView from '../views/analysis/MonitorView.vue';
import ScreenerView from '../views/analysis/ScreenerView.vue';
import StrategyView from '../views/analysis/StrategyView.vue';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';
import CoinResourcesView from '../views/resources/CoinResourcesView.vue';
import CoinSourcesDrawer from './CoinSourcesDrawer.vue';

const handleTabChange = (key: string | number): void => {
  workspace.setActivePage(key as CoinTab);
};
</script>
