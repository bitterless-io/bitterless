<template>
  <div class="bl-full-container setting">
    <div class="setting__body">
      <div class="setting__sidebar">
        <div 
          class="setting__nav-item" 
          :class="{ 'setting__nav-item--active': activeTab === 'proxy' }"
          @click="onNavClick('proxy')"
        >
          {{ i18nHelper.setting.proxy.tabTitle }}
        </div>
        <div 
          class="setting__nav-item" 
          :class="{ 'setting__nav-item--active': activeTab === 'general' }"
          @click="onNavClick('general')"
        >
          {{ i18nHelper.setting.general.tabTitle }}
        </div>
        <div 
          class="setting__nav-item" 
          :class="{ 'setting__nav-item--active': activeTab === 'llm' }"
          @click="onNavClick('llm')"
        >
          {{ i18nHelper.setting.llm.tabTitle }}
        </div>
        <div 
          class="setting__nav-item" 
          :class="{ 'setting__nav-item--active': activeTab === 'systemPrompt' }"
          @click="onNavClick('systemPrompt')"
        >
          {{ i18nHelper.setting.systemPrompt.tabTitle }}
        </div>
        <div 
          class="setting__nav-item" 
          :class="{ 'setting__nav-item--active': activeTab === 'about' }"
          @click="onNavClick('about')"
        >
          {{ i18nHelper.setting.about.tabTitle }}
        </div>
      </div>
      <div class="setting__content">
        <ProxySetting v-if="activeTab === 'proxy'" />
        <GeneralSetting v-if="activeTab === 'general'" />
        <LLMSetting v-if="activeTab === 'llm'" />
        <SystemPromptSetting v-if="activeTab === 'systemPrompt'" />
        <About v-if="activeTab === 'about'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import LLMSetting from './components/LLMSetting/LLMSetting.vue';
import SystemPromptSetting from './components/SystemPromptSetting/SystemPromptSetting.vue';
import ProxySetting from './components/ProxySetting/ProxySetting.vue';
import GeneralSetting from './components/GeneralSetting/GeneralSetting.vue';
import About from './components/About/About.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { loadProxySetting } from './components/ProxySetting/proxySetting.store';
import { loadSystemPromptSetting } from './components/SystemPromptSetting/systemPromptSetting.store';

const activeTab = ref<'proxy' | 'general' | 'llm' | 'systemPrompt' | 'about'>('proxy');

const onNavClick = (key: 'proxy' | 'general' | 'llm' | 'systemPrompt' | 'about'): void => {
  activeTab.value = key;
  
  if (key === 'proxy') {
    loadProxySetting();
  } else if (key === 'systemPrompt') {
    loadSystemPromptSetting();
  }
};
</script>

<style lang="less">
@import './Setting.less';
</style>
