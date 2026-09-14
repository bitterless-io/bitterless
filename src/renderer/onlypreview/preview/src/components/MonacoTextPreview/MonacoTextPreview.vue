<template>
  <div ref="editorHostRef" name="onlypreview__monaco" class="onlypreview-monaco"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
// **API-only 入口,不是 barrel。** `monaco-editor` 的 barrel(`editor.main`)会额外导入
// `basic-languages/monaco.contribution`(全部 monarch 语法)以及 css/html/json/typescript
// 四个语言贡献 —— 后四个会**按需去取语言 worker**,而那四个 worker 已经不打包了
// (`electron.vite.config.ts` 的 `languageWorkers`,它们一个消费者都没有)。留着 barrel 的话,
// 打开一个 .ts 文件会让 Monaco 去取一个不存在的 worker —— 那就是把 12 MB 换成一串错误。
//
// 上色不受影响:2026-09-08 起由 shiki 的 TextMate 语法做,经 `@shikijs/monaco` 装进 Monaco。
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
// API-only 入口**不带** folding contribution(只有 `editor.all` barrel 带)—— 光传 `folding: true`
// 什么都不会发生。这里按副作用导入它:模块顶层 `registerEditorContribution(FoldingController, Eager)`,
// 必须在 `monaco.editor.create` 之前执行,编辑器才会实例化它。它自带的 `folding.d.ts` 就是
// `export {}`,所以这一行在 strict 下也是类型干净的,不需要本地 .d.ts。
// (docs/plan/tasks/onlypreview-structured-text-folding-172.md)
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding';
// 折叠槽的展开/收起图标是 **codicon 字形**(`foldingDecorations.js`:chevron-down / chevron-right)。
// 主题服务只注入 `.codicon-folding-expanded:before { content: '\eab4' }`,字体本身
// (`@font-face codicon` ＋ `.codicon` 基础规则)在 `codiconStyles.js` 里,而它只被 `editor.all`
// barrel 与 suggest / codeAction / gotoSymbol quick-access 三个 widget 导入 —— API-only 入口和
// folding.js 都不带(含传递依赖)。
// 不导入的话,那个私有区码位落到回退字体上,渲染成一个空心方框(Ral 2026-09-10 截图)。
// 与 `editor.all.js` 的做法一致:「The codicons are defined here and must be loaded」。
// (docs/issues/onlypreview-folding-icons-render-as-boxes.md)
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codiconStyles';
import type {
  OnlyPreviewSettings,
  OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { countOnlyPreviewSelectionTexts } from '../../onlyPreviewCharacterCount.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import { onlyPreviewFindAdapterBridge } from '../../onlyPreviewFindAdapter.service';
import { createOnlyPreviewMonacoFindAdapter } from '../../onlyPreviewMonacoFind.service';
import { resolveOnlyPreviewMonacoFolding } from '../../onlyPreviewMonacoFolding.service';
import { prepareMonacoHighlighting } from '../../onlyPreviewMonacoHighlight.service';

const props = defineProps<{
  content: OnlyPreviewTextContent;
  language: string;
  reportingRevision: string;
  settings: OnlyPreviewSettings;
}>();
const emit = defineEmits<{ ready: [] }>();

const editorHostRef = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
let selectionDisposable: monaco.IDisposable | null = null;
let findAdapter: ReturnType<typeof createOnlyPreviewMonacoFindAdapter> | null = null;
let unregisterFindAdapter: (() => void) | null = null;
// `createEditor` 现在是异步的(要等 shiki 的语法),而两个 `watch` 与 `onMounted` 都能触发它。
// 没有这道围栏的话,await 期间到来的第二次调用会先建好编辑器,然后被第一次调用的后续代码覆盖
// —— 表现成「打开 B 文件却显示 A 的内容」。这不是理论风险:切一次文件就是连续两次触发。
let createGeneration = 0;

const disposeEditor = (): void => {
  selectionDisposable?.dispose();
  selectionDisposable = null;
  unregisterFindAdapter?.();
  unregisterFindAdapter = null;
  findAdapter?.dispose();
  findAdapter = null;
  onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
  editor?.dispose();
  model?.dispose();
  editor = null;
  model = null;
};

// 「默认最多预览 5 层」= 跑 Monaco 自己的 `editor.foldLevel6`(第 6 层折起,更深的随之隐藏)。
// 走公开的 `getAction().run()` 而不是导入没有类型的 `foldingModel.js`;那个 action 自己会等
// 折叠模型算完。**不 await**:折叠模型有约 200ms 的 debounce,不该拖住 `ready` 与 find adapter。
// 等待期间切了文件的话,Monaco 会用取消错误拒绝这个 promise —— 编辑器已经销毁,没有别的可做。
const collapseDeepLevels = async (
  target: monaco.editor.IStandaloneCodeEditor,
  actionId: string
): Promise<void> => {
  try {
    await target.getAction(actionId)?.run();
  } catch {
    // 编辑器在等折叠模型时被 dispose(切文件)。
  }
};

const createEditor = async (): Promise<void> => {
  if (!editorHostRef.value) return;
  const generation = ++createGeneration;
  disposeEditor();
  // 等语法**再**建 model,而不是先建后重新分词:后者会看到一次「白 → 有色」的跳变。
  // 超时(见 `prepareMonacoHighlighting`)退回纯文本,所以慢语法不会把预览卡住。
  const highlighting = await prepareMonacoHighlighting(monaco, props.language);
  // await 之后一切都要重新确认:这期间可能已经切了文件,或者组件已经卸载。
  if (generation !== createGeneration) return;
  const host = editorHostRef.value;
  if (!host) return;
  const modelUri = monaco.Uri.parse(
    `inmemory://onlypreview/${encodeURIComponent(props.content.workspaceId)}/${encodeURIComponent(props.content.relativePath)}`
  );
  model = monaco.editor.createModel(
    props.content.text,
    highlighting.language,
    modelUri
  );
  // 按分类器的语言 id 决定,不按 shiki 归一化后的高亮语言。
  const foldingPlan = resolveOnlyPreviewMonacoFolding(props.language);
  editor = monaco.editor.create(host, {
    model,
    readOnly: true,
    domReadOnly: true,
    readOnlyMessage: { value: onlyPreviewI18n.preview.editorReadOnly },
    ariaLabel: onlyPreviewI18n.preview.readOnly,
    automaticLayout: true,
    largeFileOptimizations: true,
    maxTokenizationLineLength: 20_000,
    stopRenderingLineAfter: 20_000,
    // 显式传 `folding`:contribution 装上以后 Monaco 的默认值是 true,不写的话所有文本预览都会
    // 多出折叠槽;需求只要 JSON/XML/YAML。这几种语言没注册 folding range provider,'auto' 本来
    // 也会退到缩进,写死 'indentation' 只是把它钉住。
    folding: foldingPlan.folding,
    foldingStrategy: 'indentation',
    showFoldingControls: 'always',
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    fontLigatures: false,
    fontSize: props.settings.editorFontSize,
    lineHeight: Math.round(props.settings.editorFontSize * 1.55),
    minimap: { enabled: false },
    wordWrap: props.settings.wordWrap ? 'on' : 'off',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      verticalSliderSize: 8,
      horizontalSliderSize: 8
    },
    renderValidationDecorations: 'off',
    overviewRulerBorder: false,
    overviewRulerLanes: 0,
    occurrencesHighlight: 'off',
    selectionHighlight: true,
    stickyScroll: { enabled: false },
    padding: { top: 10, bottom: 10 },
    ...(highlighting.theme ? { theme: highlighting.theme } : {})
  });
  if (foldingPlan.collapseActionId) void collapseDeepLevels(editor, foldingPlan.collapseActionId);
  selectionDisposable = editor.onDidChangeCursorSelection(() => {
    const currentEditor = editor;
    const currentModel = model;
    if (!currentEditor || !currentModel) return;
    const selectedTexts = (currentEditor.getSelections() || [])
      .filter((selection) => !selection.isEmpty())
      .map((selection) => currentModel.getValueInRange(selection));
    onlyPreviewPreviewStore.reportCharacterCount(
      countOnlyPreviewSelectionTexts(selectedTexts),
      props.reportingRevision
    );
  });
  const selectionRevision = Number(props.reportingRevision);
  if (Number.isSafeInteger(selectionRevision) && selectionRevision >= 0) {
    findAdapter = createOnlyPreviewMonacoFindAdapter(editor, model);
    unregisterFindAdapter = onlyPreviewFindAdapterBridge.register(
      'monaco',
      selectionRevision,
      findAdapter
    );
    emit('ready');
  }
  onlyPreviewPreviewStore.armCharacterCountReporting(props.reportingRevision);
};

watch(
  () => [
    props.content.workspaceId,
    props.content.relativePath,
    props.content.text,
    props.language,
    props.reportingRevision
  ],
  () => {
    void createEditor();
  }
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

onMounted(() => {
  void createEditor();
});
onBeforeUnmount(disposeEditor);
</script>

<style lang="less">
@import './MonacoTextPreview.less';
</style>
