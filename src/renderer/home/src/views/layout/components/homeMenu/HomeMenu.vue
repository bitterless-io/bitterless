<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import type { RouteRecordNormalized } from 'vue-router';
import HomeMenuItem from './homeMenuItem/HomeMenuItem.vue';

const router = useRouter();
const route = useRoute();

const menuItems = computed(() => {
  const layoutRoute = router.getRoutes().find((r) => r.path === '/');
  if (!layoutRoute?.children) {
    return [];
  }
  return layoutRoute.children
    .filter((child) => child.meta?.icon && child.name !== 'setting')
    .map((child) => ({
      icon: child.meta.icon as string,
      routeName: child.name as string,
    }));
});

const settingItem = computed(() => {
  const layoutRoute = router.getRoutes().find((r) => r.path === '/');
  const settingRoute = layoutRoute?.children?.find((child) => child.name === 'setting');
  if (!settingRoute?.meta?.icon) return null;
  return {
    icon: settingRoute.meta.icon as string,
    routeName: settingRoute.name as string,
  };
});

const navigate = (routeName: string) => {
  router.push({ name: routeName });
};
</script>

<template>
  <div class="home-menu">
    <div class="home-menu__items">
      <HomeMenuItem
        v-for="item in menuItems"
        :key="item.routeName"
        :icon="item.icon"
        :active="route.name === item.routeName"
        @click="navigate(item.routeName)"
      />
    </div>
    <div class="home-menu__footer">
      <HomeMenuItem
        v-if="settingItem"
        :icon="settingItem.icon"
        :active="route.name === settingItem.routeName"
        @click="navigate(settingItem.routeName)"
      />
    </div>
  </div>
</template>

<style lang="less">
@import './HomeMenu.less';
</style>
