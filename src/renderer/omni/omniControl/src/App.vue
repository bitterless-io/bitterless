<script setup lang="ts">
import { onMounted } from 'vue';
import OmniPane from './components/OmniPane.vue';
import { layoutStore } from './store/layout.store';

onMounted(async () => {
  await layoutStore.loadLayout();
  await layoutStore.syncLayout();
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
