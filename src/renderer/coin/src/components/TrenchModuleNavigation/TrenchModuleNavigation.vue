<template>
  <aside name="trench__module-navigation" class="trench-module-navigation">
    <a-menu
      name="trench__module-navigation__menu"
      class="trench-module-navigation__menu"
      mode="vertical"
      :selected-keys="[navigation.selectedKey]"
      :default-open-keys="['index', 'trenchers', 'sniping', 'monitoring']"
      :auto-open="true"
      :auto-open-selected="true"
      @menu-item-click="selectMenuItem"
    >
      <a-sub-menu key="index" name="trench__module-navigation__index">
        <template #title>INDEX</template>
        <a-menu-item key="index:solana" name="trench__module-navigation__sol">SOL</a-menu-item>
        <a-menu-item key="index:bsc" name="trench__module-navigation__bsc">BSC</a-menu-item>
        <a-menu-item key="index:robinhood" name="trench__module-navigation__robinhood">
          {{ t('trench.navigation.robinhood') }}
        </a-menu-item>
      </a-sub-menu>
      <a-sub-menu key="trenchers" name="trench__module-navigation__trenchers">
        <template #title>{{ t('trench.navigation.trenchers') }}</template>
        <a-menu-item key="trenchers:all" name="trench__module-navigation__all-traders">
          {{ t('trench.navigation.allTraders') }}
        </a-menu-item>
      </a-sub-menu>
      <a-sub-menu key="sniping" name="trench__module-navigation__sniping">
        <template #title>{{ t('trench.navigation.sniping') }}</template>
        <a-menu-item key="sniping:products" name="trench__module-navigation__sniping-products">
          {{ t('trench.navigation.products') }}
        </a-menu-item>
        <a-menu-item key="sniping:activity" name="trench__module-navigation__sniping-activity">
          {{ t('trench.navigation.activity') }}
        </a-menu-item>
      </a-sub-menu>
      <a-sub-menu key="monitoring" name="monitoring__navigation">
        <template #title>{{ t('trench.navigation.monitoring') }}</template>
        <a-menu-item key="monitoring:watches" name="monitoring__navigation__watches">
          {{ t('trench.navigation.watches') }}
        </a-menu-item>
        <a-menu-item key="monitoring:anomalies" name="monitoring__navigation__anomalies">
          {{ t('trench.navigation.anomalies') }}
        </a-menu-item>
      </a-sub-menu>
    </a-menu>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { createTrenchNavigationMenuItemHandler } from '../../views/navigation/trenchNavigation.store';
import { trenchNavigationStore as navigation } from '../../views/navigation/trenchNavigation.runtime';

const { t } = useI18n();
const selectMenuItem = createTrenchNavigationMenuItemHandler(navigation);
</script>

<style lang="less">
@import './TrenchModuleNavigation.less';
</style>
