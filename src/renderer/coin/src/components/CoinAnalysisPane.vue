<template>
  <main id="coin-analysis-pane" name="coin__analysisPane" class="coin-analysis-pane">
    <div
      v-if="workspace.stateError"
      name="coin__stateBanner"
      class="coin-state-banner"
      :class="{ 'coin-state-banner--danger': workspace.stateMalformed }"
      role="alert"
    >
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

    <section v-if="shell.secondaryView" name="trench__secondary" class="trench-secondary-view">
      <header class="trench-secondary-view__header">
        <a-tooltip :content="i18nHelper.coin.trench.backToWorkspace">
          <a-button
            name="trench__secondary__back"
            size="small"
            :aria-label="i18nHelper.coin.trench.backToWorkspace"
            @click="workspace.closeSecondary()"
          >
            <template #icon><IconArrowLeft :size="15" /></template>
          </a-button>
        </a-tooltip>
        <IconSettings v-if="shell.resourcesActive" :size="16" />
        <IconHistory v-else :size="16" />
        <strong>{{ shell.resourcesActive ? i18nHelper.coin.resources : i18nHelper.coin.tabs.history }}</strong>
      </header>
      <CoinResourcesView v-if="shell.resourcesActive" />
      <HistoryView v-else />
    </section>

    <TrenchWorkspace v-else />
    <CoinSourcesDrawer />
  </main>
</template>

<script setup lang="ts">
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconHistory,
  IconSettings,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as shell } from '../coinShell.store';
import HistoryView from '../views/analysis/HistoryView.vue';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';
import CoinResourcesView from '../views/resources/CoinResourcesView.vue';
import CoinSourcesDrawer from './CoinSourcesDrawer.vue';
import TrenchWorkspace from './TrenchWorkspace.vue';
</script>
