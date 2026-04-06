<script setup lang="ts">
import { onMounted } from 'vue';
import { proxySettingStore } from '@/views/setting/components/ProxySetting/proxySetting.store';
import { updateStore } from '@/store/update.store';
import { menuBarStore } from './menuBar.store';

const title = import.meta.env.VITE_MAIN_TITLE || 'BitterLess';

const handleRestartUpdate = () => {
  updateStore.restartAndUpdate();
};

const handleDblClick = () => {
  if (menuBarStore.isWindows) {
    menuBarStore.toggleMaximize();
  }
};

onMounted(() => {
  menuBarStore.init();
});
</script>

<template>
  <div class="menu-bar" @dblclick="handleDblClick">
    <div class="menu-bar__left">
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
    <div v-if="menuBarStore.isWindows" class="menu-bar__win-controls">
      <button class="menu-bar__win-btn" @click.stop="menuBarStore.minimize()">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button class="menu-bar__win-btn" @click.stop="menuBarStore.toggleMaximize()">
        <svg v-if="!menuBarStore.maximized" width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor"/><rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor"/></svg>
      </button>
      <button class="menu-bar__win-btn menu-bar__win-btn--close" @click.stop="menuBarStore.close()">
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </div>
</template>

<style lang="less">
@import './MenuBar.less';
</style>
