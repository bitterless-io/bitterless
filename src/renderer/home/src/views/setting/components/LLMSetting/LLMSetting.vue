<template>
  <div name="modelConfig__page" class="model-config">
    <a-spin :loading="llmSettingStore.loading" class="model-config__spin">
      <section name="modelConfig__summary" class="model-config__summary">
        <span class="model-config__eyebrow">{{ i18nHelper.setting.llm.activeModel }}</span>
        <div class="model-config__summary-grid">
          <div class="model-config__summary-item">
            <span>{{ i18nHelper.setting.llm.provider }}</span>
            <strong>{{ i18nHelper.setting.llm.codex }}</strong>
          </div>
          <div class="model-config__summary-item">
            <span>{{ i18nHelper.setting.llm.model }}</span>
            <strong>{{ modelLabel }}</strong>
          </div>
          <div class="model-config__summary-item">
            <span>{{ i18nHelper.setting.llm.effort }}</span>
            <strong>{{ effortLabel }}</strong>
          </div>
        </div>
      </section>

      <div name="modelConfig__workspace" class="model-config__workspace">
        <aside name="modelConfig__providers" class="model-config__providers">
          <span class="model-config__providers-title">{{ i18nHelper.setting.llm.providers }}</span>
          <button class="model-config__provider model-config__provider--active" type="button">
            <span>{{ i18nHelper.setting.llm.codex }}</span>
            <span
              class="model-config__provider-dot"
              :class="providerDotClass"
              aria-hidden="true"
            ></span>
          </button>
        </aside>

        <section name="modelConfig__detail" class="model-config__detail">
          <div class="model-config__auth" :class="authClass">
            <div class="model-config__auth-copy">
              <IconCheck v-if="llmSettingStore.authState === 'ready'" :size="16" />
              <IconAlertTriangle v-else :size="16" />
              <div>
                <strong>{{ authTitle }}</strong>
                <span v-if="authDescription">{{ authDescription }}</span>
              </div>
            </div>
            <a-button
              v-if="canLogin"
              type="primary"
              size="mini"
              :loading="
                llmSettingStore.action === 'login' || llmSettingStore.authState === 'authenticating'
              "
              :disabled="llmSettingStore.authState === 'authenticating'"
              @click="llmSettingStore.login()"
            >
              <template #icon><IconLogin :size="14" /></template>
              {{ i18nHelper.setting.llm.login }}
            </a-button>
            <a-button
              v-else-if="llmSettingStore.authState === 'ready'"
              size="mini"
              :loading="llmSettingStore.action === 'logout'"
              @click="llmSettingStore.logout()"
            >
              <template #icon><IconLogout :size="14" /></template>
              {{ i18nHelper.setting.llm.logout }}
            </a-button>
          </div>

          <div v-if="errorMessage" class="model-config__error" role="alert">
            {{ errorMessage }}
          </div>

          <div class="model-config__fixed-fields">
            <div class="model-config__field">
              <div class="model-config__field-label">
                <IconCpu :size="16" />
                <span>{{ i18nHelper.setting.llm.model }}</span>
              </div>
              <div class="model-config__field-value">
                <strong>{{ modelLabel }}</strong>
                <span>{{ i18nHelper.setting.llm.fixed }}</span>
              </div>
            </div>
            <div class="model-config__field">
              <div class="model-config__field-label">
                <IconGauge :size="16" />
                <span>{{ i18nHelper.setting.llm.effort }}</span>
              </div>
              <div class="model-config__field-value">
                <strong>{{ effortLabel }}</strong>
                <span>{{ i18nHelper.setting.llm.fixed }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import {
  IconAlertTriangle,
  IconCheck,
  IconCpu,
  IconGauge,
  IconLogin,
  IconLogout
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  MODEL_PROVIDER_CODEX_EFFORT,
  MODEL_PROVIDER_CODEX_MODEL
} from '@shared/modelProvider/modelProvider.contract';
import { llmSettingStore } from './llmSetting.store';

const modelLabel = MODEL_PROVIDER_CODEX_MODEL.toUpperCase();
const effortLabel = MODEL_PROVIDER_CODEX_EFFORT;

const authTitle = computed(() => {
  if (llmSettingStore.authState === 'ready') return i18nHelper.setting.llm.connected;
  if (llmSettingStore.authState === 'invalidated') return i18nHelper.setting.llm.invalidated;
  if (llmSettingStore.authState === 'authenticating') return i18nHelper.setting.llm.authenticating;
  if (llmSettingStore.authState === 'unavailable') return i18nHelper.setting.llm.unavailable;
  return i18nHelper.setting.llm.loginRequired;
});

const authDescription = computed(() =>
  llmSettingStore.authState === 'ready'
    ? `${i18nHelper.setting.llm.model} ${modelLabel} · ${i18nHelper.setting.llm.effort} ${effortLabel}`
    : ''
);

const canLogin = computed(
  () =>
    llmSettingStore.authState === 'login_required' ||
    llmSettingStore.authState === 'invalidated' ||
    llmSettingStore.authState === 'unavailable' ||
    llmSettingStore.authState === 'authenticating'
);

const authClass = computed(() => ({
  'model-config__auth--ready': llmSettingStore.authState === 'ready',
  'model-config__auth--warning': llmSettingStore.authState !== 'ready'
}));

const providerDotClass = computed(() => ({
  'model-config__provider-dot--ready': llmSettingStore.authState === 'ready',
  'model-config__provider-dot--busy': llmSettingStore.authState === 'authenticating',
  'model-config__provider-dot--blocked':
    llmSettingStore.authState !== null &&
    llmSettingStore.authState !== 'ready' &&
    llmSettingStore.authState !== 'authenticating'
}));

const errorMessage = computed(() => {
  if (llmSettingStore.error === 'load') return i18nHelper.setting.llm.loadFailed;
  if (llmSettingStore.error === 'login') return i18nHelper.setting.llm.loginFailed;
  if (llmSettingStore.error === 'logout') return i18nHelper.setting.llm.logoutFailed;
  return '';
});

onMounted(() => {
  void llmSettingStore.initialize();
});
</script>

<style lang="less">
@import './LLMSetting.less';
</style>
