<template>
  <section name="coin__strategy" class="coin-workspace-view">
    <div name="coin__strategy__toolbar" class="coin-workspace-toolbar">
      <label class="coin-control-group coin-control-group--fill">
        <span>{{ i18nHelper.coin.workspace.contractAddress }}</span>
        <a-input
          v-model="draft.contractAddress"
          size="small"
          :disabled="workspace.strategyLoading || workspace.aiLoading"
          :placeholder="draft.chain === 'solana' ? i18nHelper.coin.analysis.placeholders.solanaAddress : '0x...'"
          allow-clear
          @change="workspace.queuePersist()"
        />
      </label>
      <div class="coin-control-group">
        <span>{{ i18nHelper.coin.workspace.chain }}</span>
        <a-select v-model="draft.chain" size="small" :aria-label="i18nHelper.coin.workspace.chain" :disabled="workspace.strategyLoading || workspace.aiLoading" @change="workspace.queuePersist()">
          <a-option value="bsc">BSC</a-option>
          <a-option value="solana">Solana</a-option>
          <a-option value="robinhood">Robinhood</a-option>
        </a-select>
      </div>
      <div class="coin-control-group coin-control-group--wide">
        <span>{{ i18nHelper.coin.analysis.labels.launchStage }}</span>
        <a-select v-model="draft.launchStage" size="small" :aria-label="i18nHelper.coin.analysis.labels.launchStage" :disabled="workspace.strategyLoading || workspace.aiLoading" @change="workspace.queuePersist()">
          <a-option v-for="stage in launchStages" :key="stage" :value="stage">{{ i18nHelper.coin.analysis.stages[stage] }}</a-option>
        </a-select>
      </div>
      <a-button type="primary" size="small" :loading="workspace.strategyLoading" :disabled="workspace.strategyLoading || workspace.aiLoading" @click="workspace.evaluateStrategy()">
        <template #icon><IconScale :size="15" /></template>
        {{ i18nHelper.coin.workspace.evaluate }}
      </a-button>
      <a-button
        v-if="workspace.strategyResult"
        size="small"
        :loading="aiRunning"
        :disabled="workspace.strategyLoading || (workspace.aiLoading && !aiRunning)"
        @click="workspace.analyzeWithAi('strategy', workspace.strategyResult.id)"
      >
        <template #icon><IconSparkles :size="15" /></template>
        {{ i18nHelper.coin.analysis.ai.analyze }}
      </a-button>
      <a-button
        v-if="aiRunning"
        size="small"
        status="warning"
        :loading="workspace.aiCancelling"
        :disabled="workspace.aiCancelling"
        @click="workspace.cancelAi()"
      >
        <template #icon><IconPlayerStop :size="15" /></template>
        {{ i18nHelper.coin.analysis.ai.cancel }}
      </a-button>
    </div>

    <CoinEvidenceStrip />

    <div class="coin-workspace-view__body coin-strategy-body" data-overlay-scrollbar>
      <div v-if="workspace.strategyError" class="coin-inline-error" role="alert">
        <IconAlertTriangle :size="16" />
        <span>{{ workspace.strategyError }}</span>
      </div>

      <section name="coin__strategy__market" class="coin-analysis-section coin-analysis-section--form">
        <h3>{{ i18nHelper.coin.analysis.sections.marketExecution }}</h3>
        <div class="coin-strategy-grid">
          <StrategyNumberField v-model="draft.tokenAgeMinutes" :label="i18nHelper.coin.analysis.fields.tokenAge" :min="0" suffix="m" @change="persist" />
          <StrategyNumberField v-model="draft.priceUsd" :label="i18nHelper.coin.analysis.fields.price" :min="0" :step="0.000001" @change="persist" />
          <StrategyNumberField v-model="draft.liquidityUsd" :label="i18nHelper.coin.analysis.fields.liquidity" :min="0" suffix="$" @change="persist" />
          <StrategyNumberField v-model="draft.snapshotAgeSeconds" :label="i18nHelper.coin.analysis.fields.snapshotAge" :min="0" suffix="s" @change="persist" />
          <StrategyNumberField v-model="draft.plannedEntryAmount" :label="i18nHelper.coin.analysis.fields.plannedEntry" :min="0" suffix="$" @change="persist" />
          <StrategyNumberField v-model="draft.riskBudget" :label="i18nHelper.coin.analysis.fields.riskBudget" :min="0" suffix="$" @change="persist" />
          <StrategyNumberField v-model="draft.roundTripCostPct" :label="i18nHelper.coin.analysis.fields.roundTripCost" :min="0" :max="100" suffix="%" @change="persist" />
        </div>
      </section>

      <section name="coin__strategy__signals" class="coin-analysis-section coin-analysis-section--form">
        <h3>{{ i18nHelper.coin.analysis.sections.structuredSignals }}</h3>
        <div class="coin-strategy-grid">
          <StrategyNumberField v-model="draft.walletOverlapScore" :label="i18nHelper.coin.analysis.fields.walletOverlap" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.attentionPotentialScore" :label="i18nHelper.coin.analysis.fields.attention" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.momentumScore" :label="i18nHelper.coin.analysis.fields.momentum" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.buyerQualityScore" :label="i18nHelper.coin.analysis.fields.buyerQuality" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.holderHealthScore" :label="i18nHelper.coin.analysis.fields.holderHealth" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.liquidityScore" :label="i18nHelper.coin.analysis.fields.liquidityScore" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.smartMoneyFlowScore" :label="i18nHelper.coin.analysis.fields.smartMoney" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.graduationScore" :label="i18nHelper.coin.analysis.fields.graduation" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.riskScore" :label="i18nHelper.coin.analysis.fields.riskScore" :min="0" :max="100" @change="persist" />
          <StrategyNumberField v-model="draft.dataConfidence" :label="i18nHelper.coin.analysis.fields.confidence" :min="0" :max="1" :step="0.01" @change="persist" />
        </div>
      </section>

      <section name="coin__strategy__forecast" class="coin-analysis-section coin-analysis-section--form">
        <h3>{{ i18nHelper.coin.analysis.sections.forecastRisk }}</h3>
        <div class="coin-strategy-grid">
          <StrategyNumberField v-model="draft.winProbability" :label="i18nHelper.coin.analysis.fields.winProbability" :min="0" :max="1" :step="0.01" @change="persist" />
          <StrategyNumberField v-model="draft.expectedUpsidePctGivenWin" :label="i18nHelper.coin.analysis.fields.expectedUpside" :min="0" suffix="%" @change="persist" />
          <StrategyNumberField v-model="draft.expectedDownsidePctGivenLoss" :label="i18nHelper.coin.analysis.fields.expectedDownside" :min="0" suffix="%" @change="persist" />
        </div>
        <div class="coin-switch-grid">
          <label><span>{{ i18nHelper.coin.analysis.fields.sellable }}</span><a-switch v-model="draft.sellable" size="small" @change="persist" /></label>
          <label><span>{{ i18nHelper.coin.analysis.fields.honeypot }}</span><a-switch v-model="draft.honeypotConfirmed" size="small" type="round" @change="persist" /></label>
          <label><span>{{ i18nHelper.coin.analysis.fields.sourceConflict }}</span><a-switch v-model="draft.criticalSourceConflict" size="small" type="round" @change="persist" /></label>
        </div>
      </section>

      <section name="coin__strategy__position" class="coin-analysis-section coin-analysis-section--form">
        <div class="coin-section-heading">
          <h3>{{ i18nHelper.coin.analysis.sections.position }}</h3>
          <label class="coin-inline-switch"><span>{{ i18nHelper.coin.analysis.fields.hasPosition }}</span><a-switch v-model="draft.hasPosition" size="small" @change="persist" /></label>
        </div>
        <div v-if="draft.hasPosition" class="coin-strategy-grid">
          <StrategyNumberField v-model="draft.entryPrice" :label="i18nHelper.coin.analysis.fields.entryPrice" :min="0" :step="0.000001" @change="persist" />
          <StrategyNumberField v-model="draft.remainingAmount" :label="i18nHelper.coin.analysis.fields.remainingAmount" :min="0" @change="persist" />
          <StrategyNumberField v-model="draft.investedAmount" :label="i18nHelper.coin.analysis.fields.investedAmount" :min="0" suffix="$" @change="persist" />
          <StrategyNumberField v-model="draft.peakPrice" :label="i18nHelper.coin.analysis.fields.peakPrice" :min="0" :step="0.000001" @change="persist" />
          <StrategyNumberField v-model="draft.heldMinutes" :label="i18nHelper.coin.analysis.fields.heldMinutes" :min="0" suffix="m" @change="persist" />
        </div>
        <p v-else class="coin-text-muted">{{ i18nHelper.coin.analysis.states.noPosition }}</p>
      </section>

      <template v-if="workspace.strategyResult">
        <section
          :id="workspace.evidenceAnchorId(`derived:strategy:${workspace.strategyResult.id}`)"
          name="coin__strategy__decision"
          class="coin-analysis-section coin-decision-result"
        >
          <div class="coin-decision-result__header">
            <span class="coin-decision" :class="`coin-decision--${workspace.strategyResult.decision.toLowerCase()}`">{{ workspace.strategyResult.decision }}</span>
            <div><strong>{{ workspace.strategyResult.score }}/100</strong><span>{{ i18nHelper.coin.analysis.metrics.confidence }} {{ formatPercent(workspace.strategyResult.confidence) }}</span></div>
            <span>{{ formatDate(workspace.strategyResult.generatedAt) }}</span>
          </div>
          <div class="coin-decision-metrics">
            <div><span>{{ i18nHelper.coin.analysis.metrics.decisionPosition }}</span><strong>{{ currency(workspace.strategyResult.metrics.decisionPositionUsd) }}</strong></div>
            <div><span>{{ i18nHelper.coin.analysis.metrics.netExpectedValue }}</span><strong>{{ percent(workspace.strategyResult.metrics.netExpectedValuePct) }}</strong></div>
            <div><span>{{ i18nHelper.coin.analysis.metrics.expectedLoss }}</span><strong>{{ currency(workspace.strategyResult.metrics.expectedLossUsd) }}</strong></div>
            <div><span>{{ i18nHelper.coin.analysis.metrics.positionReturn }}</span><strong>{{ nullablePercent(workspace.strategyResult.metrics.positionReturnPct) }}</strong></div>
            <div><span>{{ i18nHelper.coin.analysis.metrics.drawdown }}</span><strong>{{ nullablePercent(workspace.strategyResult.metrics.drawdownFromPeakPct) }}</strong></div>
          </div>
          <div class="coin-decision-columns">
            <div>
              <h4>{{ i18nHelper.coin.analysis.labels.reasons }}</h4>
              <article
                v-for="reason in workspace.strategyResult.reasons"
                :key="reason.code"
                class="coin-decision-reason"
                :data-coin-evidence="reason.evidenceRefs.join('\n')"
              >
                <strong>{{ reason.code }}</strong><span>{{ reason.text }}</span><small>{{ reason.evidenceRefs.join(', ') }}</small>
              </article>
            </div>
            <div>
              <h4>{{ i18nHelper.coin.analysis.labels.invalidation }}</h4>
              <ul><li v-for="item in workspace.strategyResult.invalidation" :key="item">{{ item }}</li></ul>
            </div>
          </div>
          <p class="coin-decision-result__disclaimer"><IconLock :size="14" />{{ i18nHelper.coin.analysis.labels.noExecution }}</p>
        </section>

        <CoinAiInterpretation kind="strategy" :result-id="workspace.strategyResult.id" />
      </template>

      <CoinResultState v-else kind="empty" :title="i18nHelper.coin.analysis.states.strategyEmpty" :detail="i18nHelper.coin.analysis.states.strategyEmptyDetail" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { IconAlertTriangle, IconLock, IconPlayerStop, IconScale, IconSparkles } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { COIN_LAUNCH_STAGES } from '@shared/coin/coinAnalysis.type';
import CoinEvidenceStrip from '../../components/CoinEvidenceStrip.vue';
import CoinAiInterpretation from './CoinAiInterpretation.vue';
import CoinResultState from './CoinResultState.vue';
import StrategyNumberField from './StrategyNumberField.vue';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

const launchStages = COIN_LAUNCH_STAGES;
const draft = computed(() => workspace.data.drafts.strategy);
const aiRunning = computed(() => Boolean(
  workspace.strategyResult &&
  workspace.isAiRunning('strategy', workspace.strategyResult.id),
));
const persist = (): void => workspace.queuePersist();
const formatDate = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const currency = (value: number): string => `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const percent = (value: number): string => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;
const nullablePercent = (value: number | null): string => value === null ? i18nHelper.coin.analysis.labels.unavailable : percent(value);
</script>
