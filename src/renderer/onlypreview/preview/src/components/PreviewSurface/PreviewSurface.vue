<template>
  <article name="onlypreview__previewSurface" class="onlypreview-preview">
    <section name="onlypreview__previewBody" class="onlypreview-preview__body">
      <div
        v-if="onlyPreviewPreviewStore.previewMetadata"
        name="onlypreview__previewMetadata"
        class="onlypreview-preview__state"
        :class="{
          'onlypreview-preview__state--error':
            onlyPreviewPreviewStore.previewMetadata.variant === 'error'
        }"
        :role="onlyPreviewPreviewStore.previewMetadata.variant === 'error' ? 'alert' : undefined"
      >
        <span class="onlypreview-preview__state-mark" aria-hidden="true">
          <IconAlertTriangle
            v-if="onlyPreviewPreviewStore.previewMetadata.variant === 'error'"
            :size="24"
          />
          <IconFileUnknown v-else :size="25" />
        </span>
        <h1>{{ onlyPreviewPreviewStore.previewMetadata.title }}</h1>
        <p class="onlypreview-preview__state-file">
          {{ onlyPreviewPreviewStore.previewMetadata.name }}
        </p>
        <p>{{ onlyPreviewPreviewStore.previewMetadata.reason }}</p>
        <p
          v-if="onlyPreviewPreviewStore.errorCode === 'TEXT_TOO_LARGE'"
          class="onlypreview-preview__state-note"
        >
          {{ previewLimitMessage }}
        </p>
        <div
          v-if="onlyPreviewPreviewStore.currentRef"
          name="onlypreview__previewMetadataActions"
          class="onlypreview-preview__state-actions"
        >
          <a-button
            name="onlypreview__previewOpenExternally"
            class="onlypreview-preview__state-action"
            type="primary"
            size="small"
            :loading="onlyPreviewPreviewStore.openingExternally"
            :disabled="onlyPreviewPreviewStore.openingExternally"
            @click="onlyPreviewPreviewStore.openExternally()"
          >
            <IconExternalLink :size="15" aria-hidden="true" />
            {{ onlyPreviewI18n.preview.openExternally }}
          </a-button>
          <p
            v-if="onlyPreviewPreviewStore.openExternallyError"
            name="onlypreview__previewOpenExternallyError"
            class="onlypreview-preview__state-action-error"
            role="alert"
          >
            {{ onlyPreviewPreviewStore.openExternallyError }}
          </p>
        </div>
        <dl class="onlypreview-preview__metadata">
          <div>
            <dt>{{ onlyPreviewI18n.preview.type }}</dt>
            <dd>{{ onlyPreviewPreviewStore.previewMetadata.type }}</dd>
          </div>
          <div>
            <dt>{{ onlyPreviewI18n.preview.size }}</dt>
            <dd>{{ formatOnlyPreviewBytes(onlyPreviewPreviewStore.previewMetadata.size) }}</dd>
          </div>
          <div>
            <dt>{{ onlyPreviewI18n.preview.modified }}</dt>
            <dd>{{ formatOnlyPreviewDate(onlyPreviewPreviewStore.previewMetadata.modifiedAt) }}</dd>
          </div>
        </dl>
      </div>

      <div
        v-else-if="
          onlyPreviewPreviewStore.errorMessage || onlyPreviewPreviewStore.presentationError
        "
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
        @ready="
          onlyPreviewPreviewStore.reportMonacoReady(
            onlyPreviewPreviewStore.selectionReportingRevision
          )
        "
      />

      <OfficePreview
        v-else-if="
          (onlyPreviewPreviewStore.descriptor?.kind === 'sheet' ||
            onlyPreviewPreviewStore.descriptor?.kind === 'document' ||
            onlyPreviewPreviewStore.descriptor?.kind === 'presentation') &&
          onlyPreviewPreviewStore.officeSession
        "
        :key="selectionPreviewKey"
        :session="onlyPreviewPreviewStore.officeSession"
        :reporting-revision="onlyPreviewPreviewStore.selectionReportingRevision"
        @ready="
          onlyPreviewPreviewStore.reportOfficeReady(
            onlyPreviewPreviewStore.selectionReportingRevision
          )
        "
        @error="
          (errorCode) =>
            onlyPreviewPreviewStore.reportSurfaceError(
              onlyPreviewPreviewStore.selectionReportingRevision,
              errorCode
            )
        "
      />

      <DrawioPreview
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'diagram' &&
          onlyPreviewPreviewStore.drawioContent
        "
        :key="selectionPreviewKey"
        :content="onlyPreviewPreviewStore.drawioContent"
        :reporting-revision="onlyPreviewPreviewStore.selectionReportingRevision"
      />

      <ImagePreview
        v-else-if="
          onlyPreviewPreviewStore.descriptor?.kind === 'image' &&
          onlyPreviewPreviewStore.imageSession &&
          onlyPreviewPreviewStore.imageContent
        "
        :key="selectionPreviewKey"
        :content="onlyPreviewPreviewStore.imageContent"
        :alt="imageAlt"
        :reporting-revision="onlyPreviewPreviewStore.selectionReportingRevision"
      />

      <MediaPreview
        v-else-if="
          (onlyPreviewPreviewStore.descriptor?.kind === 'audio' ||
            onlyPreviewPreviewStore.descriptor?.kind === 'video') &&
          onlyPreviewPreviewStore.descriptor.assetUrl &&
          onlyPreviewPreviewStore.mediaPrepared
        "
        :key="selectionPreviewKey"
        :kind="onlyPreviewPreviewStore.descriptor.kind"
        :asset-url="onlyPreviewPreviewStore.descriptor.assetUrl"
        :name="onlyPreviewPreviewStore.descriptor.name"
        :reporting-revision="onlyPreviewPreviewStore.selectionReportingRevision"
      />

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
import { computed, defineAsyncComponent } from 'vue';
import {
  IconAlertTriangle,
  IconExternalLink,
  IconFileSearch,
  IconFileUnknown
} from '@tabler/icons-vue';
import {
  formatOnlyPreviewBytes,
  formatOnlyPreviewDate,
  interpolateOnlyPreview
} from '../../../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

const MarkdownPreview = defineAsyncComponent(
  () => import('../MarkdownPreview/MarkdownPreview.vue')
);
const MonacoTextPreview = defineAsyncComponent(
  () => import('../MonacoTextPreview/MonacoTextPreview.vue')
);
const OfficePreview = defineAsyncComponent(() => import('../OfficePreview/OfficePreview.vue'));
const DrawioPreview = defineAsyncComponent(() => import('../DrawioPreview/DrawioPreview.vue'));
const ImagePreview = defineAsyncComponent(() => import('../ImagePreview/ImagePreview.vue'));
const MediaPreview = defineAsyncComponent(() => import('../MediaPreview/MediaPreview.vue'));

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
  if (
    descriptor?.kind === 'sheet' ||
    descriptor?.kind === 'document' ||
    descriptor?.kind === 'presentation'
  ) {
    return onlyPreviewI18n.preview.officeLimit;
  }
  if (descriptor?.kind === 'diagram') return onlyPreviewI18n.preview.diagramLimit;
  return onlyPreviewI18n.preview.textLimit;
});
</script>

<style lang="less">
@import './PreviewSurface.less';
</style>
