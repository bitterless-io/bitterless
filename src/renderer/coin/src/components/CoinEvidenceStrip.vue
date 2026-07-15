<template>
  <div name="coin__evidenceStrip" class="coin-evidence-strip" role="status">
    <span class="coin-evidence-strip__label">{{ i18nHelper.coin.evidence.label }}</span>
    <span class="coin-evidence-strip__item">
      <IconDatabaseOff :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ i18nHelper.coin.evidence.source }}
    </span>
    <span class="coin-evidence-strip__item">
      <IconClockOff :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ i18nHelper.coin.evidence.freshness }}
    </span>
    <span class="coin-evidence-strip__item">{{ i18nHelper.coin.evidence.support }}</span>
    <span class="coin-evidence-strip__item">{{ i18nHelper.coin.evidence.confidence }}</span>
  </div>
</template>

<script setup lang="ts">
import { IconClockOff, IconDatabaseOff } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
</script>
