<template>
  <footer name="coin__statusBar" class="coin-status-bar" aria-live="polite">
    <span class="coin-status-bar__item">
      <IconDatabaseOff :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ i18nHelper.coin.sourceStatusUnavailable }}
    </span>
    <span class="coin-status-bar__separator" aria-hidden="true"></span>
    <span class="coin-status-bar__item">
      <IconActivity :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ i18nHelper.coin.noActiveJobs }}
    </span>
    <span class="coin-status-bar__spacer"></span>
    <span v-if="store.statusError" class="coin-status-bar__error">{{ store.statusError }}</span>
    <span v-else-if="store.statusLoading" class="coin-status-bar__item">
      <a-spin :size="11" />
      {{ i18nHelper.coin.loading }}
    </span>
    <span v-else class="coin-status-bar__item coin-status-bar__item--ready">
      <IconCircleCheck :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ i18nHelper.coin.shellReady }}
    </span>
  </footer>
</template>

<script setup lang="ts">
import { IconActivity, IconCircleCheck, IconDatabaseOff } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore as store } from '../coinShell.store';
</script>
