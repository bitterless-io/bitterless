<template>
  <section name="coin__screener" class="coin-workspace-view">
    <div name="coin__screener__toolbar" class="coin-workspace-toolbar coin-workspace-toolbar--wrap">
      <label class="coin-control-group coin-control-group--fill">
        <span>{{ i18nHelper.coin.workspace.screenerInput }}</span>
        <a-input
          v-model="workspace.data.drafts.screener.query"
          :placeholder="i18nHelper.coin.workspace.screenerPlaceholder"
          size="small"
          :disabled="busy"
          allow-clear
          @change="workspace.queuePersist()"
          @press-enter="workspace.parseScreener()"
        />
      </label>
      <label class="coin-control-group coin-control-group--wide">
        <span>{{ i18nHelper.coin.analysis.labels.symbolUniverse }}</span>
        <a-input
          v-model="workspace.data.drafts.screener.symbolsText"
          :placeholder="i18nHelper.coin.analysis.placeholders.optionalSymbols"
          size="small"
          :disabled="busy"
          allow-clear
          @change="workspace.queuePersist()"
        />
      </label>
      <a-radio-group
        v-model="workspace.data.drafts.screener.mode"
        type="button"
        size="small"
        :disabled="busy"
        @change="workspace.queuePersist()"
      >
        <a-radio value="live_public">{{ i18nHelper.coin.analysis.modes.live }}</a-radio>
        <a-radio value="sample">{{ i18nHelper.coin.analysis.modes.sample }}</a-radio>
      </a-radio-group>
      <a-button size="small" :loading="workspace.screenerParsing" :disabled="busy" @click="workspace.parseScreener()">
        <template #icon><IconBraces :size="15" /></template>
        {{ i18nHelper.coin.workspace.parse }}
      </a-button>
      <a-button type="primary" size="small" :loading="workspace.screenerLoading" :disabled="busy" @click="workspace.screen()">
        <template #icon><IconFilterSearch :size="15" /></template>
        {{ i18nHelper.coin.workspace.screen }}
      </a-button>
      <a-tooltip v-if="busy" :content="i18nHelper.coin.analysis.actions.cancel">
        <a-button size="small" status="danger" :aria-label="i18nHelper.coin.analysis.actions.cancel" @click="cancelActive">
          <template #icon><IconPlayerStop :size="15" /></template>
        </a-button>
      </a-tooltip>
    </div>

    <div v-if="workspace.data.drafts.screener.mode === 'sample'" class="coin-mode-warning" role="status">
      <IconFlask :size="15" />
      {{ i18nHelper.coin.analysis.modes.sampleWarning }}
    </div>

    <div v-if="workspace.screenerParseResult" name="coin__screener__parsed" class="coin-filter-strip">
      <span class="coin-filter-strip__label">{{ i18nHelper.coin.analysis.labels.parsed }}</span>
      <span v-for="(filter, index) in workspace.screenerParseResult.parsed.filters" :key="`${filter.field}-${index}`" class="coin-filter-token">
        {{ filter.field }} {{ filter.op }} {{ formatFilterValue(filter.value) }}
      </span>
      <span v-if="workspace.screenerParseResult.parsed.filters.length === 0" class="coin-text-muted">
        {{ i18nHelper.coin.analysis.states.noFilters }}
      </span>
      <span class="coin-filter-strip__parser">{{ workspace.screenerParseResult.parsed.parser }}</span>
    </div>

    <CoinEvidenceStrip />

    <div class="coin-workspace-view__body coin-workspace-view__body--table">
      <div v-if="workspace.screenerError" class="coin-inline-error" role="alert">
        <IconAlertTriangle :size="16" />
        <span>{{ workspace.screenerError }}</span>
      </div>

      <template v-if="workspace.screenerResult">
        <div name="coin__screener__summary" class="coin-result-summary">
          <span class="coin-state-label" :class="workspace.screenerResult.mode === 'sample' ? 'coin-state-label--sample' : 'coin-state-label--ready'">
            {{ workspace.screenerResult.mode === 'sample' ? i18nHelper.coin.analysis.modes.sample : i18nHelper.coin.analysis.modes.live }}
          </span>
          <span>{{ workspace.screenerResult.matched }} {{ i18nHelper.coin.analysis.labels.matched }}</span>
          <span>{{ workspace.screenerResult.scanned }} {{ i18nHelper.coin.analysis.labels.scanned }}</span>
          <span>{{ workspace.screenerResult.rejected }} {{ i18nHelper.coin.analysis.labels.rejected }}</span>
          <span>{{ formatDate(workspace.screenerResult.generatedAt) }}</span>
        </div>
        <div v-if="workspace.screenerResult.warnings.length" class="coin-warning-list">
          <span v-for="warning in workspace.screenerResult.warnings" :key="warning">{{ warning }}</span>
        </div>

        <CoinResultState
          v-if="workspace.screenerResult.rows.length === 0"
          kind="empty"
          :title="i18nHelper.coin.analysis.states.noMatches"
          :detail="i18nHelper.coin.analysis.states.noMatchesDetail"
        />
        <div v-else name="coin__screener__table" class="coin-data-table-scroll" data-overlay-scrollbar>
          <table class="coin-data-table coin-data-table--screener">
            <thead>
              <tr>
                <th>#</th>
                <th>{{ i18nHelper.coin.analysis.columns.symbol }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.score }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.price }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.low }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.multiple }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.listingAge }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.funding }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.state }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in workspace.screenerResult.rows" :key="`${row.rank}-${row.symbol}`" name="coin__screener__row">
                <td>{{ row.rank }}</td>
                <td class="coin-data-table__identity">{{ row.symbol }}</td>
                <td>{{ formatNumber(row.score, 1) }}</td>
                <td>{{ formatNumber(row.currentPrice, 8) }}</td>
                <td>{{ formatNumber(row.historicalLowPrice, 8) }}</td>
                <td>{{ formatNumber(row.priceMultiple, 2) }}</td>
                <td>{{ formatNumber(row.listingAgeDays, 1) }}</td>
                <td>{{ formatPercent(row.fundingRatePct) }}</td>
                <td><span :class="{ 'coin-text-warning': row.warning }">{{ row.warning || row.state || i18nHelper.coin.analysis.labels.ready }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <CoinResultState v-else-if="busy" kind="loading" :title="i18nHelper.coin.analysis.states.loadingScreener" />
      <CoinResultState
        v-else-if="!screenerConfigured"
        kind="unavailable"
        :title="i18nHelper.coin.analysis.states.screenerUnavailable"
        :detail="i18nHelper.coin.analysis.states.configureSource"
        show-sources
        @open-sources="shell.openSources()"
      />
      <CoinResultState
        v-else
        kind="empty"
        :title="i18nHelper.coin.analysis.states.screenerEmpty"
        :detail="i18nHelper.coin.analysis.states.screenerEmptyDetail"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { IconAlertTriangle, IconBraces, IconFilterSearch, IconFlask, IconPlayerStop } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { CoinFilterValue } from '@shared/coin/coinAnalysis.type';
import { coinShellStore as shell } from '../../coinShell.store';
import CoinEvidenceStrip from '../../components/CoinEvidenceStrip.vue';
import CoinResultState from './CoinResultState.vue';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

const busy = computed(() => workspace.screenerParsing || workspace.screenerLoading);
const screenerConfigured = computed(() => workspace.sourceStatuses.some((source) => source.source === 'screener' && source.configured));

const cancelActive = (): void => {
  if (workspace.screenerParsing) void workspace.cancelScreenerParse();
  else void workspace.cancelScreener();
};
const formatDate = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const formatNumber = (value: number | null, digits: number): string =>
  value === null ? i18nHelper.coin.analysis.labels.unavailable : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const formatPercent = (value: number | null): string => value === null ? i18nHelper.coin.analysis.labels.unavailable : `${formatNumber(value, 4)}%`;
const formatFilterValue = (value: CoinFilterValue): string => Array.isArray(value) ? value.join(' – ') : String(value);
</script>
