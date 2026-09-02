<script setup lang="ts">
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import Login from '@/views/login/Login.vue';
import LocalHomeMenu from './components/LocalHomeMenu.vue';
import { localHomeAuthStore } from './localHomeAuth.store';

const route = useRoute();
const router = useRouter();

const retryAuthSnapshot = (): void => {
  void localHomeAuthStore.refreshAuthSnapshot();
};

watch(
  [() => localHomeAuthStore.ready, () => route.name],
  ([ready, routeName], [wasReady]) => {
    const becameReady = ready && wasReady === false;
    const isAuthGate = routeName === 'auth-gate' || routeName === 'auth-gate-fallback';
    if (!ready || (!becameReady && !isAuthGate) || routeName === 'mini-app') return;
    void router.replace({ name: 'mini-app' });
  },
  { immediate: true }
);
</script>

<template>
  <main name="maestro-local-home" class="maestro-local-home">
    <section
      v-if="!localHomeAuthStore.authResolved"
      name="maestro-local-home__auth-gate"
      class="maestro-local-home__auth-gate"
    >
      <a-spin v-if="localHomeAuthStore.initializing" dot />
      <template v-else>
        <p>{{ i18nHelper.auth.homeAuthorityUnavailable }}</p>
        <a-button type="primary" @click="retryAuthSnapshot">
          {{ i18nHelper.auth.homeAuthorityRetry }}
        </a-button>
      </template>
      <span v-if="localHomeAuthStore.initializing">
        {{ i18nHelper.auth.homeAuthorityLoading }}
      </span>
    </section>
    <Login v-else-if="!localHomeAuthStore.ready" :auth="localHomeAuthStore" />
    <a-layout v-else name="maestro-local-home__body" class="maestro-local-home__body">
      <a-layout-sider
        name="maestro-local-home__rail"
        class="maestro-local-home__rail"
        :width="56"
        :collapsed-width="56"
      >
        <LocalHomeMenu />
      </a-layout-sider>
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
