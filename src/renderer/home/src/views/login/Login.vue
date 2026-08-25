<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { isNavigationFailure, useRoute, useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { authStore, customerNeedsPasswordSetup } from '@/stores/auth/auth.store';
import { authEmitter } from '@/emitter/auth.emitter';

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
const resetVisible = ref(false);
const resetEmail = ref('');
const resetCode = ref('');
const resetNewPassword = ref('');
const resetPasswordConfirmation = ref('');
const resetCooldown = ref(0);
const transitioning = ref(false);
const passwordSetupComplete = ref(false);
const sessionRecoveryVisible = ref(authStore.isAuthenticated());
const sessionRecoveryFailed = ref(false);
const sessionRecoveryCancelled = ref(false);
const sessionRecoveryCancelling = ref(false);
let cooldownTimer: number | undefined;
let resetCooldownTimer: number | undefined;
let sessionRecoveryAbortController: AbortController | null = null;

const redirectAfterLogin = async (): Promise<void> => {
  const redirect = (route.query.redirect as string) || '/chat';
  transitioning.value = true;
  try {
    const failure = await router.replace(redirect);
    if (isNavigationFailure(failure)) {
      throw failure;
    }
  } catch (err) {
    Message.error(i18nHelper.auth.navigationFailed);
    throw err;
  } finally {
    transitioning.value = false;
  }
};

const continueAfterLogin = async (): Promise<void> => {
  const current = authStore.current;
  if (customerNeedsPasswordSetup(current)) {
    email.value = current?.email || email.value;
    passwordSetupComplete.value = false;
    step.value = 'set-password';
    return;
  }
  if (current?.status !== 'active') {
    authStore.clearLocalSession();
    Message.error('账号状态无效，请重新登录');
    return;
  }
  await redirectAfterLogin();
  Message.success('登录成功');
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

const startResetCooldown = (): void => {
  resetCooldown.value = 60;
  window.clearInterval(resetCooldownTimer);
  resetCooldownTimer = window.setInterval(() => {
    resetCooldown.value -= 1;
    if (resetCooldown.value <= 0) {
      window.clearInterval(resetCooldownTimer);
      resetCooldownTimer = undefined;
    }
  }, 1000);
};

const restorePersistedSession = async (): Promise<void> => {
  if (!authStore.isAuthenticated()) {
    sessionRecoveryVisible.value = false;
    sessionRecoveryFailed.value = false;
    sessionRecoveryCancelled.value = false;
    return;
  }

  sessionRecoveryVisible.value = true;
  sessionRecoveryFailed.value = false;
  sessionRecoveryCancelled.value = false;
  sessionRecoveryAbortController?.abort();
  const controller = new AbortController();
  sessionRecoveryAbortController = controller;
  try {
    await authStore.restoreSession(controller.signal);
    if (sessionRecoveryAbortController !== controller) return;
    await continueAfterLogin();
    if (!authStore.isAuthenticated()) {
      sessionRecoveryVisible.value = false;
    }
  } catch (err) {
    if (sessionRecoveryAbortController !== controller) return;
    if (!authStore.isAuthenticated()) {
      sessionRecoveryVisible.value = false;
      return;
    }
    sessionRecoveryFailed.value = true;
    if (controller.signal.aborted) {
      sessionRecoveryCancelled.value = true;
      return;
    }
    console.warn('[Login] Saved session is temporarily unavailable:', err);
  } finally {
    if (sessionRecoveryAbortController === controller) {
      sessionRecoveryAbortController = null;
    }
    sessionRecoveryCancelling.value = false;
  }
};

const onRetrySession = async (): Promise<void> => {
  if (authStore.checking || transitioning.value) return;
  await restorePersistedSession();
};

const onCancelSessionRecovery = (): void => {
  if (!authStore.checking || transitioning.value || sessionRecoveryCancelling.value) return;
  sessionRecoveryCancelling.value = true;
  sessionRecoveryAbortController?.abort();
};

const onDiscardPersistedSession = async (): Promise<void> => {
  if (authStore.checking || authStore.loggingOut || transitioning.value) return;
  const controller = sessionRecoveryAbortController;
  sessionRecoveryAbortController = null;
  controller?.abort();
  await authStore.logout();
  sessionRecoveryVisible.value = false;
  sessionRecoveryFailed.value = false;
  sessionRecoveryCancelled.value = false;
};

onMounted(async () => {
  await authEmitter.showHomeWindow();
  await restorePersistedSession();
});

onBeforeUnmount(() => {
  sessionRecoveryAbortController?.abort();
  sessionRecoveryAbortController = null;
  window.clearInterval(cooldownTimer);
  window.clearInterval(resetCooldownTimer);
});

const onSendOtp = async (): Promise<void> => {
  if (authStore.sendingOtp || cooldown.value > 0) return;

  if (!email.value.trim()) {
    Message.warning('请输入邮箱');
    return;
  }
  try {
    await authStore.sendOtp(email.value.trim(), 'login');
    Message.success('验证码已发送');
    startCooldown();
  } catch {
    /* error already shown by store */
  }
};

const openPasswordRecovery = (): void => {
  resetEmail.value = email.value.trim();
  resetCode.value = '';
  resetNewPassword.value = '';
  resetPasswordConfirmation.value = '';
  resetVisible.value = true;
};

const closePasswordRecovery = (): void => {
  resetVisible.value = false;
  resetCode.value = '';
  resetNewPassword.value = '';
  resetPasswordConfirmation.value = '';
};

const onSendResetOtp = async (): Promise<void> => {
  if (authStore.sendingOtp || resetCooldown.value > 0) return;
  if (!resetEmail.value.trim()) {
    Message.warning('请输入邮箱');
    return;
  }

  try {
    await authStore.sendOtp(resetEmail.value.trim(), 'reset_password');
    Message.success('如果账号可以重置密码，验证码将发送到该邮箱');
    startResetCooldown();
  } catch {
    /* error already shown by store */
  }
};

const onResetPassword = async (): Promise<void> => {
  if (authStore.resettingPassword) return;
  if (!resetEmail.value.trim()) {
    Message.warning('请输入邮箱');
    return;
  }
  if (resetCode.value.trim().length !== 6) {
    Message.warning('请输入 6 位验证码');
    return;
  }
  if (resetNewPassword.value.length < 8) {
    Message.warning('密码至少 8 位');
    return;
  }
  if (resetNewPassword.value !== resetPasswordConfirmation.value) {
    Message.warning('两次输入的密码不一致');
    return;
  }

  try {
    await authStore.resetPassword(
      resetEmail.value.trim(),
      resetCode.value.trim(),
      resetNewPassword.value,
      resetPasswordConfirmation.value
    );
    email.value = resetEmail.value.trim();
    password.value = '';
    code.value = '';
    mode.value = 'password';
    closePasswordRecovery();
    Message.success('密码已重置，请使用新密码登录');
  } catch {
    /* error already shown by store */
  }
};

const onSubmit = async (): Promise<void> => {
  if (authStore.loading || authStore.checking || authStore.loggingOut || transitioning.value) return;

  if (!email.value.trim()) {
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
    await continueAfterLogin();
  } catch {
    if (authStore.isAuthenticated() && !authStore.current) {
      sessionRecoveryVisible.value = true;
      sessionRecoveryFailed.value = true;
    }
    /* error already shown by store */
  }
};

const onSetPassword = async (): Promise<void> => {
  if (authStore.loading || authStore.loggingOut || transitioning.value) return;

  if (passwordSetupComplete.value) {
    try {
      await redirectAfterLogin();
      Message.success(i18nHelper.auth.passwordSetupSuccess);
    } catch {
      /* navigation error already shown by redirectAfterLogin */
    }
    return;
  }

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
    passwordSetupComplete.value = true;
    newPassword.value = '';
    passwordConfirmation.value = '';
    await redirectAfterLogin();
    Message.success(i18nHelper.auth.passwordSetupSuccess);
  } catch {
    /* error already shown by store */
  }
};
</script>

<template>
  <main name="login" class="login-view">
    <section name="login__panel" class="login-view__panel">
      <div name="login__copy" class="login-view__copy">
        <h1>{{ sessionRecoveryVisible ? '恢复登录状态' : '登录 Bitterless' }}</h1>
      </div>

      <div
        v-if="sessionRecoveryVisible"
        name="login__session-recovery"
        class="login-view__session-recovery"
      >
        <a-spin :loading="authStore.checking || transitioning" dot>
          <p v-if="sessionRecoveryCancelled">
            已取消验证。登录状态仍已保留，可重试或改用其他账号。
          </p>
          <p v-else-if="sessionRecoveryFailed">
            暂时无法连接 Bitterless 服务。登录状态已保留，网络恢复后重试即可。
          </p>
          <p v-else>正在验证已保存的登录状态...</p>
        </a-spin>
        <div
          v-if="!transitioning && (authStore.checking || sessionRecoveryFailed)"
          name="login__session-recovery-actions"
          class="login-view__session-recovery-actions"
        >
          <a-button
            v-if="sessionRecoveryFailed && !authStore.checking"
            type="primary"
            size="large"
            :loading="authStore.checking || transitioning"
            @click="onRetrySession"
          >
            重试
          </a-button>
          <a-button
            v-if="authStore.checking"
            size="large"
            :loading="sessionRecoveryCancelling"
            :disabled="sessionRecoveryCancelling"
            @click="onCancelSessionRecovery"
          >
            取消
          </a-button>
          <a-button
            v-if="sessionRecoveryFailed && !authStore.checking"
            size="large"
            :loading="authStore.loggingOut"
            :disabled="authStore.loggingOut || transitioning"
            @click="onDiscardPersistedSession"
          >
            改用其他账号
          </a-button>
        </div>
      </div>

      <a-radio-group
        v-if="!sessionRecoveryVisible"
        v-model="mode"
        type="button"
        size="large"
        class="login-view__modes"
      >
        <a-radio value="password">密码登录</a-radio>
        <a-radio value="otp">邮箱验证码</a-radio>
      </a-radio-group>

      <a-form
        v-if="!sessionRecoveryVisible"
        layout="vertical"
        :model="{}"
        class="login-view__form"
        @submit.prevent
      >
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

        <div v-if="mode === 'password'" name="login__forgot" class="login-view__forgot">
          <a-button type="text" size="small" @click="openPasswordRecovery"> 忘记密码？ </a-button>
        </div>

        <a-form-item v-if="mode === 'otp'" label="邮箱验证码">
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
              {{
                authStore.sendingOtp ? '发送中...' : cooldown > 0 ? `${cooldown}s` : '发送验证码'
              }}
            </a-button>
          </div>
        </a-form-item>

        <a-button
          long
          type="primary"
          size="large"
          :loading="authStore.loading || transitioning"
          :disabled="authStore.loading || authStore.checking || authStore.loggingOut || transitioning"
          @click="onSubmit"
        >
          {{ mode === 'password' ? '登录' : '验证并登录' }}
        </a-button>
      </a-form>

      <div v-if="!sessionRecoveryVisible" class="login-view__footer">
        <span>当前版本仅开放受邀客户账号。</span>
      </div>
    </section>

    <a-modal
      :visible="resetVisible"
      width="min(440px, calc(100vw - 40px))"
      :footer="false"
      :closable="true"
      :mask-closable="true"
      :esc-to-close="true"
      :unmount-on-close="false"
      modal-class="login-view__recovery-dialog"
      @cancel="closePasswordRecovery"
    >
      <template #title>重置密码</template>
      <div name="login__password-recovery" class="login-view__recovery-modal">
        <p>输入账号邮箱和验证码，然后设置新的登录密码。</p>

        <a-form layout="vertical" :model="{}" class="login-view__form" @submit.prevent>
          <a-form-item label="邮箱">
            <a-input
              v-model="resetEmail"
              size="large"
              placeholder="you@example.com"
              autocomplete="email"
              allow-clear
            />
          </a-form-item>
          <a-form-item label="邮箱验证码">
            <div name="login__reset-otp" class="login-view__otp-field">
              <a-input
                v-model="resetCode"
                size="large"
                placeholder="6 位验证码"
                autocomplete="one-time-code"
                :max-length="6"
              />
              <a-button
                size="large"
                :loading="authStore.sendingOtp"
                :disabled="authStore.sendingOtp || resetCooldown > 0"
                @click="onSendResetOtp"
              >
                {{
                  authStore.sendingOtp
                    ? '发送中...'
                    : resetCooldown > 0
                      ? `${resetCooldown}s`
                      : '发送验证码'
                }}
              </a-button>
            </div>
          </a-form-item>
          <a-form-item label="新密码">
            <a-input-password
              v-model="resetNewPassword"
              size="large"
              placeholder="至少 8 位"
              autocomplete="new-password"
            />
          </a-form-item>
          <a-form-item label="确认密码">
            <a-input-password
              v-model="resetPasswordConfirmation"
              size="large"
              placeholder="再次输入密码"
              autocomplete="new-password"
              @press-enter="onResetPassword"
            />
          </a-form-item>
          <a-button
            long
            type="primary"
            size="large"
            :loading="authStore.resettingPassword"
            :disabled="authStore.resettingPassword"
            @click="onResetPassword"
          >
            重置密码
          </a-button>
        </a-form>
      </div>
    </a-modal>

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
      <template #title>
        {{
          passwordSetupComplete
            ? i18nHelper.auth.passwordSetupCompleteTitle
            : i18nHelper.auth.passwordSetupTitle
        }}
      </template>
      <div name="login__password-setup" class="login-view__password-modal">
        <template v-if="!passwordSetupComplete">
          <p>{{ i18nHelper.auth.passwordSetupDescription }}</p>
          <p class="login-view__account">{{ authStore.current?.email }}</p>

          <a-form layout="vertical" :model="{}" class="login-view__form" @submit.prevent>
            <a-form-item :label="i18nHelper.auth.newPassword">
              <a-input-password
                v-model="newPassword"
                size="large"
                :placeholder="i18nHelper.auth.passwordMinimum"
                autocomplete="new-password"
                @press-enter="onSetPassword"
              />
            </a-form-item>
            <a-form-item :label="i18nHelper.auth.confirmPassword">
              <a-input-password
                v-model="passwordConfirmation"
                size="large"
                :placeholder="i18nHelper.auth.confirmPasswordPlaceholder"
                autocomplete="new-password"
                @press-enter="onSetPassword"
              />
            </a-form-item>
            <a-button
              long
              type="primary"
              size="large"
              :loading="authStore.loading || transitioning"
              :disabled="authStore.loading || authStore.loggingOut || transitioning"
              @click="onSetPassword"
            >
              {{ i18nHelper.auth.setPasswordAndContinue }}
            </a-button>
          </a-form>
        </template>
        <template v-else>
          <p>{{ i18nHelper.auth.passwordSetupCompleteDescription }}</p>
          <a-button
            long
            type="primary"
            size="large"
            :loading="transitioning"
            :disabled="authStore.loggingOut || transitioning"
            @click="onSetPassword"
          >
            {{ i18nHelper.auth.continueToWorkspace }}
          </a-button>
        </template>
      </div>
    </a-modal>
  </main>
</template>

<style lang="less">
@import './Login.less';
</style>
