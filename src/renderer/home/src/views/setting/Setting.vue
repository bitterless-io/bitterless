<template>
  <div class="bl-full-container setting">
    <div class="setting__body">
      <div class="setting__sidebar">
        <div
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'proxy' }"
          @click="onNavClick('proxy')"
        >
          {{ i18nHelper.setting.proxy.tabTitle }}
        </div>
        <div
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'general' }"
          @click="onNavClick('general')"
        >
          {{ i18nHelper.setting.general.tabTitle }}
        </div>
        <div
          name="setting__nav-account"
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'account' }"
          @click="onNavClick('account')"
        >
          {{ i18nHelper.setting.account.tabTitle }}
        </div>
        <div
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'llm' }"
          @click="onNavClick('llm')"
        >
          {{ i18nHelper.setting.llm.tabTitle }}
        </div>
        <div
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'systemPrompt' }"
          @click="onNavClick('systemPrompt')"
        >
          {{ i18nHelper.setting.systemPrompt.tabTitle }}
        </div>
        <div
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'notification' }"
          @click="onNavClick('notification')"
        >
          {{ i18nHelper.setting.notification.tabTitle }}
        </div>
        <div
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'log' }"
          @click="onNavClick('log')"
        >
          {{ i18nHelper.setting.log.tabTitle }}
        </div>
        <div
          class="setting__nav-item"
          :class="{ 'setting__nav-item--active': settingNavStore.activeTab === 'about' }"
          @click="onNavClick('about')"
        >
          {{ i18nHelper.setting.about.tabTitle }}
        </div>
      </div>
      <div class="setting__content">
        <ProxySetting v-if="settingNavStore.activeTab === 'proxy'" />
        <GeneralSetting
          v-if="settingNavStore.activeTab === 'general'"
          :show-chat-menu-control="showChatMenuControl"
        />
        <AccountSetting v-if="settingNavStore.activeTab === 'account'" />
        <LLMSetting v-if="settingNavStore.activeTab === 'llm'" />
        <SystemPromptSetting v-if="settingNavStore.activeTab === 'systemPrompt'" />
        <NotificationSetting v-if="settingNavStore.activeTab === 'notification'" />
        <LogSetting v-if="settingNavStore.activeTab === 'log'" />
        <About v-if="settingNavStore.activeTab === 'about'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import LLMSetting from './components/LLMSetting/LLMSetting.vue';
import SystemPromptSetting from './components/SystemPromptSetting/SystemPromptSetting.vue';
import ProxySetting from './components/ProxySetting/ProxySetting.vue';
import GeneralSetting from './components/GeneralSetting/GeneralSetting.vue';
import AccountSetting from './components/AccountSetting/AccountSetting.vue';
import About from './components/About/About.vue';
import NotificationSetting from './components/NotificationSetting/NotificationSetting.vue';
import LogSetting from './components/LogSetting/LogSetting.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { loadProxySetting } from './components/ProxySetting/proxySetting.store';
import { loadSystemPromptSetting } from './components/SystemPromptSetting/systemPromptSetting.store';
import type { SettingTab } from '@shared/setting/settingNavigation.contract';
import { settingNavStore } from './store/settingNav.store';

withDefaults(defineProps<{
  showChatMenuControl?: boolean;
}>(), {
  showChatMenuControl: true,
});

const onNavClick = (key: SettingTab): void => {
  settingNavStore.select(key);
  if (key === 'proxy') {
    loadProxySetting();
  } else if (key === 'systemPrompt') {
    loadSystemPromptSetting();
  }
};

onMounted(() => {
  if (settingNavStore.activeTab === 'proxy') {
    void loadProxySetting();
  }
});
</script>

<style lang="less">
@import './Setting.less';
</style>
