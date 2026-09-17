<script setup lang="ts">
import { ref } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { homeShellBridge } from '@renderer/common/homeShellBridge.client';
import { localHomeAuthStore } from './localHomeAuth.store';

const failed = ref(false);
const requestLogin = async (): Promise<void> => {
  failed.value = false;
  try {
    await homeShellBridge.requestLogin();
  } catch {
    failed.value = true;
  }
};
</script>

<template>
  <section name="maestro-local-home__sign-in" class="maestro-local-home__sign-in">
    <a-spin v-if="localHomeAuthStore.ready" />
    <template v-else>
      <h1>{{ i18nHelper.auth.controlSignInTitle }}</h1>
      <p>{{ i18nHelper.auth.controlSignInDescription }}</p>
      <a-button type="primary" @click="requestLogin">{{
        i18nHelper.auth.controlSignInAction
      }}</a-button>
      <p v-if="failed" role="alert">{{ i18nHelper.auth.homeAuthorityUnavailable }}</p>
    </template>
  </section>
</template>
