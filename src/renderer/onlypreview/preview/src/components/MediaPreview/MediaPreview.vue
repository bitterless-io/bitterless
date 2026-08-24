<template>
  <section
    name="onlypreview__mediaPreview"
    class="onlypreview-media"
    :class="`onlypreview-media--${kind}`"
  >
    <div v-if="kind === 'audio'" class="onlypreview-media__audio-mark" aria-hidden="true">
      <IconMusic :size="28" />
    </div>
    <audio
      v-if="kind === 'audio' && !failed"
      ref="audioElement"
      name="onlypreview__audioPlayer"
      class="onlypreview-media__audio"
      controls
      preload="metadata"
      :aria-label="playerLabel"
    ></audio>
    <video
      v-else-if="!failed"
      ref="videoElement"
      name="onlypreview__videoPlayer"
      class="onlypreview-media__video"
      controls
      preload="metadata"
      :aria-label="playerLabel"
    ></video>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { IconMusic } from '@tabler/icons-vue';
import { interpolateOnlyPreview } from '../../../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import {
  mapOnlyPreviewMediaErrorCode,
  ONLY_PREVIEW_MEDIA_METADATA_TIMEOUT_MS
} from '../../onlyPreviewMedia.service';

const props = defineProps<{
  kind: 'audio' | 'video';
  assetUrl: string;
  name: string;
  reportingRevision: string;
}>();

const audioElement = ref<HTMLAudioElement | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const failed = ref(false);
let generation = 0;
let activeElement: HTMLMediaElement | null = null;
let loadedMetadataListener: (() => void) | null = null;
let errorListener: (() => void) | null = null;
let metadataTimer: ReturnType<typeof setTimeout> | null = null;
let readySent = false;

const playerLabel = computed(() =>
  interpolateOnlyPreview(
    props.kind === 'audio'
      ? onlyPreviewI18n.preview.audioPlayer
      : onlyPreviewI18n.preview.videoPlayer,
    { name: props.name }
  )
);

const cleanupElement = (): void => {
  if (metadataTimer !== null) clearTimeout(metadataTimer);
  metadataTimer = null;
  const element = activeElement;
  activeElement = null;
  if (!element) return;
  if (loadedMetadataListener) element.removeEventListener('loadedmetadata', loadedMetadataListener);
  if (errorListener) element.removeEventListener('error', errorListener);
  loadedMetadataListener = null;
  errorListener = null;
  element.pause();
  element.removeAttribute('src');
  element.load();
};

const deactivateElement = (): void => {
  generation += 1;
  cleanupElement();
};

const activateElement = async (): Promise<void> => {
  const currentGeneration = ++generation;
  cleanupElement();
  await nextTick();
  if (currentGeneration !== generation) return;
  const element = props.kind === 'audio' ? audioElement.value : videoElement.value;
  if (!element || failed.value || !props.assetUrl || !props.reportingRevision) return;
  const revision = props.reportingRevision;
  const source = props.assetUrl;
  readySent = false;
  activeElement = element;
  loadedMetadataListener = () => {
    if (
      currentGeneration !== generation ||
      activeElement !== element ||
      revision !== props.reportingRevision ||
      source !== props.assetUrl ||
      readySent
    ) {
      return;
    }
    readySent = true;
    if (metadataTimer !== null) clearTimeout(metadataTimer);
    metadataTimer = null;
    onlyPreviewPreviewStore.reportSurfaceReady(revision);
  };
  errorListener = () => {
    if (
      currentGeneration !== generation ||
      activeElement !== element ||
      revision !== props.reportingRevision ||
      source !== props.assetUrl
    ) {
      return;
    }
    const errorCode = mapOnlyPreviewMediaErrorCode(element.error?.code);
    failed.value = true;
    deactivateElement();
    const terminalGeneration = generation;
    void nextTick().then(() => {
      if (
        terminalGeneration !== generation ||
        revision !== props.reportingRevision ||
        source !== props.assetUrl ||
        !failed.value
      ) {
        return;
      }
      onlyPreviewPreviewStore.reportSurfaceError(revision, errorCode);
    });
  };
  element.addEventListener('loadedmetadata', loadedMetadataListener);
  element.addEventListener('error', errorListener);
  element.src = source;
  element.load();
  metadataTimer = setTimeout(() => {
    if (
      currentGeneration !== generation ||
      activeElement !== element ||
      revision !== props.reportingRevision ||
      source !== props.assetUrl ||
      readySent
    ) {
      return;
    }
    failed.value = true;
    deactivateElement();
    const terminalGeneration = generation;
    void nextTick().then(() => {
      if (
        terminalGeneration !== generation ||
        revision !== props.reportingRevision ||
        source !== props.assetUrl ||
        !failed.value
      ) {
        return;
      }
      onlyPreviewPreviewStore.reportSurfaceError(revision, 'MEDIA_READ_FAILED');
    });
  }, ONLY_PREVIEW_MEDIA_METADATA_TIMEOUT_MS);
};

onMounted(() => void activateElement());
watch(
  () => [props.kind, props.assetUrl, props.reportingRevision] as const,
  () => {
    failed.value = false;
    void activateElement();
  }
);
onBeforeUnmount(deactivateElement);
</script>

<style lang="less">
@import './MediaPreview.less';
</style>
