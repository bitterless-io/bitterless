<template>
  <section
    ref="viewportElement"
    name="onlypreview__imagePreview"
    class="onlypreview-image"
    :class="{
      'onlypreview-image--pannable': isPannable,
      'onlypreview-image--dragging': dragState !== null
    }"
    :aria-label="onlyPreviewI18n.preview.imageViewport"
    tabindex="0"
    @keydown="handleKeydown"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="finishPointerDrag"
    @pointercancel="finishPointerDrag"
    @lostpointercapture="finishPointerDrag"
  >
    <div
      name="onlypreview__imageControls"
      class="onlypreview-image__controls"
      role="toolbar"
      :aria-label="onlyPreviewI18n.preview.imageViewport"
      @pointerdown.stop
    >
      <button
        type="button"
        class="onlypreview-image__control"
        :disabled="viewportState.mode === 'fit'"
        :aria-label="onlyPreviewI18n.preview.imageFit"
        :title="onlyPreviewI18n.preview.imageFit"
        @click="fitImage"
      >
        <IconAspectRatio :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="onlypreview-image__control"
        :disabled="viewportState.scale <= minimumScale"
        :aria-label="onlyPreviewI18n.preview.imageZoomOut"
        :title="onlyPreviewI18n.preview.imageZoomOut"
        @click="zoomImage('out')"
      >
        <IconZoomOut :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="onlypreview-image__control"
        :disabled="viewportState.scale >= ONLY_PREVIEW_IMAGE_MAX_SCALE"
        :aria-label="onlyPreviewI18n.preview.imageZoomIn"
        :title="onlyPreviewI18n.preview.imageZoomIn"
        @click="zoomImage('in')"
      >
        <IconZoomIn :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="onlypreview-image__control"
        :disabled="isAtReset"
        :aria-label="onlyPreviewI18n.preview.imageReset"
        :title="onlyPreviewI18n.preview.imageReset"
        @click="resetImage"
      >
        <IconZoomReset :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="onlypreview-image__origin" :style="originStyle">
      <img
        v-if="!failed"
        name="onlypreview__imageContent"
        class="onlypreview-image__content"
        :style="imageStyle"
        :src="content.objectUrl"
        :alt="alt"
        :width="content.naturalWidth"
        :height="content.naturalHeight"
        draggable="false"
        @load="handleImageLoad"
        @error="handleImageError"
        @dragstart.prevent
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { IconAspectRatio, IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-vue';
import type { OnlyPreviewImageRender } from '../../onlyPreviewImage.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import {
  ONLY_PREVIEW_IMAGE_KEYBOARD_PAN_PX,
  ONLY_PREVIEW_IMAGE_MAX_SCALE,
  fitOnlyPreviewImageViewport,
  getOnlyPreviewImageMinimumScale,
  getOnlyPreviewImagePanBounds,
  panOnlyPreviewImageViewport,
  resetOnlyPreviewImageViewport,
  resizeOnlyPreviewImageViewport,
  zoomOnlyPreviewImageViewport,
  type OnlyPreviewImageDimensions,
  type OnlyPreviewImageViewportState
} from '../../onlyPreviewImageViewport.service';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';

const props = defineProps<{
  content: OnlyPreviewImageRender;
  alt: string;
  reportingRevision: string;
}>();

const viewportElement = ref<HTMLElement | null>(null);
const viewportSize = reactive({ width: 0, height: 0 });
const viewportState = reactive<OnlyPreviewImageViewportState>({
  mode: 'fit',
  scale: 1,
  offsetX: 0,
  offsetY: 0
});
const failed = ref(false);
const readySent = ref(false);
const dragState = ref<{ pointerId: number; x: number; y: number } | null>(null);
let resizeObserver: ResizeObserver | null = null;
let active = true;

const dimensions = (): OnlyPreviewImageDimensions => ({
  naturalWidth: props.content.naturalWidth,
  naturalHeight: props.content.naturalHeight,
  viewportWidth: viewportSize.width,
  viewportHeight: viewportSize.height
});

const assignState = (state: OnlyPreviewImageViewportState): void => {
  Object.assign(viewportState, state);
};

const panBounds = computed(() => getOnlyPreviewImagePanBounds(dimensions(), viewportState.scale));
const minimumScale = computed(() => getOnlyPreviewImageMinimumScale(dimensions()));
const isPannable = computed(() => panBounds.value.maxX > 0 || panBounds.value.maxY > 0);
const isAtReset = computed(
  () =>
    viewportState.mode === 'manual' &&
    viewportState.scale === 1 &&
    viewportState.offsetX === 0 &&
    viewportState.offsetY === 0
);
const originStyle = computed(() => ({
  width: `${props.content.naturalWidth}px`,
  height: `${props.content.naturalHeight}px`,
  transform: `translate(-50%, -50%) translate(${viewportState.offsetX}px, ${viewportState.offsetY}px)`
}));
const imageStyle = computed(() => ({ transform: `scale(${viewportState.scale})` }));

const releasePointer = (): void => {
  const drag = dragState.value;
  const viewport = viewportElement.value;
  dragState.value = null;
  if (!drag || !viewport?.hasPointerCapture?.(drag.pointerId)) return;
  viewport.releasePointerCapture(drag.pointerId);
};

const fitImage = (): void => {
  releasePointer();
  assignState(fitOnlyPreviewImageViewport(dimensions()));
};

const resetImage = (): void => {
  releasePointer();
  assignState(resetOnlyPreviewImageViewport(dimensions()));
};

const zoomImage = (direction: 'in' | 'out'): void => {
  releasePointer();
  assignState(zoomOnlyPreviewImageViewport(viewportState, direction, dimensions()));
};

const handlePointerDown = (event: PointerEvent): void => {
  const target = event.target;
  if (
    !event.isPrimary ||
    event.button !== 0 ||
    !isPannable.value ||
    (target instanceof Element && target.closest('.onlypreview-image__controls'))
  ) {
    return;
  }
  event.preventDefault();
  releasePointer();
  dragState.value = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  viewportElement.value?.setPointerCapture?.(event.pointerId);
};

const handlePointerMove = (event: PointerEvent): void => {
  const drag = dragState.value;
  if (!drag || event.pointerId !== drag.pointerId || !event.isPrimary) return;
  const deltaX = event.clientX - drag.x;
  const deltaY = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  assignState(panOnlyPreviewImageViewport(viewportState, deltaX, deltaY, dimensions()));
};

const finishPointerDrag = (event: PointerEvent): void => {
  if (dragState.value?.pointerId !== event.pointerId) return;
  releasePointer();
};

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.target !== event.currentTarget || !isPannable.value) return;
  let deltaX = 0;
  let deltaY = 0;
  if (event.key === 'ArrowLeft') deltaX = ONLY_PREVIEW_IMAGE_KEYBOARD_PAN_PX;
  else if (event.key === 'ArrowRight') deltaX = -ONLY_PREVIEW_IMAGE_KEYBOARD_PAN_PX;
  else if (event.key === 'ArrowUp') deltaY = ONLY_PREVIEW_IMAGE_KEYBOARD_PAN_PX;
  else if (event.key === 'ArrowDown') deltaY = -ONLY_PREVIEW_IMAGE_KEYBOARD_PAN_PX;
  else return;
  event.preventDefault();
  assignState(panOnlyPreviewImageViewport(viewportState, deltaX, deltaY, dimensions()));
};

const handleImageLoad = async (event: Event): Promise<void> => {
  const image = event.currentTarget;
  const revision = props.reportingRevision;
  const objectUrl = props.content.objectUrl;
  if (
    readySent.value ||
    failed.value ||
    !(image instanceof HTMLImageElement) ||
    image.src !== objectUrl ||
    !revision
  ) {
    return;
  }
  await nextTick();
  if (
    !active ||
    !image.isConnected ||
    failed.value ||
    revision !== props.reportingRevision ||
    objectUrl !== props.content.objectUrl ||
    image.src !== objectUrl
  ) {
    return;
  }
  readySent.value = true;
  onlyPreviewPreviewStore.reportSurfaceReady(revision);
};

const handleImageError = async (): Promise<void> => {
  if (failed.value) return;
  const revision = props.reportingRevision;
  failed.value = true;
  releasePointer();
  await nextTick();
  if (!active || revision !== props.reportingRevision || !failed.value) return;
  onlyPreviewPreviewStore.reportSurfaceError(revision, 'IMAGE_DECODE_FAILED');
};

onMounted(() => {
  const viewport = viewportElement.value;
  if (!viewport) return;
  const updateSize = (width: number, height: number): void => {
    releasePointer();
    viewportSize.width = Math.max(0, width);
    viewportSize.height = Math.max(0, height);
    assignState(resizeOnlyPreviewImageViewport(viewportState, dimensions()));
  };
  updateSize(viewport.clientWidth, viewport.clientHeight);
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    updateSize(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(viewport);
});

onBeforeUnmount(() => {
  active = false;
  resizeObserver?.disconnect();
  resizeObserver = null;
  releasePointer();
  failed.value = true;
});
</script>

<style lang="less">
@import './ImagePreview.less';
</style>
