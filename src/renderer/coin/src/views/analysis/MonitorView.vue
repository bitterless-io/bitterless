<template>
  <section name="coin__monitor" class="coin-workspace-view">
    <div name="coin__monitor__toolbar" class="coin-workspace-toolbar">
      <label class="coin-control-group coin-control-group--wide">
        <span>{{ i18nHelper.coin.workspace.monitorInput }}</span>
        <a-input
          v-model="workspace.data.drafts.monitor.symbolsText"
          :placeholder="i18nHelper.coin.workspace.monitorPlaceholder"
          size="small"
          :disabled="busy"
          allow-clear
          @change="workspace.queuePersist()"
          @press-enter="workspace.loadMonitor(false)"
        />
      </label>
      <div class="coin-control-group">
        <span>{{ i18nHelper.coin.workspace.sort }}</span>
        <a-select
          v-model="workspace.data.drafts.monitor.sort"
          size="small"
          :aria-label="i18nHelper.coin.workspace.sort"
          :disabled="busy"
          @change="workspace.queuePersist()"
        >
          <a-option value="low_multiple_asc">{{ i18nHelper.coin.analysis.sort.lowMultipleAsc }}</a-option>
          <a-option value="low_multiple_desc">{{ i18nHelper.coin.analysis.sort.lowMultipleDesc }}</a-option>
          <a-option value="symbol_asc">{{ i18nHelper.coin.analysis.sort.symbol }}</a-option>
        </a-select>
      </div>
      <a-button type="primary" size="small" :loading="workspace.monitorLoading" :disabled="busy" @click="workspace.loadMonitor(false)">
        <template #icon><IconPlayerPlay :size="15" /></template>
        {{ i18nHelper.coin.analysis.actions.load }}
      </a-button>
      <a-button size="small" :loading="workspace.monitorRefreshing" :disabled="busy" @click="workspace.loadMonitor(true)">
        <template #icon><IconRefresh :size="15" /></template>
        {{ i18nHelper.coin.workspace.refresh }}
      </a-button>
      <a-tooltip v-if="busy" :content="i18nHelper.coin.analysis.actions.cancel">
        <a-button size="small" status="danger" :aria-label="i18nHelper.coin.analysis.actions.cancel" @click="workspace.cancelMonitor()">
          <template #icon><IconPlayerStop :size="15" /></template>
        </a-button>
      </a-tooltip>
    </div>

    <CoinEvidenceStrip />

    <div class="coin-workspace-view__body coin-workspace-view__body--table">
      <div v-if="workspace.monitorError" class="coin-inline-error" role="alert">
        <IconAlertTriangle :size="16" />
        <span>{{ workspace.monitorError }}</span>
      </div>

      <template v-if="workspace.monitorResult">
        <div name="coin__monitor__summary" class="coin-result-summary">
          <span class="coin-state-label" :class="`coin-state-label--${workspace.monitorResult.connection}`">
            {{ connectionLabel }}
          </span>
          <span>{{ workspace.monitorResult.rows.length }} {{ i18nHelper.coin.analysis.labels.rows }}</span>
          <span>{{ formatDate(workspace.monitorResult.readAt) }}</span>
          <span v-if="workspace.monitorResult.missingSymbols.length" class="coin-text-warning">
            {{ i18nHelper.coin.analysis.labels.missing }}: {{ workspace.monitorResult.missingSymbols.join(', ') }}
          </span>
        </div>

        <CoinResultState
          v-if="sortedRows.length === 0"
          kind="empty"
          :title="i18nHelper.coin.analysis.states.noRows"
          :detail="i18nHelper.coin.analysis.states.noRowsDetail"
        />
        <div v-else name="coin__monitor__table" class="coin-data-table-scroll" data-overlay-scrollbar>
          <table class="coin-data-table coin-data-table--monitor">
            <thead>
              <tr>
                <th>{{ i18nHelper.coin.analysis.columns.symbol }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.price }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.low }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.high }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.multiple }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.listingAge }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.freshness }}</th>
                <th>{{ i18nHelper.coin.analysis.columns.state }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedRows" :key="row.symbol" name="coin__monitor__row" :class="`coin-data-row--${row.state}`">
                <td class="coin-data-table__identity">{{ row.symbol }}</td>
                <td>{{ formatNumber(row.currentPrice, 8) }}</td>
                <td>{{ formatNumber(row.historicalLowPrice, 8) }}</td>
                <td>{{ formatNumber(row.historicalHighPrice, 8) }}</td>
                <td>{{ formatNumber(row.lowMultiple, 2) }}</td>
                <td>{{ formatNumber(row.listingAgeDays, 1) }}</td>
                <td>{{ formatFreshness(row.freshnessSeconds) }}</td>
                <td>
                  <span class="coin-state-label" :class="`coin-state-label--${row.state}`">{{ row.reason || row.state }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <CoinResultState
        v-else-if="busy"
        kind="loading"
        :title="i18nHelper.coin.analysis.states.loadingMonitor"
      />
      <CoinResultState
        v-else-if="!monitorConfigured"
        kind="unavailable"
        :title="i18nHelper.coin.analysis.states.monitorUnavailable"
        :detail="i18nHelper.coin.analysis.states.configureSource"
        show-sources
        @open-sources="shell.openSources()"
      />
      <CoinResultState
        v-else
        kind="empty"
        :title="i18nHelper.coin.analysis.states.monitorEmpty"
        :detail="i18nHelper.coin.analysis.states.monitorEmptyDetail"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { IconAlertTriangle, IconPlayerPlay, IconPlayerStop, IconRefresh } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { CoinMonitorRow } from '@shared/coin/coinAnalysis.type';
import { coinShellStore as shell } from '../../coinShell.store';
import CoinEvidenceStrip from '../../components/CoinEvidenceStrip.vue';
import CoinResultState from './CoinResultState.vue';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

const busy = computed(() => workspace.monitorLoading || workspace.monitorRefreshing);
const monitorConfigured = computed(() => workspace.sourceStatuses.some((source) => source.source === 'monitor-http' && source.configured));
const connectionLabel = computed(() => i18nHelper.coin.analysis.connections[workspace.monitorResult?.connection ?? 'closed']);

const sortedRows = computed<CoinMonitorRow[]>(() => {
  const rows = [...(workspace.monitorResult?.rows ?? [])];
  const sort = workspace.data.drafts.monitor.sort;
  if (sort === 'symbol_asc') return rows.sort((left, right) => left.symbol.localeCompare(right.symbol));
  const direction = sort === 'low_multiple_desc' ? -1 : 1;
  return rows.sort((left, right) => {
    if (left.lowMultiple === null) return 1;
    if (right.lowMultiple === null) return -1;
    return (left.lowMultiple - right.lowMultiple) * direction;
  });
});

const formatDate = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const formatNumber = (value: number | null, digits: number): string =>
  value === null ? i18nHelper.coin.analysis.labels.unavailable : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const formatFreshness = (value: number | null): string =>
  value === null ? i18nHelper.coin.analysis.labels.unavailable : `${Math.round(value)}s`;
</script>
