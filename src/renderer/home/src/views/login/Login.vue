<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import { authStore } from '@/stores/auth/auth.store';

const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');

const redirectAfterLogin = (): void => {
  const redirect = (route.query.redirect as string) || '/chat';
  router.replace(redirect);
};

onMounted(async () => {
  if (!authStore.isAuthenticated()) return;
  try {
    if (!authStore.current) {
      await authStore.fetchMe();
    }
    redirectAfterLogin();
  } catch {
    authStore.clearLocalSession();
  }
});

const onSubmit = async (): Promise<void> => {
  if (!email.value) {
    Message.warning('请输入邮箱');
    return;
  }
  if (!password.value) {
    Message.warning('请输入密码');
    return;
  }

  await authStore.loginWithPassword(email.value, password.value);
  Message.success('登录成功');
  redirectAfterLogin();
};
</script>

<template>
  <main class="login-view">
    <section class="login-view__panel">
      <div class="login-view__mark">
        <span class="login-view__mark-line"></span>
        <span>Bitterless</span>
      </div>

      <div class="login-view__copy">
        <h1>登录后继续</h1>
        <p>使用你的 Bitterless customer 账号进入桌面工作区。</p>
      </div>

      <a-form layout="vertical" :model="{}" class="login-view__form" @submit.prevent>
        <a-form-item label="邮箱">
          <a-input
            v-model="email"
            size="large"
            placeholder="you@example.com"
            allow-clear
            @press-enter="onSubmit"
          />
        </a-form-item>

        <a-form-item label="密码">
          <a-input-password
            v-model="password"
            size="large"
            placeholder="请输入密码"
            @press-enter="onSubmit"
          />
        </a-form-item>

        <a-button long type="primary" size="large" :loading="authStore.loading" @click="onSubmit">
          登录
        </a-button>
      </a-form>

      <div class="login-view__footer">
        <span>当前版本仅开放受邀客户账号。</span>
      </div>
    </section>
  </main>
</template>

<style lang="less">
@import './Login.less';
</style>
