<template>
  <section
    name="terminal-setting"
    class="terminal-setting"
    :aria-busy="terminalSettingStore.loading"
  >
    <p class="terminal-setting__description">{{ i18nHelper.setting.terminal.sharedDescription }}</p>
    <div name="terminal-setting__shortcuts" class="terminal-setting__shortcuts">
      <label class="terminal-setting__field">
        <span>{{ i18nHelper.zellij.splitDown }}</span>
        <a-input
          v-model="terminalSettingStore.draft.splitDown"
          :max-length="80"
          :disabled="!terminalSettingStore.ready"
          :aria-label="i18nHelper.zellij.splitDown"
        />
      </label>
      <label class="terminal-setting__field">
        <span>{{ i18nHelper.zellij.splitRight }}</span>
        <a-input
          v-model="terminalSettingStore.draft.splitRight"
          :max-length="80"
          :disabled="!terminalSettingStore.ready"
          :aria-label="i18nHelper.zellij.splitRight"
        />
      </label>
      <label class="terminal-setting__field">
        <span>{{ i18nHelper.zellij.closePane }}</span>
        <a-input
          v-model="terminalSettingStore.draft.closePane"
          :max-length="80"
          :disabled="!terminalSettingStore.ready"
          :aria-label="i18nHelper.zellij.closePane"
        />
      </label>
    </div>
    <p class="terminal-setting__hint">{{ i18nHelper.zellij.shortcutsHint }}</p>
    <div class="terminal-setting__actions">
      <a-button
        size="small"
        type="primary"
        :loading="terminalSettingStore.saving"
        :disabled="!terminalSettingStore.ready || terminalSettingStore.loading"
        @click="terminalSettingStore.save()"
        >{{ i18nHelper.zellij.save }}</a-button
      >
      <a-button
        size="small"
        type="text"
        :loading="terminalSettingStore.loading"
        :disabled="terminalSettingStore.saving"
        @click="terminalSettingStore.load()"
        >{{ i18nHelper.zellij.refresh }}</a-button
      >
    </div>
    <p
      v-if="terminalSettingStore.errorMessage"
      name="terminal-setting__error"
      class="terminal-setting__error"
      role="alert"
    >
      {{ terminalSettingStore.errorMessage }}
    </p>
    <div name="terminal-setting__directory" class="terminal-setting__directory">
      <span>{{ i18nHelper.zellij.configDirectory }}</span>
      <bdi>{{ terminalSettingStore.configDirectory }}</bdi>
      <div class="terminal-setting__actions">
        <a-button
          size="small"
          type="text"
          :disabled="!terminalSettingStore.configDirectory"
          @click="terminalSettingStore.copyDirectory()"
          >{{ i18nHelper.zellij.copy }}</a-button
        >
        <a-button
          size="small"
          type="text"
          :disabled="!terminalSettingStore.configDirectory"
          @click="terminalSettingStore.openDirectory()"
          >{{ i18nHelper.zellij.open }}</a-button
        >
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { terminalSettingStore } from './terminalSetting.store';

onMounted(() => terminalSettingStore.load());
</script>

<style lang="less">
@import './TerminalSetting.less';
</style>
