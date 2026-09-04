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
            :title="onlyPreviewShellStore.workspace?.displayPath || onlyPreviewI18n.project.label"
          >
            {{ onlyPreviewI18n.project.label }}
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

        <div
          v-if="onlyPreviewShellStore.errorMessage"
          name="onlypreview__indexError"
          class="onlypreview-shell__inline-error"
          role="alert"
        >
          <IconAlertTriangle
            class="onlypreview-shell__inline-error-icon"
            :size="15"
            aria-hidden="true"
          />
          <span class="onlypreview-shell__inline-error-message">
            {{ onlyPreviewShellStore.errorMessage }}
          </span>
          <button
            name="onlypreview__dismissIndexError"
            class="onlypreview-shell__inline-error-dismiss"
            type="button"
            :title="onlyPreviewI18n.project.dismissError"
            :aria-label="onlyPreviewI18n.project.dismissError"
            @click="onlyPreviewShellStore.dismissError()"
          >
            <IconX :size="14" aria-hidden="true" />
          </button>
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
            aria-multiselectable="true"
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
                onlyPreviewTreeSelection.isSelected(row.entry.relativePath),
              'onlypreview-shell__tree-row--previewed':
                onlyPreviewTreeSelection.isPreviewed(row.entry.relativePath),
              'onlypreview-shell__tree-row--symlink': row.entry.nodeKind === 'symlink',
              'onlypreview-shell__tree-row--search-excluded': row.searchExcluded
            }"
            :style="{ '--onlypreview-tree-depth': row.depth }"
            type="button"
            role="treeitem"
            :data-relative-path="row.entry.relativePath"
            :tabindex="row.entry.relativePath === treeFocusRelativePath ? 0 : -1"
            :aria-level="row.depth + 1"
            :aria-expanded="row.entry.nodeKind === 'directory' ? row.expanded : undefined"
            :aria-selected="onlyPreviewTreeSelection.isSelected(row.entry.relativePath)"
            :title="
              row.entry.nodeKind === 'symlink'
                ? onlyPreviewI18n.project.symlink
                : row.entry.relativePath
            "
            @focus="onlyPreviewShellStore.setFocusedPath(row.entry.relativePath)"
            @click="handleTreeRowClick(row.entry, $event)"
            @dblclick.prevent="handleTreeRowDoubleClick(row.entry)"
            @contextmenu.prevent.stop="showOnlyPreviewTreeContextMenu(row.entry)"
          >
            <span
              v-if="row.entry.nodeKind === 'directory'"
              name="onlypreview__treeChevron"
              class="onlypreview-shell__tree-chevron-hit"
              aria-hidden="true"
              @click.stop="onlyPreviewShellStore.handleTreeClick(row.entry, $event.detail, true)"
              @dblclick.prevent.stop
            >
              <IconChevronRight
                class="onlypreview-shell__tree-chevron"
                :class="{ 'onlypreview-shell__tree-chevron--expanded': row.expanded }"
                :size="13"
              />
            </span>
            <span v-else class="onlypreview-shell__tree-spacer" aria-hidden="true"></span>
            <IconFolderOpen
              v-if="row.entry.nodeKind === 'directory' && row.expanded"
              class="onlypreview-shell__tree-icon"
              :class="{
                'onlypreview-shell__tree-icon--search-excluded-directory': row.searchExcluded
              }"
              :size="15"
              aria-hidden="true"
            />
            <IconFolder
              v-else-if="row.entry.nodeKind === 'directory'"
              class="onlypreview-shell__tree-icon"
              :class="{
                'onlypreview-shell__tree-icon--search-excluded-directory': row.searchExcluded
              }"
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
            <input
              v-if="onlyPreviewProjectAuthoring.editing?.relativePath === row.entry.relativePath"
              :ref="(element) => registerEditInput(element)"
              name="onlypreview__treeNameInput"
              class="onlypreview-shell__tree-name-input"
              :style="{ width: `${editInputWidthCh}ch` }"
              :value="onlyPreviewProjectAuthoring.editing.draft"
              :aria-label="onlyPreviewI18n.project.editNameLabel"
              spellcheck="false"
              autocomplete="off"
              @click.stop
              @dblclick.stop
              @input="onlyPreviewProjectAuthoring.updateDraft(($event.target as HTMLInputElement).value)"
              @keydown.stop="handleEditKeydown"
              @blur="onlyPreviewProjectAuthoring.commit()"
            />
            <span v-else class="onlypreview-shell__tree-name">{{ row.entry.name }}</span>
          </button>
        </div>

        <div
          v-else-if="onlyPreviewShellStore.projectionReady"
          name="onlypreview__noResults"
          class="onlypreview-shell__no-results"
        >
          {{ onlyPreviewI18n.project.emptyProject }}
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

      <section name="onlypreview__previewRegion" class="onlypreview-shell__preview-region">
        <PreviewToolbar />
        <div
          ref="previewHostRef"
          name="onlypreview__previewContentHost"
          class="onlypreview-shell__preview-host"
        >
          <div
            v-if="onlyPreviewShellStore.previewPresentation?.status === 'unavailable'"
            name="onlypreview__previewUnavailable"
            class="onlypreview-shell__preview-unavailable"
            role="alert"
          >
            <IconAlertTriangle :size="24" aria-hidden="true" />
            <strong>{{ onlyPreviewI18n.preview.failedTitle }}</strong>
            <span>{{ onlyPreviewShellStore.previewPresentation.error?.message }}</span>
          </div>
        </div>
      </section>
    </main>

    <footer
      name="onlypreview__statusRail"
      class="onlypreview-shell__status-rail"
      role="status"
      aria-live="polite"
    >
      <span v-if="onlyPreviewShellStore.selectedEntry" class="onlypreview-shell__file-state">
        <template
          v-if="
            onlyPreviewShellStore.selectedTextAvailable &&
            onlyPreviewShellStore.selectedCharacterCount > 0
          "
        >
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
  IconSettings,
  IconX
} from '@tabler/icons-vue';
import { formatOnlyPreviewBytes, interpolateOnlyPreview } from '../../common/onlyPreviewFormat';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import PreviewToolbar from './components/PreviewToolbar/PreviewToolbar.vue';
import { onlyPreviewProjectWidthPersistence } from './onlyPreviewProjectWidthPersistence.service';
import type { OnlyPreviewIndexEntry } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';
import {
  onlyPreviewTreeSelection,
  showOnlyPreviewTreeContextMenu
} from './onlyPreviewTreeSelection.store';
import { onlyPreviewEditInputWidthCh } from './onlyPreviewProjectAuthoring.service';
import {
  onlyPreviewProjectAuthoring,
  subscribeOnlyPreviewProjectIntents
} from './onlyPreviewProjectAuthoring.store';

const previewHostRef = ref<HTMLElement | null>(null);
const treeRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
const isMac = onlyPreviewEnv.platform === 'darwin';
const isWindows = onlyPreviewEnv.platform === 'win32';

const treeFocusRelativePath = computed(() => onlyPreviewShellStore.treeFocusRelativePath);
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

const flushProjectWidth = (): void => onlyPreviewProjectWidthPersistence.flush();

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
    flushProjectWidth();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', stop);
  target.addEventListener('pointercancel', stop);
};

const focusTreePath = async (relativePath: string, center = false): Promise<boolean> => {
  await nextTick();
  const items = treeRef.value?.querySelectorAll<HTMLElement>('[role="treeitem"]') || [];
  for (const item of items) {
    if (item.dataset.relativePath !== relativePath) continue;
    if (center) item.scrollIntoView({ block: 'center', inline: 'nearest' });
    item.focus(center ? { preventScroll: true } : undefined);
    return true;
  }
  return false;
};

const focusProjectTree = (): void => {
  void focusTreePath(onlyPreviewShellStore.focusTree());
};

const locateCurrentFile = async (): Promise<void> => {
  await focusTreePath(await onlyPreviewShellStore.locateSelectedFile(), true);
};

const handleTreeKeydown = (event: KeyboardEvent): void => {
  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (primary && event.key.toLowerCase() === 'a' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    onlyPreviewTreeSelection.apply('all', null);
    return;
  }
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
  const moved = onlyPreviewShellStore.moveTreeFocus(event.key);
  // Shift extends the selection to the row focus just reached; a plain arrow collapses it, matching
  // the plain click.
  onlyPreviewTreeSelection.apply(event.shiftKey ? 'extend' : 'replace', moved);
  void focusTreePath(moved);
};

// A click on the row being renamed blurs the input, which commits; re-activating the row on top of
// that would re-preview a path that may be about to change. The edited row is inert until the edit
// closes.
const isEditing = (relativePath: string): boolean =>
  onlyPreviewProjectAuthoring.editing?.relativePath === relativePath;

// A modified click builds the selection and must not load a document: a shift-click across forty
// rows would otherwise start forty previews.
const handleTreeRowClick = (entry: OnlyPreviewIndexEntry, event: MouseEvent): void => {
  if (isEditing(entry.relativePath)) return;
  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (event.shiftKey && !primary) {
    onlyPreviewTreeSelection.apply('extend', entry.relativePath);
    return;
  }
  if (primary && !event.shiftKey) {
    onlyPreviewTreeSelection.apply('toggle', entry.relativePath);
    return;
  }
  onlyPreviewTreeSelection.apply('replace', entry.relativePath);
  onlyPreviewShellStore.handleTreeClick(entry, event.detail);
};

const handleTreeRowDoubleClick = (entry: OnlyPreviewIndexEntry): void => {
  if (isEditing(entry.relativePath)) return;
  onlyPreviewShellStore.handleTreeDoubleClick(entry);
};

let editInputElement: HTMLInputElement | null = null;

const editInputWidthCh = computed(() =>
  onlyPreviewEditInputWidthCh(onlyPreviewProjectAuthoring.editing?.draft ?? '')
);

// The input is created inside a `v-for`, so the row that owns it is identified by the store rather
// than by a per-row ref. Selecting the stem is what a rename is for: the extension usually stays.
const registerEditInput = (element: unknown): void => {
  if (!(element instanceof HTMLInputElement) || element === editInputElement) return;
  editInputElement = element;
  void nextTick(() => {
    if (editInputElement !== element || !element.isConnected) return;
    element.focus();
    const stem = element.value.lastIndexOf('.');
    element.setSelectionRange(0, stem > 0 ? stem : element.value.length);
  });
};

const handleEditKeydown = (event: KeyboardEvent): void => {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    void onlyPreviewProjectAuthoring.commit();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    onlyPreviewProjectAuthoring.cancel();
  }
};

const handleProjectItemCopyShortcut = (event: KeyboardEvent): boolean => {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.key.toLowerCase() !== 'c'
  ) {
    return false;
  }
  const primaryModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primaryModifier) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]') ||
    !target.matches('button[name="onlypreview__treeRow"]')
  ) {
    return false;
  }
  const relativePath = target.dataset.relativePath;
  if (relativePath === undefined) return false;
  // Copy Path (Shift) and Copy Name (Alt) are Main-owned window shortcuts now, so they work with
  // focus anywhere and must not also run here. Plain Cmd+C stays renderer-owned: inside a document
  // it means "copy the selection", and Main must not take that key.
  if (event.shiftKey || event.altKey) return false;
  event.preventDefault();
  void onlyPreviewShellStore.copyProjectItem(relativePath, 'item');
  return true;
};

const handleShellKeydown = (event: KeyboardEvent): void => {
  if (handleProjectItemCopyShortcut(event)) return;
  if (event.altKey && event.code === 'Digit1') {
    event.preventDefault();
    focusProjectTree();
    return;
  }
};

onMounted(() => {
  subscribeOnlyPreviewProjectIntents();
  window.addEventListener('pagehide', flushProjectWidth);
  void onlyPreviewShellStore.initialize();
});

watch(() => onlyPreviewShellStore.focusProjectRevision, focusProjectTree);

watch(
  () => onlyPreviewShellStore.centerProjectRevision,
  () => void focusTreePath(onlyPreviewShellStore.centerProjectRelativePath, true)
);

watch(
  previewHostRef,
  (host) => {
    resizeObserver?.disconnect();
    if (!host) return;
    resizeObserver ||= new ResizeObserver(reportPreviewBounds);
    resizeObserver.observe(host);
    reportPreviewBounds();
  },
  { flush: 'post' }
);

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flushProjectWidth);
  flushProjectWidth();
  resizeObserver?.disconnect();
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
});
</script>

<style lang="less">
@import './App.less';
</style>
