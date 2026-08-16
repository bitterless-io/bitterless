<template>
  <section name="trench__sniping__product-detail" class="sniping-product-detail">
    <a-button
      name="trench__sniping__back-to-products"
      class="sniping-product-detail__back"
      type="text"
      size="mini"
      @click="store.setMobileDetail(false)"
    >{{ t('trench.sniping.backToProducts') }}</a-button>
    <div v-if="!store.detail" class="sniping-product-detail__empty">
      <strong>{{ t('trench.sniping.detail.selectTitle') }}</strong>
      <span>{{ t('trench.sniping.detail.selectDescription') }}</span>
    </div>
    <template v-else>
      <header name="trench__sniping__product-header" class="sniping-product-detail__header">
        <div>
          <span class="sniping-product-detail__eyebrow">{{ store.detail.chain.toUpperCase() }} · r{{ store.detail.config_revision }}</span>
          <h1>{{ store.detail.name || t('trench.sniping.detail.newProduct') }}</h1>
          <p>{{ store.selectedRelease?.description || t('trench.sniping.detail.releaseUnavailable') }}</p>
          <small>{{ t('trench.sniping.readiness.selectedRuntime') }} · {{ store.selectedRuntimeState || '—' }}</small>
        </div>
        <span class="sniping-product-detail__state" :class="`sniping-product-detail__state--${store.displayStateKey}`">
          {{ t(`trench.sniping.state.${store.displayStateKey}`) }}
        </span>
      </header>

      <p v-if="store.detailProjectionStale" class="sniping-product-detail__lock-note" role="status">
        {{ t('trench.sniping.detail.staleProjection') }}
      </p>

      <ol name="trench__sniping__qualification" class="sniping-qualification">
        <li :class="{ 'sniping-qualification__ready': store.monitorQualificationReady }">
          {{ t('trench.sniping.qualification.monitor') }}
        </li>
        <li>{{ t('trench.sniping.qualification.simulate') }}</li>
        <li class="sniping-qualification__locked">{{ t('trench.sniping.qualification.canaryLocked') }}</li>
        <li class="sniping-qualification__locked">{{ t('trench.sniping.qualification.armedLocked') }}</li>
      </ol>
      <p class="sniping-product-detail__lock-note">{{ t('trench.sniping.qualification.executionUnavailable') }}</p>

      <SnipingEvidenceRail />

      <div name="trench__sniping__detail-tabs" class="sniping-product-detail__tabs" role="tablist">
        <button
          v-for="(tab, index) in tabs"
          :key="tab"
          :id="`sniping-tab-${tab}`"
          :name="`trench__sniping__tab-${tab}`"
          type="button"
          role="tab"
          :aria-selected="store.detailTab === tab"
          :aria-controls="`sniping-panel-${tab}`"
          :tabindex="store.detailTab === tab ? 0 : -1"
          :class="{ 'sniping-product-detail__tab--active': store.detailTab === tab }"
          @click="selectTab(tab)"
          @keydown="onTabKeydown($event, index)"
        >{{ t(`trench.sniping.tabs.${tab}`) }}</button>
      </div>

      <div name="trench__sniping__detail-scroll" class="sniping-product-detail__scroll">
        <div
          v-if="store.detailTab === 'configuration'"
          id="sniping-panel-configuration"
          role="tabpanel"
          aria-labelledby="sniping-tab-configuration"
        ><SnipingConfigurationPanel /></div>
        <div
          v-else-if="store.detailTab === 'simulation'"
          id="sniping-panel-simulation"
          role="tabpanel"
          aria-labelledby="sniping-tab-simulation"
        ><SnipingSimulationPanel /></div>
        <section
          v-else
          id="sniping-panel-versions"
          name="trench__sniping__versions"
          class="sniping-versions"
          role="tabpanel"
          aria-labelledby="sniping-tab-versions"
        >
          <span>{{ t('trench.sniping.versions.current') }}</span>
          <strong>{{ store.detail.component_id }}@{{ store.detail.component_version }}</strong>
          <code>{{ store.detail.schema_hash }}</code>
          <span>{{ t('trench.sniping.versions.revision', { revision: store.detail.config_revision }) }}</span>
          <p>{{ t('trench.sniping.versions.noHistory') }}</p>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import SnipingConfigurationPanel from './SnipingConfigurationPanel.vue';
import SnipingEvidenceRail from './SnipingEvidenceRail.vue';
import SnipingSimulationPanel from './SnipingSimulationPanel.vue';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';

const { t } = useI18n();
const tabs = ['configuration', 'simulation', 'versions'] as const;
type DetailTab = (typeof tabs)[number];
const selectTab = (tab: DetailTab): void => store.setDetailTab(tab);
const focusTab = (index: number): void => {
  const tab = tabs[index];
  selectTab(tab);
  document.getElementById(`sniping-tab-${tab}`)?.focus();
};
const onTabKeydown = (event: KeyboardEvent, index: number): void => {
  let next: number | null = null;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  if (next === null) return;
  event.preventDefault();
  focusTab(next);
};
</script>
