<template>
  <section name="trench__sniping__activity" class="sniping-activity">
    <div name="trench__sniping__activity-filters" class="sniping-activity__filters">
      <a-select
        :model-value="store.activityFilter.product"
        size="small"
        :placeholder="t('trench.sniping.activity.allSources')"
        allow-clear
        @change="setFilter('product', $event)"
        @clear="setFilter('product', '')"
      >
        <a-option value="monitor">Monitor</a-option>
        <a-option value="exact">Exact</a-option>
        <a-option value="shadow">Shadow</a-option>
      </a-select>
      <a-select
        :model-value="store.activityFilter.outcome"
        size="small"
        :placeholder="t('trench.sniping.activity.allOutcomes')"
        allow-clear
        @change="setFilter('outcome', $event)"
        @clear="setFilter('outcome', '')"
      >
        <a-option v-for="outcome in outcomes" :key="outcome" :value="outcome">{{ outcome }}</a-option>
      </a-select>
      <a-select
        :model-value="store.activityFilter.chain"
        size="small"
        :placeholder="t('trench.sniping.activity.allChains')"
        allow-clear
        @change="setFilter('chain', $event)"
        @clear="setFilter('chain', '')"
      >
        <a-option value="bsc">BSC</a-option>
        <a-option value="ethereum">Ethereum</a-option>
        <a-option value="base">Base</a-option>
        <a-option value="arbitrum">Arbitrum</a-option>
        <a-option value="solana">Solana</a-option>
      </a-select>
      <a-input-search
        v-model="search"
        name="trench__sniping__activity-search"
        size="small"
        :placeholder="t('trench.sniping.activity.search')"
        search-button
        @search="setFilter('search', search)"
      />
    </div>

    <div name="trench__sniping__activity-table-region" class="sniping-activity__table-region">
      <table class="sniping-activity__table">
        <thead>
          <tr>
            <th>{{ t('trench.sniping.activity.time') }}</th>
            <th>{{ t('trench.sniping.activity.product') }}</th>
            <th>{{ t('trench.sniping.activity.source') }}</th>
            <th>{{ t('trench.sniping.activity.outcome') }}</th>
            <th>{{ t('trench.sniping.activity.reason') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in store.activity"
            :key="row.activity_id"
            name="trench__sniping__activity-row"
            tabindex="0"
            :aria-selected="store.selectedActivity?.activity_id === row.activity_id"
            :class="{ 'sniping-activity__row--selected': store.selectedActivity?.activity_id === row.activity_id }"
            @click="store.selectActivity(row)"
            @keydown.enter="store.selectActivity(row)"
            @keydown.space.prevent="store.selectActivity(row)"
          >
            <td>{{ dateTime(row.created_at) }}</td>
            <td>
              <strong>{{ row.config_name }}</strong>
              <code>{{ row.token_address ? shortAddress(row.token_address) : '—' }}</code>
            </td>
            <td>{{ row.product }}</td>
            <td><span :class="`sniping-activity__outcome--${row.outcome}`">{{ row.outcome }}</span></td>
            <td><code>{{ row.reason_code }}</code></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!store.activity.length && !store.activityLoading" class="sniping-activity__empty">
        {{ t('trench.sniping.activity.empty') }}
      </div>
    </div>
    <a-button
      v-if="store.activityCursor"
      name="trench__sniping__activity-load-more"
      class="sniping-activity__load-more"
      size="small"
      :loading="store.activityLoading"
      @click="store.loadMoreActivity()"
    >{{ t('trench.sniping.activity.loadMore') }}</a-button>

    <a-drawer
      :visible="!!store.selectedActivity"
      name="trench__sniping__activity-drawer"
      :title="t('trench.sniping.activity.details')"
      :width="'min(420px, 100%)'"
      :footer="false"
      popup-container=".sniping-workspace"
      @cancel="store.selectActivity(null)"
    >
      <dl v-if="store.selectedActivity" class="sniping-activity__drawer-list">
        <div v-for="field in drawerFields" :key="field.label">
          <dt>{{ field.label }}</dt>
          <dd :title="field.value">{{ field.value }}</dd>
        </div>
      </dl>
      <p class="sniping-activity__drawer-note">{{ t('trench.sniping.activity.sanitizedOnly') }}</p>
    </a-drawer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  SnipingActivityOutcome,
  SnipingActivityProduct,
  SnipingChain,
} from '@shared/sniping/snipingBridge.type';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';

const { locale, t } = useI18n();
const search = ref(store.activityFilter.search);
const outcomes: SnipingActivityOutcome[] = [
  'hit', 'filtered', 'blocked', 'failed', 'executable', 'unknown', 'duplicate', 'claimed', 'expired', 'retryable',
];
const setFilter = (
  field: 'product' | 'outcome' | 'chain' | 'search',
  value: unknown,
): void => {
  if (field === 'product') void store.setActivityFilter({ product: String(value ?? '') as '' | SnipingActivityProduct });
  else if (field === 'outcome') void store.setActivityFilter({ outcome: String(value ?? '') as '' | SnipingActivityOutcome });
  else if (field === 'chain') void store.setActivityFilter({ chain: String(value ?? '') as '' | SnipingChain });
  else void store.setActivityFilter({ search: String(value ?? '') });
};
const dateTime = (value: string): string => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'short', timeStyle: 'medium',
}).format(new Date(value));
const shortAddress = (value: string): string => `${value.slice(0, 8)}…${value.slice(-6)}`;
const drawerFields = computed(() => {
  const row = store.selectedActivity;
  if (!row) return [];
  return [
    [t('trench.sniping.activity.source'), row.product],
    [t('trench.sniping.activity.config'), `${row.config_name} · ${row.config_id}`],
    [t('trench.sniping.activity.release'), `${row.component_id}@${row.component_version}`],
    [t('trench.sniping.activity.chain'), row.chain],
    [t('trench.sniping.activity.canonicalEvent'), row.canonical_event_key ?? '—'],
    [t('trench.sniping.activity.token'), row.token_address ?? '—'],
    [t('trench.sniping.activity.quoteToken'), row.quote_token_address ?? '—'],
    [t('trench.sniping.activity.outcome'), row.outcome],
    [t('trench.sniping.activity.reason'), row.reason_code],
    [t('trench.sniping.activity.attempt'), row.attempt_number === null ? '—' : String(row.attempt_number)],
    [t('trench.sniping.activity.attemptState'), row.attempt_state ?? '—'],
    [t('trench.sniping.activity.request'), row.request_id ?? '—'],
    [t('trench.sniping.activity.fingerprint'), row.request_fingerprint ?? '—'],
  ].map(([label, value]) => ({ label, value }));
});
</script>
