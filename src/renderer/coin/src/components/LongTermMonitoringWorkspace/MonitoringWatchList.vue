<template>
  <aside name="monitoring__watch__list" class="monitoring-watch-list">
    <div class="monitoring-watch-list__search">
      <a-input-search
        name="monitoring__watch__search"
        :aria-label="t('trench.monitoring.watches.search')"
        size="small"
        :model-value="store.watchSearch"
        :placeholder="t('trench.monitoring.watches.search')"
        search-button
        allow-clear
        @input="store.setSearch(String($event ?? ''))"
        @search="store.applySearch()"
        @clear="store.clearSearch()"
      />
    </div>

    <div
      v-if="store.listIntent && store.watches.length"
      class="monitoring-watch-list__notice"
      role="status"
    >
      <a-spin size="mini" />
      <span>{{
        t('trench.monitoring.watches.pendingQuery', {
          applied: store.appliedWatchSearch || t('trench.monitoring.watches.allWatches'),
          target: store.listIntent.search || t('trench.monitoring.watches.allWatches'),
          page: store.listIntent.page
        })
      }}</span>
    </div>
    <div
      v-else-if="store.errors.list && store.watches.length"
      class="monitoring-watch-list__notice"
      role="alert"
    >
      <span>{{
        t('trench.monitoring.watches.staleQuery', {
          query: store.appliedWatchSearch || t('trench.monitoring.watches.allWatches'),
          target: store.failedListIntent?.search || t('trench.monitoring.watches.allWatches'),
          page: store.failedListIntent?.page ?? store.watchPage,
          time: utcInstant(store.watchListStaleSince)
        })
      }}</span>
      <a-button name="monitoring__watch__retry-list" size="mini" @click="store.retryWatches()">
        {{ t('trench.monitoring.actions.retry') }}
      </a-button>
    </div>

    <div v-if="store.watchesLoading && !store.watches.length" class="monitoring-watch-list__state">
      <a-spin size="small" />
      <span>{{ t('trench.monitoring.watches.loading') }}</span>
    </div>
    <div
      v-else-if="store.errors.list && !store.watches.length"
      class="monitoring-watch-list__state"
      role="alert"
    >
      <span>{{ errorText(store.errors.list) }}</span>
      <a-button
        name="monitoring__watch__retry-list"
        size="mini"
        :loading="store.watchesLoading"
        :disabled="store.watchesLoading"
        @click="store.retryWatches()"
      >
        {{ t('trench.monitoring.actions.retry') }}
      </a-button>
    </div>
    <div v-else-if="!store.watches.length" class="monitoring-watch-list__state">
      <strong>{{
        store.appliedWatchSearch
          ? t('trench.monitoring.watches.emptySearch')
          : t('trench.monitoring.watches.emptyTitle')
      }}</strong>
      <span v-if="!store.appliedWatchSearch">{{
        t('trench.monitoring.watches.emptyDescription')
      }}</span>
      <a-button
        v-if="store.appliedWatchSearch"
        name="monitoring__watch__clear-search"
        size="mini"
        @click="store.clearSearch()"
        >{{ t('trench.monitoring.actions.clearSearch') }}</a-button
      >
    </div>
    <div v-else name="monitoring__watch__rows" class="monitoring-watch-list__rows">
      <button
        v-for="row in store.watchDisplays"
        :key="row.watch.config_id"
        name="monitoring__watch__row"
        type="button"
        class="monitoring-watch-list__row"
        :class="{
          'monitoring-watch-list__row--selected': store.selectedConfigId === row.watch.config_id
        }"
        :aria-current="store.selectedConfigId === row.watch.config_id ? 'true' : undefined"
        @click="store.selectWatch(row.watch.config_id)"
      >
        <span class="monitoring-watch-list__row-top">
          <span
            class="monitoring-watch-list__dot"
            :class="`monitoring-watch-list__dot--${tone(row.watch.latest?.state ?? 'WARMING')}`"
            aria-hidden="true"
          />
          <strong>{{ row.watch.name }}</strong>
          <span v-if="row.watch.latest" class="monitoring-watch-list__score">
            {{ score(row.watch.latest.z_score) }}
          </span>
        </span>
        <code>{{ shortAddress(row.watch.token_address) }} · eip155:56</code>
        <span class="monitoring-watch-list__meta">
          {{
            row.watch.status === 'Monitoring'
              ? t('trench.monitoring.watches.monitoring')
              : t('trench.monitoring.watches.stopped')
          }}
          · {{ stateLabel(row.watch.readiness.state) }}
          <template v-if="row.watch.readiness.state === 'WARMING'">
            {{ row.watch.readiness.baseline_count }} /
            {{ row.watch.readiness.minimum_baseline_count }}
          </template>
        </span>
        <span v-if="row.watch.latest" class="monitoring-watch-list__meta">
          {{ t('trench.monitoring.watches.latestFinalized') }} ·
          {{ utcRange(row.watch.latest.bucket_start, row.watch.latest.bucket_end) }}
        </span>
        <span class="monitoring-watch-list__meta">
          {{ t('trench.monitoring.watches.observed') }} ·
          <template v-for="region in row.regions" :key="region.region">
            {{ region.region.toUpperCase() }} {{ runtimeStateLabel(region.runtimeObservedState) }}
          </template>
        </span>
      </button>
    </div>

    <footer v-if="store.watchTotal" class="monitoring-watch-list__pagination">
      <a-button
        name="monitoring__watch__previous"
        size="mini"
        :disabled="store.watchPage <= 1"
        @click="store.setWatchPage(store.watchPage - 1)"
        >{{ t('trench.monitoring.actions.previous') }}</a-button
      >
      <span>{{
        t('trench.monitoring.watches.page', { page: store.watchPage, pages: store.watchPages })
      }}</span>
      <a-button
        name="monitoring__watch__next"
        size="mini"
        :disabled="store.watchPage >= store.watchPages"
        @click="store.setWatchPage(store.watchPage + 1)"
        >{{ t('trench.monitoring.actions.next') }}</a-button
      >
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { MonitoringProjectedState } from '@shared/monitoring/monitoringBridge.type';
import { monitoringStore as store } from '../../views/monitoring/monitoring.runtime';
import {
  monitoringStateTone,
  monitoringUtcInstant,
  monitoringUtcRange,
  shortMonitoringAddress
} from '../../views/monitoring/monitoringPresentation.service';

const { t } = useI18n();
const shortAddress = shortMonitoringAddress;
const tone = monitoringStateTone;
const utcRange = monitoringUtcRange;
const utcInstant = (value: string | null): string => monitoringUtcInstant(value) ?? '—';
const score = (value: string | null): string => {
  if (value === null) return '—';
  const numeric = Number(value);
  return `Z ${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}`;
};
const stateLabel = (state: MonitoringProjectedState): string =>
  t(`trench.monitoring.states.${state}`);
const runtimeStateLabel = (state: string): string => t(`trench.monitoring.runtimeStates.${state}`);
const errorText = (code: string): string => t('trench.monitoring.errors.generic', { code });
</script>
