<template>
  <div
    name="monitoring__watch__chart"
    class="monitoring-chart"
    role="img"
    :aria-label="t('trench.monitoring.detector.range')"
  >
    <div class="monitoring-chart__legend">
      <span class="monitoring-chart__legend-count">{{
        t('trench.monitoring.detector.count')
      }}</span>
      <span class="monitoring-chart__legend-z">{{
        threshold === null
          ? t('trench.monitoring.detector.zUnknown')
          : t('trench.monitoring.detector.z', { value: threshold.toFixed(2) })
      }}</span>
    </div>
    <div v-if="chart.empty" class="monitoring-chart__empty">
      {{ t('trench.monitoring.detector.noChart') }}
    </div>
    <svg v-else viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line
        x1="0"
        :y1="chart.upperThresholdY"
        x2="100"
        :y2="chart.upperThresholdY"
        class="monitoring-chart__threshold"
      />
      <line
        x1="0"
        :y1="chart.lowerThresholdY"
        x2="100"
        :y2="chart.lowerThresholdY"
        class="monitoring-chart__threshold"
      />
      <polyline
        v-for="segment in chart.countSegments"
        :key="segment.key"
        :points="segment.points"
        class="monitoring-chart__count"
      />
      <polyline
        v-for="segment in chart.zSegments"
        :key="segment.key"
        :points="segment.points"
        class="monitoring-chart__z"
      />
    </svg>
    <span v-if="chart.hasGap" class="monitoring-chart__gap">{{
      t('trench.monitoring.detector.gap')
    }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MonitoringSampleProjection } from '@shared/monitoring/monitoringBridge.type';
import { buildMonitoringChart } from '../../views/monitoring/monitoringPresentation.service';

const props = defineProps<{ samples: MonitoringSampleProjection[]; threshold: number | null }>();
const { t } = useI18n();
const chart = computed(() => buildMonitoringChart(props.samples));
</script>
