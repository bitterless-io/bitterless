<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import { authStore } from '@/stores/auth/auth.store';

type LoginMode = 'password' | 'otp';
type LoginStep = 'login' | 'set-password';

const route = useRoute();
const router = useRouter();

const mode = ref<LoginMode>('password');
const step = ref<LoginStep>('login');
const email = ref('');
const password = ref('');
const code = ref('');
const newPassword = ref('');
const passwordConfirmation = ref('');
const cooldown = ref(0);
let cooldownTimer: number | undefined;

const redirectAfterLogin = (): void => {
  const redirect = (route.query.redirect as string) || '/chat';
  router.replace(redirect);
};

const continueAfterLogin = (): void => {
  if (authStore.current?.must_set_password) {
    email.value = authStore.current.email;
    step.value = 'set-password';
    return;
  }
  Message.success('登录成功');
  redirectAfterLogin();
};

const startCooldown = (): void => {
  cooldown.value = 60;
  window.clearInterval(cooldownTimer);
  cooldownTimer = window.setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0) {
      window.clearInterval(cooldownTimer);
      cooldownTimer = undefined;
    }
  }, 1000);
};

onMounted(async () => {
  if (!authStore.isAuthenticated()) return;
  try {
    if (!authStore.current) {
      await authStore.fetchMe();
    }
    continueAfterLogin();
  } catch {
    authStore.clearLocalSession();
  }
});

onBeforeUnmount(() => {
  window.clearInterval(cooldownTimer);
});

const onSendOtp = async (): Promise<void> => {
  if (authStore.sendingOtp) return;

  if (!email.value) {
    Message.warning('请输入邮箱');
    return;
  }
  try {
    await authStore.sendOtp(email.value.trim());
    Message.success('验证码已发送');
    startCooldown();
  } catch {
    /* error already shown by store */
  }
};

const onSubmit = async (): Promise<void> => {
  if (!email.value) {
    Message.warning('请输入邮箱');
    return;
  }

  try {
    if (mode.value === 'password') {
      if (!password.value) {
        Message.warning('请输入密码');
        return;
      }
      await authStore.loginWithPassword(email.value.trim(), password.value);
    } else {
      if (code.value.trim().length !== 6) {
        Message.warning('请输入 6 位验证码');
        return;
      }
      await authStore.loginWithOtp(email.value.trim(), code.value.trim());
    }
    continueAfterLogin();
  } catch {
    /* error already shown by store */
  }
};

const onSetPassword = async (): Promise<void> => {
  if (newPassword.value.length < 8) {
    Message.warning('密码至少 8 位');
    return;
  }
  if (newPassword.value !== passwordConfirmation.value) {
    Message.warning('两次输入的密码不一致');
    return;
  }
  try {
    await authStore.changePassword(newPassword.value);
    Message.success('密码设置成功');
    redirectAfterLogin();
  } catch {
    /* error already shown by store */
  }
};
</script>

<template>
  <main name="login" class="login-view">
    <div name="login__drag-region" class="login-view__drag-region" aria-hidden="true"></div>

    <section name="login__panel" class="login-view__panel">
      <div class="login-view__mark">
        <span class="login-view__mark-line"></span>
        <span>Bitterless</span>
      </div>

      <div name="login__copy" class="login-view__copy">
        <p>使用你的 Bitterless customer 账号进入桌面工作区。</p>
      </div>

      <a-radio-group v-model="mode" type="button" size="large" class="login-view__modes">
        <a-radio value="password">密码登录</a-radio>
        <a-radio value="otp">邮箱验证码</a-radio>
      </a-radio-group>

      <a-form layout="vertical" :model="{}" class="login-view__form" @submit.prevent>
        <a-form-item label="邮箱">
          <a-input
            v-model="email"
            size="large"
            placeholder="you@example.com"
            autocomplete="email"
            allow-clear
            @press-enter="onSubmit"
          />
        </a-form-item>

        <a-form-item v-if="mode === 'password'" label="密码">
          <a-input-password
            v-model="password"
            size="large"
            placeholder="请输入密码"
            autocomplete="current-password"
            @press-enter="onSubmit"
          />
        </a-form-item>

        <a-form-item v-else label="邮箱验证码">
          <div name="login__otp" class="login-view__otp-field">
            <a-input
              v-model="code"
              size="large"
              placeholder="6 位验证码"
              autocomplete="one-time-code"
              :max-length="6"
              @press-enter="onSubmit"
            />
            <a-button
              size="large"
              :loading="authStore.sendingOtp"
              :disabled="authStore.sendingOtp || cooldown > 0"
              @click="onSendOtp"
            >
              {{ authStore.sendingOtp ? '发送中...' : cooldown > 0 ? `${cooldown}s` : '发送验证码' }}
            </a-button>
          </div>
        </a-form-item>

        <a-button long type="primary" size="large" :loading="authStore.loading" @click="onSubmit">
          {{ mode === 'password' ? '登录' : '验证并登录' }}
        </a-button>
      </a-form>

      <div class="login-view__footer">
        <span>当前版本仅开放受邀客户账号。</span>
      </div>
    </section>

    <a-modal
      :visible="step === 'set-password'"
      width="min(440px, calc(100vw - 40px))"
      :footer="false"
      :closable="false"
      :mask-closable="false"
      :esc-to-close="false"
      :unmount-on-close="false"
      modal-class="login-view__password-dialog"
    >
      <template #title>设置登录密码</template>
      <div name="login__password-setup" class="login-view__password-modal">
        <p>首次登录必须先设置密码，完成后才能进入工作区。</p>
        <p class="login-view__account">{{ authStore.current?.email }}</p>

        <a-form layout="vertical" :model="{}" class="login-view__form" @submit.prevent>
          <a-form-item label="新密码">
            <a-input-password
              v-model="newPassword"
              size="large"
              placeholder="至少 8 位"
              autocomplete="new-password"
              @press-enter="onSetPassword"
            />
          </a-form-item>
          <a-form-item label="确认密码">
            <a-input-password
              v-model="passwordConfirmation"
              size="large"
              placeholder="再次输入密码"
              autocomplete="new-password"
              @press-enter="onSetPassword"
            />
          </a-form-item>
          <a-button
            long
            type="primary"
            size="large"
            :loading="authStore.loading"
            @click="onSetPassword"
          >
            设置密码并继续
          </a-button>
        </a-form>
      </div>
    </a-modal>
  </main>
</template>

<style lang="less">
@import './Login.less';
</style>
