<template>
  <div
    name="onlypreview__shell"
    class="onlypreview-shell"
    :style="{ '--onlypreview-project-width': `${onlyPreviewShellStore.projectWidth}px` }"
    @keydown.capture="handleShellKeydown"
  >
    <header
      name="onlypreview__menuBar"
      class="onlypreview-shell__menu-bar"
      :class="{
        'onlypreview-shell__menu-bar--mac': isMac,
        'onlypreview-shell__menu-bar--windows': isWindows
      }"
      @dblclick="handleMenuBarDoubleClick"
    >
      <div name="onlypreview__identity" class="onlypreview-shell__identity">
        <IconFiles class="onlypreview-shell__identity-icon" :size="15" aria-hidden="true" />
        <span class="onlypreview-shell__product">{{ onlyPreviewI18n.productName }}</span>
        <span
          class="onlypreview-shell__path"
          :title="
            onlyPreviewShellStore.workspace?.displayPath || onlyPreviewI18n.topbar.noWorkspace
          "
        >
          {{ onlyPreviewShellStore.workspace?.displayPath || onlyPreviewI18n.topbar.noWorkspace }}
        </span>
      </div>

      <div name="onlypreview__menuActions" class="onlypreview-shell__menu-actions">
        <a-button
          name="onlypreview__openFolder"
          class="onlypreview-shell__command"
          type="text"
          size="mini"
          :disabled="onlyPreviewShellStore.targetLoading"
          @click="onlyPreviewShellStore.chooseFolder()"
        >
          <template #icon><IconFolderPlus :size="15" aria-hidden="true" /></template>
          {{ onlyPreviewI18n.topbar.openFolder }}
        </a-button>
        <a-button
          name="onlypreview__agentSkillGuide"
          class="onlypreview-shell__icon-command"
          type="text"
          size="mini"
          :title="onlyPreviewI18n.topbar.agentSkillGuide"
          :aria-label="onlyPreviewI18n.topbar.agentSkillGuide"
          @click="onlyPreviewShellStore.openAgentSkillGuide()"
        >
          <template #icon><IconRobot :size="16" aria-hidden="true" /></template>
        </a-button>
        <a-button
          name="onlypreview__settings"
          class="onlypreview-shell__icon-command"
          type="text"
          size="mini"
          :title="onlyPreviewI18n.topbar.settings"
          :aria-label="onlyPreviewI18n.topbar.settings"
          @click="onlyPreviewShellStore.openSettings()"
        >
          <template #icon><IconSettings :size="16" aria-hidden="true" /></template>
        </a-button>

        <template v-if="isWindows">
          <a-button
            name="onlypreview__minimize"
            class="onlypreview-shell__icon-command"
            type="text"
            size="mini"
            :title="onlyPreviewI18n.topbar.minimize"
            :aria-label="onlyPreviewI18n.topbar.minimize"
            @click="onlyPreviewShellStore.minimizeWindow()"
          >
            <template #icon><IconMinus :size="16" aria-hidden="true" /></template>
          </a-button>
          <a-button
            name="onlypreview__maximize"
            class="onlypreview-shell__icon-command"
            type="text"
            size="mini"
            :title="onlyPreviewI18n.topbar.maximize"
            :aria-label="onlyPreviewI18n.topbar.maximize"
            @click="onlyPreviewShellStore.toggleMaximizeWindow()"
          >
            <template #icon><IconMaximize :size="16" aria-hidden="true" /></template>
          </a-button>
          <a-button
            name="onlypreview__close"
            class="onlypreview-shell__icon-command onlypreview-shell__icon-command--close"
            type="text"
            size="mini"
            :title="onlyPreviewI18n.topbar.close"
            :aria-label="onlyPreviewI18n.topbar.close"
            @click="onlyPreviewShellStore.closeWindow()"
          >
            <template #icon><IconX :size="16" aria-hidden="true" /></template>
          </a-button>
        </template>
      </div>
    </header>

    <main name="onlypreview__workspace" class="onlypreview-shell__workspace">
      <aside name="onlypreview__project" class="onlypreview-shell__project">
        <div name="onlypreview__projectHeader" class="onlypreview-shell__project-header">
          <span
            name="onlypreview__projectTitle"
            class="onlypreview-shell__project-title"
            :title="
              onlyPreviewProjectSearchStore.active
                ? onlyPreviewI18n.project.projectSearchTitle
                : onlyPreviewShellStore.workspace?.displayPath || onlyPreviewI18n.project.label
            "
          >
            {{
              onlyPreviewProjectSearchStore.active
                ? onlyPreviewI18n.project.projectSearchTitle
                : onlyPreviewShellStore.workspace?.rootName || onlyPreviewI18n.project.label
            }}
          </span>
          <a-button
            name="onlypreview__locateCurrentFile"
            class="onlypreview-shell__project-action"
            type="text"
            size="mini"
            :title="onlyPreviewI18n.project.locateCurrentFile"
            :aria-label="onlyPreviewI18n.project.locateCurrentFile"
            :disabled="!onlyPreviewShellStore.selectedEntry"
            @click="locateCurrentFile"
          >
            <template #icon><IconCrosshair :size="15" aria-hidden="true" /></template>
          </a-button>
        </div>

        <label name="onlypreview__search" class="onlypreview-shell__search">
          <IconSearch :size="14" aria-hidden="true" />
          <input
            ref="searchInputRef"
            :value="
              onlyPreviewProjectSearchStore.active
                ? onlyPreviewProjectSearchStore.query
                : onlyPreviewShellStore.searchQuery
            "
            type="search"
            autocomplete="off"
            :aria-label="
              onlyPreviewProjectSearchStore.active
                ? onlyPreviewI18n.project.projectSearchLabel
                : onlyPreviewI18n.project.searchLabel
            "
            :placeholder="
              onlyPreviewProjectSearchStore.active
                ? onlyPreviewI18n.project.projectSearchPlaceholder
                : onlyPreviewI18n.project.searchPlaceholder
            "
            @input="handleSearchInput"
            @compositionstart="handleSearchCompositionStart"
            @compositionend="handleSearchCompositionEnd"
            @keydown.esc.prevent="handleSearchEscape"
          />
          <button
            v-if="
              onlyPreviewProjectSearchStore.active
                ? onlyPreviewProjectSearchStore.query
                : onlyPreviewShellStore.searchQuery
            "
            class="onlypreview-shell__search-clear"
            type="button"
            :aria-label="onlyPreviewI18n.project.clearSearch"
            @click="clearActiveSearch"
          >
            <IconX :size="13" aria-hidden="true" />
          </button>
        </label>

        <div
          v-if="onlyPreviewProjectSearchStore.active && onlyPreviewShellStore.workspace"
          name="onlypreview__projectSearchScope"
          class="onlypreview-shell__project-search-scope"
        >
          <label
            name="onlypreview__projectSearchScopeControl"
            class="onlypreview-shell__scope-control"
          >
            <span class="onlypreview-shell__scope-label">
              {{ onlyPreviewI18n.project.projectSearchScope }}
            </span>
            <select
              name="onlypreview__projectSearchScopeSelect"
              class="onlypreview-shell__scope-select"
              :value="onlyPreviewProjectSearchStore.scopeKind"
              :aria-label="onlyPreviewI18n.project.projectSearchScopeLabel"
              @change="handleProjectSearchScopeChange"
            >
              <option value="directory">
                {{ onlyPreviewI18n.project.projectSearchInDirectory }}
              </option>
              <option value="project">
                {{ onlyPreviewI18n.project.projectSearchInProject }}
              </option>
            </select>
          </label>
          <span
            name="onlypreview__projectSearchScopeTarget"
            class="onlypreview-shell__scope-target"
            :title="projectSearchScopeTarget"
          >
            {{ projectSearchScopeTarget }}
          </span>
        </div>

        <div
          v-if="onlyPreviewShellStore.errorMessage"
          name="onlypreview__indexError"
          class="onlypreview-shell__inline-error"
          role="alert"
        >
          <IconAlertTriangle :size="15" aria-hidden="true" />
          <span>{{ onlyPreviewShellStore.errorMessage }}</span>
        </div>

        <ProjectSearchResults
          v-if="onlyPreviewProjectSearchStore.active && onlyPreviewShellStore.workspace"
        />

        <div
          v-else-if="!onlyPreviewShellStore.workspace"
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
            @contextmenu.prevent.stop="onlyPreviewShellStore.showFileContextMenu(row.entry)"
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
          v-else-if="onlyPreviewShellStore.projectionReady"
          name="onlypreview__noResults"
          class="onlypreview-shell__no-results"
        >
          {{
            onlyPreviewShellStore.searchQuery.trim()
              ? onlyPreviewI18n.project.noResults
              : onlyPreviewI18n.project.emptyProject
          }}
        </div>

        <div
          v-if="onlyPreviewShellStore.indexProgress"
          name="onlypreview__indexProgress"
          class="onlypreview-shell__index-progress"
          :class="`onlypreview-shell__index-progress--${onlyPreviewShellStore.indexProgress.phase}`"
          role="progressbar"
          :aria-label="onlyPreviewI18n.project.indexProgressLabel"
          :aria-valuemin="onlyPreviewShellStore.indexProgress.phase === 'indexing' ? 0 : undefined"
          :aria-valuemax="
            onlyPreviewShellStore.indexProgress.phase === 'indexing'
              ? onlyPreviewShellStore.indexProgress.total
              : undefined
          "
          :aria-valuenow="
            onlyPreviewShellStore.indexProgress.phase === 'indexing'
              ? onlyPreviewShellStore.indexProgress.completed
              : undefined
          "
        >
          <span
            class="onlypreview-shell__index-progress-fill"
            :style="indexProgressStyle"
            aria-hidden="true"
          ></span>
        </div>
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
      <span v-if="onlyPreviewShellStore.selectedEntry" class="onlypreview-shell__file-state">
        <template v-if="onlyPreviewShellStore.selectedCharacterCount > 0">
          <span class="onlypreview-shell__selection-state">{{ selectedCharacterStatus }}</span>
          <span aria-hidden="true">·</span>
        </template>
        {{ selectedFileType }}
        <span aria-hidden="true">·</span>
        {{ formatOnlyPreviewBytes(onlyPreviewShellStore.selectedEntry.size) }}
      </span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  IconAlertTriangle,
  IconChevronRight,
  IconCrosshair,
  IconFile,
  IconFiles,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLink,
  IconMaximize,
  IconMinus,
  IconRobot,
  IconSearch,
  IconSettings,
  IconX
} from '@tabler/icons-vue';
import { formatOnlyPreviewBytes, interpolateOnlyPreview } from '../../common/onlyPreviewFormat';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import ProjectSearchResults from './components/ProjectSearchResults/ProjectSearchResults.vue';
import { onlyPreviewProjectSearchStore } from './onlyPreviewProjectSearch.store';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';

const previewHostRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const treeRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
let lastShiftAt = 0;
const isMac = onlyPreviewEnv.platform === 'darwin';
const isWindows = onlyPreviewEnv.platform === 'win32';

const treeFocusRelativePath = computed(() => onlyPreviewShellStore.treeFocusRelativePath);
const projectSearchScopeTarget = computed(
  () =>
    (onlyPreviewProjectSearchStore.scopeKind === 'directory'
      ? onlyPreviewProjectSearchStore.directoryLabel
      : onlyPreviewShellStore.workspace?.rootName) ||
    onlyPreviewShellStore.workspace?.rootName ||
    onlyPreviewI18n.project.label
);

const indexProgressStyle = computed(() =>
  onlyPreviewShellStore.indexProgress?.phase === 'indexing'
    ? { transform: `scaleX(${onlyPreviewShellStore.indexProgressRatio})` }
    : undefined
);

const selectedCharacterStatus = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.project.selectedCharacters, {
    count: onlyPreviewShellStore.selectedCharacterCount
  }).toUpperCase()
);

const selectedFileType = computed(() => {
  const entry = onlyPreviewShellStore.selectedEntry;
  if (!entry) return '';
  return /\.md$/i.test(entry.relativePath) ? 'MARKDOWN' : entry.previewHint.toUpperCase();
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

const handleMenuBarDoubleClick = (event: MouseEvent): void => {
  if ((event.target as HTMLElement).closest('.onlypreview-shell__menu-actions')) return;
  void onlyPreviewShellStore.toggleMaximizeWindow();
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
  const value = (event.target as HTMLInputElement).value;
  if (onlyPreviewProjectSearchStore.active) {
    onlyPreviewProjectSearchStore.setQuery(value);
    return;
  }
  onlyPreviewShellStore.setSearchQuery(value);
};

const handleSearchCompositionStart = (): void => {
  onlyPreviewProjectSearchStore.beginComposition();
};

const handleSearchCompositionEnd = (event: CompositionEvent): void => {
  onlyPreviewProjectSearchStore.endComposition((event.target as HTMLInputElement).value);
};

const handleSearchEscape = (): void => {
  if (onlyPreviewProjectSearchStore.active) {
    onlyPreviewProjectSearchStore.exit();
    return;
  }
  onlyPreviewShellStore.clearSearch();
};

const clearActiveSearch = (): void => {
  if (onlyPreviewProjectSearchStore.active) {
    onlyPreviewProjectSearchStore.clear();
    return;
  }
  onlyPreviewShellStore.clearSearch();
};

const handleProjectSearchScopeChange = (event: Event): void => {
  const scopeKind = (event.target as HTMLSelectElement).value;
  if (scopeKind === 'directory' || scopeKind === 'project') {
    onlyPreviewProjectSearchStore.setScopeKind(scopeKind);
  }
};

const focusTreePath = async (relativePath: string, center = false): Promise<void> => {
  if (!relativePath) return;
  await nextTick();
  const items = treeRef.value?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [];
  for (const item of items) {
    if (item.dataset.relativePath !== relativePath) continue;
    if (center) item.scrollIntoView({ block: 'center', inline: 'nearest' });
    item.focus(center ? { preventScroll: true } : undefined);
    return;
  }
};

const focusProjectTree = (): void => {
  onlyPreviewProjectSearchStore.exit();
  void focusTreePath(onlyPreviewShellStore.focusTree());
};

const locateCurrentFile = async (): Promise<void> => {
  await focusTreePath(await onlyPreviewShellStore.locateSelectedFile(), true);
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
    onlyPreviewProjectSearchStore.exit();
    void nextTick(() => searchInputRef.value?.focus());
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
  () => void nextTick(() => searchInputRef.value?.focus())
);

onBeforeUnmount(() => {
  onlyPreviewProjectSearchStore.shutdown();
  resizeObserver?.disconnect();
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
});
</script>

<style lang="less">
@import './App.less';
</style>
