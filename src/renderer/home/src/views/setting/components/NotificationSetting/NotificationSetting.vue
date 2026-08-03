<template>
  <div name="notification-setting" class="notification-setting">
    <a-button
      size="mini"
      :loading="notificationSettingStore.testing"
      :disabled="notificationSettingStore.testing"
      @click="notificationSettingStore.sendTestNotification()"
    >
      {{ i18nHelper.setting.notification.test }}
    </a-button>
  </div>
</template>

<script setup lang="ts">
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { notificationSettingStore } from './notificationSetting.store';
</script>

<style lang="less">
@import './NotificationSetting.less';
</style>
