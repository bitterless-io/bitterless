<template>
  <nav
    v-if="onlyPreviewShellStore.workspace && onlyPreviewShellStore.projectionReady"
    name="onlypreview__bookmarks"
    class="onlypreview-bookmarks"
    :aria-label="onlyPreviewI18n.bookmarks.label"
  >
    <div name="onlypreview__bookmarksHeader" class="onlypreview-bookmarks__header">
      <span class="onlypreview-bookmarks__title">{{ onlyPreviewI18n.bookmarks.label }}</span>
      <button
        name="onlypreview__bookmarksToggle"
        class="onlypreview-bookmarks__toggle"
        type="button"
        :title="toggleLabel"
        :aria-label="toggleLabel"
        :aria-expanded="onlyPreviewBookmarksStore.expanded"
        aria-controls="onlypreview-bookmark-list"
        @click="onlyPreviewBookmarksStore.toggleExpanded()"
      >
        <IconChevronDown v-if="onlyPreviewBookmarksStore.expanded" :size="14" aria-hidden="true" />
        <IconChevronRight v-else :size="14" aria-hidden="true" />
      </button>
    </div>
    <template v-if="onlyPreviewBookmarksStore.expanded">
      <!-- 第二行:空态。放在列表之前而不是塞进列表里 —— 它不是一个书签条目,列表滚动时它也不该跟着滚。 -->
      <span
        v-if="!onlyPreviewBookmarksStore.entries.length && !onlyPreviewBookmarksStore.errorMessage"
        name="onlypreview__bookmarksEmpty"
        class="onlypreview-bookmarks__empty"
        >{{ onlyPreviewI18n.bookmarks.empty }}</span
      >
      <div
        id="onlypreview-bookmark-list"
        name="onlypreview__bookmarkList"
        class="onlypreview-bookmarks__list"
        :aria-busy="onlyPreviewBookmarksStore.reordering"
        @pointerdown.capture="allowNextClick"
        @click.capture="guardDragClick"
      >
        <div
          v-for="entry in onlyPreviewBookmarksStore.entries"
          :key="entry.relativePath"
          name="onlypreview__bookmarkRow"
          class="onlypreview-bookmarks__row"
          :class="{
            'onlypreview-bookmarks__row--dragging': dragSource?.relativePath === entry.relativePath,
            'onlypreview-bookmarks__row--drop-before': dropTarget?.relativePath === entry.relativePath && dropTarget.edge === 'before',
            'onlypreview-bookmarks__row--drop-after': dropTarget?.relativePath === entry.relativePath && dropTarget.edge === 'after'
          }"
          :draggable="!onlyPreviewBookmarksStore.reordering && onlyPreviewBookmarksStore.entries.length > 1"
          @dragstart.stop="startDrag($event, entry.relativePath)"
          @dragover.stop="updateDropTarget($event, entry.relativePath)"
          @dragleave.stop="leaveDropTarget($event, entry.relativePath)"
          @drop.prevent.stop="dropBookmark($event, entry.relativePath)"
          @dragend.stop="resetDrag"
          @contextmenu.prevent.stop="onlyPreviewBookmarksStore.showMenu(entry.relativePath)"
          @keydown.shift.f10.prevent="onlyPreviewBookmarksStore.showMenu(entry.relativePath)"
        >
          <button name="onlypreview__bookmark" class="onlypreview-bookmarks__item" type="button"
            :title="`${onlyPreviewShellStore.workspace.displayPath}/${entry.relativePath}`"
            @click="onlyPreviewShellStore.openBookmark(entry)">
            <component
              :is="entry.nodeKind === 'directory' ? IconFolder : FILE_ICONS[resolveOnlyPreviewFileIconKey(entry.relativePath)]"
              class="onlypreview-bookmarks__icon"
              :size="14"
              aria-hidden="true"
            />
            <span class="onlypreview-bookmarks__name">{{ entry.name }}</span>
          </button>
          <IconBtn name="onlypreview__removeBookmark" class="onlypreview-bookmarks__remove"
            :title="onlyPreviewI18n.bookmarks.remove" :aria-label="`${onlyPreviewI18n.bookmarks.remove}: ${entry.name}`"
            @click.stop="onlyPreviewBookmarksStore.remove(entry.relativePath)">
            <IconX :size="14" aria-hidden="true" />
          </IconBtn>
        </div>
      </div>
      <div v-if="onlyPreviewBookmarksStore.errorMessage" class="onlypreview-bookmarks__failure" role="alert">
        <span>{{ onlyPreviewBookmarksStore.errorMessage }}</span>
        <button
          class="onlypreview-bookmarks__error"
          name="onlypreview__bookmarksRetry"
          type="button"
          :title="onlyPreviewBookmarksStore.errorMessage"
          @click="onlyPreviewBookmarksStore.refresh()"
        >
          {{ onlyPreviewI18n.recents.retry }}
        </button>
      </div>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  IconChevronDown,
  IconChevronRight,
  IconFileText,
  IconFileTypeDoc,
  IconFileTypePdf,
  IconFileTypePpt,
  IconFileTypeXls,
  IconFileTypeZip,
  IconFolder,
  IconMarkdown,
  IconPhotoAlt,
  IconX
} from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import {
  resolveOnlyPreviewFileIconKey,
  type OnlyPreviewFileIconKey
} from '../../../../common/onlyPreviewTreeIcon.service';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
import { onlyPreviewBookmarksStore } from '../../onlyPreviewBookmarks.store';
import { reorderOnlyPreviewBookmarkPaths, type OnlyPreviewBookmarkDropEdge } from './onlyPreviewBookmarkOrder.service';

const FILE_ICONS: Record<OnlyPreviewFileIconKey, unknown> = {
  document: IconFileTypeDoc,
  spreadsheet: IconFileTypeXls,
  presentation: IconFileTypePpt,
  markdown: IconMarkdown,
  pdf: IconFileTypePdf,
  archive: IconFileTypeZip,
  image: IconPhotoAlt,
  file: IconFileText
};

const toggleLabel = computed(() => onlyPreviewBookmarksStore.expanded
  ? onlyPreviewI18n.bookmarks.collapse
  : onlyPreviewI18n.bookmarks.expand);

const BOOKMARK_DRAG_TYPE = 'application/x-onlypreview-bookmark';
const dragSource = ref<{ workspaceId: string; relativePath: string } | null>(null);
const dropTarget = ref<{ relativePath: string; edge: OnlyPreviewBookmarkDropEdge } | null>(null);
let suppressDragClick = false;

const resetDrag = (): void => {
  dragSource.value = null;
  dropTarget.value = null;
};
const allowNextClick = (): void => { suppressDragClick = false; };
const guardDragClick = (event: MouseEvent): void => {
  if (!dragSource.value && (!suppressDragClick || event.detail === 0)) return;
  event.preventDefault();
  event.stopPropagation();
};
const startDrag = (event: DragEvent, relativePath: string): void => {
  const workspaceId = onlyPreviewShellStore.workspace?.workspaceId;
  if (!workspaceId || onlyPreviewBookmarksStore.reordering || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  dragSource.value = { workspaceId, relativePath };
  suppressDragClick = true;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(BOOKMARK_DRAG_TYPE, 'reorder');
};
const isLocalDrag = (event: DragEvent): boolean => Boolean(
  dragSource.value &&
  dragSource.value.workspaceId === onlyPreviewShellStore.workspace?.workspaceId &&
  !onlyPreviewBookmarksStore.reordering &&
  event.dataTransfer?.types.includes(BOOKMARK_DRAG_TYPE) &&
  onlyPreviewBookmarksStore.entries.some(entry => entry.relativePath === dragSource.value?.relativePath)
);
const dropEdge = (event: DragEvent): OnlyPreviewBookmarkDropEdge => {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
};
const updateDropTarget = (event: DragEvent, relativePath: string): void => {
  if (!isLocalDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = dragSource.value?.relativePath === relativePath
    ? null
    : { relativePath, edge: dropEdge(event) };
};
const leaveDropTarget = (event: DragEvent, relativePath: string): void => {
  const row = event.currentTarget as HTMLElement;
  if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
  if (dropTarget.value?.relativePath === relativePath) dropTarget.value = null;
};
const dropBookmark = async (event: DragEvent, relativePath: string): Promise<void> => {
  if (!isLocalDrag(event) || !dragSource.value) return;
  const paths = reorderOnlyPreviewBookmarkPaths(
    onlyPreviewBookmarksStore.entries.map(entry => entry.relativePath),
    dragSource.value.relativePath,
    relativePath,
    dropEdge(event)
  );
  resetDrag();
  if (paths) await onlyPreviewBookmarksStore.reorder(paths);
};

watch(
  () => onlyPreviewShellStore.workspace?.workspaceId,
  () => {
    resetDrag();
    suppressDragClick = false;
    onlyPreviewBookmarksStore.resetWorkspace();
  }
);
watch(
  () => onlyPreviewBookmarksStore.expanded,
  expanded => { if (!expanded) resetDrag(); }
);
onMounted(() => {
  onlyPreviewBookmarksStore.initialize();
});
onBeforeUnmount(() => {
  resetDrag();
  onlyPreviewBookmarksStore.dispose();
});
</script>

<style lang="less">
@import './BookmarkBar.less';
</style>
