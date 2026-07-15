<script setup lang="ts">
import { onMounted } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import './App.less';

onMounted(() => {
  xpcRenderer.handle('sqlite/hello', async () => {
    console.log('Received message from main process: sqlite/hello');
    return 'hello';
  });

  xpcRenderer.subscribe('hi_everyone', (payload) => {
    console.log('[sqlite] hi_everyone received:', payload);
  });
});
</script>

<template>
  <div class="sqlite-manager">
    <h1 class="sqlite-manager__title">SQLite Manager</h1>
  </div>
</template>
