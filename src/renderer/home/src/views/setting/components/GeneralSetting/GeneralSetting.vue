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

    <div
      v-if="showChatMenuControl"
      name="general-setting__experimental"
      class="general-setting__section"
    >
      <h4 class="general-setting__section-title">{{ i18nHelper.setting.general.experimental.label }}</h4>
      <div name="general-setting__show-chat-menu" class="general-setting__control">
        <div class="general-setting__control-copy">
          <div class="general-setting__control-label">
            {{ i18nHelper.setting.general.experimental.showChatMenu }}
          </div>
          <div class="general-setting__control-description">
            {{ i18nHelper.setting.general.experimental.showChatMenuDescription }}
          </div>
        </div>
        <a-switch
          :model-value="generalSettingStore.showChatMenu"
          :loading="generalSettingStore.chatMenuLoading || generalSettingStore.chatMenuSaving"
          :disabled="generalSettingStore.chatMenuLoading || generalSettingStore.chatMenuSaving"
          @change="onChatMenuVisibilityChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { generalSettingStore } from './generalSetting.store';

withDefaults(defineProps<{
  showChatMenuControl?: boolean;
}>(), {
  showChatMenuControl: true,
});

onMounted(async () => {
  await generalSettingStore.loadSettings();
});

const onLanguageChange = async (): Promise<void> => {
  await generalSettingStore.changeLanguage(generalSettingStore.currentLanguage);
};

const onSearchEngineChange = (): void => {
  generalSettingStore.changeSearchEngine(generalSettingStore.currentSearchEngine);
};

const onChatMenuVisibilityChange = (value: string | number | boolean): void => {
  void generalSettingStore.changeChatMenuVisibility(value === true);
};
</script>

<style lang="less">
@import './GeneralSetting.less';
</style>
