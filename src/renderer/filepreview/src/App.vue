<template>
  <header name="onlypreview__previewToolbar" class="file-preview__toolbar">
    <div name="filePreview__identity" class="file-preview__identity" :title="filePreviewStore.path">
      <strong>{{
        filePreviewStore.presentation?.descriptor?.name ||
        filePreviewStore.path.split(/[\\/]/).at(-1)
      }}</strong>
      <span>{{ filePreviewStore.path }}</span>
    </div>
    <FindBar v-if="onlyPreviewFindStore.open" />
    <span v-else-if="onlyPreviewFindStore.feedback" class="file-preview__feedback" role="status">{{
      onlyPreviewFindStore.feedback
    }}</span>
    <span
      v-if="filePreviewStore.error"
      class="file-preview__error"
      role="alert"
      :title="filePreviewStore.error"
      >{{ filePreviewStore.error }}</span
    >
    <div name="filePreview__actions" class="file-preview__actions">
      <IconBtn
        name="onlypreview__openExternally"
        :title="onlyPreviewI18n.preview.openExternally"
        :aria-label="onlyPreviewI18n.preview.openExternally"
        :disabled="!filePreviewStore.presentation?.fileRef || filePreviewStore.actionPending"
        @click="filePreviewStore.act('openExternally')"
      >
        <IconExternalLink :size="16" aria-hidden="true" />
      </IconBtn>
      <IconBtn
        name="onlypreview__reveal"
        :title="onlyPreviewI18n.preview.reveal"
        :aria-label="onlyPreviewI18n.preview.reveal"
        :disabled="!filePreviewStore.presentation?.fileRef || filePreviewStore.actionPending"
        @click="filePreviewStore.act('revealInFolder')"
      >
        <IconFolder :size="16" aria-hidden="true" />
      </IconBtn>
    </div>
  </header>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { IconExternalLink, IconFolder } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import FindBar from '../../onlypreview/shell/src/components/FindBar/FindBar.vue';
import { onlyPreviewFindStore } from '../../onlypreview/shell/src/onlyPreviewFind.store';
import { onlyPreviewI18n } from '../../onlypreview/common/onlyPreviewI18n';
import { filePreviewStore } from './filePreview.store';

onMounted(() => void filePreviewStore.initialize());
onBeforeUnmount(() => filePreviewStore.dispose());
</script>
