<template>
  <section
    name="trench__workspace"
    class="trench-workspace"
    :class="{
      'trench-workspace--signal-open': shell.signalDockOpen,
      'trench-workspace--decision-open': shell.decisionDockOpen,
    }"
  >
    <TrenchCommandBar />

    <div name="trench__workspace__body" class="trench-workspace__body">
      <TrenchSignalRail />

      <main name="trench__tokenCanvas" class="trench-token-canvas">
        <MemeAnalysisPanel :source-configured="sourceConfigured" embedded :show-ai="false" />
      </main>

      <TrenchDecisionDock />

      <div
        v-if="shell.signalDockOpen || shell.decisionDockOpen"
        class="trench-workspace__dock-scrim"
        aria-hidden="true"
        @click="shell.closeDocks()"
      ></div>

      <div class="trench-workspace__dock-controls">
        <a-tooltip :content="i18nHelper.coin.trench.signals">
          <a-button
            name="trench__workspace__signals"
            size="small"
            :aria-label="i18nHelper.coin.trench.signals"
            :class="{ 'trench-workspace__dock-button--active': shell.signalDockOpen }"
            @click="shell.toggleSignalDock()"
          >
            <template #icon><IconRadar :size="15" /></template>
          </a-button>
        </a-tooltip>
        <a-tooltip :content="i18nHelper.coin.trench.decision">
          <a-button
            name="trench__workspace__decision"
            size="small"
            :aria-label="i18nHelper.coin.trench.decision"
            :class="{ 'trench-workspace__dock-button--active': shell.decisionDockOpen }"
            @click="shell.toggleDecisionDock()"
          >
            <template #icon><IconSparkles :size="15" /></template>
          </a-button>
        </a-tooltip>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconRadar, IconSparkles } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as shell } from '../coinShell.store';
import MemeAnalysisPanel from '../views/analysis/MemeAnalysisPanel.vue';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';
import TrenchCommandBar from './TrenchCommandBar.vue';
import TrenchDecisionDock from './TrenchDecisionDock.vue';
import TrenchSignalRail from './TrenchSignalRail.vue';

const sourceConfigured = computed(() => workspace.sourceStatuses.some((source) =>
  ['meme-service', 'gmgn-cli'].includes(source.source) && source.configured));
</script>
