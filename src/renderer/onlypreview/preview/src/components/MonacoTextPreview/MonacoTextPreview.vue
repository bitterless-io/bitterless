<template>
  <div ref="editorHostRef" name="onlypreview__monaco" class="onlypreview-monaco"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as monaco from 'monaco-editor';
import type {
  OnlyPreviewSettings,
  OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';

const props = defineProps<{
  content: OnlyPreviewTextContent;
  language: string;
  settings: OnlyPreviewSettings;
}>();

const editorHostRef = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;

const disposeEditor = (): void => {
  editor?.dispose();
  model?.dispose();
  editor = null;
  model = null;
};

const createEditor = (): void => {
  const host = editorHostRef.value;
  if (!host) return;
  disposeEditor();
  const modelUri = monaco.Uri.parse(
    `inmemory://onlypreview/${encodeURIComponent(props.content.workspaceId)}/${encodeURIComponent(props.content.relativePath)}`
  );
  model = monaco.editor.createModel(props.content.text, props.language || 'plaintext', modelUri);
  editor = monaco.editor.create(host, {
    model,
    readOnly: true,
    domReadOnly: true,
    readOnlyMessage: { value: onlyPreviewI18n.preview.editorReadOnly },
    ariaLabel: onlyPreviewI18n.preview.readOnly,
    automaticLayout: true,
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    fontLigatures: false,
    fontSize: props.settings.editorFontSize,
    lineHeight: Math.round(props.settings.editorFontSize * 1.55),
    minimap: { enabled: false },
    wordWrap: props.settings.wordWrap ? 'on' : 'off',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    renderValidationDecorations: 'off',
    overviewRulerBorder: false,
    overviewRulerLanes: 0,
    occurrencesHighlight: 'off',
    selectionHighlight: true,
    stickyScroll: { enabled: false },
    padding: { top: 10, bottom: 10 },
    theme: 'vs'
  });
};

watch(
  () => [props.content.workspaceId, props.content.relativePath, props.content.text, props.language],
  createEditor
);

watch(
  () => [props.settings.editorFontSize, props.settings.wordWrap],
  () => {
    editor?.updateOptions({
      fontSize: props.settings.editorFontSize,
      lineHeight: Math.round(props.settings.editorFontSize * 1.55),
      wordWrap: props.settings.wordWrap ? 'on' : 'off',
      readOnly: true,
      domReadOnly: true
    });
  }
);

onMounted(createEditor);
onBeforeUnmount(disposeEditor);
</script>

<style lang="less">
@import './MonacoTextPreview.less';
</style>
