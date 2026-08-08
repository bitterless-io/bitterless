<template>
  <aside name="trench__decision" class="trench-decision-dock">
    <header class="trench-decision-dock__header">
      <h2>{{ i18nHelper.coin.trench.decision }}</h2>
      <span v-if="result" class="trench-decision-dock__asset">
        {{ result.asset.symbol.value || shortAddress(result.asset.contractAddress) }}
      </span>
    </header>

    <div class="trench-decision-dock__composer">
      <a-textarea
        v-model="workspace.data.drafts.decision.thesis"
        name="trench__decision__thesis"
        :placeholder="i18nHelper.coin.trench.thesisPlaceholder"
        :max-length="maxThesisLength"
        :auto-size="{ minRows: 5, maxRows: 10 }"
        :disabled="workspace.aiLoading"
        @change="workspace.queuePersist()"
      />
      <div class="trench-decision-dock__actions">
        <span v-if="!result" class="trench-decision-dock__state">
          {{ i18nHelper.coin.trench.analysisFirst }}
        </span>
        <a-button
          name="trench__decision__review"
          type="primary"
          size="small"
          :loading="aiRunning"
          :disabled="!result || !thesisReady || (workspace.aiLoading && !aiRunning)"
          @click="workspace.reviewCurrentThesis()"
        >
          <template #icon><IconSparkles :size="15" /></template>
          {{ i18nHelper.coin.trench.reviewThesis }}
        </a-button>
      </div>
    </div>

    <div v-if="workspace.decisionError" class="trench-decision-dock__error" role="alert">
      <IconAlertTriangle :size="14" />
      <span>{{ workspace.decisionError }}</span>
    </div>

    <div name="trench__decision__result" class="trench-decision-dock__result" data-overlay-scrollbar>
      <CoinAiInterpretation v-if="result" kind="meme" :result-id="result.id" />
      <div v-if="result && !receipt && !aiRunning" class="trench-decision-dock__empty">
        {{ i18nHelper.coin.trench.noReview }}
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconAlertTriangle, IconSparkles } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { COIN_AI_MAX_THESIS_LENGTH } from '@shared/coin/coinAnalysis.type';
import CoinAiInterpretation from '../views/analysis/CoinAiInterpretation.vue';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';

const maxThesisLength = COIN_AI_MAX_THESIS_LENGTH;
const result = computed(() => workspace.memeAnalysis);
const thesisReady = computed(() => Boolean(workspace.data.drafts.decision.thesis.trim()));
const aiRunning = computed(() => Boolean(
  result.value && workspace.isAiRunning('meme', result.value.id),
));
const receipt = computed(() => result.value
  ? workspace.aiReceiptFor('meme', result.value.id)
  : null);
const shortAddress = (value: string): string =>
  value.length > 16 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
</script>
