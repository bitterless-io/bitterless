<template>
  <a-drawer
    :visible="wechatStore.drawerVisible"
    :width="480"
    :footer="false"
    @cancel="wechatStore.closeDrawer()"
  >
    <template #title>
      {{ i18nHelper.connector.name.wechat }}
    </template>
    <div class="wechat-config">
      <div class="wechat-config__header">
        <div class="wechat-config__header-left">
          <a-tag v-if="wechatStore.loggedIn" color="green">
            {{ i18nHelper.connector.connected }}: {{ wechatStore.nickName }}
          </a-tag>
          <a-tag v-else color="red">
            {{ i18nHelper.connector.notLoggedIn }}
          </a-tag>
        </div>
        <div class="wechat-config__header-right">
          <span v-if="wechatStore.error" class="wechat-config__error">{{ wechatStore.error }}</span>
        </div>
      </div>

      <div class="wechat-config__owner-info">
        <div class="wechat-config__owner-info-row">
          <span class="wechat-config__owner-info-label">{{ i18nHelper.connector.wechat.ownerVerified }}</span>
          <span class="wechat-config__owner-info-value">{{ wechatStore.ownerName || '-' }}</span>
        </div>
        <div class="wechat-config__owner-info-row">
          <span class="wechat-config__owner-info-label">Owner ID</span>
          <span class="wechat-config__owner-info-value wechat-config__owner-info-value--id">{{ wechatStore.ownerID || '-' }}</span>
        </div>
      </div>

      <div v-if="!wechatStore.loggedIn || wechatStore.error" class="wechat-config__action">
        <a-button
          type="primary"
          :loading="wechatStore.loggingIn"
          @click="wechatStore.startLoginFlow()"
        >
          {{ i18nHelper.connector.wechat.startLogin }}
        </a-button>
      </div>

      <div v-if="wechatStore.loggingIn && !wechatStore.qrcodeUrl" class="wechat-config__loading">
        <a-spin />
      </div>

      <div v-if="wechatStore.qrcodeUrl && !wechatStore.loggedIn" class="wechat-config__qrcode">
        <p>{{ i18nHelper.connector.scanQrcode }}</p>
        <img :src="wechatStore.qrcodeUrl" alt="QR Code" />
      </div>

      <div v-if="wechatStore.loggedIn" class="wechat-config__owner">
        <div class="wechat-config__owner-header">
          <span class="wechat-config__owner-title">{{ i18nHelper.connector.wechat.ownerVerifyTitle }}</span>
          <span class="wechat-config__verify-code">{{ wechatStore.verifyCode }}</span>
        </div>
        <div class="wechat-config__owner-hint">{{ i18nHelper.connector.wechat.ownerVerifyHint }}</div>
        <div v-if="wechatStore.ownerName" class="wechat-config__owner-result">
          <a-tag color="green">{{ i18nHelper.connector.wechat.ownerVerified }}: {{ wechatStore.ownerName }}</a-tag>
        </div>
        <div v-else class="wechat-config__owner-result">
          <a-tag color="orange">{{ i18nHelper.connector.wechat.ownerNotSet }}</a-tag>
        </div>
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { wechatStore } from './wechat.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
</script>

<style scoped>
@import './WechatConfig.less';
</style>
