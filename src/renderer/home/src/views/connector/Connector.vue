<template>
  <div class="bl-full-container">
    <div class="connector-page">
      <div class="connector-page__grid">
        <a-card
          v-for="connector in connectors"
          :key="connector.name"
          class="connector-page__card"
        >
          <template #title>
            <div class="connector-page__card-title">
              <img :src="connector.icon" :alt="connector.name" class="connector-page__card-icon" />
              <span>{{ i18nHelper.connector.name[connector.name] }}</span>
            </div>
          </template>
          <div class="connector-page__card-content">
            <div class="connector-page__card-status">
              <div class="connector-page__card-status-item">
                <span class="connector-page__card-status-label">{{ i18nHelper.connector.configStatus }}:</span>
                <span class="connector-page__card-status-value">{{ i18nHelper.connector.notConfigured }}</span>
              </div>
              <div class="connector-page__card-status-item">
                <span class="connector-page__card-status-label">{{ i18nHelper.connector.connectionStatus }}:</span>
                <span class="connector-page__card-status-value">{{ i18nHelper.connector.disconnected }}</span>
              </div>
            </div>
          </div>
          <template #actions>
            <a-button type="primary" @click="handleEditConfig(connector.name)">
              {{ i18nHelper.connector.editConfig }}
            </a-button>
          </template>
        </a-card>
      </div>
    </div>
    <WechatConfig />
    <DingtalkConfig />
    <FeishuConfig />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import { connectors } from './store/connectors.constant';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { wechatStore } from './wechat/wechat.store';
import { dingtalkStore } from './dingtalk/dingtalk.store';
import { feishuStore } from './feishu/feishu.store';
import WechatConfig from './wechat/WechatConfig.vue';
import DingtalkConfig from './dingtalk/DingtalkConfig.vue';
import FeishuConfig from './feishu/FeishuConfig.vue';

interface RigchatHandler {
  init(): Promise<void>;
  checkLogin(): Promise<{ loggedIn: boolean; nickName: string }>;
  startLogin(): Promise<void>;
}

const rigchatEmitter = createXpcRendererEmitter<RigchatHandler>('RigchatHandler');

const handleEditConfig = (connectorName: string) => {
  if (connectorName === 'wechat') {
    wechatStore.openDrawer();
  } else if (connectorName === 'dingtalk') {
    dingtalkStore.openDrawer();
  } else if (connectorName === 'feishu') {
    feishuStore.openDrawer();
  }
};

onMounted(() => {
  wechatStore.init().catch((err) => console.error('[connector] wechat init failed:', err));
  dingtalkStore.init().catch((err) => console.error('[connector] dingtalk init failed:', err));
  feishuStore.init().catch((err) => console.error('[connector] feishu init failed:', err));
});
</script>

<style scoped>
@import './Connector.less';
</style>
