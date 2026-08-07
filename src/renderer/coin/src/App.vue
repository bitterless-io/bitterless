<template>
  <div name="coin__app" class="coin-app">
    <CoinWindowHeader :platform="platform" />

    <div name="coin__workspace" class="coin-app__workspace">
      <CoinAnalysisPane />
    </div>

    <CoinStatusBar />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { coinShellStore } from './coinShell.store';
import CoinAnalysisPane from './components/CoinAnalysisPane.vue';
import CoinStatusBar from './components/CoinStatusBar.vue';
import CoinWindowHeader from './components/CoinWindowHeader.vue';
import { coinWorkspaceStore } from './views/analysis/coinWorkspace.store';
import { coinXBrowserStore } from './views/analysis/coinXBrowser.store';

const platform = window.coin.platform;

onMounted(() => {
  void Promise.all([
    coinShellStore.initialize(),
    coinWorkspaceStore.initialize(),
    coinXBrowserStore.initialize(),
  ]);
});
</script>

<style lang="less">
@import './App.less';
</style>
