<script setup lang="ts">
import Login from './Login.vue';
import type { LoginSurfaceAuthController } from './loginSurface.type';
import { authEmitter } from '@/emitter/auth.emitter';
import { authStore } from '@/stores/auth/auth.store';
import {
  cancelCustomerSessionRecovery,
  restoreCustomerSession
} from '@/stores/auth/authSessionRecovery.service';

const legacyLoginAuthController: LoginSurfaceAuthController = {
  get current() {
    return authStore.current;
  },
  get loading() {
    return authStore.loading;
  },
  get loggingOut() {
    return authStore.loggingOut;
  },
  get sendingOtp() {
    return authStore.sendingOtp;
  },
  get resettingPassword() {
    return authStore.resettingPassword;
  },
  get checking() {
    return authStore.checking;
  },
  defaultRedirect: '/chat',
  handlesOperationErrors: true,
  handlesPostAuthNavigation: true,
  isAuthenticated: () => authStore.isAuthenticated(),
  prepareSurface: async () => await authEmitter.showHomeWindow(),
  restoreSession: async (signal) => {
    await restoreCustomerSession(signal);
  },
  cancelSessionRecovery: () => cancelCustomerSessionRecovery(),
  clearLocalSession: () => authStore.clearLocalSession(),
  logout: async () => await authStore.logout(),
  loginWithPassword: async (email, password) => {
    await authStore.loginWithPassword(email, password);
  },
  sendOtp: async (email, purpose) => {
    await authStore.sendOtp(email, purpose);
  },
  resetPassword: async (email, code, newPassword, passwordConfirmation) => {
    await authStore.resetPassword(email, code, newPassword, passwordConfirmation);
  },
  loginWithOtp: async (email, code) => {
    await authStore.loginWithOtp(email, code);
  },
  changePassword: async (newPassword) => {
    await authStore.changePassword(newPassword);
  }
};
</script>

<template>
  <Login :auth="legacyLoginAuthController" />
</template>
