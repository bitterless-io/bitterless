<template>
  <section name="trench__detail" class="trench-record-detail">
    <button
      name="trench__detail__back"
      class="trench-record-detail__back"
      :class="{ 'trench-record-detail__back--source': sourceVisible }"
      type="button"
      @click="goBack"
    >
      ← {{ sourceVisible ? t('trench.actions.backToSources') : t('trench.actions.back') }}
    </button>

    <template v-if="sourceVisible">
      <div v-if="sourceDocument.phase === 'loading'" class="trench-record-detail__state">
        {{ t('trench.states.loadingDocument') }}
      </div>
      <div
        v-else-if="sourceDocument.phase === 'missing'"
        name="trench__detail__missing"
        class="trench-record-detail__state trench-record-detail__state--warning"
      >
        {{ sourceDocument.error?.message }}
      </div>
      <div
        v-else-if="sourceDocument.phase === 'invalid'"
        name="trench__detail__invalid"
        class="trench-record-detail__state trench-record-detail__state--error"
      >
        {{ sourceDocument.error?.message }}
      </div>
      <div
        v-else-if="sourceDocument.phase === 'error'"
        name="trench__detail__error"
        class="trench-record-detail__state trench-record-detail__state--error"
      >
        {{ sourceDocument.error?.message }}
      </div>
      <template v-else-if="sourceDocument.phase === 'ready' && sourceDocument.value">
        <div class="trench-record-detail__meta trench-record-detail__meta--source">
          <div class="trench-record-detail__spine">
            <span>{{ t('trench.meta.sourceCa') }}</span>
            <strong>#{{ sourceDocument.source?.rank }}</strong>
          </div>
          <div class="trench-record-detail__identity">
            <span>{{ sourceDocument.value.record.contractAddress }}</span>
            <small
              >{{ sourceDocument.value.record.schema }} ·
              {{ sourceDocument.value.record.analysisId }} ·
              {{ sourceDocument.value.contentHash }}</small
            >
          </div>
          <div class="trench-record-detail__facts">
            <span>{{
              trenchVaultStore.formatTime(sourceDocument.value.record.generatedAt, locale)
            }}</span>
            <span>{{
              sourceDocument.value.record.source.agent || sourceDocument.value.record.source.kind
            }}</span>
          </div>
        </div>
        <TrenchAnalysisDetail :detail="sourceDocument.value" />
      </template>
    </template>

    <template v-else>
      <div
        v-if="detail.refreshing && detail.value"
        name="trench__detail__refreshing"
        class="trench-record-detail__refreshing"
        role="status"
      >
        {{ t('trench.states.refreshing') }}
      </div>
      <div
        v-if="detail.phase === 'idle' && currentList.phase === 'loading'"
        class="trench-record-detail__state"
        role="status"
      >
        {{ t('trench.states.loading') }}
      </div>
      <div v-else-if="detail.phase === 'idle'" class="trench-record-detail__state">
        {{ t('trench.states.selectRecord') }}
      </div>
      <div v-else-if="detail.phase === 'loading'" class="trench-record-detail__state">
        {{ t('trench.states.loadingDocument') }}
      </div>
      <div
        v-else-if="detail.phase === 'missing'"
        name="trench__detail__missing"
        class="trench-record-detail__state trench-record-detail__state--warning"
      >
        <strong>{{ t('trench.states.missingTitle') }}</strong>
        <span>{{ detail.error?.message }}</span>
        <button type="button" @click="trenchVaultStore.refresh()">
          {{ t('trench.actions.refresh') }}
        </button>
      </div>
      <div
        v-else-if="detail.phase === 'invalid'"
        name="trench__detail__invalid"
        class="trench-record-detail__state trench-record-detail__state--error"
      >
        <strong>{{ t('trench.states.invalidRecord') }}</strong>
        <span>{{ detail.issue?.identity || detail.error?.message }}</span>
        <span v-if="detail.issue">{{ detail.issue.message }}</span>
      </div>
      <div
        v-else-if="detail.phase === 'error'"
        name="trench__detail__error"
        class="trench-record-detail__state trench-record-detail__state--error"
      >
        <strong>{{ t('trench.states.detailError') }}</strong>
        <span>{{ detail.error?.message }}</span>
        <button type="button" @click="trenchVaultStore.retryDetail()">
          {{ t('trench.actions.retry') }}
        </button>
      </div>

      <template v-else-if="detail.phase === 'ready' && analysisDetail">
        <div class="trench-record-detail__meta">
          <div class="trench-record-detail__spine">
            <span>CA</span>
            <strong>R{{ analysisDetail.revision }}</strong>
          </div>
          <div class="trench-record-detail__identity">
            <span>{{ analysisDetail.record.contractAddress }}</span>
            <small
              >{{ analysisDetail.record.schema }} · {{ analysisDetail.record.analysisId }}</small
            >
          </div>
          <div class="trench-record-detail__facts">
            <span
              v-for="chain in analysisDetail.record.chains"
              :key="chain.chain"
              class="trench-record-detail__chain"
            >
              {{ chain.chain
              }}<template v-if="chain.token?.symbol"> · {{ chain.token.symbol }}</template>
            </span>
            <span>{{
              trenchVaultStore.formatTime(analysisDetail.record.generatedAt, locale)
            }}</span>
            <span>{{
              analysisDetail.record.source.agent || analysisDetail.record.source.kind
            }}</span>
          </div>
          <div v-if="analysisDetail.references.length" class="trench-record-detail__references">
            <span
              v-for="reference in analysisDetail.references"
              :key="`${reference.kind}:${reference.chain}:${reference.address}`"
              :class="{
                'trench-record-detail__reference--retired': reference.status === 'no-longer-current'
              }"
            >
              {{ reference.kind }} · {{ reference.chain }} · {{ reference.status }}
            </span>
          </div>
        </div>
        <TrenchAnalysisDetail :detail="analysisDetail" />
      </template>

      <template v-else-if="detail.phase === 'ready' && indexDetail">
        <div class="trench-record-detail__meta">
          <div class="trench-record-detail__spine">
            <span>{{ indexDetail.wallet.chain }}</span>
            <strong>#{{ indexDetail.wallet.bestRank }}</strong>
          </div>
          <div class="trench-record-detail__identity">
            <span>{{ indexDetail.wallet.address }}</span>
            <small>{{ indexDetail.contentHash }}</small>
          </div>
          <div class="trench-record-detail__facts">
            <span>{{
              t('trench.index.sourceCount', { count: indexDetail.wallet.sourceCount })
            }}</span>
            <span
              >{{ t('trench.meta.lastSeen') }}
              {{ trenchVaultStore.formatTime(indexDetail.wallet.lastSeenAt, locale) }}</span
            >
          </div>
        </div>
        <TrenchIndexWalletDetail :detail="indexDetail" :state="detail" />
      </template>

      <template v-else-if="detail.phase === 'ready' && negativeDetail">
        <div class="trench-record-detail__meta">
          <div class="trench-record-detail__spine">
            <span>{{ negativeDetail.tag.chain }}</span>
            <strong>NEG</strong>
          </div>
          <div class="trench-record-detail__identity">
            <span>{{ negativeDetail.tag.address }}</span>
            <small>{{ negativeDetail.tag.schema }} · {{ negativeDetail.tag.tagId }}</small>
          </div>
          <div class="trench-record-detail__facts">
            <span>{{ negativeDetail.tag.source }}</span>
            <span
              >{{ t('trench.meta.updated') }}
              {{ trenchVaultStore.formatTime(negativeDetail.tag.updatedAt, locale) }}</span
            >
          </div>
        </div>
        <TrenchNegativeWalletDetail :detail="negativeDetail" />
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrenchIndexWalletDetail as TrenchIndexWalletDetailValue } from '@shared/trench/trench.type';
import type {
  TrenchAnalysisDetail as TrenchAnalysisDetailValue,
  TrenchNegativeWalletReadDetail
} from '@shared/trench/trenchXpc.type';
import TrenchAnalysisDetail from '../TrenchAnalysisDetail/TrenchAnalysisDetail.vue';
import TrenchIndexWalletDetail from '../TrenchIndexWalletDetail/TrenchIndexWalletDetail.vue';
import TrenchNegativeWalletDetail from '../TrenchNegativeWalletDetail/TrenchNegativeWalletDetail.vue';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';

const { t, locale } = useI18n();
const detail = computed(() => trenchVaultStore.currentDetail);
const currentList = computed(() => trenchVaultStore.currentList);
const sourceDocument = computed(() => trenchVaultStore.sourceDocument);
const sourceVisible = computed(() => sourceDocument.value.phase !== 'idle');
const analysisDetail = computed(() =>
  trenchVaultStore.module === 'ca' ? (detail.value.value as TrenchAnalysisDetailValue | null) : null
);
const indexDetail = computed(() =>
  trenchVaultStore.module === 'index-wallets'
    ? (detail.value.value as TrenchIndexWalletDetailValue | null)
    : null
);
const negativeDetail = computed(() =>
  trenchVaultStore.module === 'negative-wallets'
    ? (detail.value.value as TrenchNegativeWalletReadDetail | null)
    : null
);
const goBack = (): void => {
  const wasSource = sourceVisible.value;
  const sourceIdentity =
    wasSource && sourceDocument.value.source
      ? trenchVaultStore.indexSourceIdentity(sourceDocument.value.source)
      : null;
  if (wasSource) trenchVaultStore.closeIndexSource();
  else trenchVaultStore.backToList();
  void nextTick(() => {
    const sourceTarget = sourceIdentity
      ? [
          ...document.querySelectorAll<HTMLElement>('[name="trench__detail__index-source-open"]')
        ].find((candidate) => candidate.dataset.sourceIdentity === sourceIdentity)
      : null;
    const target = wasSource
      ? (sourceTarget ??
        document.querySelector<HTMLElement>('[name="trench__detail__index-source-open"]'))
      : (document.querySelector<HTMLElement>(
          '[name="trench__records__row"][aria-current="true"]'
        ) ?? document.querySelector<HTMLElement>('[name="trench__records__search"]'));
    target?.focus();
  });
};
</script>

<style lang="less">
@import './TrenchRecordDetail.less';
</style>
