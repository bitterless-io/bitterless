<script setup lang="ts">
import { onMounted } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import MenuBar from '@/components/MenuBar/MenuBar.vue';
import { loadProxySetting } from '@/views/setting/components/ProxySetting/proxySetting.store';

onMounted(async () => {
  xpcRenderer.send('UpdateHandler/startPolling');
  loadProxySetting();
});
</script>

<template>
  <div name="app-shell" class="app-shell">
    <MenuBar />
    <div name="app-shell__content" class="app-shell__content">
      <RouterView />
    </div>
  </div>
</template>

<style lang="less">
@import './App.less';
</style>
