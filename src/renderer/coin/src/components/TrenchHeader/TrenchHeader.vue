<template>
  <header
    name="trench__header"
    class="trench-header"
    :class="{
      'trench-header--mac': host.platform === 'darwin' && host.host === 'standalone',
      'trench-header--embedded': host.host === 'omni'
    }"
  >
    <span class="trench-header__title">Trench</span>
    <div name="trench__header__actions" class="trench-header__actions">
      <div class="trench-header__status" role="status" aria-live="polite" :title="statusText">
        <span
          class="trench-header__status-dot"
          :class="{
            'trench-header__status-dot--pending':
              currentList.phase === 'loading' || currentList.phase === 'refreshing' || analyzing,
            'trench-header__status-dot--error': currentList.phase === 'unavailable'
          }"
          aria-hidden="true"
        />
        <span class="trench-header__status-label">{{ statusText }}</span>
      </div>
      <a-tooltip :content="t('trench.agentGuide.trigger')" position="br" mini>
        <a-button
          name="trench__header__agent-guide"
          class="trench-header__agent-guide"
          size="mini"
          type="text"
          :title="t('trench.agentGuide.trigger')"
          :aria-label="t('trench.agentGuide.trigger')"
          @click="trenchAgentGuideStore.open()"
        >
          <template #icon>
            <IconRobot aria-hidden="true" />
          </template>
        </a-button>
      </a-tooltip>
      <a-tooltip :content="t('trench.actions.refresh')" position="br" mini>
        <a-button
          name="trench__header__refresh"
          class="trench-header__refresh"
          size="mini"
          type="text"
          :loading="refreshPending"
          :disabled="refreshPending"
          :title="t('trench.actions.refresh')"
          :aria-label="t('trench.actions.refresh')"
          @click="refreshActiveModule"
        >
          <template #icon>
            <IconRefresh aria-hidden="true" />
          </template>
        </a-button>
      </a-tooltip>
      <a-tooltip :content="t('trench.gmgnSettings.trigger')" position="br" mini>
        <a-button
          name="trench__header__gmgn-settings"
          class="trench-header__gmgn-settings"
          size="mini"
          type="text"
          :title="t('trench.gmgnSettings.trigger')"
          :aria-label="t('trench.gmgnSettings.trigger')"
          @click="trenchGmgnSettingsStore.open()"
        >
          <template #icon>
            <IconSettings aria-hidden="true" />
          </template>
        </a-button>
      </a-tooltip>
    </div>
  </header>
  <TrenchAgentGuideModal />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconRefresh, IconRobot, IconSettings } from '@tabler/icons-vue';
import TrenchAgentGuideModal from '../TrenchAgentGuideModal/TrenchAgentGuideModal.vue';
import { trenchGmgnSettingsStore } from '../TrenchGmgnSettings/trenchGmgnSettings.runtime';
import { trenchHost } from '../../contextBridge/trenchHost.bridge';
import { trenchAgentGuideStore } from '../../views/vault/trenchAgentGuide.runtime';
import { trenchIndexStore } from '../../views/index/trenchIndex.runtime';
import { trenchNavigationStore } from '../../views/navigation/trenchNavigation.runtime';
import { snipingStore } from '../../views/sniping/sniping.runtime';
import { trenchPersonStore } from '../../views/trenchers/trenchPerson.runtime';
import { monitoringStore } from '../../views/monitoring/monitoring.runtime';

const { t } = useI18n();
const host = trenchHost;
const currentList = computed(() => {
  if (trenchNavigationStore.module === 'index') return { phase: trenchIndexStore.phase };
  if (trenchNavigationStore.module === 'trenchers') return { phase: trenchPersonStore.phase };
  if (trenchNavigationStore.module === 'monitoring') {
    const scope = trenchNavigationStore.monitoringScope;
    const pending =
      scope === 'anomalies'
        ? monitoringStore.anomalyLoading || monitoringStore.anomalyOptionsLoading
        : monitoringStore.workspaceRefreshLoading ||
          monitoringStore.watchesLoading ||
          monitoringStore.detailLoading;
    const error =
      scope === 'anomalies'
        ? (monitoringStore.errors.anomalies ?? monitoringStore.errors.anomalyOptions)
        : (monitoringStore.errors.list ?? monitoringStore.errors.detail);
    const phase =
      scope === 'anomalies'
        ? pending
          ? 'refreshing'
          : error
            ? 'unavailable'
            : monitoringStore.anomaliesInitialized
              ? monitoringStore.anomalies.length
                ? 'ready'
                : 'empty'
              : 'idle'
        : pending
          ? 'refreshing'
          : error
            ? 'unavailable'
            : monitoringStore.phase;
    return { phase };
  }
  if (trenchNavigationStore.snipingScope === 'products')
    return {
      phase: snipingStore.workspaceRefreshing
        ? 'refreshing'
        : snipingStore.productsErrorCode
          ? 'unavailable'
          : snipingStore.phase
    };
  return {
    phase: snipingStore.activityLoading
      ? 'refreshing'
      : snipingStore.activityErrorCode
        ? 'unavailable'
        : 'ready'
  };
});
const analyzing = computed(
  () =>
    trenchNavigationStore.module === 'index' && trenchIndexStore.snapshot?.jobState === 'running'
);
const refreshPending = computed(
  () => currentList.value.phase === 'loading' || currentList.value.phase === 'refreshing'
);
const statusText = computed(() => {
  if (trenchNavigationStore.module === 'monitoring') {
    const error =
      trenchNavigationStore.monitoringScope === 'anomalies'
        ? (monitoringStore.errors.anomalies ?? monitoringStore.errors.anomalyOptions)
        : (monitoringStore.errors.list ?? monitoringStore.errors.detail);
    if (error === 'SNIPING_SESSION_REQUIRED') return t('trench.monitoring.header.sessionRequired');
    if (currentList.value.phase === 'loading' || currentList.value.phase === 'refreshing') {
      return t('trench.monitoring.header.refreshing');
    }
    if (currentList.value.phase === 'unavailable') return t('trench.monitoring.header.unavailable');
    return t('trench.monitoring.header.connected');
  }
  if (trenchNavigationStore.module === 'sniping') {
    const scopedError =
      trenchNavigationStore.snipingScope === 'products'
        ? snipingStore.productsErrorCode
        : snipingStore.activityErrorCode;
    if (scopedError === 'SNIPING_SESSION_REQUIRED') {
      return t('trench.sniping.header.sessionRequired');
    }
    if (currentList.value.phase === 'loading' || currentList.value.phase === 'refreshing') {
      return t('trench.sniping.header.refreshing');
    }
    if (currentList.value.phase === 'unavailable') return t('trench.sniping.header.unavailable');
    return t('trench.sniping.header.connected');
  }
  if (currentList.value.phase === 'loading') return t('trench.header.loading');
  if (currentList.value.phase === 'refreshing') return t('trench.header.refreshing');
  if (currentList.value.phase === 'unavailable') {
    return t('trench.header.unavailable');
  }
  if (analyzing.value) return t('trench.header.analyzing');
  return t('trench.header.local');
});
const refreshActiveModule = (): void => {
  if (trenchNavigationStore.module === 'index') {
    void trenchIndexStore.refresh();
    return;
  }
  if (trenchNavigationStore.module === 'trenchers') {
    void trenchPersonStore.refresh();
    return;
  }
  if (trenchNavigationStore.module === 'monitoring') {
    void monitoringStore.refreshSelectedScope(trenchNavigationStore.monitoringScope);
    return;
  }
  if (trenchNavigationStore.snipingScope === 'products') void snipingStore.refreshWorkspace();
  else void snipingStore.refreshActivity();
};
</script>

<style lang="less">
@import './TrenchHeader.less';
</style>
