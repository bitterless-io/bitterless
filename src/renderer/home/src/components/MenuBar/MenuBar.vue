<script setup lang="ts">
import { proxySettingStore } from '@/views/setting/components/ProxySetting/proxySetting.store';
import { updateStore } from '@/store/update.store';

const title = import.meta.env.VITE_MAIN_TITLE || 'BitterLess';

const handleRestartUpdate = () => {
  updateStore.restartAndUpdate();
};
</script>

<template>
  <div class="menu-bar">
    <span class="menu-bar__title">{{ title }}</span>
    <div class="menu-bar__actions">
      <div v-if="updateStore.updateAvailable" class="menu-bar__update" @click="handleRestartUpdate">
        <span class="menu-bar__update-text">Restart to Update</span>
      </div>
      <div v-if="proxySettingStore.activeSetting.switch" class="menu-bar__status">
        <span class="menu-bar__status-dot"></span>
        <span class="menu-bar__status-text">Proxy</span>
      </div>
    </div>
  </div>
</template>

<style lang="less">
@import './MenuBar.less';
</style>
