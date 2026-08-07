<template>
  <article name="onlypreview__previewSurface" class="onlypreview-preview">
    <header
      v-if="onlyPreviewPreviewStore.descriptor"
      name="onlypreview__previewHeader"
      class="onlypreview-preview__header"
    >
      <div class="onlypreview-preview__identity">
        <span class="onlypreview-preview__file-name">
          {{ onlyPreviewPreviewStore.descriptor.name }}
        </span>
        <span class="onlypreview-preview__file-path">
          {{ onlyPreviewPreviewStore.descriptor.displayPath }}
        </span>
      </div>
      <div class="onlypreview-preview__badges">
        <span class="onlypreview-preview__badge">
          {{ descriptorType }}
        </span>
        <span class="onlypreview-preview__badge onlypreview-preview__badge--read-only">
          <IconLock :size="11" aria-hidden="true" />
          {{ onlyPreviewI18n.preview.readOnly }}
        </span>
      </div>
    </header>

    <section name="onlypreview__previewBody" class="onlypreview-preview__body">
      <div
        v-if="onlyPreviewPreviewStore.errorMessage || onlyPreviewPreviewStore.presentationError"
        name="onlypreview__previewError"
        class="onlypreview-preview__state onlypreview-preview__state--error"
        role="alert"
      >
        <span class="onlypreview-preview__state-mark" aria-hidden="true">
          <IconAlertTriangle :size="24" />
        </span>
        <h1>{{ onlyPreviewI18n.preview.failedTitle }}</h1>
        <p>
          {{ onlyPreviewPreviewStore.errorMessage || onlyPreviewPreviewStore.presentationError }}
        </p>
        <p
          v-if="onlyPreviewPreviewStore.errorCode === 'TEXT_TOO_LARGE'"
          class="onlypreview-preview__state-note"
        >
          {{ onlyPreviewI18n.preview.textLimit }}
        </p>
        <FileActions v-if="onlyPreviewPreviewStore.currentRef" />
      </div>

      <MonacoTextPreview
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'text' && onlyPreviewPreviewStore.textContent
        "
        :content="onlyPreviewPreviewStore.textContent"
        :language="onlyPreviewPreviewStore.descriptor.language"
        :settings="onlyPreviewPreviewStore.settings"
      />

      <PdfPreview
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'pdf' &&
          onlyPreviewPreviewStore.descriptor.assetUrl
        "
        :key="previewKey"
        :asset-url="onlyPreviewPreviewStore.descriptor.assetUrl"
      />

      <div
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'image' &&
          onlyPreviewPreviewStore.descriptor.assetUrl
        "
        name="onlypreview__imagePreview"
        class="onlypreview-preview__media onlypreview-preview__media--image"
      >
        <img
          :src="onlyPreviewPreviewStore.descriptor.assetUrl"
          :alt="imageAlt"
          @error="onlyPreviewPreviewStore.reportMediaError('media')"
        />
      </div>

      <div
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'audio' &&
          onlyPreviewPreviewStore.descriptor.assetUrl
        "
        name="onlypreview__audioPreview"
        class="onlypreview-preview__media onlypreview-preview__media--audio"
      >
        <div class="onlypreview-preview__audio-disc" aria-hidden="true">
          <IconMusic :size="28" />
        </div>
        <audio
          :src="onlyPreviewPreviewStore.descriptor.assetUrl"
          controls
          preload="metadata"
          @error="onlyPreviewPreviewStore.reportMediaError('media')"
        ></audio>
      </div>

      <div
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'video' &&
          onlyPreviewPreviewStore.descriptor.assetUrl
        "
        name="onlypreview__videoPreview"
        class="onlypreview-preview__media onlypreview-preview__media--video"
      >
        <video
          :src="onlyPreviewPreviewStore.descriptor.assetUrl"
          controls
          preload="metadata"
          @error="onlyPreviewPreviewStore.reportMediaError('media')"
        ></video>
      </div>

      <div
        v-else-if="onlyPreviewPreviewStore.descriptor?.kind === 'unsupported'"
        name="onlypreview__unsupportedPreview"
        class="onlypreview-preview__state"
      >
        <span class="onlypreview-preview__state-mark" aria-hidden="true">
          <IconFileUnknown :size="25" />
        </span>
        <h1>{{ onlyPreviewI18n.preview.unsupportedTitle }}</h1>
        <p>{{ onlyPreviewI18n.preview.unsupportedBody }}</p>
        <dl class="onlypreview-preview__metadata">
          <div>
            <dt>{{ onlyPreviewI18n.preview.type }}</dt>
            <dd>{{ descriptorType }}</dd>
          </div>
          <div>
            <dt>{{ onlyPreviewI18n.preview.size }}</dt>
            <dd>{{ formatOnlyPreviewBytes(onlyPreviewPreviewStore.descriptor.size) }}</dd>
          </div>
          <div>
            <dt>{{ onlyPreviewI18n.preview.modified }}</dt>
            <dd>{{ formatOnlyPreviewDate(onlyPreviewPreviewStore.descriptor.modifiedAt) }}</dd>
          </div>
        </dl>
        <FileActions />
      </div>

      <div
        v-else-if="!onlyPreviewPreviewStore.loading"
        name="onlypreview__previewEmpty"
        class="onlypreview-preview__state"
      >
        <span class="onlypreview-preview__state-mark" aria-hidden="true">
          <IconFileSearch :size="25" />
        </span>
        <h1>{{ onlyPreviewI18n.preview.emptyTitle }}</h1>
        <p>{{ onlyPreviewI18n.preview.emptyBody }}</p>
      </div>

      <div
        v-if="onlyPreviewPreviewStore.loading"
        name="onlypreview__previewLoading"
        class="onlypreview-preview__loading"
        role="status"
      >
        <span class="onlypreview-preview__loading-line" aria-hidden="true"></span>
        {{ onlyPreviewI18n.preview.loading }}
      </div>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconAlertTriangle,
  IconFileSearch,
  IconFileUnknown,
  IconLock,
  IconMusic
} from '@tabler/icons-vue';
import {
  formatOnlyPreviewBytes,
  formatOnlyPreviewDate,
  interpolateOnlyPreview
} from '../../../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import FileActions from '../FileActions/FileActions.vue';
import MonacoTextPreview from '../MonacoTextPreview/MonacoTextPreview.vue';
import PdfPreview from '../PdfPreview/PdfPreview.vue';

const descriptorType = computed(() => {
  const descriptor = onlyPreviewPreviewStore.descriptor;
  if (!descriptor) return '';
  return (
    descriptor.language || descriptor.extension.replace(/^\./, '').toUpperCase() || descriptor.kind
  );
});

const previewKey = computed(() => {
  const descriptor = onlyPreviewPreviewStore.descriptor;
  return descriptor ? `${descriptor.workspaceId}:${descriptor.relativePath}` : '';
});

const imageAlt = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.preview.imageAlt, {
    name: onlyPreviewPreviewStore.descriptor?.name || ''
  })
);
</script>

<style lang="less">
@import './PreviewSurface.less';
</style>
