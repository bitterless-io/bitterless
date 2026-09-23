<script setup lang="ts">
import { onDeactivated, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { localHomeAuthStore as auth } from './localHomeAuth.store';
import { changePasswordStore as store } from './changePassword.store';
import SignInGuide from './SignInGuide.vue';
import './ChangePassword.less';
const router = useRouter();
watch(() => auth.ready && !auth.loggingOut, ready => { if (!ready) store.reset(); });
onDeactivated(() => store.reset());
onBeforeUnmount(() => store.reset());
</script>
<template>
  <main v-if="auth.ready && !auth.loggingOut" class="account-password">
    <form class="account-password__form" @submit.prevent="store.submit()">
      <h1>{{ i18nHelper.setting.account.changePassword }}</h1>
      <label for="account-new-password">{{ i18nHelper.auth.newPassword }}</label>
      <input id="account-new-password" v-model="store.password" type="password" autocomplete="new-password" :disabled="store.pending" required />
      <p class="account-password__hint">{{ i18nHelper.setting.account.passwordPolicy }}</p>
      <label for="account-confirm-password">{{ i18nHelper.auth.confirmPassword }}</label>
      <input id="account-confirm-password" v-model="store.confirmation" type="password" autocomplete="new-password" :disabled="store.pending" required />
      <p v-if="store.error" role="alert" class="account-password__error">{{ i18nHelper.setting.account[store.error] }}</p>
      <p v-if="store.saved" role="status">{{ i18nHelper.setting.account.passwordChanged }}</p>
      <div class="account-password__actions">
        <button type="button" :disabled="store.pending" @click="router.push('/mini-app')">{{ i18nHelper.setting.account.cancel }}</button>
        <button type="submit" class="account-password__save" :disabled="store.pending">{{ store.pending ? i18nHelper.setting.account.saving : i18nHelper.setting.account.save }}</button>
      </div>
    </form>
  </main>
  <SignInGuide v-else />
</template>
