<template>
  <aside name="trench__signalRail" class="trench-signal-rail">
    <section name="trench__scan" class="trench-signal-section trench-signal-section--scan">
      <header class="trench-signal-section__header">
        <div>
          <h2>{{ i18nHelper.coin.trench.scan }}</h2>
          <span>GMGN CLI</span>
        </div>
        <a-tooltip
          :content="workspace.discoverSnapshot?.running
            ? i18nHelper.coin.analysis.actions.stop
            : i18nHelper.coin.analysis.actions.start"
        >
          <a-button
            name="trench__scan__toggle"
            size="mini"
            :status="workspace.discoverSnapshot?.running ? 'danger' : 'normal'"
            :loading="workspace.discoverStarting || workspace.discoverStopping"
            :aria-label="workspace.discoverSnapshot?.running
              ? i18nHelper.coin.analysis.actions.stop
              : i18nHelper.coin.analysis.actions.start"
            @click="toggleDiscover"
          >
            <template #icon>
              <IconPlayerStop v-if="workspace.discoverSnapshot?.running" :size="14" />
              <IconPlayerPlay v-else :size="14" />
            </template>
          </a-button>
        </a-tooltip>
      </header>

      <div v-if="workspace.discoverError" class="trench-signal-section__error" role="alert">
        {{ workspace.discoverError }}
      </div>

      <div name="trench__scan__list" class="trench-signal-list" data-overlay-scrollbar>
        <article
          v-for="candidate in candidates"
          :key="`${candidate.chain}:${candidate.contractAddress}`"
          name="trench__scan__row"
          class="trench-signal-row"
          :class="{ 'trench-signal-row--active': isActive(candidate.chain, candidate.contractAddress) }"
        >
          <button
            class="trench-signal-row__main"
            type="button"
            @click="workspace.selectCandidate(candidate)"
          >
            <span class="trench-signal-row__identity">
              <strong>{{ candidate.symbol || candidate.name || i18nHelper.coin.analysis.labels.unnamed }}</strong>
              <small>{{ candidate.chain.toUpperCase() }} · {{ shortAddress(candidate.contractAddress) }}</small>
            </span>
            <span v-if="candidate.reasonCodes.length" class="trench-signal-row__reason">
              {{ candidate.reasonCodes[0] }}
            </span>
            <span class="trench-signal-row__evidence">
              <span v-if="candidate.ageMinutes !== null">{{ formatNumber(candidate.ageMinutes) }}m</span>
              <span v-if="candidate.riskScore !== null" :class="riskClass(candidate.riskScore)">
                {{ i18nHelper.coin.trench.risk }} {{ formatNumber(candidate.riskScore) }}
              </span>
              <span :class="{ 'coin-text-warning': candidate.stale }">
                {{ candidate.stale ? i18nHelper.coin.analysis.labels.stale : formatTime(candidate.observedAt) }}
              </span>
            </span>
          </button>
          <div class="trench-signal-row__actions">
            <a-tooltip :content="i18nHelper.coin.workspace.analyze">
              <a-button
                size="mini"
                :aria-label="i18nHelper.coin.workspace.analyze"
                :disabled="workspace.memeLoading"
                @click="workspace.analyzeCandidate(candidate)"
              >
                <template #icon><IconMicroscope :size="14" /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip :content="i18nHelper.coin.trench.addFocus">
              <a-button
                size="mini"
                :aria-label="i18nHelper.coin.trench.addFocus"
                :disabled="workspace.isFocused(candidate.chain, candidate.contractAddress)"
                @click="workspace.addCandidateToFocus(candidate)"
              >
                <template #icon><IconStar :size="14" /></template>
              </a-button>
            </a-tooltip>
          </div>
        </article>

        <div v-if="candidates.length === 0" class="trench-signal-empty">
          <a-spin v-if="workspace.discoverStarting" :size="16" />
          <span v-else>{{ i18nHelper.coin.trench.scanEmpty }}</span>
        </div>
      </div>
    </section>

    <section name="trench__focus" class="trench-signal-section trench-signal-section--focus">
      <header class="trench-signal-section__header">
        <h2>{{ i18nHelper.coin.trench.focus }}</h2>
      </header>

      <div name="trench__focus__list" class="trench-signal-list" data-overlay-scrollbar>
        <article
          v-for="row in focusRows"
          :key="row.item.id"
          name="trench__focus__row"
          class="trench-signal-row trench-signal-row--focus"
          :class="{ 'trench-signal-row--active': isActive(row.item.chain, row.item.asset) }"
        >
          <button class="trench-signal-row__main" type="button" @click="workspace.selectFocus(row.item)">
            <span class="trench-signal-row__identity">
              <strong>{{ row.label }}</strong>
              <small>{{ row.item.chain?.toUpperCase() }} · {{ shortAddress(row.item.asset) }}</small>
            </span>
            <span class="trench-signal-row__evidence">
              <span>{{ row.analysis ? formatTime(row.analysis.createdAt) : i18nHelper.coin.trench.notAnalyzed }}</span>
            </span>
          </button>
          <div class="trench-signal-row__actions">
            <a-tooltip :content="i18nHelper.coin.trench.removeFocus">
              <a-button
                size="mini"
                status="danger"
                :aria-label="i18nHelper.coin.trench.removeFocus"
                @click="workspace.removeFocus(row.item.id)"
              >
                <template #icon><IconX :size="14" /></template>
              </a-button>
            </a-tooltip>
          </div>
        </article>

        <div v-if="focusRows.length === 0" class="trench-signal-empty">
          {{ i18nHelper.coin.trench.focusEmpty }}
        </div>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import {
  IconMicroscope,
  IconPlayerPlay,
  IconPlayerStop,
  IconStar,
  IconX,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type {
  CoinChain,
  CoinStoredAnalysis,
  CoinWatchItem,
} from '@shared/coin/coinAnalysis.type';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';

interface FocusRow {
  item: CoinWatchItem;
  analysis: CoinStoredAnalysis | null;
  label: string;
}

const candidates = computed(() => workspace.discoverSnapshot?.candidates ?? []);
const focusRows = computed<FocusRow[]>(() => workspace.focusItems.map((item) => {
  const analysis = [...workspace.data.analyses]
    .reverse()
    .find((entry) =>
      entry.type === 'meme' &&
      workspace.tokensMatch(entry.chain, entry.asset, item.chain, item.asset)) ?? null;
  const label = analysis?.result.schema === 'coin-meme-analysis-v1'
    ? analysis.result.asset.symbol.value || analysis.result.asset.name.value || shortAddress(item.asset)
    : shortAddress(item.asset);
  return { item, analysis, label };
}));

const toggleDiscover = (): void => {
  if (workspace.discoverSnapshot?.running) void workspace.stopDiscover();
  else void workspace.startDiscover('local_cli_rpc');
};
const isActive = (chain: CoinChain | null, address: string): boolean =>
  workspace.isCurrentToken(chain, address);
const shortAddress = (value: string): string =>
  value.length > 16 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
const formatTime = (value: number): string => dayjs(value).format('HH:mm:ss');
const formatNumber = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const riskClass = (value: number): string =>
  value >= 70 ? 'coin-text-danger' : value >= 40 ? 'coin-text-warning' : '';
</script>
