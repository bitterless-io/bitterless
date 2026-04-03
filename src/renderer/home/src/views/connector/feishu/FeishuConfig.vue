<template>
  <a-drawer
    :visible="feishuStore.drawerVisible"
    :width="480"
    :footer="false"
    @cancel="feishuStore.closeDrawer()"
  >
    <template #title>
      {{ i18nHelper.connector.name.feishu }}
    </template>
    <div class="feishu-config">
      <div class="feishu-config__header">
        <div class="feishu-config__header-left">
          <a-tag v-if="feishuStore.loggedIn" color="green">
            {{ i18nHelper.connector.connected }}: {{ feishuStore.botName }}
          </a-tag>
          <a-tag v-else color="red">
            {{ i18nHelper.connector.notLoggedIn }}
          </a-tag>
        </div>
        <div class="feishu-config__header-right">
          <span v-if="feishuStore.error" class="feishu-config__error">{{ feishuStore.error }}</span>
        </div>
      </div>

      <div class="feishu-config__form">
        <a-form layout="vertical" :model="feishuStore.formData">
          <a-form-item label="App ID">
            <a-input
              v-model="feishuStore.formData.appId"
              placeholder="Enter Feishu App ID"
              :disabled="feishuStore.loggedIn"
            />
          </a-form-item>
          <a-form-item label="App Secret">
            <a-input-password
              v-model="feishuStore.formData.appSecret"
              placeholder="Enter Feishu App Secret"
              :disabled="feishuStore.loggedIn"
            />
          </a-form-item>
        </a-form>
      </div>

      <div v-if="!feishuStore.loggedIn" class="feishu-config__actions">
        <a-button
          :loading="feishuStore.loading"
          @click="feishuStore.saveOnly()"
        >
          {{ i18nHelper.connector.saveOnly }}
        </a-button>
        <a-button
          type="primary"
          :loading="feishuStore.connecting"
          @click="feishuStore.saveAndConnect()"
        >
          {{ i18nHelper.connector.saveAndConnect }}
        </a-button>
      </div>

      <div v-else class="feishu-config__actions">
        <a-button
          danger
          @click="feishuStore.disconnect()"
        >
          {{ i18nHelper.connector.disconnect }}
        </a-button>
      </div>

      <div v-if="feishuStore.connecting" class="feishu-config__loading">
        <a-spin />
        <p>{{ i18nHelper.connector.connecting }}</p>
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { feishuStore } from './feishu.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
</script>

<style scoped>
@import './FeishuConfig.less';
</style>
