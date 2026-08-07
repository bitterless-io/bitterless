<template>
  <div name="coin__evidenceStrip" class="coin-evidence-strip" role="status">
    <span class="coin-evidence-strip__label">{{ i18nHelper.coin.evidence.label }}</span>
    <span class="coin-evidence-strip__item">
      <a-spin v-if="workspace.activeJobCount" :size="11" />
      <IconDatabase v-else :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ sourceLabel }}
    </span>
    <span class="coin-evidence-strip__item" :class="{ 'coin-text-warning': stale }">
      <IconClock :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ freshnessLabel }}
    </span>
    <span class="coin-evidence-strip__item">
      <IconShieldCheck :size="14" stroke-width="1.8" aria-hidden="true" />
      {{ supportLabel }}
    </span>
    <span v-if="workspace.stateSaving" class="coin-evidence-strip__item">
      <a-spin :size="10" />{{ i18nHelper.coin.analysis.state.saving }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { IconClock, IconDatabase, IconShieldCheck } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinWorkspaceStore as workspace } from '../views/analysis/coinWorkspace.store';

const receipts = computed(() => workspace.activeReceipts);
const stale = computed(() => receipts.value.some((receipt) => receipt.stale || receipt.status === 'stale'));
const sourceLabel = computed(() => {
  if (workspace.activeJobCount && receipts.value.length === 0) return i18nHelper.coin.analysis.labels.requesting;
  const sources = [...new Set(receipts.value.map((receipt) => receipt.source))];
  return sources.length ? sources.join(', ') : i18nHelper.coin.evidence.source;
});
const freshnessLabel = computed(() => {
  const observedAt = Math.max(...receipts.value.map((receipt) => receipt.observedAt ?? 0));
  if (!Number.isFinite(observedAt) || observedAt <= 0) return i18nHelper.coin.evidence.freshness;
  const prefix = stale.value ? `${i18nHelper.coin.analysis.labels.stale} · ` : '';
  return `${prefix}${dayjs(observedAt).format('MM-DD HH:mm:ss')}`;
});
const supportLabel = computed(() => {
  if (!receipts.value.length) return i18nHelper.coin.evidence.support;
  const states = new Set(receipts.value.map((receipt) => receipt.status));
  if (states.has('error')) return i18nHelper.coin.analysis.labels.error;
  if (states.has('unavailable')) return i18nHelper.coin.analysis.labels.unavailable;
  if (states.has('partial') || states.has('stale')) return i18nHelper.coin.analysis.labels.partial;
  return i18nHelper.coin.analysis.labels.ready;
});
</script>
