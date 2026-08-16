<template>
  <div
    name="trench__app"
    class="trench-app"
    :class="{ 'trench-app--embedded': host.host === 'omni' }"
    :data-host="host.host"
  >
    <TrenchHeader />
    <div name="trench__body" class="trench-app__body">
      <TrenchModuleNavigation />
      <section name="trench__module-viewport" class="trench-app__viewport">
        <TrenchIndexWorkspace
          v-if="navigation.module === 'index'"
          :selected-chain="navigation.selectedChain"
        />
        <TrenchersWorkspace v-else-if="navigation.module === 'trenchers'" />
        <SnipingWorkspace v-else-if="navigation.module === 'sniping'" :scope="navigation.snipingScope" />
        <LongTermMonitoringWorkspace v-else :scope="navigation.monitoringScope" />
      </section>
    </div>
    <TrenchGmgnSettings />
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue';
import TrenchHeader from './components/TrenchHeader/TrenchHeader.vue';
import TrenchGmgnSettings from './components/TrenchGmgnSettings/TrenchGmgnSettings.vue';
import TrenchIndexWorkspace from './components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue';
import TrenchModuleNavigation from './components/TrenchModuleNavigation/TrenchModuleNavigation.vue';
import TrenchersWorkspace from './components/TrenchersWorkspace/TrenchersWorkspace.vue';
import SnipingWorkspace from './components/SnipingWorkspace/SnipingWorkspace.vue';
import LongTermMonitoringWorkspace from './components/LongTermMonitoringWorkspace/LongTermMonitoringWorkspace.vue';
import { trenchHost } from './contextBridge/trenchHost.bridge';
import { trenchIndexStore } from './views/index/trenchIndex.runtime';
import { trenchNavigationStore as navigation } from './views/navigation/trenchNavigation.runtime';
import { trenchPersonStore } from './views/trenchers/trenchPerson.runtime';
import { monitoringStore } from './views/monitoring/monitoring.runtime';

const host = trenchHost;

onMounted(() => {
  void trenchIndexStore.initialize();
});

watch(
  () => navigation.module,
  (module) => {
    if (module === 'trenchers') void trenchPersonStore.initialize();
    if (module === 'monitoring') void monitoringStore.initialize();
  },
  { immediate: true },
);
</script>

<style lang="less">
@import './App.less';
</style>
