<template>
  <nav
    v-if="onlyPreviewShellStore.workspace && onlyPreviewShellStore.projectionReady"
    name="onlypreview__bookmarks"
    class="onlypreview-bookmarks"
    :aria-label="onlyPreviewI18n.bookmarks.label"
  >
    <!-- 标题一行:标题 ＋ 问号。问号弹的是 alert 面那一层,所以「回车 / esc / 点关闭都能关」
         和焦点管理都是既有行为,不是这里新写的。
         空态**不在这一行** —— Ral 2026-09-09:「No bookmarks 应该放到第二行」。 -->
    <div name="onlypreview__bookmarksHeader" class="onlypreview-bookmarks__header">
      <span class="onlypreview-bookmarks__title">{{ onlyPreviewI18n.bookmarks.label }}</span>
      <IconBtn
        name="onlypreview__bookmarksHint"
        class="onlypreview-bookmarks__hint"
        :title="onlyPreviewI18n.bookmarks.hint"
        :aria-label="onlyPreviewI18n.bookmarks.hint"
        @click="onlyPreviewBookmarksStore.showHint()"
      >
        <IconHelp :size="14" aria-hidden="true" />
      </IconBtn>
    </div>
    <!-- 第二行:空态。放在列表之前而不是塞进列表里 —— 它不是一个书签条目,列表滚动时它也不该跟着滚。 -->
    <span
      v-if="!onlyPreviewBookmarksStore.entries.length && !onlyPreviewBookmarksStore.errorMessage"
      name="onlypreview__bookmarksEmpty"
      class="onlypreview-bookmarks__empty"
      >{{ onlyPreviewI18n.bookmarks.empty }}</span
    >
    <div name="onlypreview__bookmarkList" class="onlypreview-bookmarks__list">
      <div
        v-for="entry in onlyPreviewBookmarksStore.entries"
        :key="entry.relativePath"
        name="onlypreview__bookmarkRow"
        class="onlypreview-bookmarks__row"
        @contextmenu.prevent.stop="onlyPreviewBookmarksStore.showMenu(entry.relativePath)"
        @keydown.shift.f10.prevent="onlyPreviewBookmarksStore.showMenu(entry.relativePath)"
      >
        <button name="onlypreview__bookmark" class="onlypreview-bookmarks__item" type="button"
          :title="`${onlyPreviewShellStore.workspace.displayPath}/${entry.relativePath}`"
          @click="onlyPreviewShellStore.openBookmark(entry)">
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
  </nav>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { IconHelp, IconX } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
import { onlyPreviewBookmarksStore } from '../../onlyPreviewBookmarks.store';

watch(
  () => onlyPreviewShellStore.workspace?.workspaceId,
  () => onlyPreviewBookmarksStore.resetWorkspace()
);
onMounted(() => {
  onlyPreviewBookmarksStore.initialize();
});
onBeforeUnmount(() => {
  onlyPreviewBookmarksStore.dispose();
});
</script>

<style lang="less">
@import './BookmarkBar.less';
</style>
