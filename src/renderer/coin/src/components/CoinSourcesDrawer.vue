<template>
  <a-drawer
    v-model:visible="store.sourcesVisible"
    class="coin-sources-drawer"
    placement="right"
    :width="'min(520px, 100%)'"
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
        <a-button
          size="small"
          :loading="store.statusLoading"
          :disabled="store.statusLoading"
          @click="store.refreshStatus()"
        >
          <template #icon><IconRefresh :size="16" /></template>
          {{ i18nHelper.coin.sourceDrawer.refresh }}
        </a-button>
      </div>

      <div v-if="store.statusError" class="coin-sources-drawer__error" role="alert">
        {{ store.statusError }}
      </div>

      <div class="coin-sources-drawer__table-scroll" data-overlay-scrollbar>
        <table class="coin-sources-drawer__table">
          <thead>
            <tr>
              <th>{{ i18nHelper.coin.sourceDrawer.source }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.configured }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.support }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.freshness }}</th>
              <th>{{ i18nHelper.coin.sourceDrawer.lastError }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in sources" :key="source.id" name="coin__sources__row">
              <td>{{ source.name }}</td>
              <td><span class="coin-source-state">{{ i18nHelper.coin.sourceDrawer.no }}</span></td>
              <td>{{ i18nHelper.coin.sourceDrawer.pending }}</td>
              <td>—</td>
              <td>{{ source.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconDatabaseSearch, IconRefresh } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as store } from '../coinShell.store';

const sources = computed(() => [
  {
    id: 'binance-monitor',
    name: i18nHelper.coin.sourceDrawer.binance,
    reason: i18nHelper.coin.sourceDrawer.integrationRequired,
  },
  {
    id: 'coin-screener',
    name: i18nHelper.coin.sourceDrawer.screener,
    reason: i18nHelper.coin.sourceDrawer.integrationRequired,
  },
  {
    id: 'gmgn',
    name: i18nHelper.coin.sourceDrawer.gmgn,
    reason: i18nHelper.coin.sourceDrawer.integrationRequired,
  },
  {
    id: 'alchemy-bsc',
    name: i18nHelper.coin.sourceDrawer.alchemyBsc,
    reason: i18nHelper.coin.sourceDrawer.integrationRequired,
  },
  {
    id: 'alchemy-solana',
    name: i18nHelper.coin.sourceDrawer.alchemySolana,
    reason: i18nHelper.coin.sourceDrawer.integrationRequired,
  },
  {
    id: 'robinhood-chain',
    name: i18nHelper.coin.sourceDrawer.robinhood,
    reason: i18nHelper.coin.sourceDrawer.capabilityGate,
  },
]);
</script>
