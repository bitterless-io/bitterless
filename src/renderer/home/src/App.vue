<script setup lang="ts">
import { onMounted } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';

onMounted(async () => {
  xpcRenderer.send('UpdateHandler/startPolling');
});
</script>

<template>
  <RouterView />
</template>

<style lang="less">
@import './App.less';
</style>
