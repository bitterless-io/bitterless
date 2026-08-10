<template>
  <aside name="trench__records" class="trench-record-list">
    <div class="trench-record-list__search">
      <a-input
        name="trench__records__search"
        size="mini"
        allow-clear
        :model-value="currentList.query"
        :placeholder="t('trench.search.placeholder')"
        :aria-label="t('trench.search.label')"
        @update:model-value="setSearch"
      />
      <span v-if="currentList.phase === 'refreshing'">{{ t('trench.states.refreshing') }}</span>
    </div>

    <div
      class="trench-record-list__scroll"
      :aria-busy="currentList.phase === 'loading' || currentList.appending"
    >
      <div
        v-if="currentList.phase === 'loading' && currentList.items.length === 0"
        name="trench__records__loading"
        class="trench-record-list__state"
        role="status"
      >
        <span class="trench-record-list__loading-label">{{ t('trench.states.loading') }}</span>
        <span v-for="index in 5" :key="index" class="trench-record-list__skeleton" />
      </div>

      <button
        v-for="item in currentList.items"
        :key="trenchVaultStore.recordIdentity(trenchVaultStore.module, item)"
        name="trench__records__row"
        class="trench-record-list__row"
        :class="{
          'trench-record-list__row--selected': selection === trenchVaultStore.recordIdentity(trenchVaultStore.module, item),
        }"
        type="button"
        :title="trenchVaultStore.recordPrimary(trenchVaultStore.module, item)"
        :aria-current="selection === trenchVaultStore.recordIdentity(trenchVaultStore.module, item) ? 'true' : undefined"
        :aria-pressed="selection === trenchVaultStore.recordIdentity(trenchVaultStore.module, item)"
        @click="selectRecord(item)"
      >
        <template v-if="trenchVaultStore.module === 'ca'">
          <span class="trench-record-list__identity">{{ trenchVaultStore.recordPrimary(trenchVaultStore.module, item) }}</span>
          <span class="trench-record-list__meta">
            <i v-for="chain in trenchVaultStore.caSummary(item).chains" :key="chain.chain">{{ chain.chain }}</i>
            {{ trenchVaultStore.caSymbol(item) }} · {{ trenchVaultStore.formatTime(trenchVaultStore.caSummary(item).generatedAt, locale) }}
          </span>
          <span class="trench-record-list__note">{{ trenchVaultStore.caSource(item) }}</span>
        </template>
        <template v-else-if="trenchVaultStore.module === 'index-wallets'">
          <span class="trench-record-list__identity">{{ trenchVaultStore.recordPrimary(trenchVaultStore.module, item) }}</span>
          <span class="trench-record-list__meta">
            <i>{{ trenchVaultStore.indexSummary(item).chain }}</i>
            {{ t('trench.index.sourceCount', { count: trenchVaultStore.indexSummary(item).sourceCount }) }}
          </span>
          <span class="trench-record-list__note">
            {{ t('trench.index.bestRank', { rank: trenchVaultStore.indexSummary(item).bestRank }) }} · {{ trenchVaultStore.formatTime(trenchVaultStore.indexSummary(item).lastSeenAt, locale) }}
          </span>
        </template>
        <template v-else>
          <span class="trench-record-list__identity">{{ trenchVaultStore.recordPrimary(trenchVaultStore.module, item) }}</span>
          <span class="trench-record-list__meta">
            <i>{{ trenchVaultStore.negativeSummary(item).chain }}</i>
            {{ trenchVaultStore.negativeSummary(item).hasHoldings ? t('trench.negative.holdingsReady') : t('trench.negative.holdingsMissing') }}
          </span>
          <span class="trench-record-list__note">{{ trenchVaultStore.firstLine(trenchVaultStore.negativeSummary(item).explanation) }}</span>
        </template>
      </button>

      <button
        v-for="issue in currentList.issues"
        :key="`${issue.entity}:${issue.identity}`"
        name="trench__records__issue"
        class="trench-record-list__issue"
        :class="{
          'trench-record-list__issue--selected': detailIdentity === trenchVaultStore.issueIdentity(issue),
        }"
        type="button"
        :aria-current="detailIdentity === trenchVaultStore.issueIdentity(issue) ? 'true' : undefined"
        :aria-pressed="detailIdentity === trenchVaultStore.issueIdentity(issue)"
        @click="selectIssue(issue)"
      >
        <strong>{{ t('trench.states.invalidRecord') }}</strong>
        <span>{{ issue.identity }}</span>
      </button>

      <div
        v-if="currentList.phase === 'empty'"
        name="trench__records__empty"
        class="trench-record-list__state"
      >
        <strong>{{ t('trench.states.emptyTitle') }}</strong>
        <span>{{ t('trench.states.emptyDescription') }}</span>
      </div>
      <div
        v-else-if="currentList.phase === 'no-match'"
        name="trench__records__no-match"
        class="trench-record-list__state"
      >
        <strong>{{ t('trench.states.noMatchTitle') }}</strong>
        <span>{{ t('trench.states.noMatchDescription') }}</span>
      </div>
      <div
        v-else-if="currentList.phase === 'error' && currentList.items.length === 0"
        name="trench__records__error"
        class="trench-record-list__state trench-record-list__state--error"
      >
        {{ currentList.error?.message }}
      </div>

      <button
        v-if="currentList.nextCursor"
        name="trench__records__load-more"
        class="trench-record-list__load-more"
        type="button"
        :disabled="currentList.appending"
        @click="trenchVaultStore.loadMoreRecords()"
      >
        {{ currentList.appending ? t('trench.states.loading') : t('trench.actions.loadMore') }}
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrenchStoredIssue } from '@shared/trench/trench.type';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';
import type { TrenchRecordSummary } from '../../views/vault/trenchVault.type';

const { t, locale } = useI18n();
const currentList = computed(() => trenchVaultStore.currentList);
const selection = computed(() => trenchVaultStore.selections[trenchVaultStore.module]);
const detailIdentity = computed(() => trenchVaultStore.currentDetail.identity);
const setSearch = (value: string): void => {
  void trenchVaultStore.setSearch(value);
};
const selectRecord = (item: TrenchRecordSummary): void => {
  void trenchVaultStore.selectRecord(item);
  void nextTick(() => {
    if (window.matchMedia('(max-width: 479px)').matches) {
      document.querySelector<HTMLElement>('[name="trench__detail__back"]')?.focus();
    }
  });
};
const selectIssue = (issue: TrenchStoredIssue): void => {
  trenchVaultStore.selectIssue(issue);
  void nextTick(() => {
    if (window.matchMedia('(max-width: 479px)').matches) {
      document.querySelector<HTMLElement>('[name="trench__detail__back"]')?.focus();
    }
  });
};
</script>

<style lang="less">
@import './TrenchRecordList.less';
</style>
