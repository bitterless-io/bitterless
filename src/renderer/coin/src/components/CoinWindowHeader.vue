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
      {{ i18nHelper.coin.noActiveJobs }}
    </div>

    <div name="coin__windowHeader__actions" class="coin-window-header__actions">
      <a-tooltip :content="i18nHelper.coin.window.sourceStatus" position="bottom">
        <button
          name="coin__windowHeader__sources"
          class="coin-window-header__status-button"
          :class="{ 'coin-window-header__status-button--active': store.sourcesVisible }"
          type="button"
          :aria-pressed="store.sourcesVisible"
          :disabled="store.statusLoading"
          @click="store.openSources()"
        >
          <a-spin v-if="store.statusLoading" :size="12" />
          <IconDatabaseOff v-else :size="16" stroke-width="1.8" aria-hidden="true" />
          <span>{{ i18nHelper.coin.sources }}</span>
          <span class="coin-window-header__status-dot" aria-hidden="true"></span>
        </button>
      </a-tooltip>

      <a-tooltip :content="i18nHelper.coin.window.aiStatus" position="bottom">
        <button
          name="coin__windowHeader__ai"
          class="coin-window-header__status-button"
          :class="{ 'coin-window-header__status-button--active': store.resourcesActive }"
          type="button"
          :aria-pressed="store.resourcesActive"
          @click="store.openResources()"
        >
          <IconBrandOpenai :size="16" stroke-width="1.8" aria-hidden="true" />
          <span>{{ i18nHelper.coin.aiStatusSignIn }}</span>
          <span class="coin-window-header__status-dot" aria-hidden="true"></span>
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
import {
  IconBrandOpenai,
  IconCoins,
  IconDatabaseOff,
  IconMinus,
  IconSquare,
  IconX,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as store } from '../coinShell.store';

defineProps<{
  platform: 'darwin' | 'win32' | 'other';
}>();
</script>
