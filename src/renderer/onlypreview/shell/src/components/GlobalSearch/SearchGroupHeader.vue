<template>
  <button
    :name="`onlypreview__globalSearch${section === 'files' ? 'Files' : 'Contents'}Heading`"
    class="onlypreview-global-search__group"
    type="button"
    :aria-expanded="!collapsed"
    @click="onlyPreviewGlobalSearchStore.toggleGroup(section)"
    @keydown.left.prevent="onlyPreviewGlobalSearchStore.toggleGroup(section, false)"
    @keydown.right.prevent="onlyPreviewGlobalSearchStore.toggleGroup(section, true)"
  >
    <IconChevronRight
      class="onlypreview-global-search__group-chevron"
      :class="{ 'onlypreview-global-search__group-chevron--expanded': !collapsed }"
      :size="13"
      aria-hidden="true"
    />
    <span>{{ label }}</span>
    <span class="onlypreview-global-search__group-count">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconChevronRight } from '@tabler/icons-vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewGlobalSearchStore } from '../../onlyPreviewGlobalSearch.store';

const props = defineProps<{ section: 'files' | 'contents' }>();
const collapsed = computed(() =>
  props.section === 'files'
    ? onlyPreviewGlobalSearchStore.filesCollapsed
    : onlyPreviewGlobalSearchStore.contentsCollapsed
);
const count = computed(() =>
  props.section === 'files'
    ? onlyPreviewGlobalSearchStore.files.length
    : onlyPreviewGlobalSearchStore.contents.length
);
const label = computed(() =>
  props.section === 'files'
    ? onlyPreviewI18n.globalSearch.files
    : onlyPreviewI18n.globalSearch.contents
);
</script>
