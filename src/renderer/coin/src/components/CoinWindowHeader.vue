<template>
  <header
    name="coin__windowHeader"
    class="coin-window-header"
    :class="{ 'coin-window-header--mac': platform === 'darwin' }"
  >
    <div name="coin__windowHeader__identity" class="coin-window-header__identity">
      <IconCoins :size="19" stroke-width="1.8" aria-hidden="true" />
      <strong>{{ i18nHelper.coin.productName }}</strong>
    </div>

    <div name="coin__windowHeader__context" class="coin-window-header__context" aria-live="polite">
      {{ activeContext }}
    </div>

    <div name="coin__windowHeader__actions" class="coin-window-header__actions">
      <a-tooltip :content="xBrowserModeTooltip" position="bottom">
        <div
          name="coin__windowHeader__xBrowserMode"
          class="coin-window-header__browser-mode"
          :class="{ 'coin-window-header__browser-mode--visible': xBrowserVisible }"
        >
          <IconEye v-if="xBrowserVisible" :size="15" stroke-width="1.8" aria-hidden="true" />
          <IconEyeOff v-else :size="15" stroke-width="1.8" aria-hidden="true" />
          <a-switch
            :model-value="xBrowserVisible"
            size="small"
            :aria-label="xBrowserModeTooltip"
            :disabled="xBrowser.loading || xBrowser.status.mode === 'cdp'"
            @change="handleXBrowserModeChange"
          />
        </div>
      </a-tooltip>

      <a-tooltip :content="i18nHelper.coin.window.sourceStatus" position="bottom">
        <button
          name="coin__windowHeader__sources"
          class="coin-window-header__status-button"
          :class="{ 'coin-window-header__status-button--active': store.sourcesVisible }"
          type="button"
          :aria-label="i18nHelper.coin.window.sourceStatus"
          :aria-pressed="store.sourcesVisible"
          :disabled="sourceLoading"
          @click="store.openSources()"
        >
          <a-spin v-if="sourceLoading" :size="12" />
          <IconDatabase v-else-if="sourceReadyCount" :size="16" stroke-width="1.8" aria-hidden="true" />
          <IconDatabaseOff v-else :size="16" stroke-width="1.8" aria-hidden="true" />
          <span class="coin-window-header__status-dot" :class="sourceDotClass" aria-hidden="true"></span>
        </button>
      </a-tooltip>

      <div name="coin__windowHeader__controls" class="coin-window-header__controls">
        <a-tooltip :content="i18nHelper.coin.window.minimize" position="bottom">
          <button
            name="coin__windowHeader__minimize"
            class="coin-window-header__control"
            type="button"
            :aria-label="i18nHelper.coin.window.minimize"
            :disabled="!!store.pendingWindowAction"
            @click="store.minimize()"
          >
            <a-spin v-if="store.pendingWindowAction === 'minimize'" :size="12" />
            <IconMinus v-else :size="17" stroke-width="1.8" aria-hidden="true" />
          </button>
        </a-tooltip>
        <a-tooltip :content="i18nHelper.coin.window.maximize" position="bottom">
          <button
            name="coin__windowHeader__maximize"
            class="coin-window-header__control"
            type="button"
            :aria-label="i18nHelper.coin.window.maximize"
            :disabled="!!store.pendingWindowAction"
            @click="store.toggleMaximize()"
          >
            <a-spin v-if="store.pendingWindowAction === 'maximize'" :size="12" />
            <IconSquare v-else :size="14" stroke-width="1.8" aria-hidden="true" />
          </button>
        </a-tooltip>
        <a-tooltip :content="i18nHelper.coin.window.close" position="bottom">
          <button
            name="coin__windowHeader__close"
            class="coin-window-header__control coin-window-header__control--close"
            type="button"
            :aria-label="i18nHelper.coin.window.close"
            :disabled="!!store.pendingWindowAction"
            @click="store.close()"
          >
            <a-spin v-if="store.pendingWindowAction === 'close'" :size="12" />
            <IconX v-else :size="17" stroke-width="1.8" aria-hidden="true" />
          </button>
        </a-tooltip>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconCoins,
  IconDatabase,
  IconDatabaseOff,
  IconEye,
  IconEyeOff,
  IconMinus,
  IconSquare,
  IconX,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as store } from '../coinShell.store';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';
import { coinXBrowserStore as xBrowser } from '../views/analysis/coinXBrowser.store';
import { coinResourcesStore as resources } from '../views/resources/coinResources.store';

defineProps<{
  platform: 'darwin' | 'win32' | 'other';
}>();

const sourceTotal = computed(() => workspace.sourceStatuses.filter((source) => source.configured).length);
const sourceReadyCount = computed(() => workspace.sourceStatuses.filter((source) => source.configured && ['ready', 'partial', 'stale'].includes(source.state)).length);
const sourceLoading = computed(() => workspace.sourceLoading || store.statusLoading || resources.statusLoading);
const xBrowserVisible = computed(() => workspace.data.xBrowser.displayMode === 'visible');
const xBrowserModeTooltip = computed(() => {
  if (xBrowser.status.mode === 'cdp') return i18nHelper.coin.trench.xBrowser.displayMode.external;
  return xBrowserVisible.value
    ? i18nHelper.coin.trench.xBrowser.displayMode.visible
    : i18nHelper.coin.trench.xBrowser.displayMode.hidden;
});
const sourceDotClass = computed(() => ({
  'coin-window-header__status-dot--ready': sourceTotal.value > 0 && sourceReadyCount.value === sourceTotal.value,
  'coin-window-header__status-dot--danger': Boolean(workspace.sourceError || resources.statusError),
}));
const activeContext = computed(() => {
  const result = workspace.memeAnalysis;
  if (result) {
    const label = result.asset.symbol.value || result.asset.name.value || result.asset.contractAddress;
    return `${result.asset.chain.toUpperCase()} · ${label}`;
  }
  const address = workspace.data.drafts.meme.contractAddress.trim();
  return address ? `${workspace.data.drafts.meme.chain.toUpperCase()} · ${address}` : '';
});

const handleXBrowserModeChange = (value: boolean | string | number): void => {
  void workspace.setXBrowserDisplayMode(value === true ? 'visible' : 'hidden');
};
</script>
