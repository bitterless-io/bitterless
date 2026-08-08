<template>
  <div name="onlypreview__pdfPreview" class="onlypreview-pdf">
    <div ref="pagesRef" name="onlypreview__pdfPages" class="onlypreview-pdf__pages"></div>
    <div v-if="loading" class="onlypreview-pdf__loading" role="status">
      {{ onlyPreviewI18n.preview.loading }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AnnotationMode, getDocument, TextLayer } from 'unpdf/pdfjs';
import { interpolateOnlyPreview } from '../../../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { countOnlyPreviewDomSelection } from '../../onlyPreviewCharacterCount.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

const props = defineProps<{ assetUrl: string }>();
const pagesRef = ref<HTMLElement | null>(null);
const loading = ref(false);
let generation = 0;
let abortController: AbortController | null = null;
let loadingTask: ReturnType<typeof getDocument> | null = null;
let pdfDocument: Awaited<ReturnType<typeof getDocument>['promise']> | null = null;
let renderTasks: Array<{ cancel: () => void }> = [];
let textLayers: TextLayer[] = [];

const disposePdf = (): void => {
  onlyPreviewPreviewStore.reportCharacterCount(0);
  generation += 1;
  abortController?.abort();
  abortController = null;
  for (const renderTask of renderTasks) renderTask.cancel();
  for (const textLayer of textLayers) textLayer.cancel();
  renderTasks = [];
  textLayers = [];
  if (pdfDocument) void pdfDocument.destroy().catch(() => undefined);
  if (loadingTask) void loadingTask.destroy().catch(() => undefined);
  pdfDocument = null;
  loadingTask = null;
  if (pagesRef.value) pagesRef.value.replaceChildren();
};

const reportSelection = (): void => {
  onlyPreviewPreviewStore.reportCharacterCount(
    countOnlyPreviewDomSelection(pagesRef.value, window.getSelection())
  );
};

const renderPdf = async (): Promise<void> => {
  disposePdf();
  const runGeneration = generation;
  const pages = pagesRef.value;
  if (!pages) return;
  loading.value = true;
  abortController = new AbortController();
  try {
    const response = await fetch(props.assetUrl, { signal: abortController.signal });
    if (!response.ok) throw new Error('PDF stream failed');
    const data = new Uint8Array(await response.arrayBuffer());
    if (runGeneration !== generation) return;
    loadingTask = getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: true
    });
    pdfDocument = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (runGeneration !== generation) return;
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(240, pages.clientWidth - 36);
      const scale = Math.min(1.8, Math.max(0.55, availableWidth / baseViewport.width));
      const viewport = page.getViewport({ scale });

      const pageElement = document.createElement('section');
      pageElement.className = 'onlypreview-pdf__page';
      pageElement.setAttribute('name', 'onlypreview__pdfPage');
      pageElement.setAttribute(
        'aria-label',
        interpolateOnlyPreview(onlyPreviewI18n.preview.pdfPage, { page: pageNumber })
      );
      pageElement.style.width = `${viewport.width}px`;
      pageElement.style.height = `${viewport.height}px`;
      pageElement.style.setProperty('--scale-factor', String(viewport.scale));
      pages.append(pageElement);

      const canvas = document.createElement('canvas');
      canvas.className = 'onlypreview-pdf__canvas';
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('aria-hidden', 'true');
      pageElement.append(canvas);

      const renderTask = page.render({
        canvas,
        viewport,
        background: '#ffffff',
        intent: 'print',
        annotationMode: AnnotationMode.DISABLE
      });
      renderTasks.push(renderTask);
      await renderTask.promise;
      if (runGeneration !== generation) return;

      const textLayerElement = document.createElement('div');
      textLayerElement.className = 'textLayer onlypreview-pdf__text-layer';
      textLayerElement.setAttribute('name', 'onlypreview__pdfTextLayer');
      pageElement.append(textLayerElement);
      const textLayer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: textLayerElement,
        viewport
      });
      textLayers.push(textLayer);
      await textLayer.render();
    }
  } catch {
    if (runGeneration === generation) onlyPreviewPreviewStore.reportMediaError('pdf');
  } finally {
    if (runGeneration === generation) loading.value = false;
  }
};

watch(
  () => props.assetUrl,
  () => void renderPdf()
);
onMounted(() => {
  document.addEventListener('selectionchange', reportSelection);
  void renderPdf();
});
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', reportSelection);
  disposePdf();
});
</script>

<style lang="less">
@import './PdfPreview.less';
</style>
