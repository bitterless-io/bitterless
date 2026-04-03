<template>
  <div class="proxy-setting">
    <div class="proxy-setting__form">
      <div class="proxy-setting__field">
        <label class="proxy-setting__label">{{ i18nHelper.setting.proxy.switch }}</label>
        <a-switch v-model="proxySettingStore.formSetting.switch" class="proxy-setting__switch" />
      </div>
      <div class="proxy-setting__row">
        <div class="proxy-setting__field">
          <label class="proxy-setting__label">{{ i18nHelper.setting.proxy.ip }}</label>
          <a-input
            v-model="proxySettingStore.formSetting.ip"
            :placeholder="i18nHelper.setting.proxy.ipPlaceholder"
            :disabled="!proxySettingStore.formSetting.switch"
            class="proxy-setting__input"
            allow-clear
          />
          <span v-if="errors.ip" class="proxy-setting__error">{{ errors.ip }}</span>
        </div>
        <div class="proxy-setting__field">
          <label class="proxy-setting__label">{{ i18nHelper.setting.proxy.port }}</label>
          <a-input
            v-model="proxySettingStore.formSetting.port"
            :placeholder="i18nHelper.setting.proxy.portPlaceholder"
            :disabled="!proxySettingStore.formSetting.switch"
            class="proxy-setting__input"
            allow-clear
          />
          <span v-if="errors.port" class="proxy-setting__error">{{ errors.port }}</span>
        </div>
      </div>
      <div class="proxy-setting__actions">
        <a-button type="primary" :loading="proxySettingStore.loading" @click="handleSave">
          {{ i18nHelper.setting.proxy.save }}
        </a-button>
        <span v-if="proxySettingStore.saveStatus === 'success'" class="proxy-setting__status--success">
          {{ i18nHelper.setting.proxy.saveSuccess }}
        </span>
        <span v-if="proxySettingStore.saveStatus === 'failed'" class="proxy-setting__status--failed">
          {{ i18nHelper.setting.proxy.saveFailed }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { proxySettingStore, saveProxySetting } from './proxySetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const errors = reactive({ ip: '', port: '' });

const validate = (): boolean => {
  errors.ip = '';
  errors.port = '';
  if (proxySettingStore.formSetting.switch) {
    if (!proxySettingStore.formSetting.ip) {
      errors.ip = i18nHelper.setting.proxy.ipRequired;
    }
    if (!proxySettingStore.formSetting.port) {
      errors.port = i18nHelper.setting.proxy.portRequired;
    }
  }
  return !errors.ip && !errors.port;
};

const handleSave = async (): Promise<void> => {
  if (!validate()) return;
  await saveProxySetting();
};

</script>

<style lang="less">
@import './ProxySetting.less';
</style>
