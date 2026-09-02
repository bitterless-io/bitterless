<template>
  <div name="account-setting" class="account-setting">
    <section name="account-setting__identity" class="account-setting__section">
      <h4 class="account-setting__section-title">{{ i18nHelper.setting.account.title }}</h4>

      <div class="account-setting__row">
        <div class="account-setting__identity-copy">
          <div class="account-setting__label">{{ i18nHelper.setting.account.email }}</div>

          <div
            v-if="accountSettingStore.loading"
            name="account-setting__loading"
            class="account-setting__status"
          >
            <a-spin :size="14" />
            <span>{{ i18nHelper.setting.account.loading }}</span>
          </div>

          <div
            v-else-if="accountSettingStore.loadFailed"
            name="account-setting__error"
            class="account-setting__status account-setting__status--error"
          >
            <span>{{ i18nHelper.setting.account.unavailable }}</span>
            <a-button
              name="account-setting__retry"
              type="text"
              size="mini"
              :disabled="accountSettingStore.loggingOut"
              @click="accountSettingStore.loadAccount()"
            >
              {{ i18nHelper.setting.account.retry }}
            </a-button>
          </div>

          <div
            v-else
            name="account-setting__email"
            class="account-setting__email"
            :title="accountSettingStore.email"
          >
            {{ accountSettingStore.email }}
          </div>
        </div>

        <a-button
          name="account-setting__logout"
          type="text"
          status="danger"
          size="mini"
          :loading="accountSettingStore.loggingOut"
          :disabled="accountSettingStore.loggingOut"
          @click="accountSettingStore.logout()"
        >
          {{ i18nHelper.setting.account.logout }}
        </a-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { accountSettingStore } from './accountSetting.store';

void accountSettingStore.loadAccount();
</script>

<style lang="less">
@import './AccountSetting.less';
</style>
