<template>
  <section
    name="monitoring__watches"
    class="monitoring-watches"
    :class="{ 'monitoring-watches--detail': store.mobileDetail }"
  >
    <MonitoringWatchList />
    <MonitoringWatchDetail />
    <MonitoringWatchDialog />
  </section>
</template>

<script setup lang="ts">
import MonitoringWatchDetail from './MonitoringWatchDetail.vue';
import MonitoringWatchDialog from './MonitoringWatchDialog.vue';
import MonitoringWatchList from './MonitoringWatchList.vue';
import { monitoringStore as store } from '../../views/monitoring/monitoring.runtime';
</script>
