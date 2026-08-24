import assert from 'node:assert/strict';
import { test } from 'node:test';
import { source } from './onlyPreviewCoreTest.helper.mjs';

test('Markdown rendering and selection counts stay renderer-only, inert, and host-scoped', () => {
  const packageJson = JSON.parse(source('package.json'));
  assert.equal(packageJson.dependencies.marked, '18.0.7');
  assert.equal(packageJson.dependencies.dompurify, '3.4.12');

  const classifier = source('src/main/onlypreview/onlyPreviewClassifier.service.ts');
  assert.match(classifier, /TEXT_EXTENSIONS[\s\S]*'\.md'[\s\S]*'\.mdx'/);
  assert.match(classifier, /'\.md':\s*'markdown'/);
  assert.match(classifier, /'\.markdown':\s*'markdown'/);
  assert.match(classifier, /'\.mdx':\s*'markdown'/);

  const surface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  const markdownBranch = surface.indexOf('<MarkdownPreview');
  const monacoBranch = surface.indexOf('<MonacoTextPreview');
  assert.ok(markdownBranch >= 0 && markdownBranch < monacoBranch);
  assert.match(surface, /descriptor\.extension === '\.md'/);
  assert.doesNotMatch(surface, /descriptor\.extension === '\.mdx'/);
  assert.doesNotMatch(surface, /descriptor\.extension === '\.markdown'/);
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  assert.match(region, /descriptor\.extension === '\.md'[\s\S]*adapterId: 'markdown-dom'/);
  assert.doesNotMatch(region, /descriptor\.extension === '\.mdx'/);

  const markdownService = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts'
  );
  assert.match(markdownService, /from 'marked'/);
  assert.match(markdownService, /from 'dompurify'/);
  assert.match(markdownService, /ONLY_PREVIEW_MAX_MARKDOWN_BYTES/);
  assert.match(markdownService, /class OnlyPreviewMarkdownRenderer extends Renderer/);
  assert.match(markdownService, /html\(\{ text \}[\s\S]*escapeHtml\(text\)/);
  assert.match(markdownService, /image\(\{ text \}[\s\S]*\[Image:/);
  assert.match(markdownService, /purifier\.sanitize\(parsed/);
  assert.match(markdownService, /ALLOWED_ATTR:\s*\[\]/);
  assert.match(markdownService, /ALLOW_ARIA_ATTR:\s*false/);
  assert.match(markdownService, /ALLOW_DATA_ATTR:\s*false/);
  assert.match(markdownService, /ALLOWED_NAMESPACES:\s*\['http:\/\/www\.w3\.org\/1999\/xhtml'\]/);

  const markdownComponent = source(
    'src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue'
  );
  assert.match(markdownComponent, /v-html="renderResult\.html"/);
  assert.match(markdownComponent, /countOnlyPreviewDomSelection\(documentRef\.value/);
  assert.match(markdownComponent, /document\.addEventListener\('selectionchange'/);
  assert.match(markdownComponent, /document\.removeEventListener\('selectionchange'/);
  assert.match(markdownComponent, /reportCharacterCount\(0, props\.reportingRevision\)/);
  assert.match(markdownComponent, /armCharacterCountReporting\(props\.reportingRevision\)/);

  const markdownStyle = source(
    'src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.less'
  );
  assert.match(markdownStyle, /width:\s*min\(860px, 100%\)/);
  assert.match(markdownStyle, /overflow:\s*auto/);
  assert.match(markdownStyle, /--onlypreview-royal/);
  assert.match(markdownStyle, /border-collapse:\s*collapse/);
  assert.doesNotMatch(markdownStyle, /animation|transition/);

  const characterService = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewCharacterCount.service.ts'
  );
  assert.match(characterService, /new Intl\.Segmenter\(undefined, \{ granularity: 'grapheme' \}\)/);
  assert.match(characterService, /Array\.from\(value\)\.length/);
  assert.match(characterService, /root\.contains\(selection\.anchorNode\)/);
  assert.match(characterService, /root\.contains\(selection\.focusNode\)/);

  const monaco = source(
    'src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue'
  );
  assert.match(monaco, /onDidChangeCursorSelection/);
  assert.match(monaco, /getSelections\(\)/);
  assert.match(monaco, /filter\(\(selection\) => !selection\.isEmpty\(\)\)/);
  assert.match(monaco, /getValueInRange\(selection\)/);
  assert.match(monaco, /selectionDisposable\?\.dispose\(\)/);
  assert.match(monaco, /reportCharacterCount\(0, props\.reportingRevision\)/);
  assert.match(monaco, /armCharacterCountReporting\(props\.reportingRevision\)/);

  const characterCountGate = source(
    'src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts'
  );
  assert.match(characterCountGate, /class OnlyPreviewCharacterCountSourceGate/);
  assert.match(characterCountGate, /revision === this\.currentRevision/);
  assert.match(characterCountGate, /this\.armedRevision === revision/);
  assert.match(characterCountGate, /class OnlyPreviewCharacterCountHostGate/);
  assert.match(characterCountGate, /this\.readyRevision === this\.currentRevision/);
  assert.match(characterCountGate, /canBufferCount\(characterCount: number\)/);
  assert.match(characterCountGate, /isSuspended\(\): boolean/);
  assert.match(characterCountGate, /revisionForSync\(\): string/);

  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(
    previewStore,
    /xpcRenderer\.broadcast\(ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT, \{\s*hostId,\s*characterCount\s*\}\);/
  );
  assert.match(previewStore, /getVuePreviewPresentation\(\{ hostToken, previewRuntimeToken \}\)/);
  assert.match(previewStore, /presentationFetchGeneration/);
  assert.match(
    previewStore,
    /reportPreviewReset\(\{[\s\S]*selectionRevision,[\s\S]*previewRuntimeToken/
  );
  assert.match(previewStore, /await nextTick\(\);[\s\S]*reportPreviewReset/);
  assert.match(previewStore, /const reportingRevision = String\(revision\)/);
  assert.match(
    previewStore,
    /reportPreviewReady\(\{[\s\S]*hostToken,[\s\S]*selectionRevision,[\s\S]*previewRuntimeToken/
  );
  assert.match(
    previewStore,
    /reportPreviewError\(\{ hostToken, selectionRevision, previewRuntimeToken, errorCode \}\)/
  );
  assert.match(
    previewStore,
    /ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT, \{[\s\S]*?hostId,[\s\S]*?revision: reportingRevision[\s\S]*?\}/
  );
  assert.match(previewStore, /characterCountGate\.canReport\(reportingRevision, normalizedCount\)/);
  assert.doesNotMatch(
    previewStore,
    /ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT|ONLY_PREVIEW_REFRESH_EVENT|ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT|ONLY_PREVIEW_PREVIEW_CONTROL_EVENT/
  );
  assert.doesNotMatch(previewStore, /selectedText|selectionText|text:\s*character/);
  assert.doesNotMatch(
    source('src/shared/onlypreview/onlyPreview.types.ts'),
    /PREVIEW_CONTROL|PreviewControl|CHARACTER_COUNT_TRANSITION|CHARACTER_COUNT_SYNC_REQUEST|characterCountTransition|characterCountSyncRequest/
  );

  const previewToolbar = source(
    'src/renderer/onlypreview/shell/src/components/PreviewToolbar/PreviewToolbar.vue'
  );
  assert.match(previewToolbar, /presentation\.value\?\.descriptor\?\.relativePath/);
  assert.match(previewToolbar, /presentation\.value\?\.fileRef\?\.relativePath/);
  assert.match(previewToolbar, /<FileActions \/>/);
  assert.doesNotMatch(previewToolbar, /xpcRenderer/);

  const previewSurface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  assert.doesNotMatch(previewSurface, /FileActions/);

  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const shellEvents = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts'
  );
  assert.match(shellEvents, /keys\.length === 2/);
  assert.match(shellEvents, /Number\.isSafeInteger\(event\.characterCount\)/);
  assert.match(
    shellEvents,
    /isCharacterCountEvent\(params\) && isCurrentHost\(params\)[\s\S]*handlers\.characterCountChanged\(params\.characterCount\)/
  );
  assert.match(shellStore, /characterCountGate\.canAcceptCount\(characterCount\)/);
  assert.match(shellStore, /characterCountGate\.canBufferCount\(characterCount\)/);
  assert.match(shellEvents, /ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT/);
  assert.match(shellStore, /characterCountGate\.acceptReady\(revision\)/);
  assert.match(shellEvents, /isOnlyPreviewPresentationNudge/);
  assert.match(shellStore, /getPreviewPresentation\(\{ hostToken \}\)/);
  assert.match(shellStore, /previewPresentationFetchGeneration/);
  assert.doesNotMatch(shellStore, /crypto\.randomUUID/);
  assert.match(shellEvents, /ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT/);
  assert.match(shellEvents, /ONLY_PREVIEW_SELECTION_CHANGED_EVENT/);
  const selectFile = shellStore.slice(
    shellStore.indexOf('private async selectFile('),
    shellStore.indexOf('private expandSelectedParents()')
  );
  assert.match(
    selectFile,
    /this\.restoreGeneration \+= 1;[\s\S]*this\.selectedRelativePath = relativePath/
  );
  assert.match(
    selectFile,
    /catch \(error\)[\s\S]*if \(generation !== this\.selectionGeneration\) return;[\s\S]*await this\.syncSelection\(\);[\s\S]*if \(generation !== this\.selectionGeneration\) return;/
  );
  const directRefresh = shellStore.slice(
    shellStore.indexOf('async refresh()'),
    shellStore.indexOf('async openSettings()')
  );
  assert.match(directRefresh, /await this\.refreshIndex\(\)/);
  assert.doesNotMatch(directRefresh, /broadcast\(ONLY_PREVIEW_REFRESH_EVENT/);

  assert.match(shellEvents, /ONLY_PREVIEW_REFRESH_EVENT/);
  const nativeRefresh = shellStore.slice(
    shellStore.indexOf('refresh: () =>'),
    shellStore.indexOf('browseListing:')
  );
  assert.match(nativeRefresh, /this\.refreshIndex\(\)/);
  assert.match(shellStore, /const reportingRevision = String\(presentation\.selectionRevision\)/);

  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.ok(
    shellApp.indexOf('selectedCharacterStatus') < shellApp.indexOf('{{ selectedFileType }}'),
    'selected count must appear before type and size'
  );
  assert.match(shellApp, /selectedCharacterCount > 0/);
  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  assert.match(shellStyle, /\.onlypreview-shell__status-rail[\s\S]*height:\s*25px/);
  assert.match(shellStyle, /flex:\s*0 0 25px/);

  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.match(i18n, /selectedCharacters:\s*'Selected \{count\} characters'/);
  assert.match(i18n, /selectedCharacters:\s*'已选择 \{count\} 个字符'/);
  assert.match(i18n, /markdownLimit:\s*'Markdown rendering is limited to 1 MB\.'/);

  const sharedTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  const api = sharedTypes.match(/export interface OnlyPreviewApi \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(api);
  assert.doesNotMatch(api, /characterCount|reportingRevision|selectedText|selectionText/);
  for (const mainBoundary of [
    'src/main/xpc/onlyPreview.handler.ts',
    'src/preload/onlypreview/onlypreview.preload.ts'
  ]) {
    assert.doesNotMatch(source(mainBoundary), /CHARACTER_COUNT_|characterCount/);
  }
});

test('image and native media adapters keep renderer-owned lifecycle and no text/find claims', () => {
  const surface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  assert.match(surface, /<ImagePreview/);
  assert.match(surface, /<MediaPreview/);
  assert.doesNotMatch(surface, /<(?:img|audio|video)\b/);

  const imageComponent = source(
    'src/renderer/onlypreview/preview/src/components/ImagePreview/ImagePreview.vue'
  );
  assert.match(imageComponent, /tabindex="0"/);
  assert.match(imageComponent, /@pointercancel="finishPointerDrag"/);
  assert.match(imageComponent, /@lostpointercapture="finishPointerDrag"/);
  assert.match(imageComponent, /onlyPreviewPreviewStore\.reportSurfaceReady\(revision\)/);
  assert.match(
    imageComponent,
    /onlyPreviewPreviewStore\.reportSurfaceError\(revision, 'IMAGE_DECODE_FAILED'\)/
  );
  assert.doesNotMatch(imageComponent, /defineEmits/);

  const mediaComponent = source(
    'src/renderer/onlypreview/preview/src/components/MediaPreview/MediaPreview.vue'
  );
  assert.match(mediaComponent, /<audio[\s\S]*controls[\s\S]*preload="metadata"/);
  assert.match(mediaComponent, /<video[\s\S]*controls[\s\S]*preload="metadata"/);
  assert.match(
    mediaComponent,
    /element\.pause\(\)[\s\S]*removeAttribute\('src'\)[\s\S]*element\.load\(\)/
  );
  assert.match(mediaComponent, /ONLY_PREVIEW_MEDIA_METADATA_TIMEOUT_MS/);
  assert.doesNotMatch(mediaComponent, /canPlayType|defineEmits/);

  const imageService = source('src/renderer/onlypreview/preview/src/onlyPreviewImage.service.ts');
  assert.match(imageService, /await response\.blob\(\)/);
  assert.match(imageService, /URL\.createObjectURL/);
  assert.match(imageService, /await image\.decode\(\)/);
  assert.match(imageService, /URL\.revokeObjectURL/);

  const mediaService = source('src/renderer/onlypreview/preview/src/onlyPreviewMedia.service.ts');
  assert.match(mediaService, /method: 'HEAD'/);
  assert.match(mediaService, /response\.headers\.get\('accept-ranges'\)/);
  assert.match(mediaService, /code === 1[\s\S]*code === 2[\s\S]*code === 3[\s\S]*code === 4/);

  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  assert.match(region, /adapterId === 'audio' \|\| adapterId === 'video'/);
  assert.match(region, /\? 'selection'[\s\S]*: 'ttl'/);
  assert.match(region, /this\.presentation\.status !== 'loading'/);
  const adapterTextGate = region.slice(
    region.indexOf('const adapterProvidesSelectedText'),
    region.indexOf('const adapterUsesOneShotAsset')
  );
  assert.doesNotMatch(adapterTextGate, /image|audio|video/);

  const presentationType = source('src/shared/onlypreview/onlyPreview.types.ts').match(
    /export interface OnlyPreviewPreviewPresentation[^{]*[{]([\s\S]*?)\n[}]/
  )?.[1];
  assert.ok(presentationType);
  assert.doesNotMatch(presentationType, /\bfind\b/);
});

test('deep Project rows stay complete while HTML routes to the isolated Chrome surface', () => {
  const sharedTypes = source('src/shared/onlypreview/onlyPreview.types.ts');
  assert.match(sharedTypes, /export const ONLY_PREVIEW_MAX_HTML_BYTES = 1024 \* 1024;/);

  const classifier = source('src/main/onlypreview/onlyPreviewClassifier.service.ts');
  const textExtensions = classifier.match(
    /const TEXT_EXTENSIONS = new Set\(\[([\s\S]*?)\]\);/
  )?.[1];
  assert.ok(textExtensions);
  assert.match(textExtensions, /'\.htm'/);
  assert.match(textExtensions, /'\.html'/);
  assert.match(classifier, /'\.htm':\s*'html'/);
  assert.match(classifier, /'\.html':\s*'html'/);

  const surface = source(
    'src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue'
  );
  assert.doesNotMatch(surface, /HtmlPreview|PdfPreview|<(?:iframe|webview)\b/i);

  const previewStore = source('src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts');
  assert.match(
    previewStore,
    /presentation\.adapterId === 'html-page'[\s\S]*A Chromium-direct document was routed to the Vue Preview surface/
  );
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');
  const viewService = source('src/main/onlypreview/views/onlyPreviewPreviewView.service.ts');
  assert.match(region, /adapterId:\s*'html-page'/);
  assert.match(region, /onlyPreviewDocumentRegistry\.issue\(opened, revision\)/);
  assert.match(viewService, /installOnlyPreviewSessionProtocol/);
  assert.match(viewService, /setProxy\(/);
  assert.match(viewService, /setWebRTCIPHandlingPolicy\('disable_non_proxied_udp'\)/);
  const documentRegistry = source('src/main/onlypreview/onlyPreviewDocument.registry.ts');
  assert.match(documentRegistry, /script-src 'self' 'unsafe-inline'/);
  assert.match(documentRegistry, /connect-src 'none'/);
  assert.match(documentRegistry, /webrtc 'block'/);

  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const treeViewport = shellStyle.slice(
    shellStyle.indexOf('.onlypreview-shell__tree {'),
    shellStyle.indexOf('.onlypreview-shell__tree-row {')
  );
  assert.match(treeViewport, /overflow:\s*auto/);
  assert.match(
    treeViewport,
    /\.onlypreview-shell__tree::-webkit-scrollbar \{[\s\S]*width:\s*8px;[\s\S]*height:\s*8px;/
  );
  assert.match(
    treeViewport,
    /::-webkit-scrollbar-track,[\s\S]*::-webkit-scrollbar-corner \{[\s\S]*background:\s*transparent/
  );
  assert.match(
    treeViewport,
    /::-webkit-scrollbar-thumb \{[\s\S]*background:\s*var\(--onlypreview-divider\)/
  );
  const treeRow = shellStyle.slice(
    shellStyle.indexOf('.onlypreview-shell__tree-row {'),
    shellStyle.indexOf('.onlypreview-shell__tree-row:hover')
  );
  assert.match(treeRow, /width:\s*max-content/);
  assert.match(treeRow, /min-width:\s*100%/);
  assert.match(treeRow, /height:\s*27px/);
  assert.match(treeRow, /overflow:\s*visible/);
  assert.match(treeRow, /var\(--onlypreview-tree-depth\) \* 14px/);
  const treeName = shellStyle.slice(
    shellStyle.indexOf('.onlypreview-shell__tree-name {'),
    shellStyle.indexOf('.onlypreview-shell__inline-error {')
  );
  assert.match(treeName, /white-space:\s*nowrap/);
  assert.doesNotMatch(treeName, /overflow|text-overflow|ellipsis/);

  assert.match(
    shellStyle,
    /grid-template-columns:\s*var\(--onlypreview-project-width\) 5px minmax\(0, 1fr\)/
  );
  assert.match(shellStyle, /--onlypreview-project-surface:\s*#f9fafc/);
  const projectSurface = shellStyle.slice(
    shellStyle.indexOf('.onlypreview-shell__project {'),
    shellStyle.indexOf('.onlypreview-shell__project-header {')
  );
  assert.match(projectSurface, /background:\s*var\(--onlypreview-project-surface\)/);
  const resizeHandle = shellStyle.slice(
    shellStyle.indexOf('.onlypreview-shell__resize-handle {'),
    shellStyle.indexOf('.onlypreview-shell__preview-host {')
  );
  assert.match(resizeHandle, /width:\s*5px/);
  assert.match(resizeHandle, /background:\s*var\(--onlypreview-project-surface\)/);
  assert.match(resizeHandle, /cursor:\s*col-resize/);
  assert.match(resizeHandle, /touch-action:\s*none/);
  assert.doesNotMatch(resizeHandle, /border-(?:left|right)|::after|#eef0f5|#b8bdcd/);
  assert.doesNotMatch(shellStyle, /\.onlypreview-shell__resize-handle::after/);

  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.match(shellApp, /scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);

  const i18n = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.match(i18n, /htmlLimit:\s*'HTML rendering is limited to 1 MB\.'/);
  assert.match(i18n, /htmlLimit:\s*'HTML 渲染上限为 1 MB。'/);

  const api = sharedTypes.match(/export interface OnlyPreviewApi \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(api);
  assert.doesNotMatch(api, /readHtml|renderHtml|htmlContent|assetHtml/i);
  for (const rendererBoundary of [
    'src/main/xpc/onlyPreview.handler.ts',
    'src/preload/onlypreview/onlypreview.preload.ts'
  ]) {
    assert.doesNotMatch(source(rendererBoundary), /readHtml|renderHtml|htmlContent|assetHtml/i);
  }
  assert.match(source('src/renderer/onlypreview/preview/index.html'), /frame-src 'none'/);
});

test('OnlyPreview shell shows the current folder identity without a duplicate path slash', () => {
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const menuIdentity = shellApp.slice(
    shellApp.indexOf('name="onlypreview__identity"'),
    shellApp.indexOf('name="onlypreview__menuActions"')
  );
  assert.match(
    menuIdentity,
    /onlyPreviewShellStore\.workspace\?\.displayPath \|\| onlyPreviewI18n\.topbar\.noWorkspace/
  );
  assert.doesNotMatch(menuIdentity, /onlypreview-shell__location-divider|>\s*\/\s*<\/span>/);

  const projectHeader = shellApp.slice(
    shellApp.indexOf('name="onlypreview__projectHeader"'),
    shellApp.indexOf('name="onlypreview__search"')
  );
  assert.match(projectHeader, /name="onlypreview__projectTitle"/);
  assert.match(projectHeader, /class="onlypreview-shell__project-title"/);
  assert.match(
    projectHeader,
    /:title="[\s\S]*onlyPreviewShellStore\.workspace\?\.displayPath \|\| onlyPreviewI18n\.project\.label[\s\S]*"/
  );
  assert.match(
    projectHeader,
    /onlyPreviewShellStore\.workspace\?\.rootName \|\| onlyPreviewI18n\.project\.label/
  );

  const shellStyle = source('src/renderer/onlypreview/shell/src/App.less');
  assert.doesNotMatch(shellStyle, /\.onlypreview-shell__location-divider/);
  const projectTitle = shellStyle.slice(
    shellStyle.indexOf('.onlypreview-shell__project-title {'),
    shellStyle.indexOf('.onlypreview-shell__project-action.arco-btn')
  );
  assert.match(projectTitle, /min-width:\s*0/);
  assert.match(projectTitle, /flex:\s*1/);
  assert.match(projectTitle, /overflow:\s*hidden/);
  assert.match(projectTitle, /letter-spacing:\s*0/);
  assert.match(projectTitle, /text-overflow:\s*ellipsis/);
  assert.match(projectTitle, /text-transform:\s*none/);
  assert.match(projectTitle, /white-space:\s*nowrap/);
});
