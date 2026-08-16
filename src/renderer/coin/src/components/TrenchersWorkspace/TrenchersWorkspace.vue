<template>
  <main
    name="trench__trenchers"
    class="trenchers"
    :class="{ 'trenchers--detail-open': store.detailPaneRequested }"
  >
    <header name="trench__trenchers__scope" class="trenchers__scope">
      <strong>{{ t('trench.navigation.trenchers') }}</strong>
      <span aria-hidden="true">/</span>
      <span>{{ t('trench.navigation.allTraders') }}</span>
    </header>
    <div name="trench__trenchers__workspace" class="trenchers__workspace">
      <TrenchPersonList />
      <TrenchPersonDetail />
    </div>
  </main>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import TrenchPersonDetail from './TrenchPersonDetail.vue';
import TrenchPersonList from './TrenchPersonList.vue';
import { trenchPersonStore } from '../../views/trenchers/trenchPerson.runtime';

const { t } = useI18n();
const store = trenchPersonStore;
</script>

<style lang="less">
@import './TrenchersWorkspace.less';
</style>
