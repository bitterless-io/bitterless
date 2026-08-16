<template>
  <section name="monitoring__workspace" class="monitoring-workspace">
    <header name="monitoring__workspace__header" class="monitoring-workspace__header">
      <div>
        <span class="monitoring-workspace__eyebrow">{{
          t(
            scope === 'watches'
              ? 'trench.monitoring.workspace.watchesTitle'
              : 'trench.monitoring.workspace.anomaliesTitle'
          )
        }}</span>
        <p>
          {{
            t(
              scope === 'watches'
                ? 'trench.monitoring.workspace.watchesDescription'
                : 'trench.monitoring.workspace.anomaliesDescription'
            )
          }}
        </p>
      </div>
      <span class="monitoring-workspace__boundary">
        {{
          t(
            scope === 'watches'
              ? 'trench.monitoring.workspace.evidenceBoundary'
              : 'trench.monitoring.workspace.bscFixed'
          )
        }}
      </span>
      <a-button
        v-if="scope === 'watches'"
        name="monitoring__watch__add"
        size="small"
        type="primary"
        @click="store.openCreate()"
      >
        <template #icon><IconPlus aria-hidden="true" /></template>
        {{ t('trench.monitoring.actions.addCa') }}
      </a-button>
    </header>
    <MonitoringWatches v-if="scope === 'watches'" />
    <MonitoringAnomalies v-else />
  </section>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconPlus } from '@tabler/icons-vue';
import MonitoringAnomalies from './MonitoringAnomalies.vue';
import MonitoringWatches from './MonitoringWatches.vue';
import { monitoringStore as store } from '../../views/monitoring/monitoring.runtime';

const props = defineProps<{ scope: 'watches' | 'anomalies' }>();
const { t } = useI18n();

watch(
  () => props.scope,
  (scope) => {
    if (scope === 'watches') void store.initialize();
    else void store.initializeAnomalies();
  },
  { immediate: true }
);
</script>

<style lang="less">
@import './LongTermMonitoringWorkspace.less';
</style>
