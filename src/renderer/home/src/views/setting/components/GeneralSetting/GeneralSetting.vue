<template>
  <div class="general-setting">
    <div class="general-setting__section">
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.language.label }}</h4>
      <div class="general-setting__body">
        <a-radio-group v-model="generalSettingStore.currentLanguage" direction="vertical" @change="onLanguageChange">
          <a-radio value="en">{{ i18nHelper.setting.general.language.en }}</a-radio>
          <a-radio value="zh">{{ i18nHelper.setting.general.language.zh }}</a-radio>
        </a-radio-group>
      </div>
    </div>

    <div class="general-setting__section">
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.searchEngine.label }}</h4>
      <div class="general-setting__body">
        <a-radio-group v-model="generalSettingStore.currentSearchEngine" direction="vertical" @change="onSearchEngineChange">
          <a-radio value="baidu">{{ i18nHelper.setting.general.searchEngine.baidu }}</a-radio>
          <a-radio value="duckduckgo">{{ i18nHelper.setting.general.searchEngine.duckduckgo }}</a-radio>
        </a-radio-group>
      </div>
    </div>

    <div name="general-setting__account" class="general-setting__section">
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.account.label }}</h4>
      <div class="general-setting__account">
        <span class="general-setting__account-email" :title="generalSettingStore.accountEmail">
          {{ generalSettingStore.accountEmail }}
        </span>
        <a-button
          type="text"
          status="danger"
          size="mini"
          :loading="generalSettingStore.loggingOut"
          :disabled="generalSettingStore.loggingOut"
          @click="generalSettingStore.logout()"
        >
          {{ i18nHelper.setting.general.account.logout }}
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { generalSettingStore } from './generalSetting.store';

onMounted(async () => {
  await generalSettingStore.loadSettings();
});

const onLanguageChange = async (): Promise<void> => {
  await generalSettingStore.changeLanguage(generalSettingStore.currentLanguage);
};

const onSearchEngineChange = (): void => {
  generalSettingStore.changeSearchEngine(generalSettingStore.currentSearchEngine);
};
</script>

<style lang="less">
@import './GeneralSetting.less';
</style>
