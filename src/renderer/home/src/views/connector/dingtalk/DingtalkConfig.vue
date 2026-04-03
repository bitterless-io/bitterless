<template>
  <a-drawer
    :visible="dingtalkStore.drawerVisible"
    :width="480"
    :footer="false"
    @cancel="dingtalkStore.closeDrawer()"
  >
    <template #title>
      {{ i18nHelper.connector.name.dingtalk }}
    </template>
    <div class="dingtalk-config">
      <div class="dingtalk-config__header">
        <div class="dingtalk-config__header-left">
          <a-tag v-if="dingtalkStore.loggedIn" color="green">
            {{ i18nHelper.connector.connected }}: {{ dingtalkStore.botName }}
          </a-tag>
          <a-tag v-else color="red">
            {{ i18nHelper.connector.notLoggedIn }}
          </a-tag>
        </div>
        <div class="dingtalk-config__header-right">
          <span v-if="dingtalkStore.error" class="dingtalk-config__error">{{ dingtalkStore.error }}</span>
        </div>
      </div>

      <div class="dingtalk-config__form">
        <a-form layout="vertical" :model="dingtalkStore.formData">
          <a-form-item label="Client ID">
            <a-input
              v-model="dingtalkStore.formData.clientId"
              placeholder="Enter DingTalk Client ID"
              :disabled="dingtalkStore.loggedIn"
            />
          </a-form-item>
          <a-form-item label="Client Secret">
            <a-input-password
              v-model="dingtalkStore.formData.clientSecret"
              placeholder="Enter DingTalk Client Secret"
              :disabled="dingtalkStore.loggedIn"
            />
          </a-form-item>
        </a-form>
      </div>

      <div v-if="!dingtalkStore.loggedIn" class="dingtalk-config__actions">
        <a-button
          :loading="dingtalkStore.loading"
          @click="dingtalkStore.saveOnly()"
        >
          {{ i18nHelper.connector.saveOnly }}
        </a-button>
        <a-button
          type="primary"
          :loading="dingtalkStore.connecting"
          @click="dingtalkStore.saveAndConnect()"
        >
          {{ i18nHelper.connector.saveAndConnect }}
        </a-button>
      </div>

      <div v-else class="dingtalk-config__actions">
        <a-button
          danger
          @click="dingtalkStore.disconnect()"
        >
          {{ i18nHelper.connector.disconnect }}
        </a-button>
      </div>

      <div v-if="dingtalkStore.connecting" class="dingtalk-config__loading">
        <a-spin />
        <p>{{ i18nHelper.connector.connecting }}</p>
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { dingtalkStore } from './dingtalk.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
</script>

<style scoped>
@import './DingtalkConfig.less';
</style>
