<template>
  <section name="trench__trenchers__person-list" class="trenchers__person-list">
    <form name="trench__trenchers__search" class="trenchers__search" @submit.prevent="submitSearch">
      <a-input-search
        v-model="searchText"
        name="trench__trenchers__search-input"
        size="small"
        allow-clear
        search-button
        :placeholder="t('trench.trenchers.searchPlaceholder')"
        :aria-label="t('trench.trenchers.searchLabel')"
        @search="submitSearch"
        @clear="submitSearch"
      />
    </form>

    <div
      v-if="store.phase === 'loading' && !store.page"
      name="trench__trenchers__person-skeletons"
      class="trenchers__person-skeletons"
      role="status"
    >
      <span class="trenchers__sr-only">{{ t('trench.trenchers.loading') }}</span>
      <div
        v-for="row in 3"
        :key="row"
        name="trench__trenchers__person-skeleton"
        class="trenchers__person-skeleton"
        aria-hidden="true"
      >
        <span class="trenchers__skeleton-line trenchers__skeleton-line--name" />
        <span class="trenchers__skeleton-line trenchers__skeleton-line--meta" />
        <span class="trenchers__skeleton-line trenchers__skeleton-line--profit" />
      </div>
    </div>
    <div v-else-if="store.listError" class="trenchers__list-state trenchers__list-state--error" role="alert">
      <strong>{{ errorText(store.listError) }}</strong>
      <a-button name="trench__trenchers__retry-list" size="mini" @click="store.refresh(true)">
        {{ t('trench.indexWorkspace.retry') }}
      </a-button>
    </div>
    <div v-else-if="store.items.length === 0" class="trenchers__list-state">
      <strong>{{ t('trench.trenchers.emptyTitle') }}</strong>
      <span>{{ store.query ? t('trench.trenchers.emptySearch') : t('trench.trenchers.emptyDescription') }}</span>
    </div>
    <div
      v-else
      name="trench__trenchers__person-rows"
      class="trenchers__person-rows"
      :aria-busy="store.phase === 'refreshing'"
    >
      <button
        v-for="person in store.items"
        :key="person.personId"
        name="trench__trenchers__person-row"
        class="trenchers__person-row"
        :class="{ 'trenchers__person-row--selected': person.personId === store.selectedPersonId }"
        type="button"
        :aria-current="person.personId === store.selectedPersonId ? 'true' : undefined"
        @click="store.requestPersonDetail(person.personId)"
      >
        <span class="trenchers__person-row-title">
          <strong>{{ person.displayName || t('trench.trenchers.anonymous') }}</strong>
          <span class="trenchers__wallet-count">
            {{ t('trench.trenchers.walletCount', { count: person.walletCount }) }}
          </span>
        </span>
        <span class="trenchers__chain-badges">
          <span
            v-for="chain in person.chains"
            :key="chain"
            class="trenchers__chain-badge"
            :class="`trenchers__chain-badge--${chain}`"
          >{{ chainLabel(chain) }}</span>
        </span>
        <span class="trenchers__person-profit">
          {{ t('trench.trenchers.walletAggregate') }}
          <strong>{{ aggregateMoney(person.profit.rankedWalletCount, person.profit.totalProfitUsd) }}</strong>
        </span>
        <span v-if="person.note" class="trenchers__person-note">{{ person.note }}</span>
      </button>
    </div>

    <footer name="trench__trenchers__pagination" class="trenchers__pagination">
      <a-button
        name="trench__trenchers__previous-page"
        size="mini"
        :disabled="!store.hasPreviousPage || listPending"
        @click="store.previousPage()"
      >{{ t('trench.trenchers.previous') }}</a-button>
      <span>{{ t('trench.trenchers.page', { page: store.pageNumber }) }}</span>
      <a-button
        name="trench__trenchers__next-page"
        size="mini"
        :disabled="!store.hasNextPage || listPending"
        @click="store.nextPage()"
      >{{ t('trench.trenchers.next') }}</a-button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrenchChain } from '@shared/trench/trench.type';
import type { TrenchIndexError } from '@shared/trench/trenchIndex.type';
import { trenchPersonStore as store } from '../../views/trenchers/trenchPerson.runtime';

const { locale, t } = useI18n();
const searchText = ref('');
const listPending = computed(() => store.phase === 'loading' || store.phase === 'refreshing');
const chainLabel = (chain: TrenchChain): string => chain === 'solana'
  ? 'SOL'
  : chain === 'robinhood'
    ? 'RHC'
    : 'BSC';
const money = (value: number): string => new Intl.NumberFormat(locale.value, {
  style: 'currency',
  currency: 'USD',
  notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
  maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
}).format(value);
const aggregateMoney = (rankedWalletCount: number, value: number): string =>
  rankedWalletCount > 0 ? money(value) : '—';
const errorText = (error: TrenchIndexError): string => t(`trench.trenchers.errors.${error.code}`);
const submitSearch = (): void => {
  void store.search(searchText.value);
};
</script>
