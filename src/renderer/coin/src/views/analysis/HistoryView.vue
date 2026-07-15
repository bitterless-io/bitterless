<template>
  <section name="coin__history" class="coin-workspace-view">
    <div name="coin__history__toolbar" class="coin-workspace-toolbar">
      <label class="coin-control-group">
        <span>{{ i18nHelper.coin.workspace.type }}</span>
        <a-select v-model="type" size="small">
          <a-option value="all">{{ i18nHelper.coin.workspace.all }}</a-option>
          <a-option value="monitor">{{ i18nHelper.coin.tabs.monitor }}</a-option>
          <a-option value="screener">{{ i18nHelper.coin.tabs.screener }}</a-option>
          <a-option value="meme">{{ i18nHelper.coin.tabs.meme }}</a-option>
          <a-option value="decision">{{ i18nHelper.coin.analysis.labels.decisions }}</a-option>
          <a-option value="source">{{ i18nHelper.coin.analysis.sections.sourceReceipts }}</a-option>
        </a-select>
      </label>
      <label class="coin-control-group">
        <span>{{ i18nHelper.coin.workspace.chain }}</span>
        <a-select v-model="chain" size="small">
          <a-option value="all">{{ i18nHelper.coin.workspace.all }}</a-option>
          <a-option value="bsc">BSC</a-option>
          <a-option value="solana">Solana</a-option>
          <a-option value="robinhood">Robinhood</a-option>
        </a-select>
      </label>
      <label class="coin-control-group">
        <span>{{ i18nHelper.coin.analysis.labels.dateRange }}</span>
        <a-select v-model="range" size="small">
          <a-option value="all">{{ i18nHelper.coin.workspace.all }}</a-option>
          <a-option value="24h">24h</a-option>
          <a-option value="7d">7d</a-option>
          <a-option value="30d">30d</a-option>
        </a-select>
      </label>
      <label class="coin-control-group coin-control-group--fill">
        <span>{{ i18nHelper.coin.workspace.search }}</span>
        <a-input v-model="search" :placeholder="i18nHelper.coin.workspace.historySearch" size="small" allow-clear />
      </label>
    </div>

    <div class="coin-workspace-view__body coin-workspace-view__body--table">
      <template v-if="type === 'source'">
        <CoinResultState v-if="receiptRows.length === 0" kind="empty" :title="i18nHelper.coin.analysis.states.noReceipts" />
        <div v-else name="coin__history__receipts" class="coin-data-table-scroll" data-overlay-scrollbar>
          <table class="coin-data-table coin-data-table--history">
            <thead><tr><th>{{ i18nHelper.coin.sourceDrawer.source }}</th><th>{{ i18nHelper.coin.analysis.columns.mode }}</th><th>{{ i18nHelper.coin.analysis.columns.state }}</th><th>{{ i18nHelper.coin.analysis.columns.observed }}</th><th>{{ i18nHelper.coin.analysis.columns.received }}</th><th>{{ i18nHelper.coin.analysis.columns.evidence }}</th><th>{{ i18nHelper.coin.analysis.columns.reason }}</th></tr></thead>
            <tbody>
              <tr v-for="receipt in receiptRows" :key="receipt.id" name="coin__history__receiptRow">
                <td class="coin-data-table__identity">{{ receipt.source }}</td>
                <td>{{ receipt.mode }}</td>
                <td><span class="coin-state-label" :class="`coin-state-label--${receipt.status}`">{{ receipt.status }}</span></td>
                <td>{{ receipt.observedAt ? formatDate(receipt.observedAt) : unavailable }}</td>
                <td>{{ formatDate(receipt.receivedAt) }}</td>
                <td>{{ receipt.evidenceIds.length }}</td>
                <td>{{ receipt.reason || unavailable }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <CoinResultState v-if="historyRows.length === 0" kind="empty" :title="i18nHelper.coin.workspace.noHistory" :detail="i18nHelper.coin.analysis.states.historyEmptyDetail" />
        <div v-else name="coin__history__table" class="coin-data-table-scroll" data-overlay-scrollbar>
          <table class="coin-data-table coin-data-table--history">
            <thead><tr><th>{{ i18nHelper.coin.workspace.type }}</th><th>{{ i18nHelper.coin.analysis.columns.asset }}</th><th>{{ i18nHelper.coin.workspace.chain }}</th><th>{{ i18nHelper.coin.analysis.columns.summary }}</th><th>{{ i18nHelper.coin.analysis.columns.created }}</th><th>{{ i18nHelper.coin.analysis.columns.receipts }}</th><th class="coin-data-table__operation">{{ i18nHelper.coin.analysis.columns.operation }}</th></tr></thead>
            <tbody>
              <tr v-for="entry in historyRows" :key="entry.id" name="coin__history__row">
                <td><span class="coin-state-label coin-state-label--neutral">{{ typeLabel(entry.type) }}</span></td>
                <td class="coin-data-table__identity coin-history-asset">{{ entry.asset }}</td>
                <td>{{ entry.chain || unavailable }}</td>
                <td>{{ entry.summary }}</td>
                <td>{{ formatDate(entry.createdAt) }}</td>
                <td>{{ entry.sourceReceiptIds.length }}</td>
                <td class="coin-data-table__operation">
                  <a-tooltip :content="i18nHelper.coin.analysis.actions.open">
                    <a-button size="mini" :aria-label="i18nHelper.coin.analysis.actions.open" @click="workspace.openHistory(entry)">
                      <template #icon><IconExternalLink :size="14" /></template>
                    </a-button>
                  </a-tooltip>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import { IconExternalLink } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { CoinHistoryType } from '@shared/coin/coinAnalysis.type';
import CoinResultState from './CoinResultState.vue';
import { coinWorkspaceStore as workspace } from './coinWorkspace.store';

type HistoryFilter = CoinHistoryType | 'all' | 'source';
type DateRange = 'all' | '24h' | '7d' | '30d';

const type = ref<HistoryFilter>('all');
const chain = ref('all');
const range = ref<DateRange>('all');
const search = ref('');
const unavailable = i18nHelper.coin.analysis.labels.unavailable;
const cutoff = computed(() => {
  if (range.value === '24h') return Date.now() - 24 * 60 * 60 * 1000;
  if (range.value === '7d') return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (range.value === '30d') return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return 0;
});
const historyRows = computed(() => workspace
  .history(type.value === 'source' ? 'all' : type.value, chain.value, search.value)
  .filter((entry) => entry.createdAt >= cutoff.value));
const receiptRows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return [...workspace.data.sourceReceipts]
    .reverse()
    .filter((receipt) => receipt.receivedAt >= cutoff.value)
    .filter((receipt) => !needle || receipt.source.includes(needle) || receipt.reason?.toLowerCase().includes(needle) || receipt.evidenceIds.some((id) => id.toLowerCase().includes(needle)));
});
const formatDate = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const typeLabel = (value: CoinHistoryType): string => value === 'decision' ? i18nHelper.coin.analysis.labels.decision : i18nHelper.coin.tabs[value];
</script>
