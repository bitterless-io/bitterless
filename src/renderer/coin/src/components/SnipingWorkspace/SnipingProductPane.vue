<template>
  <aside name="trench__sniping__product-pane" class="sniping-product-pane">
    <section name="trench__sniping__my-products" class="sniping-product-pane__section">
      <header>
        <strong>{{ t('trench.sniping.products.myProducts') }}</strong>
        <span>{{ store.configTotal }}</span>
      </header>
      <a-input-search
        :model-value="store.configSearch"
        name="trench__sniping__product-search"
        size="small"
        :placeholder="t('trench.sniping.products.search')"
        search-button
        @update:model-value="store.setConfigSearch(String($event))"
        @search="store.searchConfigs(String($event))"
      />
      <div v-if="store.configs.length" class="sniping-product-pane__list">
        <button
          v-for="config in store.configs"
          :key="config.config_id"
          name="trench__sniping__product-row"
          class="sniping-product-pane__row"
          :class="{ 'sniping-product-pane__row--selected': store.selectedConfigId === config.config_id }"
          type="button"
          @click="store.selectConfig(config.config_id)"
        >
          <span class="sniping-product-pane__row-heading">
            <strong>{{ config.name }}</strong>
            <span :class="`sniping-product-pane__dot--${config.desired_state === 'armed' ? 'monitoring' : 'disabled'}`" />
          </span>
          <small>{{ config.desired_state === 'armed'
            ? t('trench.sniping.state.monitoring')
            : t('trench.sniping.state.disabled') }}</small>
          <small>{{ config.chain.toUpperCase() }} · r{{ config.config_revision }} · {{ config.component_version }}</small>
          <small>{{ t('trench.sniping.products.updatedAt', { time: dateTime(config.updated_at) }) }}</small>
        </button>
      </div>
      <div v-else class="sniping-product-pane__empty">
        {{ store.configSearch ? t('trench.sniping.products.noSearch') : t('trench.sniping.products.noProducts') }}
      </div>
      <SnipingPageButtons
        :page="store.configPage"
        :total="store.configTotal"
        :page-size="store.configPageSize"
        @change="store.setConfigPage"
      />
    </section>

    <section name="trench__sniping__catalog" class="sniping-product-pane__section">
      <header><strong>{{ t('trench.sniping.products.catalog') }}</strong></header>
      <article
        v-for="release in store.releases"
        :key="`${release.component_id}@${release.component_version}`"
        name="trench__sniping__catalog-row"
        class="sniping-product-pane__catalog-row"
      >
        <div>
          <strong>{{ release.title }}</strong>
          <span>{{ release.chains.map((chain) => chain.toUpperCase()).join(' · ') }} · {{ release.component_version }}</span>
        </div>
        <a-button
          name="trench__sniping__create-product"
          size="mini"
          :disabled="!release.available || !store.remoteReady"
          @click="store.startCreate(release)"
        >{{ t('trench.sniping.products.create') }}</a-button>
      </article>
      <div v-if="!store.releases.length" class="sniping-product-pane__empty">
        {{ t('trench.sniping.products.noCatalog') }}
      </div>
    </section>

    <section name="trench__sniping__roadmap" class="sniping-product-pane__section sniping-product-pane__roadmap">
      <header><strong>{{ t('trench.sniping.products.roadmap') }}</strong></header>
      <div name="trench__sniping__roadmap-launch">{{ t('trench.sniping.products.launchRoadmap') }}</div>
      <div name="trench__sniping__roadmap-copy">{{ t('trench.sniping.products.copyRoadmap') }}</div>
      <div name="trench__sniping__roadmap-twitter" class="sniping-product-pane__blocked">
        <span>{{ t('trench.sniping.products.twitter') }}</span>
        <small>{{ t('trench.sniping.products.twitterUnavailable') }}</small>
        <span aria-hidden="true">🔒</span>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import SnipingPageButtons from './SnipingPageButtons.vue';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';

const { t } = useI18n();
const dateTime = (value: string): string => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));
</script>
