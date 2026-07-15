<template>
  <main id="coin-analysis-pane" name="coin__analysisPane" class="coin-analysis-pane">
    <a-tabs
      :active-key="store.resourcesActive ? '' : store.activeTab"
      class="coin-analysis-tabs"
      :class="{ 'coin-analysis-tabs--resources': store.resourcesActive }"
      type="line"
      :animation="false"
      @change="handleTabChange"
    >
      <template #extra>
        <button
          name="coin__resourcesNav"
          class="coin-resources-nav"
          :class="{ 'coin-resources-nav--active': store.resourcesActive }"
          type="button"
          :aria-pressed="store.resourcesActive"
          @click="store.openResources()"
        >
          <IconSettings :size="15" stroke-width="1.8" aria-hidden="true" />
          <span>{{ i18nHelper.coin.resources }}</span>
        </button>
      </template>

      <a-tab-pane key="monitor" :title="i18nHelper.coin.tabs.monitor">
        <section name="coin__monitor" class="coin-workspace-view">
          <div name="coin__monitor__toolbar" class="coin-workspace-toolbar">
            <label class="coin-control-group coin-control-group--wide">
              <span>{{ i18nHelper.coin.workspace.monitorInput }}</span>
              <a-input
                :placeholder="i18nHelper.coin.workspace.monitorPlaceholder"
                size="small"
                disabled
              />
            </label>
            <label class="coin-control-group">
              <span>{{ i18nHelper.coin.workspace.sort }}</span>
              <a-select :model-value="'low_multiple'" size="small" disabled>
                <a-option value="low_multiple">{{ i18nHelper.coin.workspace.lowMultiple }}</a-option>
              </a-select>
            </label>
            <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
              <template #icon><IconRefresh :size="16" /></template>
              {{ i18nHelper.coin.workspace.refresh }}
            </a-button>
          </div>
          <CoinEvidenceStrip />
          <div class="coin-workspace-view__body" data-overlay-scrollbar>
            <CoinUnavailableState
              :title="i18nHelper.coin.workspace.monitorTitle"
              @open-sources="store.openSources()"
            />
          </div>
        </section>
      </a-tab-pane>

      <a-tab-pane key="screener" :title="i18nHelper.coin.tabs.screener">
        <section name="coin__screener" class="coin-workspace-view">
          <div name="coin__screener__toolbar" class="coin-workspace-toolbar">
            <label class="coin-control-group coin-control-group--fill">
              <span>{{ i18nHelper.coin.workspace.screenerInput }}</span>
              <a-input
                :placeholder="i18nHelper.coin.workspace.screenerPlaceholder"
                size="small"
                disabled
              />
            </label>
            <a-button size="small" disabled :title="i18nHelper.coin.unavailable">
              {{ i18nHelper.coin.workspace.parse }}
            </a-button>
            <a-button type="primary" size="small" disabled :title="i18nHelper.coin.unavailable">
              {{ i18nHelper.coin.workspace.screen }}
            </a-button>
          </div>
          <CoinEvidenceStrip />
          <div class="coin-workspace-view__body" data-overlay-scrollbar>
            <CoinUnavailableState
              :title="i18nHelper.coin.workspace.screenerTitle"
              @open-sources="store.openSources()"
            />
          </div>
        </section>
      </a-tab-pane>

      <a-tab-pane key="meme" :title="i18nHelper.coin.tabs.meme">
        <section name="coin__meme" class="coin-workspace-view">
          <div name="coin__meme__toolbar" class="coin-workspace-toolbar">
            <a-radio-group v-model="store.memeMode" type="button" size="small">
              <a-radio value="discover">{{ i18nHelper.coin.workspace.discover }}</a-radio>
              <a-radio value="analyze">{{ i18nHelper.coin.workspace.analyze }}</a-radio>
            </a-radio-group>
            <label class="coin-control-group">
              <span>{{ i18nHelper.coin.workspace.chain }}</span>
              <a-select :model-value="'bsc'" size="small" disabled>
                <a-option value="bsc">BSC</a-option>
              </a-select>
            </label>
            <label v-if="store.memeMode === 'analyze'" class="coin-control-group coin-control-group--fill">
              <span>{{ i18nHelper.coin.workspace.contractAddress }}</span>
              <a-input placeholder="0x..." size="small" disabled />
            </label>
            <a-button type="primary" size="small" disabled :title="i18nHelper.coin.unavailable">
              {{ store.memeMode === 'discover' ? i18nHelper.coin.workspace.discover : i18nHelper.coin.workspace.analyze }}
            </a-button>
          </div>
          <CoinEvidenceStrip />
          <div class="coin-workspace-view__body" data-overlay-scrollbar>
            <CoinUnavailableState
              :title="i18nHelper.coin.workspace.memeTitle"
              @open-sources="store.openSources()"
            />
          </div>
        </section>
      </a-tab-pane>

      <a-tab-pane key="strategy" :title="i18nHelper.coin.tabs.strategy">
        <section name="coin__strategy" class="coin-workspace-view">
          <div name="coin__strategy__toolbar" class="coin-workspace-toolbar">
            <label class="coin-control-group coin-control-group--wide">
              <span>{{ i18nHelper.coin.workspace.asset }}</span>
              <a-input placeholder="BTCUSDT / 0x..." size="small" disabled />
            </label>
            <label class="coin-control-group">
              <span>{{ i18nHelper.coin.workspace.riskBudget }}</span>
              <a-input-number :model-value="undefined" size="small" disabled />
            </label>
            <a-button type="primary" size="small" disabled :title="i18nHelper.coin.unavailable">
              {{ i18nHelper.coin.workspace.evaluate }}
            </a-button>
          </div>
          <CoinEvidenceStrip />
          <div class="coin-workspace-view__body" data-overlay-scrollbar>
            <CoinUnavailableState
              :title="i18nHelper.coin.workspace.strategyTitle"
              @open-sources="store.openSources()"
            />
          </div>
        </section>
      </a-tab-pane>

      <a-tab-pane key="history" :title="i18nHelper.coin.tabs.history">
        <section name="coin__history" class="coin-workspace-view">
          <div name="coin__history__toolbar" class="coin-workspace-toolbar">
            <label class="coin-control-group">
              <span>{{ i18nHelper.coin.workspace.type }}</span>
              <a-select :model-value="'all'" size="small" disabled>
                <a-option value="all">{{ i18nHelper.coin.workspace.all }}</a-option>
              </a-select>
            </label>
            <label class="coin-control-group coin-control-group--fill">
              <span>{{ i18nHelper.coin.workspace.search }}</span>
              <a-input :placeholder="i18nHelper.coin.workspace.historySearch" size="small" disabled />
            </label>
          </div>
          <div class="coin-workspace-view__body" data-overlay-scrollbar>
            <section class="coin-history-empty" aria-live="polite">
              <IconHistoryOff :size="24" stroke-width="1.6" aria-hidden="true" />
              <h2>{{ i18nHelper.coin.workspace.noHistory }}</h2>
              <p>{{ i18nHelper.coin.workspace.historyDescription }}</p>
            </section>
          </div>
        </section>
      </a-tab-pane>
    </a-tabs>

    <CoinResourcesView v-if="store.resourcesActive" />
    <CoinSourcesDrawer />
  </main>
</template>

<script setup lang="ts">
import { IconHistoryOff, IconRefresh, IconSettings } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as store } from '../coinShell.store';
import type { CoinTab } from '../coinShell.type';
import CoinEvidenceStrip from './CoinEvidenceStrip.vue';
import CoinResourcesView from './CoinResourcesView.vue';
import CoinSourcesDrawer from './CoinSourcesDrawer.vue';
import CoinUnavailableState from './CoinUnavailableState.vue';

const handleTabChange = (key: string | number): void => {
  store.openTab(key as CoinTab);
};
</script>
