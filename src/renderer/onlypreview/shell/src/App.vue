<template>
  <div
    name="onlypreview__shell"
    class="onlypreview-shell"
    :style="{ '--onlypreview-project-width': `${onlyPreviewShellStore.projectWidth}px` }"
    @keydown.capture="handleShellKeydown"
  >
    <header name="onlypreview__topbar" class="onlypreview-shell__topbar">
      <div name="onlypreview__openActions" class="onlypreview-shell__open-actions">
        <a-button
          name="onlypreview__openFile"
          class="onlypreview-shell__command onlypreview-shell__command--primary"
          type="primary"
          size="mini"
          :disabled="onlyPreviewShellStore.targetLoading"
          @click="onlyPreviewShellStore.chooseFile()"
        >
          <IconFilePlus :size="15" aria-hidden="true" />
          {{ onlyPreviewI18n.topbar.openFile }}
        </a-button>
        <a-button
          name="onlypreview__openFolder"
          class="onlypreview-shell__command"
          size="mini"
          :disabled="onlyPreviewShellStore.targetLoading"
          @click="onlyPreviewShellStore.chooseFolder()"
        >
          <IconFolderPlus :size="15" aria-hidden="true" />
          {{ onlyPreviewI18n.topbar.openFolder }}
        </a-button>
      </div>

      <div name="onlypreview__location" class="onlypreview-shell__location">
        <span class="onlypreview-shell__product">{{ onlyPreviewI18n.productName }}</span>
        <span class="onlypreview-shell__location-divider" aria-hidden="true">/</span>
        <span class="onlypreview-shell__path">
          {{ onlyPreviewShellStore.workspace?.displayPath || onlyPreviewI18n.topbar.noWorkspace }}
        </span>
      </div>

      <div name="onlypreview__utilityActions" class="onlypreview-shell__utility-actions">
        <a-button
          name="onlypreview__refresh"
          class="onlypreview-shell__icon-command"
          size="mini"
          :title="onlyPreviewI18n.topbar.refresh"
          :aria-label="onlyPreviewI18n.topbar.refresh"
          :disabled="!onlyPreviewShellStore.workspace"
          @click="onlyPreviewShellStore.refresh()"
        >
          <IconRefresh :size="16" aria-hidden="true" />
        </a-button>
        <a-button
          name="onlypreview__settings"
          class="onlypreview-shell__icon-command"
          size="mini"
          :title="onlyPreviewI18n.topbar.settings"
          :aria-label="onlyPreviewI18n.topbar.settings"
          @click="onlyPreviewShellStore.openSettings()"
        >
          <IconSettings :size="16" aria-hidden="true" />
        </a-button>
      </div>
    </header>

    <main name="onlypreview__workspace" class="onlypreview-shell__workspace">
      <aside name="onlypreview__project" class="onlypreview-shell__project">
        <div name="onlypreview__projectHeader" class="onlypreview-shell__project-header">
          <span>{{ onlyPreviewI18n.project.label }}</span>
          <span v-if="onlyPreviewShellStore.index" class="onlypreview-shell__project-count">
            {{ onlyPreviewShellStore.index.entries.length }}
          </span>
        </div>

        <label name="onlypreview__search" class="onlypreview-shell__search">
          <IconSearch :size="14" aria-hidden="true" />
          <input
            ref="searchInputRef"
            :value="onlyPreviewShellStore.searchQuery"
            type="search"
            autocomplete="off"
            :aria-label="onlyPreviewI18n.project.searchLabel"
            :placeholder="onlyPreviewI18n.project.searchPlaceholder"
            @input="handleSearchInput"
            @keydown.esc.prevent="onlyPreviewShellStore.clearSearch()"
          />
          <button
            v-if="onlyPreviewShellStore.searchQuery"
            class="onlypreview-shell__search-clear"
            type="button"
            :aria-label="onlyPreviewI18n.project.clearSearch"
            @click="onlyPreviewShellStore.clearSearch()"
          >
            <IconX :size="13" aria-hidden="true" />
          </button>
        </label>

        <div
          v-if="onlyPreviewShellStore.errorMessage"
          name="onlypreview__indexError"
          class="onlypreview-shell__inline-error"
          role="alert"
        >
          <IconAlertTriangle :size="15" aria-hidden="true" />
          <span>{{ onlyPreviewShellStore.errorMessage }}</span>
        </div>

        <div
          v-if="!onlyPreviewShellStore.workspace"
          name="onlypreview__projectEmpty"
          class="onlypreview-shell__project-empty"
        >
          <span class="onlypreview-shell__empty-mark" aria-hidden="true">
            <IconFiles :size="24" />
          </span>
          <h1>{{ onlyPreviewI18n.project.emptyTitle }}</h1>
          <p>{{ onlyPreviewI18n.project.emptyBody }}</p>
        </div>

        <div
          v-else-if="onlyPreviewShellStore.visibleRows.length"
          ref="treeRef"
          name="onlypreview__tree"
          class="onlypreview-shell__tree"
          role="tree"
          :aria-label="onlyPreviewI18n.project.treeLabel"
          @keydown="handleTreeKeydown"
        >
          <button
            v-for="row in onlyPreviewShellStore.visibleRows"
            :key="row.entry.relativePath"
            name="onlypreview__treeRow"
            class="onlypreview-shell__tree-row"
            :class="{
              'onlypreview-shell__tree-row--selected':
                row.entry.relativePath === onlyPreviewShellStore.selectedRelativePath,
              'onlypreview-shell__tree-row--symlink': row.entry.nodeKind === 'symlink'
            }"
            :style="{ '--onlypreview-tree-depth': row.depth }"
            type="button"
            role="treeitem"
            :data-relative-path="row.entry.relativePath"
            :tabindex="row.entry.relativePath === treeFocusRelativePath ? 0 : -1"
            :aria-level="row.depth + 1"
            :aria-expanded="row.entry.nodeKind === 'directory' ? row.expanded : undefined"
            :aria-selected="row.entry.relativePath === onlyPreviewShellStore.selectedRelativePath"
            :title="
              row.entry.nodeKind === 'symlink'
                ? onlyPreviewI18n.project.symlink
                : row.entry.relativePath
            "
            @focus="onlyPreviewShellStore.setFocusedPath(row.entry.relativePath)"
            @click="onlyPreviewShellStore.handleTreeClick(row.entry, $event.detail)"
            @dblclick.prevent="onlyPreviewShellStore.handleTreeDoubleClick(row.entry)"
          >
            <IconChevronRight
              v-if="row.entry.nodeKind === 'directory'"
              class="onlypreview-shell__tree-chevron"
              :class="{ 'onlypreview-shell__tree-chevron--expanded': row.expanded }"
              :size="13"
              aria-hidden="true"
            />
            <span v-else class="onlypreview-shell__tree-spacer" aria-hidden="true"></span>
            <IconFolderOpen
              v-if="row.entry.nodeKind === 'directory' && row.expanded"
              class="onlypreview-shell__tree-icon"
              :size="15"
              aria-hidden="true"
            />
            <IconFolder
              v-else-if="row.entry.nodeKind === 'directory'"
              class="onlypreview-shell__tree-icon"
              :size="15"
              aria-hidden="true"
            />
            <IconLink
              v-else-if="row.entry.nodeKind === 'symlink'"
              class="onlypreview-shell__tree-icon"
              :size="14"
              aria-hidden="true"
            />
            <IconFile v-else class="onlypreview-shell__tree-icon" :size="14" aria-hidden="true" />
            <span class="onlypreview-shell__tree-name">{{ row.entry.name }}</span>
          </button>
        </div>

        <div
          v-else-if="onlyPreviewShellStore.index && !onlyPreviewShellStore.indexLoading"
          name="onlypreview__noResults"
          class="onlypreview-shell__no-results"
        >
          {{
            onlyPreviewShellStore.searchQuery.trim()
              ? onlyPreviewI18n.project.noResults
              : onlyPreviewI18n.project.emptyProject
          }}
        </div>

        <p
          v-if="onlyPreviewShellStore.index?.truncated"
          name="onlypreview__truncated"
          class="onlypreview-shell__truncated"
        >
          {{ truncatedMessage }}
        </p>
      </aside>

      <div
        name="onlypreview__resizeHandle"
        class="onlypreview-shell__resize-handle"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="onlyPreviewShellStore.projectWidth"
        aria-valuemin="180"
        aria-valuemax="480"
        tabindex="0"
        @pointerdown="startProjectResize"
        @keydown.left.prevent="
          onlyPreviewShellStore.setProjectWidth(onlyPreviewShellStore.projectWidth - 12)
        "
        @keydown.right.prevent="
          onlyPreviewShellStore.setProjectWidth(onlyPreviewShellStore.projectWidth + 12)
        "
      ></div>

      <section
        ref="previewHostRef"
        name="onlypreview__previewHost"
        class="onlypreview-shell__preview-host"
      ></section>
    </main>

    <footer
      name="onlypreview__statusRail"
      class="onlypreview-shell__status-rail"
      role="status"
      aria-live="polite"
    >
      <span class="onlypreview-shell__index-state">
        <span
          class="onlypreview-shell__index-pulse"
          :class="{ 'onlypreview-shell__index-pulse--active': onlyPreviewShellStore.indexLoading }"
          aria-hidden="true"
        ></span>
        {{ indexStatus }}
      </span>
      <span v-if="onlyPreviewShellStore.selectedEntry" class="onlypreview-shell__file-state">
        {{ onlyPreviewShellStore.selectedEntry.previewHint.toUpperCase() }}
        <span aria-hidden="true">·</span>
        {{ formatOnlyPreviewBytes(onlyPreviewShellStore.selectedEntry.size) }}
        <span aria-hidden="true">·</span>
        {{ onlyPreviewI18n.preview.readOnly.toUpperCase() }}
      </span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  IconAlertTriangle,
  IconChevronRight,
  IconFile,
  IconFilePlus,
  IconFiles,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLink,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconX
} from '@tabler/icons-vue';
import { formatOnlyPreviewBytes, interpolateOnlyPreview } from '../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';

const previewHostRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const treeRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
let lastShiftAt = 0;

const truncatedMessage = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.project.truncated, {
    limit: onlyPreviewShellStore.index?.limit || 0
  })
);

const treeFocusRelativePath = computed(() => onlyPreviewShellStore.treeFocusRelativePath);

const indexStatus = computed(() => {
  if (onlyPreviewShellStore.indexLoading) return onlyPreviewI18n.project.indexing.toUpperCase();
  if (!onlyPreviewShellStore.workspace) return onlyPreviewI18n.project.readyToOpen.toUpperCase();
  if (!onlyPreviewShellStore.index) return onlyPreviewI18n.project.indexFailed.toUpperCase();
  if (onlyPreviewShellStore.index.truncated) {
    return `${onlyPreviewI18n.project.indexPartial.toUpperCase()} · ${interpolateOnlyPreview(
      onlyPreviewI18n.project.itemCount,
      { count: onlyPreviewShellStore.index.entries.length }
    ).toUpperCase()}`;
  }
  return `${onlyPreviewI18n.project.indexReady.toUpperCase()} · ${interpolateOnlyPreview(
    onlyPreviewI18n.project.itemCount,
    { count: onlyPreviewShellStore.index.entries.length }
  ).toUpperCase()}`;
});

const reportPreviewBounds = (): void => {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    const bounds = previewHostRef.value?.getBoundingClientRect();
    if (!bounds) return;
    void onlyPreviewShellStore.reportPreviewBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
  });
};

const startProjectResize = (event: PointerEvent): void => {
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const move = (moveEvent: PointerEvent): void => {
    onlyPreviewShellStore.setProjectWidth(moveEvent.clientX);
    void nextTick(reportPreviewBounds);
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

const handleSearchInput = (event: Event): void => {
  onlyPreviewShellStore.setSearchQuery((event.target as HTMLInputElement).value);
};

const focusTreePath = async (relativePath: string): Promise<void> => {
  if (!relativePath) return;
  await nextTick();
  const items = treeRef.value?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [];
  for (const item of items) {
    if (item.dataset.relativePath !== relativePath) continue;
    item.focus();
    return;
  }
};

const focusProjectTree = (): void => {
  void focusTreePath(onlyPreviewShellStore.focusTree());
};

const handleTreeKeydown = (event: KeyboardEvent): void => {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    onlyPreviewShellStore.activateFocusedEntry();
    return;
  }
  if (
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp' &&
    event.key !== 'ArrowLeft' &&
    event.key !== 'ArrowRight' &&
    event.key !== 'Home' &&
    event.key !== 'End'
  ) {
    return;
  }
  event.preventDefault();
  void focusTreePath(onlyPreviewShellStore.moveTreeFocus(event.key));
};

const handleShellKeydown = (event: KeyboardEvent): void => {
  if (event.altKey && event.code === 'Digit1') {
    event.preventDefault();
    focusProjectTree();
    return;
  }
  if (event.key !== 'Shift' || event.repeat) return;
  const now = performance.now();
  if (now - lastShiftAt < 450) {
    event.preventDefault();
    searchInputRef.value?.focus();
    lastShiftAt = 0;
    return;
  }
  lastShiftAt = now;
};

onMounted(() => {
  void onlyPreviewShellStore.initialize();
  if (previewHostRef.value) {
    resizeObserver = new ResizeObserver(reportPreviewBounds);
    resizeObserver.observe(previewHostRef.value);
    reportPreviewBounds();
  }
});

watch(() => onlyPreviewShellStore.focusProjectRevision, focusProjectTree);

watch(
  () => onlyPreviewShellStore.focusSearchRevision,
  () => searchInputRef.value?.focus()
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
});
</script>

<style lang="less">
@import './App.less';
</style>
