<template>
  <div name="onlypreview__fileActions" class="onlypreview-file-actions">
    <a-button
      name="onlypreview__openExternally"
      class="onlypreview-file-actions__button onlypreview-file-actions__button--primary"
      type="primary"
      size="mini"
      :title="onlyPreviewI18n.preview.openExternally"
      @click="onlyPreviewShellStore.openPreviewExternally()"
    >
      <IconExternalLink :size="14" aria-hidden="true" />
      <span class="onlypreview-file-actions__label">
        {{ onlyPreviewI18n.preview.openExternally }}
      </span>
    </a-button>
    <a-button
      name="onlypreview__reveal"
      class="onlypreview-file-actions__button"
      size="mini"
      :title="onlyPreviewI18n.preview.reveal"
      @click="onlyPreviewShellStore.revealPreviewInFolder()"
    >
      <IconFolderShare :size="14" aria-hidden="true" />
      <span class="onlypreview-file-actions__label">{{ onlyPreviewI18n.preview.reveal }}</span>
    </a-button>
    <span
      v-if="onlyPreviewShellStore.previewActionError"
      name="onlypreview__fileActionError"
      class="onlypreview-file-actions__error"
      role="alert"
      :title="onlyPreviewShellStore.previewActionError"
    >
      <IconAlertTriangle :size="14" aria-hidden="true" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { IconAlertTriangle, IconExternalLink, IconFolderShare } from '@tabler/icons-vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
</script>

<style lang="less">
@import './FileActions.less';
</style>
