<template>
  <div name="onlypreview__fileActions" class="onlypreview-file-actions">
    <a-button
      name="onlypreview__openExternally"
      class="onlypreview-file-actions__button onlypreview-file-actions__button--primary"
      type="primary"
      size="mini"
      @click="onlyPreviewPreviewStore.openExternally()"
    >
      <IconExternalLink :size="14" aria-hidden="true" />
      {{ onlyPreviewI18n.preview.openExternally }}
    </a-button>
    <a-button
      name="onlypreview__reveal"
      class="onlypreview-file-actions__button"
      size="mini"
      @click="onlyPreviewPreviewStore.revealInFolder()"
    >
      <IconFolderShare :size="14" aria-hidden="true" />
      {{ onlyPreviewI18n.preview.reveal }}
    </a-button>
    <p
      v-if="onlyPreviewPreviewStore.actionError"
      class="onlypreview-file-actions__error"
      role="alert"
    >
      {{ onlyPreviewPreviewStore.actionError }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { IconExternalLink, IconFolderShare } from '@tabler/icons-vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
</script>

<style lang="less">
@import './FileActions.less';
</style>
