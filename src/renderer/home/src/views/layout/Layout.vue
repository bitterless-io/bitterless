<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import HomeMenu from './components/homeMenu/HomeMenu.vue';
import MenuBar from '../../components/MenuBar/MenuBar.vue';
import MessageSearch from '../chat/components/MessageSearch/MessageSearch.vue';
import { initSearchShortcut, destroySearchShortcut } from '../chat/components/MessageSearch/messageSearch.store';

onMounted(() => initSearchShortcut());
onUnmounted(() => destroySearchShortcut());
</script>

<template>
  <div class="layout">
    <MenuBar />
    <a-layout class="layout__body">
      <a-layout-sider class="layout__sider" :width="56" :collapsed-width="56">
        <HomeMenu />
      </a-layout-sider>
      <a-layout-content class="layout__content">
        <RouterView />
      </a-layout-content>
    </a-layout>
    <MessageSearch />
  </div>
</template>

<style lang="less">
@import './Layout.less';
</style>
