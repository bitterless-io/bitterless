<template>
  <article name="onlypreview__previewSurface" class="onlypreview-preview">
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
          {{ previewLimitMessage }}
        </p>
      </div>

      <MarkdownPreview
        v-else-if="isMarkdown && onlyPreviewPreviewStore.textContent"
        :key="selectionPreviewKey"
        :content="onlyPreviewPreviewStore.textContent"
        :reporting-revision="onlyPreviewPreviewStore.selectionReportingRevision"
      />

      <MonacoTextPreview
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'text' && onlyPreviewPreviewStore.textContent
        "
        :key="selectionPreviewKey"
        :content="onlyPreviewPreviewStore.textContent"
        :language="onlyPreviewPreviewStore.descriptor.language"
        :reporting-revision="onlyPreviewPreviewStore.selectionReportingRevision"
        :settings="onlyPreviewPreviewStore.settings"
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
          @load="
            onlyPreviewPreviewStore.reportSurfaceReady(
              onlyPreviewPreviewStore.selectionReportingRevision
            )
          "
          @error="
            onlyPreviewPreviewStore.reportMediaError(
              onlyPreviewPreviewStore.selectionReportingRevision
            )
          "
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
          @loadedmetadata="
            onlyPreviewPreviewStore.reportSurfaceReady(
              onlyPreviewPreviewStore.selectionReportingRevision
            )
          "
          @error="
            onlyPreviewPreviewStore.reportMediaError(
              onlyPreviewPreviewStore.selectionReportingRevision
            )
          "
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
          @loadedmetadata="
            onlyPreviewPreviewStore.reportSurfaceReady(
              onlyPreviewPreviewStore.selectionReportingRevision
            )
          "
          @error="
            onlyPreviewPreviewStore.reportMediaError(
              onlyPreviewPreviewStore.selectionReportingRevision
            )
          "
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
            <dd>{{ onlyPreviewPreviewStore.descriptorType }}</dd>
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
import { IconAlertTriangle, IconFileSearch, IconFileUnknown, IconMusic } from '@tabler/icons-vue';
import {
  formatOnlyPreviewBytes,
  formatOnlyPreviewDate,
  interpolateOnlyPreview
} from '../../../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import MarkdownPreview from '../MarkdownPreview/MarkdownPreview.vue';
import MonacoTextPreview from '../MonacoTextPreview/MonacoTextPreview.vue';

const isMarkdown = computed(() => {
  const descriptor = onlyPreviewPreviewStore.descriptor;
  if (descriptor?.kind !== 'text') return false;
  return descriptor.extension === '.md';
});

const previewKey = computed(() => {
  const descriptor = onlyPreviewPreviewStore.descriptor;
  return descriptor ? `${descriptor.workspaceId}:${descriptor.relativePath}` : '';
});

const selectionPreviewKey = computed(
  () => `${previewKey.value}:${onlyPreviewPreviewStore.selectionReportingRevision}`
);

const imageAlt = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.preview.imageAlt, {
    name: onlyPreviewPreviewStore.descriptor?.name || ''
  })
);

const previewLimitMessage = computed(() => {
  const descriptor = onlyPreviewPreviewStore.descriptor;
  if (descriptor?.extension === '.md') return onlyPreviewI18n.preview.markdownLimit;
  if (descriptor?.extension === '.html' || descriptor?.extension === '.htm') {
    return onlyPreviewI18n.preview.htmlLimit;
  }
  if (descriptor?.kind === 'pdf' || descriptor?.kind === 'image') {
    return onlyPreviewI18n.preview.imagePdfLimit;
  }
  if (descriptor?.kind === 'sheet' || descriptor?.kind === 'document') {
    return onlyPreviewI18n.preview.officeLimit;
  }
  return onlyPreviewI18n.preview.textLimit;
});
</script>

<style lang="less">
@import './PreviewSurface.less';
</style>
