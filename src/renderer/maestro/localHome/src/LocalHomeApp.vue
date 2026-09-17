<template>
  <main name="maestro-local-home" class="maestro-local-home">
    <a-layout name="maestro-local-home__body" class="maestro-local-home__body">
      <a-layout-content name="maestro-local-home__content" class="maestro-local-home__content">
        <RouterView v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </RouterView>
      </a-layout-content>
    </a-layout>
  </main>
</template>
