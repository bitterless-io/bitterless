<script setup lang="ts">
// Main window renderer = the app chrome (header + native-view placeholders). The
// webpage and the control panel are separate WebContentsViews that the main process
// layers over the placeholders defined in Layout.vue.
import Layout from './views/layout/Layout.vue'
</script>

<template>
  <Layout />
</template>
