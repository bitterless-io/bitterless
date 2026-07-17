<template>
  <div :class="['menu-bar', { 'menu-bar--mac': menuBarStore.isMac }]" @dblclick="handleDblClick">
    <div class="menu-bar__left">
      <span class="menu-bar__title">{{ title }}</span>
    </div>
    <div class="menu-bar__actions">
      <div v-if="updateStore.updateAvailable" class="menu-bar__update" @click="handleRestartUpdate">
        <span class="menu-bar__update-text">{{ i18nHelper.menuBar.restartToUpdate }}</span>
      </div>
      <a-tooltip
        v-if="menuBarStore.startupIssueCount > 0"
        position="br"
        :popup-visible="menuBarStore.startupTooltipFocused ? true : undefined"
      >
        <button
          type="button"
          class="menu-bar__startup-issues"
          :aria-label="menuBarStore.startupIssueButtonLabel"
          @focus="menuBarStore.showStartupTooltipOnFocus()"
          @blur="menuBarStore.hideStartupTooltipOnBlur()"
        >
          <span class="menu-bar__startup-icon" aria-hidden="true">!</span>
          <span class="menu-bar__startup-count">{{ menuBarStore.startupIssueCount }}</span>
        </button>
        <template #content>
          <div class="menu-bar__startup-tooltip">
            <div class="menu-bar__startup-tooltip-title">
              {{ i18nHelper.menuBar.startupDiagnostics.title }}
            </div>
            <div
              v-for="issue in menuBarStore.startupIssues"
              :key="issue.stage"
              class="menu-bar__startup-tooltip-issue"
            >
              <div class="menu-bar__startup-tooltip-stage">
                {{ menuBarStore.getStartupStageLabel(issue.stage) }}
              </div>
              <div class="menu-bar__startup-tooltip-message">{{ issue.message }}</div>
            </div>
          </div>
        </template>
      </a-tooltip>
      <div v-if="proxySettingStore.activeSetting.switch" class="menu-bar__status">
        <span class="menu-bar__status-dot"></span>
        <span class="menu-bar__status-text">{{ i18nHelper.menuBar.proxy }}</span>
      </div>
    </div>
    <div v-if="menuBarStore.isWindows" class="menu-bar__win-controls">
      <button class="menu-bar__win-btn" @click.stop="menuBarStore.minimize()">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button class="menu-bar__win-btn" @click.stop="menuBarStore.toggleMaximize()">
        <svg v-if="!menuBarStore.maximized" width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor"/><rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor"/></svg>
      </button>
      <button class="menu-bar__win-btn menu-bar__win-btn--close" @click.stop="menuBarStore.close()">
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { proxySettingStore } from '@/views/setting/components/ProxySetting/proxySetting.store';
import { updateStore } from '@/store/update.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { menuBarStore } from './menuBar.store';

const title = import.meta.env.VITE_MAIN_TITLE || 'BitterLess';

const handleRestartUpdate = (): void => {
  updateStore.restartAndUpdate();
};

const handleDblClick = (): void => {
  if (menuBarStore.isWindows) {
    menuBarStore.toggleMaximize();
  }
};

onMounted(() => {
  menuBarStore.init();
});
</script>

<style lang="less">
@import './MenuBar.less';
</style>
