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
        :aria-label="onlyPreviewI18n.preview.imageRotateLeft"
        :title="onlyPreviewI18n.preview.imageRotateLeft"
        @click="rotateImage('left')"
      >
        <IconRotate :size="16" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="onlypreview-image__control"
        :aria-label="onlyPreviewI18n.preview.imageRotateRight"
        :title="onlyPreviewI18n.preview.imageRotateRight"
        @click="rotateImage('right')"
      >
        <IconRotateClockwise :size="16" aria-hidden="true" />
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
        :src="content.src"
        :alt="alt"
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
import {
  IconAspectRatio,
  IconRotate,
  IconRotateClockwise,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset
} from '@tabler/icons-vue';
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
  rotateOnlyPreviewImageViewport,
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
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0
});
const failed = ref(false);
const readySent = ref(false);
// The element is the loader now, so its intrinsic size is only known once `load` fires. Until then
// the origin box stays unconstrained; sizing it to 0 would collapse the layout under the image.
const naturalSize = reactive({ width: 0, height: 0 });
const dragState = ref<{ pointerId: number; x: number; y: number } | null>(null);
let resizeObserver: ResizeObserver | null = null;
let active = true;

const dimensions = (): OnlyPreviewImageDimensions => ({
  naturalWidth: naturalSize.width,
  naturalHeight: naturalSize.height,
  viewportWidth: viewportSize.width,
  viewportHeight: viewportSize.height
});

const assignState = (state: OnlyPreviewImageViewportState): void => {
  Object.assign(viewportState, state);
};

// Every viewport computation rejects a non-positive intrinsic size, and the intrinsic size only
// exists once the element has loaded. Each one is therefore fenced on this rather than given a
// fabricated dimension, which would produce a wrong fit scale for one frame.
const hasNaturalSize = computed(() => naturalSize.width > 0 && naturalSize.height > 0);

const panBounds = computed(() =>
  hasNaturalSize.value
    ? getOnlyPreviewImagePanBounds(dimensions(), viewportState.scale, viewportState.rotation)
    : { maxX: 0, maxY: 0 }
);
const minimumScale = computed(() =>
  hasNaturalSize.value ? getOnlyPreviewImageMinimumScale(dimensions(), viewportState.rotation) : 1
);
const isPannable = computed(() => panBounds.value.maxX > 0 || panBounds.value.maxY > 0);
const isAtReset = computed(
  () =>
    viewportState.mode === 'manual' &&
    viewportState.rotation === 0 &&
    viewportState.scale === 1 &&
    viewportState.offsetX === 0 &&
    viewportState.offsetY === 0
);
const originStyle = computed(() => ({
  width: naturalSize.width > 0 ? `${naturalSize.width}px` : 'auto',
  height: naturalSize.height > 0 ? `${naturalSize.height}px` : 'auto',
  transform: `translate(-50%, -50%) translate(${viewportState.offsetX}px, ${viewportState.offsetY}px)`
}));
const imageStyle = computed(() => ({
  transform: `rotate(${viewportState.rotation}deg) scale(${viewportState.scale})`
}));

const releasePointer = (): void => {
  const drag = dragState.value;
  const viewport = viewportElement.value;
  dragState.value = null;
  if (!drag || !viewport?.hasPointerCapture?.(drag.pointerId)) return;
  viewport.releasePointerCapture(drag.pointerId);
};

const fitImage = (): void => {
  releasePointer();
  if (!hasNaturalSize.value) return;
  assignState(fitOnlyPreviewImageViewport(dimensions(), viewportState.rotation));
};

const resetImage = (): void => {
  releasePointer();
  if (!hasNaturalSize.value) return;
  assignState(resetOnlyPreviewImageViewport(dimensions()));
};

const zoomImage = (direction: 'in' | 'out'): void => {
  releasePointer();
  if (!hasNaturalSize.value) return;
  assignState(zoomOnlyPreviewImageViewport(viewportState, direction, dimensions()));
};

const rotateImage = (direction: 'left' | 'right'): void => {
  releasePointer();
  if (!hasNaturalSize.value) return;
  assignState(rotateOnlyPreviewImageViewport(viewportState, direction, dimensions()));
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
  if (!drag || event.pointerId !== drag.pointerId || !event.isPrimary || !hasNaturalSize.value) {
    return;
  }
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
  if (!hasNaturalSize.value) return;
  assignState(panOnlyPreviewImageViewport(viewportState, deltaX, deltaY, dimensions()));
};

const handleImageLoad = async (event: Event): Promise<void> => {
  const image = event.currentTarget;
  const revision = props.reportingRevision;
  const source = props.content.src;
  if (
    readySent.value ||
    failed.value ||
    !(image instanceof HTMLImageElement) ||
    image.src !== source ||
    !revision
  ) {
    return;
  }
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    await handleImageError();
    return;
  }
  naturalSize.width = image.naturalWidth;
  naturalSize.height = image.naturalHeight;
  fitImage();
  await nextTick();
  if (
    !active ||
    !image.isConnected ||
    failed.value ||
    revision !== props.reportingRevision ||
    source !== props.content.src ||
    image.src !== source
  ) {
    return;
  }
  readySent.value = true;
  onlyPreviewPreviewStore.reportSurfaceReady(revision);
};

// The element loads the asset directly, so an `error` here is a read failure — the request was
// refused or the stream ended early — not a decode failure. A decodable body that carries no frame
// is reported through the same path after `load`, which is the only case that reaches the decoder.
const handleImageError = async (): Promise<void> => {
  if (failed.value) return;
  const revision = props.reportingRevision;
  failed.value = true;
  resetImage();
  await nextTick();
  if (!active || revision !== props.reportingRevision || !failed.value) return;
  onlyPreviewPreviewStore.reportSurfaceError(revision, 'IMAGE_READ_FAILED');
};

onMounted(() => {
  const viewport = viewportElement.value;
  if (!viewport) return;
  const updateSize = (width: number, height: number): void => {
    releasePointer();
    viewportSize.width = Math.max(0, width);
    viewportSize.height = Math.max(0, height);
    if (!hasNaturalSize.value) return;
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
  resetImage();
  failed.value = true;
});
</script>

<style lang="less">
@import './ImagePreview.less';
</style>
