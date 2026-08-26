<template>
  <pre name="onlypreview__globalSearchContextPreview" class="onlypreview-search-preview__context"><span>{{
    preview.before
  }}</span><mark>{{ preview.match }}</mark><span>{{ preview.after }}</span></pre>
</template>

<script setup lang="ts">
import type { OnlyPreviewGlobalSearchPreview } from '@shared/onlypreview/onlyPreviewSearch.type';

defineProps<{
  preview: Extract<OnlyPreviewGlobalSearchPreview, { kind: 'context' }>;
}>();
</script>
