<script setup lang="ts">
import { onMounted } from 'vue';
import { IconAlertTriangle } from '@tabler/icons-vue';
import OmniPane from './components/OmniPane.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { layoutStore } from './store/layout.store';

onMounted(async () => {
  await layoutStore.loadLayout();
  // syncLayout() removed — main process restoreSavedLayout() already applies the layout on open
});
</script>

<template>
  <div class="omni-control">
    <div
      v-if="layoutStore.layoutRecoveryError"
      name="omniControl__layoutRecovery"
      class="omni-control__recovery"
      role="alert"
    >
      <IconAlertTriangle :size="15" aria-hidden="true" />
      <span>{{ i18nHelper.omni.layoutRecoveryError }}</span>
    </div>
    <OmniPane :node="layoutStore.tree" />
  </div>
</template>

<style lang="less">
@import './App.less';
</style>
