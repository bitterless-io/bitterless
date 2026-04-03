<template>
  <div class="bl-full-container plugin-test">
    <div class="plugin-test__form">
      <div class="plugin-test__form-title">{{ i18nHelper.pluginTest.title }}</div>

      <div class="plugin-test__field">
        <div class="plugin-test__label">{{ i18nHelper.pluginTest.contentUrl }}</div>
        <div class="plugin-test__input-row">
          <a-input
            v-model="store.contentUrl"
            :placeholder="i18nHelper.pluginTest.contentUrlPlaceholder"
            size="small"
            allow-clear
          />
          <a-button
            class="plugin-test__open-btn"
            type="primary"
            size="small"
            :loading="store.contentWindowOpening"
            @click="openContentWindow"
          >
            {{ i18nHelper.pluginTest.openWindow }}
          </a-button>
        </div>
      </div>

      <div class="plugin-test__field">
        <div class="plugin-test__label">{{ i18nHelper.pluginTest.optionUrl }}</div>
        <div class="plugin-test__input-row">
          <a-input
            v-model="store.optionUrl"
            :placeholder="i18nHelper.pluginTest.optionUrlPlaceholder"
            size="small"
            allow-clear
          />
          <a-button
            class="plugin-test__open-btn"
            type="primary"
            size="small"
            :loading="store.optionWindowOpening"
            @click="openOptionWindow"
          >
            {{ i18nHelper.pluginTest.openWindow }}
          </a-button>
        </div>
      </div>

      <div class="plugin-test__field">
        <div class="plugin-test__label">{{ i18nHelper.pluginTest.backgroundPath }}</div>
        <a-input
          v-model="store.backgroundPath"
          :placeholder="i18nHelper.pluginTest.backgroundPathPlaceholder"
          size="small"
          allow-clear
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { PluginTestHandler } from '@main/xpc/pluginTest.handler';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const pluginTestEmitter = createXpcRendererEmitter<PluginTestHandler>('PluginTestHandler');

class PluginTestStore {
  contentUrl = 'http://localhost:5173';
  optionUrl = 'http://localhost:5174';
  backgroundPath = '';
  contentWindowOpening = false;
  optionWindowOpening = false;
}

const store = reactive(new PluginTestStore());

const openContentWindow = async (): Promise<void> => {
  if (!store.contentUrl || store.contentWindowOpening) return;
  store.contentWindowOpening = true;
  try {
    await pluginTestEmitter.openContentWindow({ url: store.contentUrl });
  } finally {
    store.contentWindowOpening = false;
  }
};

const openOptionWindow = async (): Promise<void> => {
  if (!store.optionUrl || store.optionWindowOpening) return;
  store.optionWindowOpening = true;
  try {
    await pluginTestEmitter.openOptionWindow({ url: store.optionUrl });
  } finally {
    store.optionWindowOpening = false;
  }
};
</script>

<style lang="less">
@import './PluginTest.less';
</style>
