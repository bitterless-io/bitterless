<template>
  <div class="system-prompt-setting">
    <div class="system-prompt-setting__form">
      <div class="system-prompt-setting__field">
        <label class="system-prompt-setting__label">{{ i18nHelper.setting.systemPrompt.label }}</label>
        <div class="system-prompt-setting__hint">{{ i18nHelper.setting.systemPrompt.hint }}</div>
        <div ref="editorContainer" class="system-prompt-setting__editor"></div>
      </div>
      <div class="system-prompt-setting__actions">
        <a-button type="primary" :loading="systemPromptSettingStore.loading" @click="handleSave">
          {{ i18nHelper.setting.systemPrompt.save }}
        </a-button>
        <span v-if="systemPromptSettingStore.saveStatus === 'success'" class="system-prompt-setting__status--success">
          {{ i18nHelper.setting.systemPrompt.saveSuccess }}
        </span>
        <span v-if="systemPromptSettingStore.saveStatus === 'failed'" class="system-prompt-setting__status--failed">
          {{ i18nHelper.setting.systemPrompt.saveFailed }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as monaco from 'monaco-editor';
import { systemPromptSettingStore, saveSystemPromptSetting, loadSystemPromptSetting } from './systemPromptSetting.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const editorContainer = ref<HTMLElement | null>(null);
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;

onMounted(async () => {
  await loadSystemPromptSetting();

  if (editorContainer.value) {
    editorInstance = monaco.editor.create(editorContainer.value, {
      value: systemPromptSettingStore.formSetting.content,
      language: 'markdown',
      theme: 'vs',
      automaticLayout: true,
      wordWrap: 'on',
      minimap: { enabled: false },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      fontSize: 14,
      lineHeight: 22,
      padding: { top: 8, bottom: 8 },
    });

    editorInstance.onDidChangeModelContent(() => {
      if (editorInstance) {
        systemPromptSettingStore.formSetting.content = editorInstance.getValue();
      }
    });
  }
});

onBeforeUnmount(() => {
  if (editorInstance) {
    editorInstance.dispose();
    editorInstance = null;
  }
});

const handleSave = async (): Promise<void> => {
  await saveSystemPromptSetting();
};

</script>

<style lang="less">
@import './SystemPromptSetting.less';
</style>
