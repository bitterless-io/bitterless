<template>
  <div name="coin__meme__analysis" class="coin-workspace-view coin-workspace-view--nested">
    <div name="coin__meme__analysisToolbar" class="coin-workspace-toolbar coin-workspace-toolbar--secondary">
      <label class="coin-control-group coin-control-group--fill">
        <span>{{ i18nHelper.coin.workspace.contractAddress }}</span>
        <a-input
          v-model="workspace.data.drafts.meme.contractAddress"
          :placeholder="addressPlaceholder"
          size="small"
          :disabled="workspace.memeLoading || workspace.aiLoading"
          allow-clear
          @change="workspace.queuePersist()"
          @press-enter="workspace.analyzeMeme()"
        />
      </label>
      <a-button
        type="primary"
        size="small"
        :loading="workspace.memeLoading"
        :disabled="workspace.memeLoading || workspace.aiLoading || !sourceConfigured"
        @click="workspace.analyzeMeme()"
      >
        <template #icon><IconMicroscope :size="15" /></template>
        {{ i18nHelper.coin.workspace.analyze }}
      </a-button>
      <a-button
        v-if="result"
        size="small"
        :loading="aiRunning"
        :disabled="workspace.memeLoading || (workspace.aiLoading && !aiRunning)"
        @click="workspace.analyzeWithAi('meme', result.id)"
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
      <a-tooltip v-if="workspace.memeLoading" :content="i18nHelper.coin.analysis.actions.cancel">
        <a-button size="small" status="danger" :aria-label="i18nHelper.coin.analysis.actions.cancel" @click="workspace.cancelMeme()">
          <template #icon><IconPlayerStop :size="15" /></template>
        </a-button>
      </a-tooltip>
    </div>

    <CoinEvidenceStrip />

    <div class="coin-workspace-view__body coin-analysis-result" data-overlay-scrollbar>
      <div v-if="workspace.memeError" class="coin-inline-error" role="alert">
        <IconAlertTriangle :size="16" />
        <span>{{ workspace.memeError }}</span>
      </div>

      <template v-if="result">
        <section
          :id="workspace.evidenceAnchorId(`derived:meme:${result.id}`)"
          name="coin__meme__asset"
          class="coin-analysis-section coin-analysis-section--identity"
        >
          <div>
            <span class="coin-section-kicker">{{ result.asset.chain.toUpperCase() }}</span>
            <h2>{{ metricValue(result.asset.symbol) }} · {{ metricValue(result.asset.name) }}</h2>
            <p class="coin-address coin-address--full">{{ result.asset.contractAddress }}</p>
          </div>
          <div class="coin-analysis-section__meta">
            <span class="coin-state-label coin-state-label--ready">{{ sourceModeLabel }}</span>
            <span>{{ formatDate(result.generatedAt) }}</span>
          </div>
        </section>

        <CoinAiInterpretation kind="meme" :result-id="result.id" />

        <section name="coin__meme__market" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.marketIdentity }}</h3>
          <div class="coin-metric-grid">
            <div v-for="item in assetMetrics" :key="item.label" class="coin-metric">
              <span>{{ item.label }}</span>
              <strong :class="{ 'coin-text-unavailable': item.metric.value === null }">{{ metricValue(item.metric, item.suffix) }}</strong>
              <small v-if="item.metric.value === null">{{ item.metric.reason }}</small>
            </div>
          </div>
        </section>

        <section name="coin__meme__holders" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.holderDistribution }}</h3>
          <div class="coin-metric-grid">
            <div v-for="item in holderMetrics" :key="item.label" class="coin-metric">
              <span>{{ item.label }}</span>
              <strong :class="{ 'coin-text-unavailable': item.metric.value === null }">{{ metricValue(item.metric, item.suffix) }}</strong>
              <small v-if="item.metric.value === null">{{ item.metric.reason }}</small>
              <small v-else-if="'numerator' in item.metric && item.metric.numerator !== null">
                {{ item.metric.numerator }} / {{ item.metric.denominator ?? unavailable }}
              </small>
            </div>
          </div>
          <div class="coin-inline-facts">
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.filtered }}:
              {{ result.holderDistribution.holderUniverse.attestation.filtered ? i18nHelper.coin.analysis.labels.yes : i18nHelper.coin.analysis.labels.no }}
            </span>
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.rawRows }}:
              {{ result.holderDistribution.holderUniverse.coverage.rawHolderCount ?? unavailable }}
            </span>
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.sourceRows }}:
              {{ result.holderDistribution.holderUniverse.coverage.sourceRowCount }} / {{ result.holderDistribution.holderUniverse.coverage.sourceLimit }}
            </span>
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.eligibleRows }}:
              {{ result.holderDistribution.holderUniverse.coverage.eligibleRowCount }}
            </span>
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.unknownRows }}:
              {{ result.holderDistribution.holderUniverse.coverage.unknownRowCount }}
            </span>
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.top10Coverage }}:
              {{ result.holderDistribution.holderUniverse.coverage.top10EligibleCount }} · {{ result.holderDistribution.holderUniverse.coverage.top10Complete ? i18nHelper.coin.analysis.labels.ready : i18nHelper.coin.analysis.labels.partial }}
            </span>
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.top100Coverage }}:
              {{ result.holderDistribution.holderUniverse.coverage.top100EligibleCount }} · {{ result.holderDistribution.holderUniverse.coverage.top100Complete ? i18nHelper.coin.analysis.labels.ready : i18nHelper.coin.analysis.labels.partial }}
            </span>
            <span>
              {{ i18nHelper.coin.analysis.holderUniverse.rawRankOne }}:
              {{ holderClassificationLabel(result.holderDistribution.holderUniverse.topHolder.status) }} ·
              {{ result.holderDistribution.holderUniverse.topHolder.address ? shortAddress(result.holderDistribution.holderUniverse.topHolder.address) : unavailable }}
            </span>
          </div>
          <div v-if="result.holderDistribution.excludedByType.length" class="coin-inline-facts">
            <span v-for="entry in result.holderDistribution.excludedByType" :key="entry.type">{{ entry.type }}: {{ entry.count }}</span>
          </div>
          <div v-if="result.holderDistribution.holderUniverse.exclusionAudit.length" class="coin-data-table-scroll coin-data-table-scroll--section">
            <table class="coin-data-table">
              <thead><tr><th>{{ i18nHelper.coin.analysis.columns.sourceRank }}</th><th>{{ i18nHelper.coin.analysis.columns.wallet }}</th><th>{{ i18nHelper.coin.analysis.columns.exclusionClass }}</th><th>{{ i18nHelper.coin.analysis.columns.reason }}</th><th>{{ i18nHelper.coin.analysis.columns.evidence }}</th></tr></thead>
              <tbody>
                <tr v-for="entry in result.holderDistribution.holderUniverse.exclusionAudit" :key="`${entry.sourceRank}-${entry.address}`">
                  <td>{{ entry.sourceRank }}</td>
                  <td class="coin-data-table__identity coin-address">{{ shortAddress(entry.address) }}</td>
                  <td>{{ holderClassLabel(entry.class) }}</td>
                  <td>{{ entry.reason }}</td>
                  <td>{{ entry.evidenceRefs.length }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section name="coin__meme__cohorts" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.top100Cohorts }}</h3>
          <div class="coin-data-table-scroll coin-data-table-scroll--section">
            <table class="coin-data-table">
              <thead><tr><th>{{ i18nHelper.coin.analysis.columns.cohort }}</th><th>{{ i18nHelper.coin.analysis.columns.matchCount }}</th><th>{{ i18nHelper.coin.analysis.columns.holdingShare }}</th></tr></thead>
              <tbody>
                <tr v-for="cohort in result.top100Cohorts" :key="cohort.cohort">
                  <td class="coin-data-table__identity">{{ cohort.label }}</td>
                  <td>{{ metricValue(cohort.matchCount) }}<small v-if="cohort.matchCount.reason">{{ cohort.matchCount.reason }}</small></td>
                  <td>{{ metricValue(cohort.holdingSharePct, '%') }}<small v-if="cohort.holdingSharePct.reason">{{ cohort.holdingSharePct.reason }}</small></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section name="coin__meme__eoa" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.eoaOnly }} · {{ result.eoaAnalysis.label }}</h3>
          <div class="coin-metric-grid coin-metric-grid--compact">
            <div class="coin-metric"><span>{{ i18nHelper.coin.analysis.metrics.eoaCount }}</span><strong>{{ metricValue(result.eoaAnalysis.holderCount) }}</strong><small v-if="result.eoaAnalysis.holderCount.reason">{{ result.eoaAnalysis.holderCount.reason }}</small></div>
            <div class="coin-metric"><span>{{ i18nHelper.coin.analysis.metrics.eoaShare }}</span><strong>{{ metricValue(result.eoaAnalysis.holdingSharePct, '%') }}</strong><small v-if="result.eoaAnalysis.holdingSharePct.reason">{{ result.eoaAnalysis.holdingSharePct.reason }}</small></div>
          </div>
          <div class="coin-data-table-scroll coin-data-table-scroll--section">
            <table class="coin-data-table">
              <thead><tr><th>{{ i18nHelper.coin.analysis.columns.cohort }}</th><th>{{ i18nHelper.coin.analysis.columns.matchCount }}</th><th>{{ i18nHelper.coin.analysis.columns.holdingShare }}</th></tr></thead>
              <tbody>
                <tr v-for="cohort in result.eoaAnalysis.cohorts" :key="cohort.cohort">
                  <td class="coin-data-table__identity">{{ cohort.label }}</td>
                  <td>{{ metricValue(cohort.matchCount) }}<small v-if="cohort.matchCount.reason">{{ cohort.matchCount.reason }}</small></td>
                  <td>{{ metricValue(cohort.holdingSharePct, '%') }}<small v-if="cohort.holdingSharePct.reason">{{ cohort.holdingSharePct.reason }}</small></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section name="coin__meme__wallets" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.keyWallets }}</h3>
          <CoinResultState v-if="result.keyWallets.length === 0" kind="unavailable" :title="i18nHelper.coin.analysis.states.keyWalletsUnavailable" :detail="result.keyWalletsReason || undefined" />
          <div v-else class="coin-data-table-scroll coin-data-table-scroll--section">
            <table class="coin-data-table coin-data-table--wallets">
              <thead><tr><th>#</th><th>{{ i18nHelper.coin.analysis.columns.wallet }}</th><th>{{ i18nHelper.coin.analysis.columns.label }}</th><th>{{ i18nHelper.coin.analysis.columns.sourceRank }}</th><th>{{ i18nHelper.coin.analysis.columns.eligibleRank }}</th><th>{{ i18nHelper.coin.analysis.columns.holdingShare }}</th><th>{{ i18nHelper.coin.analysis.columns.walletScore }}</th><th>{{ i18nHelper.coin.analysis.columns.pnl }}</th></tr></thead>
              <tbody>
                <tr v-for="wallet in result.keyWallets" :key="wallet.address">
                  <td>{{ wallet.rank }}</td>
                  <td class="coin-data-table__identity coin-address">{{ shortAddress(wallet.address) }}</td>
                  <td>{{ wallet.label }}</td>
                  <td>{{ wallet.sourceHolderRank ?? unavailable }}</td>
                  <td>{{ wallet.holderRank ?? unavailable }}</td>
                  <td>{{ nullablePercent(wallet.holdingSharePct) }}</td>
                  <td>{{ nullableNumber(wallet.walletScore) }}</td>
                  <td>{{ nullableCurrency(wallet.realizedPnlUsd) }} / {{ nullableCurrency(wallet.unrealizedPnlUsd) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section name="coin__meme__concepts" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.concepts }}</h3>
          <CoinResultState v-if="result.concepts.length === 0" kind="unavailable" :title="i18nHelper.coin.analysis.states.conceptsUnavailable" :detail="result.conceptsReason || undefined" />
          <div v-else class="coin-data-table-scroll coin-data-table-scroll--section">
            <table class="coin-data-table coin-data-table--concepts">
              <thead><tr><th>#</th><th>{{ i18nHelper.coin.analysis.columns.concept }}</th><th>{{ i18nHelper.coin.analysis.columns.basis }}</th><th>{{ i18nHelper.coin.analysis.columns.trend }}</th><th>{{ i18nHelper.coin.analysis.columns.attention }}</th><th>{{ i18nHelper.coin.analysis.columns.growth }}</th><th>{{ i18nHelper.coin.analysis.columns.novelty }}</th><th>{{ i18nHelper.coin.analysis.columns.saturation }}</th></tr></thead>
              <tbody>
                <tr v-for="concept in result.concepts" :key="concept.key">
                  <td>{{ concept.rank }}</td>
                  <td class="coin-data-table__identity">{{ concept.label }}</td>
                  <td><span class="coin-state-label" :class="concept.basis === 'observed' ? 'coin-state-label--ready' : 'coin-state-label--sample'">{{ basisLabel(concept.basis) }}</span></td>
                  <td>{{ concept.trend }}</td>
                  <td>{{ metricValue(concept.attentionScore) }}</td>
                  <td>{{ metricValue(concept.growthScore) }}</td>
                  <td>{{ metricValue(concept.noveltyScore) }}</td>
                  <td>{{ metricValue(concept.saturationScore) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="result.tokenConceptFits.length" class="coin-concept-fits">
            <article v-for="fit in result.tokenConceptFits" :key="fit.conceptKey">
              <strong>{{ fit.conceptKey }} · {{ basisLabel(fit.basis) }} · {{ metricValue(fit.fitScore) }}</strong>
              <span>{{ fit.summary }}</span>
            </article>
          </div>
        </section>

        <section name="coin__meme__risks" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.risks }}</h3>
          <div v-if="result.risks.length" class="coin-risk-list">
            <article v-for="risk in result.risks" :key="`${risk.code}-${risk.text}`" :class="`coin-risk-list__item--${risk.severity}`">
              <span>{{ risk.severity }}</span><strong>{{ risk.code }}</strong><p>{{ risk.text }}</p>
            </article>
          </div>
          <CoinResultState v-else kind="empty" :title="i18nHelper.coin.analysis.states.noReportedRisks" />
        </section>

        <section name="coin__meme__unavailable" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.unavailableFields }}</h3>
          <div v-if="result.unavailable.length" class="coin-unavailable-list">
            <div v-for="field in result.unavailable" :key="field.field"><strong>{{ field.field }}</strong><span>{{ field.reason }}</span><small>{{ field.source || unavailable }}</small></div>
          </div>
          <span v-else class="coin-text-muted">{{ i18nHelper.coin.analysis.states.noUnavailableFields }}</span>
        </section>

        <section name="coin__meme__receipts" class="coin-analysis-section">
          <h3>{{ i18nHelper.coin.analysis.sections.sourceReceipts }}</h3>
          <div class="coin-data-table-scroll coin-data-table-scroll--section">
            <table class="coin-data-table">
              <thead><tr><th>{{ i18nHelper.coin.sourceDrawer.source }}</th><th>{{ i18nHelper.coin.analysis.columns.mode }}</th><th>{{ i18nHelper.coin.analysis.columns.state }}</th><th>{{ i18nHelper.coin.analysis.columns.observed }}</th><th>{{ i18nHelper.coin.analysis.columns.evidence }}</th><th>{{ i18nHelper.coin.analysis.columns.reason }}</th></tr></thead>
              <tbody>
                <tr
                  v-for="receipt in result.receipts"
                  :key="receipt.id"
                  :data-coin-evidence="receipt.evidenceIds.join('\n')"
                >
                  <td class="coin-data-table__identity">{{ receipt.source }}</td>
                  <td>{{ receipt.mode }}</td>
                  <td><span class="coin-state-label" :class="`coin-state-label--${receipt.status}`">{{ receipt.status }}</span></td>
                  <td>{{ receipt.observedAt ? formatDate(receipt.observedAt) : unavailable }}</td>
                  <td>{{ receipt.evidenceIds.length }}</td>
                  <td>{{ receipt.reason || unavailable }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div v-if="result.warnings.length" class="coin-warning-list coin-warning-list--footer">
          <span v-for="warning in result.warnings" :key="warning">{{ warning }}</span>
        </div>
      </template>

      <CoinResultState v-else-if="workspace.memeLoading" kind="loading" :title="i18nHelper.coin.analysis.states.loadingMeme" />
      <CoinResultState v-else-if="!sourceConfigured" kind="unavailable" :title="i18nHelper.coin.analysis.states.analysisUnavailable" :detail="i18nHelper.coin.analysis.states.selectedModeUnavailable" />
      <CoinResultState v-else kind="empty" :title="i18nHelper.coin.analysis.states.memeEmpty" :detail="i18nHelper.coin.analysis.states.memeEmptyDetail" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { IconAlertTriangle, IconMicroscope, IconPlayerStop, IconSparkles } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type {
  CoinHolderClassificationStatus,
  CoinHolderExclusionClass,
  CoinNullableMetric,
  CoinRatioMetric,
} from '@shared/coin/coinAnalysis.type';
import CoinEvidenceStrip from '../../components/CoinEvidenceStrip.vue';
import CoinAiInterpretation from './CoinAiInterpretation.vue';
import CoinResultState from './CoinResultState.vue';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

defineProps<{ sourceConfigured: boolean }>();

type DisplayMetric = CoinNullableMetric<string | number | boolean> | CoinRatioMetric;

const result = computed(() => workspace.memeAnalysis);
const aiRunning = computed(() => Boolean(
  result.value && workspace.isAiRunning('meme', result.value.id),
));
const unavailable = i18nHelper.coin.analysis.labels.unavailable;
const addressPlaceholder = computed(() => workspace.data.drafts.meme.chain === 'solana' ? i18nHelper.coin.analysis.placeholders.solanaAddress : '0x...');
const sourceModeLabel = computed(() => result.value?.mode === 'service' ? i18nHelper.coin.analysis.modes.deployedService : i18nHelper.coin.analysis.modes.localReadOnly);
const assetMetrics = computed(() => result.value ? [
  { label: i18nHelper.coin.analysis.metrics.launchStage, metric: result.value.asset.launchStage, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.priceUsd, metric: result.value.asset.priceUsd, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.marketCap, metric: result.value.asset.marketCapUsd, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.liquidity, metric: result.value.asset.liquidityUsd, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.chainIdentity, metric: result.value.asset.chainIdentityVerified, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.contractVerified, metric: result.value.asset.contractVerified, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.score, metric: result.value.deterministicScore, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.confidence, metric: result.value.confidence, suffix: '' },
] : []);
const holderMetrics = computed(() => result.value ? [
  { label: i18nHelper.coin.analysis.metrics.holderCount, metric: result.value.holderDistribution.holderCount, suffix: '' },
  { label: i18nHelper.coin.analysis.metrics.top10, metric: result.value.holderDistribution.top10SharePct, suffix: '%' },
  { label: i18nHelper.coin.analysis.metrics.top100, metric: result.value.holderDistribution.top100SharePct, suffix: '%' },
  { label: i18nHelper.coin.analysis.metrics.freshWalletRate, metric: result.value.holderDistribution.freshWalletRatePct, suffix: '%' },
  { label: i18nHelper.coin.analysis.metrics.botDegenRate, metric: result.value.holderDistribution.botDegenRatePct, suffix: '%' },
  { label: i18nHelper.coin.analysis.metrics.entrapmentRate, metric: result.value.holderDistribution.entrapmentTraderRatePct, suffix: '%' },
  { label: i18nHelper.coin.analysis.metrics.excludedAddresses, metric: result.value.holderDistribution.excludedAddressCount, suffix: '' },
] : []);

const metricValue = (metric: DisplayMetric, suffix = ''): string => {
  if (metric.value === null) return unavailable;
  if (typeof metric.value === 'boolean') return metric.value ? i18nHelper.coin.analysis.labels.yes : i18nHelper.coin.analysis.labels.no;
  if (typeof metric.value === 'number') return `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 6 })}${suffix}`;
  return String(metric.value);
};
const nullableNumber = (value: number | null): string => value === null ? unavailable : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
const nullablePercent = (value: number | null): string => value === null ? unavailable : `${nullableNumber(value)}%`;
const nullableCurrency = (value: number | null): string => value === null ? unavailable : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatDate = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const shortAddress = (value: string): string => value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
const basisLabel = (basis: 'observed' | 'inferred'): string => basis === 'observed' ? i18nHelper.coin.analysis.labels.observed : i18nHelper.coin.analysis.labels.inferred;
const holderClassificationLabel = (status: CoinHolderClassificationStatus): string => {
  if (status === 'independent') return i18nHelper.coin.analysis.holderUniverse.independent;
  if (status === 'excluded') return i18nHelper.coin.analysis.holderUniverse.excluded;
  return i18nHelper.coin.analysis.holderUniverse.unknown;
};
const holderClassLabel = (value: CoinHolderExclusionClass): string =>
  i18nHelper.coin.analysis.holderUniverse.classes[value];
</script>
