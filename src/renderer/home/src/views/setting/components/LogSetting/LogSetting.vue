<template>
  <div name="log-setting" class="log-setting">
    <div class="log-setting__header">
      <div>
        <h3 class="log-setting__title">{{ i18nHelper.setting.log.tabTitle }}</h3>
        <div v-if="logSettingStore.snapshot" class="log-setting__summary">
          {{ logSettingStore.snapshot.runtime.profile }}
          ·
          {{ logSettingStore.snapshot.runtime.viteMode }}
          ·
          {{ logSettingStore.snapshot.runtime.viteEnv }}
        </div>
      </div>
      <a-button size="mini" :loading="logSettingStore.loading" @click="logSettingStore.init()">
        {{ i18nHelper.setting.log.refresh }}
      </a-button>
    </div>

    <a-alert
      v-if="logSettingStore.errorMessage"
      class="log-setting__alert"
      type="error"
      :show-icon="true"
    >
      {{ logSettingStore.errorMessage }}
    </a-alert>

    <a-spin class="log-setting__spin" :loading="logSettingStore.loading">
      <template v-if="logSettingStore.snapshot">
        <section name="log-setting__file" class="log-setting__section">
          <h4 class="log-setting__section-title">{{ i18nHelper.setting.log.logFile }}</h4>
          <div class="log-setting__row">
            <span
              class="log-setting__dot"
              :class="{ 'log-setting__dot--active': logSettingStore.snapshot.log.exists }"
            />
            <code class="log-setting__path">{{ logSettingStore.snapshot.log.file }}</code>
            <a-button
              size="mini"
              :loading="logSettingStore.revealingLogFile"
              @click="logSettingStore.revealLogFile()"
            >
              {{ i18nHelper.setting.log.open }}
            </a-button>
          </div>
        </section>

        <section name="log-setting__startup" class="log-setting__section">
          <h4 class="log-setting__section-title">{{ i18nHelper.setting.log.startup }}</h4>
          <div
            v-if="logSettingStore.snapshot.startup.issues.length === 0"
            class="log-setting__empty"
          >
            {{ i18nHelper.setting.log.startupReady }}
          </div>
          <div
            v-for="issue in logSettingStore.snapshot.startup.issues"
            :key="issue.stage"
            class="log-setting__issue"
          >
            <span class="log-setting__issue-stage">{{ issue.stage }}</span>
            <span>{{ issue.message }}</span>
          </div>
        </section>

        <section name="log-setting__directories" class="log-setting__section">
          <h4 class="log-setting__section-title">{{ i18nHelper.setting.log.directoriesTitle }}</h4>
          <div
            v-for="directory in logSettingStore.snapshot.directories"
            :key="directory.key"
            name="log-setting__directory-row"
            class="log-setting__row"
          >
            <span
              class="log-setting__dot"
              :class="{ 'log-setting__dot--active': directory.exists }"
            />
            <span class="log-setting__label">
              {{ i18nHelper.setting.log.directories[directory.key] }}
            </span>
            <code class="log-setting__path">{{ directory.path }}</code>
            <span v-if="!directory.exists" class="log-setting__muted">
              {{ i18nHelper.setting.log.notCreated }}
            </span>
            <a-button
              size="mini"
              :disabled="!directory.exists"
              :loading="logSettingStore.openingKey === directory.key"
              @click="logSettingStore.openDirectory(directory.key)"
            >
              {{ i18nHelper.setting.log.open }}
            </a-button>
          </div>
        </section>

        <section name="log-setting__environment" class="log-setting__section">
          <h4 class="log-setting__section-title">{{ i18nHelper.setting.log.environment }}</h4>
          <div
            v-for="entry in logSettingStore.snapshot.environment"
            :key="entry.key"
            name="log-setting__environment-row"
            class="log-setting__environment-row"
          >
            <code class="log-setting__environment-key">{{ entry.key }}</code>
            <span :class="{ 'log-setting__configured': entry.configured }">
              {{
                entry.configured
                  ? i18nHelper.setting.log.configured
                  : i18nHelper.setting.log.notConfigured
              }}
            </span>
            <code v-if="entry.safeValue" class="log-setting__safe-value">
              {{ entry.safeValue }}
            </code>
            <span v-else-if="entry.configured" class="log-setting__muted">
              {{ i18nHelper.setting.log.valueHidden }}
            </span>
          </div>
        </section>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { logSettingStore } from './logSetting.store';

onMounted(async () => {
  await logSettingStore.init();
});
</script>

<style lang="less">
@import './LogSetting.less';
</style>
