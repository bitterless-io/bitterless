<template>
  <div
    name="onlypreview__projectSearchResults"
    class="onlypreview-project-search"
    :aria-busy="onlyPreviewProjectSearchStore.pending"
  >
    <div
      v-if="onlyPreviewProjectSearchStore.error"
      name="onlypreview__projectSearchError"
      class="onlypreview-project-search__state onlypreview-project-search__state--error"
      role="alert"
    >
      {{ onlyPreviewProjectSearchStore.error }}
    </div>

    <div
      v-else-if="rows.length"
      name="onlypreview__projectSearchList"
      class="onlypreview-project-search__list"
      role="list"
      :aria-label="onlyPreviewI18n.project.projectSearchResultsLabel"
    >
      <button
        v-for="row in rows"
        :key="row.result.relativePath"
        name="onlypreview__projectSearchResult"
        class="onlypreview-project-search__result"
        :class="{
          'onlypreview-project-search__result--selected':
            row.result.relativePath === onlyPreviewShellStore.selectedRelativePath
        }"
        type="button"
        role="listitem"
        :title="row.result.relativePath"
        @click="onlyPreviewProjectSearchStore.selectResult(row.result)"
        @contextmenu.prevent.stop="
          onlyPreviewShellStore.showFileContextMenu(row.result.relativePath)
        "
      >
        <span class="onlypreview-project-search__identity">
          <span
            name="onlypreview__projectSearchFileName"
            class="onlypreview-project-search__file-name"
          >
            {{ row.result.fileName }}
          </span>
          <span name="onlypreview__projectSearchMedia" class="onlypreview-project-search__media">
            {{ row.result.mediaType }}
          </span>
        </span>
        <span
          v-if="row.directory"
          name="onlypreview__projectSearchDirectory"
          class="onlypreview-project-search__directory"
        >
          {{ row.directory }}
        </span>
        <!-- prettier-ignore -->
        <span
          v-if="row.snippet"
          name="onlypreview__projectSearchSnippet"
          class="onlypreview-project-search__snippet"
        >
          <span>{{ row.snippet.before }}</span><mark
            name="onlypreview__projectSearchHighlight"
            class="onlypreview-project-search__highlight"
          >{{ row.snippet.highlight }}</mark><span>{{ row.snippet.after }}</span>
        </span>
      </button>
    </div>

    <p
      v-if="onlyPreviewProjectSearchStore.pending"
      name="onlypreview__projectSearchPending"
      class="onlypreview-project-search__state"
      role="status"
    >
      {{ onlyPreviewI18n.project.projectSearchPending }}
    </p>
    <p
      v-else-if="
        onlyPreviewProjectSearchStore.query.trim() &&
        !rows.length &&
        !onlyPreviewProjectSearchStore.error
      "
      name="onlypreview__projectSearchEmpty"
      class="onlypreview-project-search__state"
    >
      {{ onlyPreviewI18n.project.projectSearchNoResults }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewProjectSearchStore } from '../../onlyPreviewProjectSearch.store';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
import { buildOnlyPreviewSearchDisplayRows } from './onlyPreviewSearchHighlight.service';

const rows = computed(() =>
  buildOnlyPreviewSearchDisplayRows(onlyPreviewProjectSearchStore.results)
);
</script>

<style lang="less">
@import './ProjectSearchResults.less';
</style>
