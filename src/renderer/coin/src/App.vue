<template>
  <div
    name="trench__app"
    class="trench-app"
    :class="{ 'trench-app--embedded': host.host === 'omni' }"
    :data-host="host.host"
    :data-mobile-detail="trenchVaultStore.mobileDetailOpen"
  >
    <TrenchHeader />
    <TrenchModuleBar />
    <TrenchRecordWorkspace />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import TrenchHeader from './components/TrenchHeader/TrenchHeader.vue';
import TrenchModuleBar from './components/TrenchModuleBar/TrenchModuleBar.vue';
import TrenchRecordWorkspace from './components/TrenchRecordWorkspace/TrenchRecordWorkspace.vue';
import { trenchHost } from './contextBridge/trenchHost.bridge';
import { trenchVaultStore } from './views/vault/trenchVault.runtime';

const host = trenchHost;

onMounted(() => {
  void trenchVaultStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
