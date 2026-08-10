<template>
  <div name="trench__detail__negative" class="trench-negative-detail">
    <section name="trench__detail__negative-tag" class="trench-negative-detail__section">
      <header class="trench-negative-detail__section-header">
        <div>
          <span>{{ t('trench.negative.tag') }}</span>
          <small>{{ detail.tag.tagId }}</small>
        </div>
        <TrenchDocumentAction
          kind="tag"
          :document="detail.tagDocument"
          :content-hash="detail.tagContentHash"
          :title="t('trench.documents.tag')"
        />
      </header>
      <dl class="trench-negative-detail__facts">
        <div>
          <dt>{{ t('trench.analysis.sourceKind') }}</dt>
          <dd>{{ detail.tag.source }}</dd>
        </div>
        <div>
          <dt>{{ t('trench.negative.created') }}</dt>
          <dd>{{ trenchVaultStore.formatTime(detail.tag.createdAt, locale) }}</dd>
        </div>
        <div>
          <dt>{{ t('trench.meta.updated') }}</dt>
          <dd>{{ trenchVaultStore.formatTime(detail.tag.updatedAt, locale) }}</dd>
        </div>
      </dl>
      <div name="trench__detail__negative-explanation" class="trench-negative-detail__explanation">
        <span>{{ t('trench.negative.explanation') }}</span>
        <p role="region" tabindex="0" :aria-label="t('trench.negative.explanation')">
          {{ detail.tag.explanation }}
        </p>
      </div>
    </section>

    <div
      v-if="detail.holdingsIssue"
      name="trench__detail__holdings-invalid"
      class="trench-negative-detail__state trench-negative-detail__state--error"
      role="status"
    >
      <strong>{{ t('trench.negative.holdingsInvalid') }}</strong>
      <span>{{ detail.holdingsIssue.message }}</span>
    </div>
    <div
      v-else-if="!detail.holdings"
      name="trench__detail__holdings-empty"
      class="trench-negative-detail__state"
    >
      <strong>{{ t('trench.negative.holdingsMissing') }}</strong>
      <span>{{ t('trench.negative.holdingsMissingDescription') }}</span>
    </div>
    <section v-else name="trench__detail__holdings" class="trench-negative-detail__section">
      <header class="trench-negative-detail__section-header">
        <div>
          <span>{{ t('trench.negative.holdings') }}</span>
          <small
            >{{ detail.holdings.schema }} · {{ detail.holdings.analysisId }} ·
            {{ trenchVaultStore.formatTime(detail.holdings.generatedAt, locale) }}</small
          >
        </div>
        <TrenchDocumentAction
          v-if="detail.holdingsDocument"
          kind="holdings"
          :document="detail.holdingsDocument"
          :content-hash="detail.holdingsContentHash"
          :title="t('trench.documents.holdings')"
        />
      </header>

      <div class="trench-negative-detail__assets">
        <h4>
          {{ t('trench.negative.assets') }} <span>{{ detail.holdings.holdings.length }}</span>
        </h4>
        <p
          v-if="detail.holdings.holdings.length === 0"
          name="trench__detail__holdings-zero"
          class="trench-negative-detail__missing"
        >
          {{ t('trench.negative.noAssets') }}
        </p>
        <article
          v-for="(holding, index) in detail.holdings.holdings.slice(0, visibleHoldings)"
          :key="holding.contractAddress ?? `native:${index}`"
          name="trench__detail__holding"
          class="trench-negative-detail__asset"
        >
          <div class="trench-negative-detail__asset-identity">
            <strong>{{ holding.symbol || t('trench.negative.symbolMissing') }}</strong>
            <span>{{ holding.contractAddress || t('trench.negative.nativeAsset') }}</span>
          </div>
          <dl>
            <div v-if="holding.balance !== undefined">
              <dt>{{ t('trench.index.balance') }}</dt>
              <dd>{{ holding.balance }}</dd>
            </div>
            <div v-if="holding.valueUsd !== undefined">
              <dt>{{ t('trench.index.value') }}</dt>
              <dd>{{ holding.valueUsd }}</dd>
            </div>
            <div v-if="holding.portfolioPercent !== undefined">
              <dt>{{ t('trench.negative.portfolioShare') }}</dt>
              <dd>{{ holding.portfolioPercent }}%</dd>
            </div>
          </dl>
          <div v-if="holding.evidence" class="trench-negative-detail__evidence">
            <span>{{ t('trench.analysis.evidence') }}</span>
            <TrenchStructuredValue
              :value="holding.evidence"
              :path="`holdings[${index}].evidence`"
            />
          </div>
        </article>
        <button
          v-if="visibleHoldings < detail.holdings.holdings.length"
          class="trench-negative-detail__more"
          type="button"
          @click="visibleHoldings += pageSize"
        >
          {{
            t('trench.structured.showMore', {
              count: Math.min(pageSize, detail.holdings.holdings.length - visibleHoldings)
            })
          }}
        </button>
      </div>

      <div name="trench__detail__holdings-result" class="trench-negative-detail__result">
        <h4>{{ t('trench.analysis.result') }}</h4>
        <TrenchStructuredValue
          :value="detail.holdings.result"
          path="holdings.result"
          initially-expanded
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrenchNegativeWalletReadDetail } from '@shared/trench/trenchXpc.type';
import TrenchDocumentAction from '../TrenchDocumentAction/TrenchDocumentAction.vue';
import TrenchStructuredValue from '../TrenchStructuredValue/TrenchStructuredValue.vue';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';

const props = defineProps<{ detail: TrenchNegativeWalletReadDetail }>();
const { t, locale } = useI18n();
const pageSize = 20;
const visibleHoldings = ref(pageSize);

watch(
  () => props.detail.contentHash,
  () => {
    visibleHoldings.value = pageSize;
  }
);
</script>

<style lang="less">
@import './TrenchNegativeWalletDetail.less';
</style>
