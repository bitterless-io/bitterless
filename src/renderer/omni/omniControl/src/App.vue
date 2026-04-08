<script setup lang="ts">
import { onMounted } from 'vue';
import OmniPane from './components/OmniPane.vue';
import { layoutStore } from './store/layout.store';

onMounted(async () => {
  await layoutStore.loadLayout();
  // syncLayout() removed — main process restoreSavedLayout() already applies the layout on open
});
</script>

<template>
  <div class="omni-control">
    <OmniPane :node="layoutStore.tree" />
  </div>
</template>

<style lang="less">
@import './App.less';
</style>
