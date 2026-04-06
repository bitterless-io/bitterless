<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { loadProxySetting } from '@/views/setting/components/ProxySetting/proxySetting.store';
import { extraResource } from './contextBridge/extraResource.bridge';

const showResourceModal = ref(false);

onMounted(async () => {
  loadProxySetting();
  xpcRenderer.send('update/startPolling');

  const needsExtract = await extraResource.checkNeedsExtract();
  if (needsExtract) {
    showResourceModal.value = true;
    await extraResource.startExtract();
    showResourceModal.value = false;
  }
});
</script>

<template>
  <a-modal
    v-model:visible="showResourceModal"
    :closable="false"
    :footer="null"
    :mask-closable="false"
    :esc-to-close="false"
  >
    <div style="text-align: center; padding: 20px;">
      <a-spin :size="32" />
      <div style="margin-top: 16px; font-size: 14px;">
        必要资源准备中，请稍候...
      </div>
    </div>
  </a-modal>
  <RouterView />
</template>

<style lang="less">
@import './App.less';
</style>
