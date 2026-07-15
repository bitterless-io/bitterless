<template>
  <a-drawer
    v-model:visible="shell.sourcesVisible"
    class="coin-sources-drawer"
    placement="right"
    :width="'min(760px, 100%)'"
    :footer="false"
    :mask-closable="true"
    popup-container="#coin-analysis-pane"
    unmount-on-close
  >
    <template #title>
      <div name="coin__sources__title" class="coin-sources-drawer__title">
        <IconDatabaseSearch :size="18" stroke-width="1.8" aria-hidden="true" />
        <span>{{ i18nHelper.coin.sourceDrawer.title }}</span>
      </div>
    </template>

    <div name="coin__sources__body" class="coin-sources-drawer__body">
      <div class="coin-sources-drawer__intro">
        <p>{{ i18nHelper.coin.sourceDrawer.description }}</p>
        <a-button size="small" @click="shell.openResources()">
          <template #icon><IconSettings :size="15" /></template>
          {{ i18nHelper.coin.resources }}
        </a-button>
        <a-button size="small" :loading="statusLoading" :disabled="statusLoading" @click="refresh">
          <template #icon><IconRefresh :size="15" /></template>
          {{ i18nHelper.coin.sourceDrawer.refresh }}
        </a-button>
      </div>

      <div v-if="statusError" class="coin-sources-drawer__error" role="alert">{{ statusError }}</div>

      <CoinResultState
        v-if="!statusLoading && workspace.sourceStatuses.length === 0"
        kind="unavailable"
        :title="i18nHelper.coin.analysis.states.sourcesUnavailable"
        :detail="workspace.sourceError || i18nHelper.coin.analysis.states.sourcesUnavailableDetail"
      />

      <div v-else class="coin-sources-drawer__table-scroll" data-overlay-scrollbar>
        <table class="coin-sources-drawer__table">
          <thead>
            <tr>
              <th>{{ i18nHelper.coin.sourceDrawer.source }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.configured }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.support }}</th>
              <th>{{ i18nHelper.coin.analysis.columns.state }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.freshness }}</th>
              <th>{{ i18nHelper.coin.analysis.labels.cooldown }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.lastError }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in workspace.sourceStatuses" :key="source.source" name="coin__sources__row">
              <td>{{ sourceName(source.source) }}</td>
              <td>{{ source.configured ? i18nHelper.coin.sourceDrawer.yes : i18nHelper.coin.sourceDrawer.no }}</td>
              <td>{{ supportLabel(source.support) }}</td>
              <td><span class="coin-source-state" :class="`coin-source-state--${source.state}`">{{ stateLabel(source.state) }}</span></td>
              <td>{{ formatTime(source.lastObservedAt) }}</td>
              <td>{{ formatCooldown(source.cooldownUntil) }}</td>
              <td>{{ source.reason || none }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import dayjs from 'dayjs';
import { IconDatabaseSearch, IconRefresh, IconSettings } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { CoinDataSourceStatus, CoinReceiptState, CoinSourceId } from '@shared/coin/coinAnalysis.type';
import { coinShellStore as shell } from '../coinShell.store';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';
import { coinResourcesStore as resources } from '../views/resources/coinResources.store';
import CoinResultState from '../views/analysis/CoinResultState.vue';

const none = i18nHelper.coin.sourceDrawer.none;
const statusLoading = computed(() => workspace.sourceLoading || shell.statusLoading || resources.statusLoading);
const statusError = computed(() => workspace.sourceError || shell.statusError || resources.statusError);
const formatTime = (value: number | null): string => value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : none;
const formatCooldown = (value: number | null): string => value && value > Date.now() ? dayjs(value).format('HH:mm:ss') : none;
const sourceName = (source: CoinSourceId): string => i18nHelper.coin.analysis.sourceNames[source];
const supportLabel = (support: CoinDataSourceStatus['support']): string => i18nHelper.coin.analysis.support[support];
const stateLabel = (state: CoinReceiptState): string => i18nHelper.coin.analysis.receiptStates[state];
const refresh = (): void => {
  void Promise.all([workspace.refreshSources(), shell.refreshStatuses()]);
};
watch(() => shell.sourcesVisible, (visible) => {
  if (visible) refresh();
});
</script>
