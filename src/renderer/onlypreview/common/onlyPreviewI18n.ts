import { reactive } from 'vue';
import { applyRendererLanguage } from '@renderer/common/i18n/i18n.helper';
import {
  getCurrentRendererLanguage,
  initializeRendererLanguage,
  onRendererLanguageApplied
} from '@renderer/common/i18n/rendererLanguage';
import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

const en = {
  productName: 'OnlyPreview',
  bootstrapFailed: 'OnlyPreview could not start. Close and reopen it to retry.',
  topbar: {
    openFolder: 'Open folder',
    agentSkillGuide: 'Copy the skill to your agent',
    settings: 'OnlyPreview settings',
    minimize: 'Minimize OnlyPreview',
    maximize: 'Maximize or restore OnlyPreview',
    close: 'Close OnlyPreview',
    noWorkspace: 'No project open'
  },
  project: {
    label: 'Project',
    searchPlaceholder: 'Filter files and folders…',
    searchLabel: 'Filter project files and folders',
    clearSearch: 'Clear search',
    projectSearchTitle: 'Project Search',
    projectSearchPlaceholder: 'Search filenames and text…',
    projectSearchLabel: 'Search project filenames and text',
    projectSearchResultsLabel: 'Project Search results',
    projectSearchScope: 'Scope',
    projectSearchScopeLabel: 'Project Search scope',
    projectSearchInDirectory: 'In Directory',
    projectSearchInProject: 'In Project',
    projectSearchPending: 'Searching…',
    projectSearchNoResults: 'No matching files.',
    projectSearchFailed: 'Project Search is unavailable.',
    locateCurrentFile: 'Locate current preview in project',
    treeLabel: 'Project files',
    emptyTitle: 'Open a folder to inspect',
    emptyBody: 'Choose a folder to browse its project index and preview files.',
    emptyProject: 'This folder has no indexed files.',
    noResults: 'No indexed files match this search.',
    indexProgressLabel: 'Building project search index',
    selectedCharacters: 'Selected {count} characters',
    symlink: 'Symbolic link'
  },
  preview: {
    readOnly: 'Read only',
    loading: 'Preparing preview…',
    emptyTitle: 'Select a file',
    emptyBody: 'Choose a file from the project index to preview it here.',
    openExternally: 'Open in system app',
    reveal: 'Reveal in folder',
    unsupportedTitle: 'Preview not available',
    unsupportedBody:
      'This file type is not rendered in Bitterless. You can open it with its system app.',
    failedTitle: 'Preview could not be loaded',
    mediaFailed: 'Chromium could not decode or display this file.',
    pdfFailed: 'The PDF could not be rendered.',
    pdfPage: 'Page {page}',
    imageAlt: 'Preview of {name}',
    type: 'Type',
    size: 'Size',
    modified: 'Modified',
    encoding: 'Encoding',
    textLimit: 'Text preview is limited to 8 MB. Open this file in a system app to inspect it.',
    markdownLimit: 'Markdown rendering is limited to 1 MB.',
    htmlLimit: 'HTML rendering is limited to 1 MB.',
    editorReadOnly: 'OnlyPreview does not edit files.'
  },
  settings: {
    title: 'OnlyPreview settings',
    subtitle: 'Tune the reading surface and project index.',
    previewSection: 'Preview',
    projectSection: 'Project',
    appearanceSection: 'Appearance',
    fontSize: 'Editor font size',
    fontSizeHint: 'Use a value from 11 to 24 pixels.',
    wordWrap: 'Wrap long lines',
    wordWrapHint: 'Keep long text visible without horizontal scrolling.',
    singleClick: 'Preview files with one click',
    singleClickHint: 'Turn this off when you prefer double-click selection.',
    theme: 'Theme',
    light: 'Light',
    lightHint: 'Only the light reading surface is available in this release.',
    cancel: 'Cancel',
    save: 'Save changes',
    saving: 'Saving…',
    loadFailed: 'Settings could not be loaded. Close and reopen this window to retry.',
    saveFailed: 'Settings could not be saved. Your previous settings are unchanged.'
  },
  guide: {
    eyebrow: 'LOCAL MCP',
    title: 'Copy the skill to your agent',
    completeSetup: 'Complete setup instructions',
    completeSetupHint:
      'Copy these instructions to your agent. They include the skill and MCP setup.',
    copy: 'Copy complete setup instructions',
    pending: 'Loading setup instructions…',
    copied: 'Setup instructions copied.',
    copyFailed: 'Could not copy the setup instructions. Try again.',
    restartRequiredTitle: 'Restart Bitterless',
    restartRequired:
      'The setup contract is unavailable or out of date. Restart Bitterless and reopen this Guide.',
    testInstanceTitle: 'Test instance: {serverName}',
    testInstanceWarning:
      'This MCP configuration is for development verification only. Do not register it as the production bitterless server.'
  },
  errors: {
    INVALID_INPUT: 'The request was invalid.',
    HOST_NOT_FOUND: 'This preview session has ended. Reopen OnlyPreview.',
    HOST_ROLE_DENIED: 'This preview session cannot perform that action.',
    WORKSPACE_NOT_FOUND: 'This project is no longer available. Open it again.',
    WORKSPACE_ACCESS_DENIED: 'This project belongs to another preview session.',
    PATH_NOT_FOUND: 'The file is no longer at this location.',
    PATH_PERMISSION_DENIED: 'Bitterless does not have permission to read this file or folder.',
    PATH_OUTSIDE_WORKSPACE: 'The file resolves outside the open project and cannot be previewed.',
    PATH_NOT_REGULAR_FILE: 'Only regular files can be previewed.',
    PATH_UNSUPPORTED_DEVICE: 'This device or special file cannot be previewed.',
    TEXT_TOO_LARGE: 'This text file is larger than the 8 MB preview limit.',
    BINARY_TEXT: 'This file contains binary data and cannot be shown as text.',
    INVALID_ENCODING: 'The text encoding could not be decoded safely.',
    SIGNATURE_MISMATCH: 'The file contents do not match its extension.',
    SETTINGS_INVALID: 'One or more settings are invalid.',
    INDEX_FAILED: 'The project index could not be built.',
    OPERATION_FAILED: 'OnlyPreview could not complete this action.',
    PROTOCOL_ERROR: 'The preview data stream could not be opened.'
  } satisfies Record<OnlyPreviewErrorCode, string>
};

type Localized<T> = {
  [K in keyof T]: T[K] extends string ? string : Localized<T[K]>;
};

const zh: Localized<typeof en> = {
  productName: 'OnlyPreview',
  bootstrapFailed: 'OnlyPreview 无法启动。请关闭后重新打开。',
  topbar: {
    openFolder: '打开文件夹',
    agentSkillGuide: '将技能复制给你的 Agent',
    settings: 'OnlyPreview 设置',
    minimize: '最小化 OnlyPreview',
    maximize: '最大化或还原 OnlyPreview',
    close: '关闭 OnlyPreview',
    noWorkspace: '未打开项目'
  },
  project: {
    label: '项目',
    searchPlaceholder: '筛选文件和文件夹…',
    searchLabel: '筛选项目文件和文件夹',
    clearSearch: '清除搜索',
    projectSearchTitle: '项目搜索',
    projectSearchPlaceholder: '搜索文件名和文本…',
    projectSearchLabel: '搜索项目文件名和文本',
    projectSearchResultsLabel: '项目搜索结果',
    projectSearchScope: '范围',
    projectSearchScopeLabel: '项目搜索范围',
    projectSearchInDirectory: '当前目录',
    projectSearchInProject: '整个项目',
    projectSearchPending: '正在搜索…',
    projectSearchNoResults: '没有匹配的文件。',
    projectSearchFailed: '项目搜索不可用。',
    locateCurrentFile: '在项目中定位当前预览文件',
    treeLabel: '项目文件',
    emptyTitle: '打开需要查看的文件夹',
    emptyBody: '选择一个文件夹，浏览项目索引并预览文件。',
    emptyProject: '此文件夹中没有可索引的文件。',
    noResults: '索引中没有匹配的文件。',
    indexProgressLabel: '正在建立项目搜索索引',
    selectedCharacters: '已选择 {count} 个字符',
    symlink: '符号链接'
  },
  preview: {
    readOnly: '只读',
    loading: '正在准备预览…',
    emptyTitle: '选择一个文件',
    emptyBody: '从项目索引中选择文件，在此处预览。',
    openExternally: '用系统应用打开',
    reveal: '在文件夹中显示',
    unsupportedTitle: '暂不支持预览',
    unsupportedBody: '此文件类型无法在 Bitterless 中渲染。可以使用系统应用打开。',
    failedTitle: '预览加载失败',
    mediaFailed: 'Chromium 无法解码或显示此文件。',
    pdfFailed: 'PDF 无法渲染。',
    pdfPage: '第 {page} 页',
    imageAlt: '{name} 的预览',
    type: '类型',
    size: '大小',
    modified: '修改时间',
    encoding: '编码',
    textLimit: '文本预览上限为 8 MB。请使用系统应用查看。',
    markdownLimit: 'Markdown 渲染上限为 1 MB。',
    htmlLimit: 'HTML 渲染上限为 1 MB。',
    editorReadOnly: 'OnlyPreview 不会编辑文件。'
  },
  settings: {
    title: 'OnlyPreview 设置',
    subtitle: '调整阅读界面和项目索引。',
    previewSection: '预览',
    projectSection: '项目',
    appearanceSection: '外观',
    fontSize: '编辑器字号',
    fontSizeHint: '可设置为 11 至 24 像素。',
    wordWrap: '自动换行',
    wordWrapHint: '无需水平滚动即可阅读长行。',
    singleClick: '单击预览文件',
    singleClickHint: '关闭后，需要双击才会预览。',
    theme: '主题',
    light: '浅色',
    lightHint: '当前版本仅提供浅色阅读界面。',
    cancel: '取消',
    save: '保存更改',
    saving: '正在保存…',
    loadFailed: '无法加载设置。请关闭后重新打开此窗口。',
    saveFailed: '无法保存设置。原有设置保持不变。'
  },
  guide: {
    eyebrow: 'LOCAL MCP',
    title: '将技能复制给你的 Agent',
    completeSetup: '完整设置说明',
    completeSetupHint: '将这些说明复制给你的 Agent，其中包含技能与 MCP 设置。',
    copy: '复制完整设置说明',
    pending: '正在加载设置说明…',
    copied: '设置说明已复制。',
    copyFailed: '无法复制设置说明，请重试。',
    restartRequiredTitle: '重启 Bitterless',
    restartRequired: '设置契约不可用或已过期。请重启 Bitterless 后重新打开此窗口。',
    testInstanceTitle: '测试实例：{serverName}',
    testInstanceWarning: '此 MCP 配置仅用于开发验证。不要将它注册为生产 bitterless 服务。'
  },
  errors: {
    INVALID_INPUT: '请求参数无效。',
    HOST_NOT_FOUND: '当前预览会话已结束。请重新打开 OnlyPreview。',
    HOST_ROLE_DENIED: '当前预览会话不能执行此操作。',
    WORKSPACE_NOT_FOUND: '当前项目已不可用。请重新打开。',
    WORKSPACE_ACCESS_DENIED: '此项目属于另一个预览会话。',
    PATH_NOT_FOUND: '文件已不在原位置。',
    PATH_PERMISSION_DENIED: 'Bitterless 没有读取此文件或文件夹的权限。',
    PATH_OUTSIDE_WORKSPACE: '此文件指向当前项目之外，无法预览。',
    PATH_NOT_REGULAR_FILE: '只能预览普通文件。',
    PATH_UNSUPPORTED_DEVICE: '无法预览设备或特殊文件。',
    TEXT_TOO_LARGE: '此文本文件超过 8 MB 预览上限。',
    BINARY_TEXT: '此文件包含二进制数据，无法作为文本显示。',
    INVALID_ENCODING: '无法安全解码此文本编码。',
    SIGNATURE_MISMATCH: '文件内容与扩展名不匹配。',
    SETTINGS_INVALID: '一项或多项设置无效。',
    INDEX_FAILED: '无法建立项目索引。',
    OPERATION_FAILED: 'OnlyPreview 无法完成此操作。',
    PROTOCOL_ERROR: '无法打开预览数据流。'
  }
};

export const onlyPreviewI18n = reactive<Localized<typeof en>>({ ...en });

const applyCatalog = (language: 'en' | 'zh'): void => {
  const catalog = language === 'zh' ? zh : en;
  for (const key of Object.keys(catalog) as Array<keyof typeof catalog>) {
    (onlyPreviewI18n as Record<string, unknown>)[key] = catalog[key];
  }
};

export const initializeOnlyPreviewI18n = async (): Promise<void> => {
  try {
    await initializeRendererLanguage();
    applyCatalog(getCurrentRendererLanguage());
  } catch {
    applyRendererLanguage('en');
    applyCatalog('en');
  }
  onRendererLanguageApplied((language) => applyCatalog(language));
};

export const getOnlyPreviewErrorMessage = (code: OnlyPreviewErrorCode): string =>
  onlyPreviewI18n.errors[code] || onlyPreviewI18n.errors.OPERATION_FAILED;
