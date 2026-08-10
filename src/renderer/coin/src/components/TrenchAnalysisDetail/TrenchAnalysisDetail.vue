<template>
  <div name="trench__detail__analysis" class="trench-analysis-detail">
    <TrenchDocumentAction
      kind="analysis"
      :document="detail.document"
      :content-hash="detail.contentHash"
      :title="t('trench.documents.analysis')"
    />

    <section
      class="trench-analysis-detail__provenance"
      :aria-label="t('trench.analysis.provenance')"
    >
      <h3>{{ t('trench.analysis.provenance') }}</h3>
      <dl>
        <div>
          <dt>{{ t('trench.analysis.sourceKind') }}</dt>
          <dd>{{ detail.record.source.kind }}</dd>
        </div>
        <div v-if="detail.record.source.agent">
          <dt>{{ t('trench.analysis.agent') }}</dt>
          <dd>{{ detail.record.source.agent }}</dd>
        </div>
        <div v-if="detail.record.source.skill">
          <dt>{{ t('trench.analysis.skill') }}</dt>
          <dd>{{ detail.record.source.skill }}</dd>
        </div>
        <div>
          <dt>{{ t('trench.analysis.providers') }}</dt>
          <dd>
            {{
              detail.record.source.providers.length
                ? detail.record.source.providers.join(' · ')
                : t('trench.structured.none')
            }}
          </dd>
        </div>
      </dl>
    </section>

    <article
      v-for="chain in detail.record.chains"
      :key="chain.chain"
      name="trench__detail__chain"
      class="trench-analysis-detail__chain"
      :data-chain="chain.chain"
    >
      <header class="trench-analysis-detail__chain-header">
        <span>{{ chain.chain }}</span>
        <div v-if="chain.token" name="trench__detail__token">
          <strong>{{ chain.token.symbol || t('trench.analysis.symbolMissing') }}</strong>
          <small>{{ chain.token.name || t('trench.analysis.nameMissing') }}</small>
        </div>
        <div v-else name="trench__detail__token-empty" class="trench-analysis-detail__missing">
          {{ t('trench.analysis.tokenMissing') }}
        </div>
      </header>

      <section name="trench__detail__analysis-result" class="trench-analysis-detail__section">
        <h4>{{ t('trench.analysis.result') }}</h4>
        <TrenchStructuredValue
          :value="chain.result"
          :path="`chains.${chain.chain}.result`"
          initially-expanded
        />
      </section>

      <section name="trench__detail__top-wallets" class="trench-analysis-detail__section">
        <h4>
          {{ t('trench.analysis.topProfitWallets') }}
          <span>{{ chain.topProfitWallets.length }}</span>
        </h4>
        <div v-if="chain.topProfitWallets.length" class="trench-analysis-detail__rows">
          <article
            v-for="wallet in chain.topProfitWallets.slice(0, limitFor(`${chain.chain}:top`))"
            :key="wallet.address"
            name="trench__detail__top-wallet"
            class="trench-analysis-detail__wallet"
          >
            <div class="trench-analysis-detail__wallet-identity">
              <strong>#{{ wallet.rank }}</strong>
              <span>{{ wallet.address }}</span>
            </div>
            <dl>
              <div v-if="wallet.profitUsd !== undefined">
                <dt>{{ t('trench.index.profit') }}</dt>
                <dd>{{ wallet.profitUsd }}</dd>
              </div>
              <div v-if="wallet.winRate !== undefined">
                <dt>{{ t('trench.index.winRate') }}</dt>
                <dd>{{ trenchVaultStore.formatWinRate(wallet.winRate) }}</dd>
              </div>
            </dl>
            <div v-if="wallet.evidence" class="trench-analysis-detail__evidence">
              <span>{{ t('trench.analysis.evidence') }}</span>
              <TrenchStructuredValue
                :value="wallet.evidence"
                :path="`chains.${chain.chain}.topProfitWallets.${wallet.rank}.evidence`"
              />
            </div>
          </article>
          <button
            v-if="limitFor(`${chain.chain}:top`) < chain.topProfitWallets.length"
            type="button"
            class="trench-analysis-detail__more"
            @click="showMore(`${chain.chain}:top`)"
          >
            {{
              t('trench.structured.showMore', {
                count: remaining(chain.topProfitWallets.length, `${chain.chain}:top`)
              })
            }}
          </button>
        </div>
        <p v-else class="trench-analysis-detail__missing">
          {{ t('trench.analysis.noTopWallets') }}
        </p>
      </section>

      <section name="trench__detail__index-exposure" class="trench-analysis-detail__section">
        <h4>{{ t('trench.analysis.indexExposure') }}</h4>
        <p v-if="chain.indexWalletExposure === undefined" class="trench-analysis-detail__missing">
          {{ t('trench.analysis.notRecorded') }}
        </p>
        <p
          v-else-if="chain.indexWalletExposure.length === 0"
          class="trench-analysis-detail__missing"
        >
          {{ t('trench.analysis.noExposureRows') }}
        </p>
        <div v-else class="trench-analysis-detail__rows">
          <article
            v-for="exposure in chain.indexWalletExposure.slice(0, limitFor(`${chain.chain}:index`))"
            :key="exposure.address"
            name="trench__detail__exposure-row"
            class="trench-analysis-detail__exposure"
          >
            <ExposureContent
              :exposure="exposure"
              :path="`chains.${chain.chain}.indexWalletExposure.${exposure.address}`"
              :reference-status="referenceStatus('index-wallet', chain.chain, exposure.address)"
            />
          </article>
          <button
            v-if="limitFor(`${chain.chain}:index`) < chain.indexWalletExposure.length"
            type="button"
            class="trench-analysis-detail__more"
            @click="showMore(`${chain.chain}:index`)"
          >
            {{
              t('trench.structured.showMore', {
                count: remaining(chain.indexWalletExposure.length, `${chain.chain}:index`)
              })
            }}
          </button>
        </div>
      </section>

      <section name="trench__detail__negative-exposure" class="trench-analysis-detail__section">
        <h4>{{ t('trench.analysis.negativeExposure') }}</h4>
        <p
          v-if="chain.negativeWalletExposure === undefined"
          class="trench-analysis-detail__missing"
        >
          {{ t('trench.analysis.notRecorded') }}
        </p>
        <p
          v-else-if="chain.negativeWalletExposure.length === 0"
          class="trench-analysis-detail__missing"
        >
          {{ t('trench.analysis.noExposureRows') }}
        </p>
        <div v-else class="trench-analysis-detail__rows">
          <article
            v-for="exposure in chain.negativeWalletExposure.slice(
              0,
              limitFor(`${chain.chain}:negative`)
            )"
            :key="exposure.address"
            name="trench__detail__exposure-row"
            class="trench-analysis-detail__exposure"
          >
            <ExposureContent
              :exposure="exposure"
              :path="`chains.${chain.chain}.negativeWalletExposure.${exposure.address}`"
              :reference-status="referenceStatus('negative-wallet', chain.chain, exposure.address)"
            />
          </article>
          <button
            v-if="limitFor(`${chain.chain}:negative`) < chain.negativeWalletExposure.length"
            type="button"
            class="trench-analysis-detail__more"
            @click="showMore(`${chain.chain}:negative`)"
          >
            {{
              t('trench.structured.showMore', {
                count: remaining(chain.negativeWalletExposure.length, `${chain.chain}:negative`)
              })
            }}
          </button>
        </div>
      </section>
    </article>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h, reactive, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  TrenchChain,
  TrenchExposureReferenceStatus,
  TrenchWalletExposure
} from '@shared/trench/trench.type';
import type { TrenchAnalysisDetail as TrenchAnalysisDetailValue } from '@shared/trench/trenchXpc.type';
import TrenchDocumentAction from '../TrenchDocumentAction/TrenchDocumentAction.vue';
import TrenchStructuredValue from '../TrenchStructuredValue/TrenchStructuredValue.vue';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';

const props = defineProps<{ detail: TrenchAnalysisDetailValue }>();
const { t } = useI18n();
const limits = reactive<Record<string, number>>({});
const pageSize = 20;

const limitFor = (key: string): number => limits[key] ?? pageSize;
const showMore = (key: string): void => {
  limits[key] = limitFor(key) + pageSize;
};
const remaining = (total: number, key: string): number => Math.min(pageSize, total - limitFor(key));
const referenceStatus = (
  kind: TrenchExposureReferenceStatus['kind'],
  chain: TrenchChain,
  address: string
): TrenchExposureReferenceStatus['status'] | null =>
  props.detail.references.find(
    (reference) =>
      reference.kind === kind && reference.chain === chain && reference.address === address
  )?.status ?? null;

const ExposureContent = defineComponent({
  name: 'TrenchExposureContent',
  props: {
    exposure: { type: Object as PropType<TrenchWalletExposure>, required: true },
    path: { type: String, required: true },
    referenceStatus: {
      type: String as PropType<TrenchExposureReferenceStatus['status'] | null>,
      default: null
    }
  },
  setup(componentProps) {
    return () =>
      h('div', { class: 'trench-analysis-detail__exposure-content' }, [
        h('div', { class: 'trench-analysis-detail__wallet-identity' }, [
          h('span', componentProps.exposure.address),
          h('strong', t(trenchVaultStore.holdingMessageKey(componentProps.exposure.holding))),
          componentProps.referenceStatus
            ? h(
                'em',
                {
                  class:
                    componentProps.referenceStatus === 'active'
                      ? 'trench-analysis-detail__reference--active'
                      : 'trench-analysis-detail__reference--retired'
                },
                t(`trench.analysis.reference.${componentProps.referenceStatus}`)
              )
            : null
        ]),
        h('dl', [
          componentProps.exposure.balance !== undefined
            ? h('div', [
                h('dt', t('trench.index.balance')),
                h('dd', componentProps.exposure.balance)
              ])
            : null,
          componentProps.exposure.sharePercent !== undefined
            ? h('div', [
                h('dt', t('trench.index.share')),
                h('dd', `${componentProps.exposure.sharePercent}%`)
              ])
            : null,
          componentProps.exposure.valueUsd !== undefined
            ? h('div', [
                h('dt', t('trench.index.value')),
                h('dd', String(componentProps.exposure.valueUsd))
              ])
            : null
        ]),
        componentProps.exposure.evidence
          ? h('div', { class: 'trench-analysis-detail__evidence' }, [
              h('span', t('trench.analysis.evidence')),
              h(TrenchStructuredValue, {
                value: componentProps.exposure.evidence,
                path: `${componentProps.path}.evidence`
              })
            ])
          : null
      ]);
  }
});
</script>

<style lang="less">
@import './TrenchAnalysisDetail.less';
</style>
