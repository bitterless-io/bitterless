<template>
  <main name="trench__workspace" class="trench-record-workspace">
    <div
      v-if="currentList.phase === 'unavailable' || currentList.phase === 'error'"
      name="trench__repository__error"
      class="trench-record-workspace__repository-error"
      role="alert"
    >
      <span>{{ currentList.error?.message || t('trench.states.repositoryError') }}</span>
      <button name="trench__repository__retry" type="button" @click="trenchVaultStore.refresh()">
        {{ t('trench.actions.retry') }}
      </button>
    </div>
    <div
      id="trench-record-panel"
      class="trench-record-workspace__panes"
      role="tabpanel"
      :aria-label="t(`trench.modules.${moduleLabelKey}`)"
    >
      <TrenchRecordList />
      <TrenchRecordDetail />
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import TrenchRecordDetail from '../TrenchRecordDetail/TrenchRecordDetail.vue';
import TrenchRecordList from '../TrenchRecordList/TrenchRecordList.vue';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';

const { t } = useI18n();
const currentList = computed(() => trenchVaultStore.currentList);
const moduleLabelKey = computed(() => trenchVaultStore.module === 'ca'
  ? 'ca'
  : trenchVaultStore.module === 'index-wallets'
    ? 'index'
    : 'negative');
</script>

<style lang="less">
@import './TrenchRecordWorkspace.less';
</style>
