<template>
  <div name="onlypreview__globalSearchDirectoryPreview" class="onlypreview-search-preview__directory">
    <div
      v-for="entry in preview.entries"
      :key="entry.relativePath"
      name="onlypreview__globalSearchDirectoryEntry"
      class="onlypreview-search-preview__directory-entry"
    >
      <IconFolder v-if="entry.nodeKind === 'directory'" :size="14" aria-hidden="true" />
      <IconFile v-else :size="14" aria-hidden="true" />
      <span>{{ entry.name }}</span>
    </div>
    <p v-if="!preview.entries.length" class="onlypreview-search-preview__state">
      {{ onlyPreviewI18n.globalSearch.emptyDirectory }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { IconFile, IconFolder } from '@tabler/icons-vue';
import type { OnlyPreviewGlobalSearchPreview } from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';

defineProps<{
  preview: Extract<OnlyPreviewGlobalSearchPreview, { kind: 'directory' }>;
}>();
</script>
