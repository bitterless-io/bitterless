<template>
  <div class="language-setting">
    <div class="language-setting__header">
      <h3 class="language-setting__title">{{ i18nHelper.setting.language.label }}</h3>
    </div>
    <div class="language-setting__body">
      <a-radio-group v-model="languageSettingStore.currentLanguage" direction="vertical" @change="onLanguageChange">
        <a-radio value="zh">{{ i18nHelper.setting.language.zh }}</a-radio>
        <a-radio value="en">{{ i18nHelper.setting.language.en }}</a-radio>
      </a-radio-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { languageSettingStore } from './languageSetting.store';

onMounted(async () => {
  await languageSettingStore.loadLanguage();
});

const onLanguageChange = (): void => {
  languageSettingStore.changeLanguage(languageSettingStore.currentLanguage);
};
</script>

<style lang="less">
@import './LanguageSetting.less';
</style>
