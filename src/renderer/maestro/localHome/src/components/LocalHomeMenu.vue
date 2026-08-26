<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { workbenchStore } from '@maestro-renderer/home/src/store/workbench.store'
import HomeMenuItem from '@/views/layout/components/homeMenu/homeMenuItem/HomeMenuItem.vue'

const route = useRoute()
const router = useRouter()

const navigate = (routeName: 'mini-app'): void => {
  void router.push({ name: routeName })
}

const openConnectors = (): void => {
  void workbenchStore.openPane('connectors')
}
</script>

<template>
  <nav name="maestro-local-home-menu" class="maestro-local-home-menu">
    <div name="maestro-local-home-menu__items" class="maestro-local-home-menu__items">
      <HomeMenuItem
        name="maestro-local-home-menu__mini-app"
        class="maestro-local-home-menu__item"
        icon="mini-app.png"
        :active="route.name === 'mini-app'"
        :title="i18nHelper.maestroWorkbench.panes.apps"
        :aria-label="i18nHelper.maestroWorkbench.panes.apps"
        role="button"
        tabindex="0"
        @click="navigate('mini-app')"
        @keydown.enter.prevent="navigate('mini-app')"
        @keydown.space.prevent="navigate('mini-app')"
      />
      <HomeMenuItem
        name="maestro-local-home-menu__connector"
        class="maestro-local-home-menu__item"
        icon="connector.png"
        :title="i18nHelper.maestroWorkbench.panes.connectors"
        :aria-label="i18nHelper.maestroWorkbench.panes.connectors"
        role="button"
        tabindex="0"
        @click="openConnectors"
        @keydown.enter.prevent="openConnectors"
        @keydown.space.prevent="openConnectors"
      />
    </div>
  </nav>
</template>
