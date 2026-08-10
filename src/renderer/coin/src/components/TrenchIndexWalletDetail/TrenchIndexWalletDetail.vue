<template>
  <div name="trench__detail__index" class="trench-index-detail">
    <article
      v-for="source in detail.items"
      :key="trenchVaultStore.indexSourceIdentity(source)"
      name="trench__detail__index-source"
      class="trench-index-detail__source"
    >
      <div class="trench-index-detail__identity">
        <strong>#{{ source.rank }} · {{ source.contractAddress }}</strong>
        <span>{{ trenchVaultStore.formatTime(source.generatedAt, locale) }}</span>
        <small>{{ source.analysisId }}</small>
        <small>{{ source.analysisContentHash }}</small>
      </div>
      <dl>
        <div v-if="source.profitUsd !== undefined">
          <dt>{{ t('trench.index.profit') }}</dt>
          <dd>{{ source.profitUsd }}</dd>
        </div>
        <div v-if="source.winRate !== undefined">
          <dt>{{ t('trench.index.winRate') }}</dt>
          <dd>{{ trenchVaultStore.formatWinRate(source.winRate) }}</dd>
        </div>
        <div>
          <dt>{{ t('trench.index.evidence') }}</dt>
          <dd>
            {{
              source.evidenceAvailable
                ? t('trench.index.available')
                : t('trench.index.notAvailable')
            }}
          </dd>
        </div>
        <div v-if="source.exposure">
          <dt>{{ t('trench.index.exposure') }}</dt>
          <dd>{{ t(trenchVaultStore.holdingMessageKey(source.exposure.holding)) }}</dd>
        </div>
        <div v-if="source.exposure?.balance !== undefined">
          <dt>{{ t('trench.index.balance') }}</dt>
          <dd>{{ source.exposure.balance }}</dd>
        </div>
        <div v-if="source.exposure?.sharePercent !== undefined">
          <dt>{{ t('trench.index.share') }}</dt>
          <dd>{{ source.exposure.sharePercent }}%</dd>
        </div>
        <div v-if="source.exposure?.valueUsd !== undefined">
          <dt>{{ t('trench.index.value') }}</dt>
          <dd>{{ source.exposure.valueUsd }}</dd>
        </div>
        <div v-if="source.exposure">
          <dt>{{ t('trench.index.exposureEvidence') }}</dt>
          <dd>
            {{
              source.exposure.evidenceAvailable
                ? t('trench.index.available')
                : t('trench.index.notAvailable')
            }}
          </dd>
        </div>
      </dl>
      <button
        name="trench__detail__index-source-open"
        type="button"
        :data-source-identity="trenchVaultStore.indexSourceIdentity(source)"
        @click="openSource(source)"
      >
        {{ t('trench.actions.openSource') }}
      </button>
    </article>
    <button
      v-if="detail.nextCursor"
      name="trench__detail__index-source__load-more"
      class="trench-index-detail__load-more"
      type="button"
      :disabled="state.indexSourcePhase === 'loading-more'"
      @click="trenchVaultStore.loadMoreIndexSources()"
    >
      {{
        state.indexSourcePhase === 'loading-more'
          ? t('trench.states.loading')
          : t('trench.actions.loadMoreSources')
      }}
    </button>
    <div v-if="state.indexSourcePhase === 'error'" class="trench-index-detail__error">
      {{ state.indexSourceError?.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrenchIndexWalletDetail, TrenchIndexWalletSource } from '@shared/trench/trench.type';
import type { TrenchDetailState } from '../../views/vault/trenchVault.type';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';

defineProps<{
  detail: TrenchIndexWalletDetail;
  state: TrenchDetailState;
}>();

const { t, locale } = useI18n();
const openSource = (source: TrenchIndexWalletSource): void => {
  void trenchVaultStore.openIndexSource(source);
  void nextTick(() => {
    document.querySelector<HTMLElement>('[name="trench__detail__back"]')?.focus();
  });
};
</script>

<style lang="less">
@import './TrenchIndexWalletDetail.less';
</style>
