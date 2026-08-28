<template>
  <section
    ref="workspaceRef"
    name="onlypreview__globalSearch"
    class="onlypreview-global-search"
    :style="{
      '--onlypreview-search-preview-height': `${onlyPreviewGlobalSearchStore.previewPercent}%`
    }"
    :aria-label="onlyPreviewI18n.globalSearch.label"
    @keydown.capture="handleWorkspaceKeydown"
  >
    <header name="onlypreview__globalSearchHeader" class="onlypreview-global-search__header">
      <label name="onlypreview__globalSearchInput" class="onlypreview-global-search__input">
        <IconSearch :size="15" aria-hidden="true" />
        <input
          ref="inputRef"
          :value="onlyPreviewGlobalSearchStore.query"
          type="search"
          autocomplete="off"
          :placeholder="onlyPreviewI18n.globalSearch.placeholder"
          :aria-label="onlyPreviewI18n.globalSearch.inputLabel"
          @input="handleInput"
          @compositionstart="onlyPreviewGlobalSearchStore.beginComposition()"
          @compositionend="handleCompositionEnd"
        />
        <button
          v-if="onlyPreviewGlobalSearchStore.query"
          name="onlypreview__globalSearchClear"
          class="onlypreview-global-search__clear"
          type="button"
          :aria-label="onlyPreviewI18n.globalSearch.clear"
          @click="onlyPreviewGlobalSearchStore.clear()"
        >
          <IconX :size="14" aria-hidden="true" />
        </button>
      </label>

      <div name="onlypreview__globalSearchScope" class="onlypreview-global-search__scope">
        <label>
          <span>{{ onlyPreviewI18n.globalSearch.scope }}</span>
          <select
            name="onlypreview__globalSearchScopeSelect"
            :value="onlyPreviewGlobalSearchStore.scopeKind"
            :aria-label="onlyPreviewI18n.globalSearch.scopeLabel"
            @change="handleScopeChange"
          >
            <option value="directory">{{ onlyPreviewI18n.globalSearch.currentDirectory }}</option>
            <option value="project">{{ onlyPreviewI18n.globalSearch.project }}</option>
          </select>
        </label>
        <span
          name="onlypreview__globalSearchScopeTarget"
          class="onlypreview-global-search__scope-target"
          :title="scopeTarget"
        >
          {{ scopeTarget }}
        </span>
      </div>
    </header>

    <div
      name="onlypreview__globalSearchResults"
      class="onlypreview-global-search__results"
      :aria-busy="onlyPreviewGlobalSearchStore.pending"
    >
      <div v-if="!globalSearchContext" class="onlypreview-global-search__state">
        <IconFolderPlus :size="24" aria-hidden="true" />
        <strong>{{ onlyPreviewI18n.globalSearch.openFolder }}</strong>
      </div>

      <template v-else>
        <section
          name="onlypreview__globalSearchContentsPane"
          class="onlypreview-global-search__results-pane onlypreview-global-search__results-pane--contents"
        >
          <SearchGroupHeader section="contents" />
          <SearchResultRow
            v-for="result in onlyPreviewGlobalSearchStore.contentsCollapsed
              ? []
              : onlyPreviewGlobalSearchStore.contents"
            :key="`contents:${result.resultToken}`"
            :result="result"
            @focus-result="focusResult"
          />
          <p
            v-if="showContentsEmpty"
            name="onlypreview__globalSearchContentsEmpty"
            class="onlypreview-global-search__empty-line"
          >
            {{ onlyPreviewI18n.globalSearch.noContents }}
          </p>
        </section>

        <section
          name="onlypreview__globalSearchFilesPane"
          class="onlypreview-global-search__results-pane onlypreview-global-search__results-pane--files"
        >
          <SearchGroupHeader section="files" />
          <SearchResultRow
            v-for="result in onlyPreviewGlobalSearchStore.filesCollapsed
              ? []
              : onlyPreviewGlobalSearchStore.files"
            :key="`files:${result.resultToken}`"
            :result="result"
            @focus-result="focusResult"
          />
          <p
            v-if="showFilesEmpty"
            name="onlypreview__globalSearchFilesEmpty"
            class="onlypreview-global-search__empty-line"
          >
            {{ onlyPreviewI18n.globalSearch.noFiles }}
          </p>
        </section>

        <p
          v-if="onlyPreviewGlobalSearchStore.pending"
          name="onlypreview__globalSearchPending"
          class="onlypreview-global-search__status"
          role="status"
        >
          {{ onlyPreviewI18n.globalSearch.pending }}
        </p>
        <p
          v-else-if="onlyPreviewGlobalSearchStore.error"
          name="onlypreview__globalSearchError"
          class="onlypreview-global-search__status onlypreview-global-search__status--error"
          role="alert"
        >
          {{ onlyPreviewGlobalSearchStore.error }}
        </p>
      </template>
    </div>

    <div
      name="onlypreview__globalSearchSplit"
      class="onlypreview-global-search__split"
      role="separator"
      aria-orientation="horizontal"
      aria-valuemin="25"
      aria-valuemax="70"
      :aria-valuenow="onlyPreviewGlobalSearchStore.previewPercent"
      tabindex="0"
      @pointerdown="startPreviewResize"
      @keydown.up.prevent="adjustPreviewHeight(2)"
      @keydown.down.prevent="adjustPreviewHeight(-2)"
      @keydown.home.prevent="onlyPreviewGlobalSearchStore.setPreviewPercent(25)"
      @keydown.end.prevent="onlyPreviewGlobalSearchStore.setPreviewPercent(70)"
    ></div>

    <section name="onlypreview__globalSearchPreviewPane" class="onlypreview-global-search__preview">
      <header class="onlypreview-global-search__preview-header">
        <span>{{ onlyPreviewI18n.globalSearch.preview }}</span>
        <button
          v-if="onlyPreviewGlobalSearchStore.selectedResult"
          name="onlypreview__globalSearchOpen"
          type="button"
          @click="onlyPreviewGlobalSearchStore.openSelected()"
        >
          {{ openLabel }} <IconExternalLink :size="13" aria-hidden="true" />
        </button>
      </header>
      <GlobalSearchPreview />
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { IconExternalLink, IconFolderPlus, IconSearch, IconX } from '@tabler/icons-vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewGlobalSearchStore } from '../../onlyPreviewGlobalSearch.store';
import GlobalSearchPreview from '../GlobalSearchPreview/GlobalSearchPreview.vue';
import SearchGroupHeader from './SearchGroupHeader.vue';
import SearchResultRow from './SearchResultRow.vue';

const inputRef = ref<HTMLInputElement | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
const globalSearchContext = computed(() => onlyPreviewGlobalSearchStore.getContext());

const scopeTarget = computed(() =>
  onlyPreviewGlobalSearchStore.scopeKind === 'project'
    ? globalSearchContext.value?.rootName || onlyPreviewI18n.project.label
    : onlyPreviewGlobalSearchStore.directoryLabel ||
      globalSearchContext.value?.rootName ||
      onlyPreviewI18n.project.label
);
const showFilesEmpty = computed(
  () =>
    !onlyPreviewGlobalSearchStore.filesCollapsed &&
    !!onlyPreviewGlobalSearchStore.query.trim() &&
    !onlyPreviewGlobalSearchStore.pending &&
    !onlyPreviewGlobalSearchStore.files.length
);
const showContentsEmpty = computed(
  () =>
    !onlyPreviewGlobalSearchStore.contentsCollapsed &&
    !!onlyPreviewGlobalSearchStore.query.trim() &&
    !onlyPreviewGlobalSearchStore.pending &&
    !onlyPreviewGlobalSearchStore.contents.length
);
const openLabel = computed(() =>
  onlyPreviewGlobalSearchStore.selectedResult?.section === 'files' &&
  onlyPreviewGlobalSearchStore.selectedResult.nodeKind === 'directory'
    ? onlyPreviewI18n.globalSearch.reveal
    : onlyPreviewI18n.globalSearch.open
);

const handleInput = (event: Event): void => {
  onlyPreviewGlobalSearchStore.setQuery((event.target as HTMLInputElement).value);
};

const handleCompositionEnd = (event: CompositionEvent): void => {
  onlyPreviewGlobalSearchStore.endComposition((event.target as HTMLInputElement).value);
};

const handleScopeChange = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'directory' || value === 'project') {
    onlyPreviewGlobalSearchStore.setScopeKind(value);
  }
};

const focusResult = async (resultToken: string): Promise<void> => {
  await nextTick();
  workspaceRef.value
    ?.querySelector<HTMLElement>(`[data-result-token="${CSS.escape(resultToken)}"]`)
    ?.focus();
};

const moveResultFocus = (offset: -1 | 1): void => {
  onlyPreviewGlobalSearchStore.moveSelection(offset);
  const token = onlyPreviewGlobalSearchStore.selectedResult?.resultToken;
  if (token) void focusResult(token);
};

const handleWorkspaceKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    void onlyPreviewGlobalSearchStore.handleEscape();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if ((event.target as HTMLElement).getAttribute('role') === 'separator') return;
    event.preventDefault();
    moveResultFocus(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void onlyPreviewGlobalSearchStore.openSelected();
  }
};

const startPreviewResize = (event: PointerEvent): void => {
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const move = (moveEvent: PointerEvent): void => {
    const bounds = workspaceRef.value?.getBoundingClientRect();
    if (!bounds?.height) return;
    onlyPreviewGlobalSearchStore.setPreviewPercent(
      ((bounds.bottom - moveEvent.clientY) / bounds.height) * 100
    );
  };
  const stop = (): void => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', stop);
    target.removeEventListener('pointercancel', stop);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', stop);
  target.addEventListener('pointercancel', stop);
};

const adjustPreviewHeight = (delta: number): void => {
  onlyPreviewGlobalSearchStore.setPreviewPercent(
    onlyPreviewGlobalSearchStore.previewPercent + delta
  );
};

watch(
  () => onlyPreviewGlobalSearchStore.focusRevision,
  () =>
    void nextTick(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    })
);

onMounted(() => {
  inputRef.value?.focus();
  inputRef.value?.select();
});
</script>

<style lang="less">
@import './GlobalSearchWorkspace.less';
</style>
