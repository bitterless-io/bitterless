<template>
  <section name="trench__sniping" class="sniping-workspace">
    <header name="trench__sniping__workspace-header" class="sniping-workspace__header">
      <div>
        <span>SNIPING / {{ scope.toUpperCase() }}</span>
        <p>{{ scope === 'products'
          ? t('trench.sniping.workspace.productsDescription')
          : t('trench.sniping.workspace.activityDescription') }}</p>
      </div>
      <span class="sniping-workspace__boundary">{{ t('trench.sniping.workspace.readOnlyBoundary') }}</span>
    </header>
    <SnipingProductsWorkspace v-if="scope === 'products'" />
    <SnipingActivityWorkspace v-else />
  </section>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import SnipingActivityWorkspace from './SnipingActivityWorkspace.vue';
import SnipingProductsWorkspace from './SnipingProductsWorkspace.vue';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';

const props = defineProps<{ scope: 'products' | 'activity' }>();
const { t } = useI18n();
watch(
  () => props.scope,
  (scope) => {
    if (scope === 'products') void store.initialize();
    else void store.refreshActivity();
  },
  { immediate: true },
);
</script>

<style lang="less">
@import './SnipingWorkspace.less';
</style>
