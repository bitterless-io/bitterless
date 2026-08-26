<template>
  <pre name="onlypreview__globalSearchPlainPreview" class="onlypreview-search-preview__plain">{{
    preview.text
  }}</pre>
</template>

<script setup lang="ts">
import type { OnlyPreviewGlobalSearchPreview } from '@shared/onlypreview/onlyPreviewSearch.type';

defineProps<{
  preview: Extract<OnlyPreviewGlobalSearchPreview, { kind: 'text' }>;
}>();
</script>
