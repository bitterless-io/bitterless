<template>
  <button
    name="onlypreview__globalSearchResult"
    class="onlypreview-global-search__result"
    :class="{
      'onlypreview-global-search__result--selected': selected
    }"
    type="button"
    :data-result-token="result.resultToken"
    :data-relative-path="result.relativePath"
    :title="result.relativePath"
    @click="select"
    @focus="select"
    @dblclick.prevent="open"
    @keydown.enter.exact.prevent="select"
  >
    <span class="onlypreview-global-search__result-rail" aria-hidden="true"></span>
    <span class="onlypreview-global-search__result-body">
      <span class="onlypreview-global-search__result-identity">
        <IconFolder
          v-if="result.section === 'files' && result.nodeKind === 'directory'"
          :size="14"
          aria-hidden="true"
        />
        <IconFile v-else :size="14" aria-hidden="true" />
        <span name="onlypreview__globalSearchResultTitle" class="onlypreview-global-search__result-title">
          {{ title }}
        </span>
        <span class="onlypreview-global-search__result-media">{{ displayType }}</span>
      </span>
      <span
        name="onlypreview__globalSearchResultDirectory"
        class="onlypreview-global-search__result-directory"
      >
        {{ result.parentRelativePath || '.' }}
      </span>
      <span
        v-if="snippet"
        name="onlypreview__globalSearchResultSnippet"
        class="onlypreview-global-search__result-snippet"
      ><span>{{ snippet.before }}</span><mark>{{ snippet.highlight }}</mark><span>{{ snippet.after }}</span></span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconFile, IconFolder } from '@tabler/icons-vue';
import type { OnlyPreviewGlobalSearchResult } from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewGlobalSearchStore } from '../../onlyPreviewGlobalSearch.store';
import {
  getOnlyPreviewGlobalSearchDisplayType,
  sameGlobalSearchResult,
  splitOnlyPreviewContentMatch
} from '../../onlyPreviewGlobalSearchResult.service';

const props = defineProps<{ result: OnlyPreviewGlobalSearchResult }>();
const emit = defineEmits<{ 'focus-result': [resultToken: string] }>();
const selected = computed(
  () =>
    !!onlyPreviewGlobalSearchStore.selectedResult &&
    sameGlobalSearchResult(props.result, onlyPreviewGlobalSearchStore.selectedResult)
);
const title = computed(() =>
  props.result.section === 'files' ? props.result.name : props.result.fileName
);
const displayType = computed(() => getOnlyPreviewGlobalSearchDisplayType(props.result));
const snippet = computed(() =>
  props.result.section === 'contents'
    ? splitOnlyPreviewContentMatch(props.result.contentMatch)
    : null
);
const select = (): void => onlyPreviewGlobalSearchStore.selectResult(props.result);
const open = (): void => {
  select();
  emit('focus-result', props.result.resultToken);
  void onlyPreviewGlobalSearchStore.openSelected();
};
</script>
