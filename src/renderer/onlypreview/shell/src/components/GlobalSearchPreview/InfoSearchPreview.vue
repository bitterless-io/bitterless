<template>
  <div name="onlypreview__globalSearchInfoPreview" class="onlypreview-search-preview__info">
    <IconFileDescription :size="34" aria-hidden="true" />
    <strong>{{ preview.name }}</strong>
    <span>{{ preview.previewHint }} · {{ formatOnlyPreviewBytes(preview.size) }}</span>
  </div>
</template>

<script setup lang="ts">
import { IconFileDescription } from '@tabler/icons-vue';
import type { OnlyPreviewGlobalSearchPreview } from '@shared/onlypreview/onlyPreviewSearch.type';
import { formatOnlyPreviewBytes } from '../../../../common/onlyPreviewFormat';

defineProps<{
  preview: Extract<OnlyPreviewGlobalSearchPreview, { kind: 'info' }>;
}>();
</script>
