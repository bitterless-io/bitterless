<template>
  <div
    name="onlypreview__shell"
    class="onlypreview-shell"
    :class="{ 'onlypreview-shell--focused': shellFocused }"
    :style="{ '--onlypreview-project-width': `${onlyPreviewShellStore.projectWidth}px` }"
    @keydown.capture="handleShellKeydown"
  >
    <header
      name="onlypreview__menuBar"
      class="onlypreview-shell__menu-bar"
      :class="{
        'onlypreview-shell__menu-bar--mac': isMac && ownsWindow,
        'onlypreview-shell__menu-bar--windows': isWindows && ownsWindow
      }"
      @dblclick="handleMenuBarDoubleClick"
    >
      <div name="onlypreview__identity" class="onlypreview-shell__identity">
        <OnlyPreviewMark class="onlypreview-shell__identity-icon" :size="15" />
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
          class="onlypreview-shell__icon-command"
          type="text"
          size="mini"
          :title="onlyPreviewI18n.topbar.openFolder"
          :aria-label="onlyPreviewI18n.topbar.openFolder"
          :disabled="onlyPreviewShellStore.targetLoading"
          @click="onlyPreviewShellStore.chooseFolder()"
        >
          <template #icon><IconFolderPlus :size="15" aria-hidden="true" /></template>
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
        <a-button
          name="onlypreview__host-toggle"
          class="onlypreview-shell__icon-command"
          :class="{ 'onlypreview-shell__icon-command--window': ownsWindow }"
          type="text"
          size="mini"
          :title="hostToggleLabel"
          :aria-label="hostToggleLabel"
          :aria-pressed="ownsWindow"
          :disabled="onlyPreviewShellStore.hostToggle.disabled"
          @click="onlyPreviewShellStore.hostToggle.toggle(onlyPreviewShellStore)"
        >
          <template #icon>
            <IconBrowser v-if="ownsWindow" :size="16" aria-hidden="true" />
            <IconExternalLink v-else :size="16" aria-hidden="true" />
          </template>
        </a-button>

        <template v-if="isWindows && ownsWindow">
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
          <ProjectPanelTabs
            v-model="onlyPreviewRecentsStore.activePanel"
            :title="onlyPreviewShellStore.workspace?.displayPath || onlyPreviewI18n.project.label"
          />
          <a-button
            name="onlypreview__collapseDirectories"
            class="onlypreview-shell__project-action"
            type="text"
            size="mini"
            :title="onlyPreviewI18n.project.collapseDirectories"
            :aria-label="onlyPreviewI18n.project.collapseDirectories"
            :disabled="!onlyPreviewShellStore.workspace || !onlyPreviewShellStore.index"
            @click="onlyPreviewShellStore.treeExpansion.collapse(onlyPreviewShellStore)"
          >
            <template #icon><IconFold :size="15" aria-hidden="true" /></template>
          </a-button>
          <a-button
            name="onlypreview__locateCurrentFile"
            class="onlypreview-shell__project-action"
            type="text"
            size="mini"
            :title="onlyPreviewI18n.project.locateCurrentFile"
            :aria-label="onlyPreviewI18n.project.locateCurrentFile"
            :disabled="!canLocateCurrentPreview"
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
            v-if="onlyPreviewErrorDetail.available"
            name="onlypreview__copyIndexErrorDetail"
            class="onlypreview-shell__inline-error-copy"
            type="button"
            :title="onlyPreviewI18n.project.copyErrorDetail"
            @click="onlyPreviewErrorDetail.copy()"
          >
            {{
              onlyPreviewErrorDetail.copied
                ? onlyPreviewI18n.project.errorDetailCopied
                : onlyPreviewI18n.project.copyErrorDetail
            }}
          </button>
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
          <p id="onlypreview-workspace-guide">{{ onlyPreviewI18n.project.emptyBody }}</p>
          <a-button
            name="onlypreview__chooseWorkspace"
            class="onlypreview-shell__choose-workspace"
            type="primary"
            size="small"
            aria-describedby="onlypreview-workspace-guide"
            :disabled="onlyPreviewShellStore.targetLoading"
            :loading="onlyPreviewShellStore.targetLoading"
            @click="onlyPreviewShellStore.chooseFolder()"
          >
            {{ onlyPreviewI18n.project.chooseWorkspace }}
          </a-button>
        </div>

        <div
          v-show="onlyPreviewRecentsStore.activePanel === 'project'"
          id="onlypreview-panel-project"
          name="onlypreview__projectPanel"
          class="onlypreview-project-panel"
          role="tabpanel"
          aria-labelledby="onlypreview-tab-project"
        >
        <BookmarkBar />
        <div
          v-if="onlyPreviewShellStore.projectListingLoading"
          name="onlypreview__projectLoading"
          class="onlypreview-shell__project-loading"
          role="status"
          :aria-label="onlyPreviewI18n.preview.loadingProjectTitle"
        >
          <a-spin :size="22" aria-hidden="true" />
          <span>{{ onlyPreviewI18n.preview.loadingProjectTitle }}</span>
        </div>
        <div
          v-else-if="onlyPreviewShellStore.workspace && onlyPreviewShellStore.projectionReady && onlyPreviewShellStore.visibleRows.length"
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
              'onlypreview-shell__tree-row--root': row.entry.relativePath === '',
              'onlypreview-shell__tree-row--selected':
                onlyPreviewTreeSelection.isSelected(row.entry.relativePath),
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
            <!-- 图标这一条 v-if 链:目录(展开/收起)→ 符号链接 → 按类型的文件图标。
                 **中间不能插 HTML 注释** —— 注释是一个节点,会把 v-if 链打断,于是 `v-else` 那一支
                 编译成一个注释节点,表现是「文件图标根本不出现」。这条是实测踩到的
                 (`onlyPreviewTreeDensity` 那条断言抓的就是它)。
                 文件那一支:判定在 `onlyPreviewTreeIcon.service`,key → 组件 的映射在
                 `TREE_FILE_ICONS`(下方 script),加一种类型是加一行。 -->
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
            <component
              :is="TREE_FILE_ICONS[resolveOnlyPreviewFileIconKey(row.entry.relativePath)]"
              v-else
              class="onlypreview-shell__tree-icon"
              :size="14"
              aria-hidden="true"
            />
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
          v-else-if="onlyPreviewShellStore.workspace && onlyPreviewShellStore.projectionReady"
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
        </div>
        <RecentsPanel v-show="onlyPreviewRecentsStore.activePanel === 'recents'" />
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
      <!-- 面包屑:从项目目录本身开始,一直指到选中的文件或文件夹(Ral 2026-09-09)。
           最后一段单独渲染在截断容器**外面** —— 路径太深时被切掉的是中间,而选中的那个东西
           始终可见。只做显示不做导航:要求是「显示」,加跳转是没要求的范围。 -->
      <span
        v-if="statusBreadcrumb"
        name="onlypreview__statusBreadcrumb"
        class="onlypreview-shell__breadcrumb"
        :title="statusBreadcrumb.title"
      >
        <span class="onlypreview-shell__breadcrumb-lead">
          <template v-for="(segment, index) in statusBreadcrumb.lead" :key="index">
            <span class="onlypreview-shell__breadcrumb-segment">{{ segment }}</span>
            <span class="onlypreview-shell__breadcrumb-separator" aria-hidden="true">/</span>
          </template>
        </span>
        <span class="onlypreview-shell__breadcrumb-segment onlypreview-shell__breadcrumb-tail">{{
          statusBreadcrumb.tail
        }}</span>
      </span>
      <span v-if="previewDescriptor" class="onlypreview-shell__file-state">
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
        {{ formatOnlyPreviewBytes(previewDescriptor.size) }}
      </span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  IconAlertTriangle,
  IconBrowser,
  IconChevronRight,
  IconCrosshair,
  IconExternalLink,
  IconFileText,
  IconFileTypeDoc,
  IconFileTypePdf,
  IconFileTypePpt,
  IconFileTypeXls,
  IconFileTypeZip,
  IconFiles,
  IconFold,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLink,
  IconMarkdown,
  IconMaximize,
  IconMinus,
  IconPhotoAlt,
  IconRobot,
  IconSettings,
  IconX
} from '@tabler/icons-vue';
import {
  resolveOnlyPreviewFileIconKey,
  type OnlyPreviewFileIconKey
} from '../../common/onlyPreviewTreeIcon.service';
import { formatOnlyPreviewBytes, interpolateOnlyPreview } from '../../common/onlyPreviewFormat';
import { resolveOnlyPreviewStatusBreadcrumb } from './onlyPreviewTree.service';
import {
  ONLY_PREVIEW_EDITABLE_TARGET_SELECTOR,
  resolveOnlyPreviewCopyShortcut
} from './onlyPreviewCopyShortcut.service';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import OnlyPreviewMark from './components/OnlyPreviewMark.vue';
import PreviewToolbar from './components/PreviewToolbar/PreviewToolbar.vue';
import BookmarkBar from './components/Bookmarks/BookmarkBar.vue';
import ProjectPanelTabs from './components/Recents/ProjectPanelTabs.vue';
import RecentsPanel from './components/Recents/RecentsPanel.vue';
import { onlyPreviewRecentsStore } from './onlyPreviewRecents.store';
import { handleOnlyPreviewProjectDeleteShortcut } from './onlyPreviewProjectDeleteShortcut.service';
import { onlyPreviewProjectWidthPersistence } from './onlyPreviewProjectWidthPersistence.service';
import type { OnlyPreviewIndexEntry } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';
import { onlyPreviewErrorDetail } from './onlyPreviewErrorDetail.store';
import {
  onlyPreviewTreeSelection,
  showOnlyPreviewTreeContextMenu
} from './onlyPreviewTreeSelection.store';
import { onlyPreviewEditInputWidthCh } from './onlyPreviewProjectAuthoring.service';
import {
  onlyPreviewProjectAuthoring,
  subscribeOnlyPreviewProjectIntents
} from './onlyPreviewProjectAuthoring.store';

/**
 * 树行的文件图标:key → tabler 组件(Ral 2026-09-09「风格要统一」)。
 *
 * **刻意没用 `IconFileType*` 那一家**(`IconFileTypeDocx` / `IconFileTypeXls` / `IconFileTypePpt`)——
 * 那一家的辨识信息是画在纸面里的 "DOCX"/"XLS" 字样,而这里是 **14px**,那几个字在这个尺寸下读不出来,
 * 四种类型会长成同一张纸,等于没分。所以取的是**轮廓本身就不同**的一组:
 * 一张写着文字行的纸 / 一张带网格的纸 / 一块投影屏 / markdown 徽标。
 *
 * 风格一致由三件事保证:同一个图标库、同一套 outline(描边宽度一致)、同一个 `:size="14"` 与
 * 同一个 `.onlypreview-shell__tree-icon` 类。
 *
 * tabler 没有 `IconFileTypeMd`,markdown 只有 `IconMarkdown` 这一个;它的外形与其它三个不同族,
 * 但 markdown 是唯一一个**靠徽标就能认出来**的类型,这个不对称是划算的。
 */
/**
 * 树行的文件图标:key → tabler 组件。
 *
 * Ral 2026-09-09 点名的这一套:默认 `file-text`,office 三种用 `file-type-doc/xls/ppt`,
 * `file-type-pdf`、`file-type-zip`,图片统一 `photo-alt`。`.md` 他没提,保留 `IconMarkdown`。
 *
 * 风格一致由三件事保证:同一个图标库、同一套 outline(描边宽度一致)、同一个 `:size="14"` 与
 * 同一个 `.onlypreview-shell__tree-icon` 类。
 *
 * 记一条已知取舍:`file-type-*` 的辨识信息是画在纸面里的 "DOC"/"PDF"/"XLS" 字样,而这里是 14px,
 * 那几个字在这个尺寸下偏小。这是 Ral 明确要的一套,不是漏想 —— 要换成轮廓可辨的一组(例如
 * `file-description` / `file-spreadsheet` / `presentation`)只需改这张表。
 */
const TREE_FILE_ICONS: Record<OnlyPreviewFileIconKey, unknown> = {
  document: IconFileTypeDoc,
  spreadsheet: IconFileTypeXls,
  presentation: IconFileTypePpt,
  markdown: IconMarkdown,
  pdf: IconFileTypePdf,
  archive: IconFileTypeZip,
  image: IconPhotoAlt,
  file: IconFileText
};

const previewHostRef = ref<HTMLElement | null>(null);
const shellFocused = ref(false);
const syncShellFocus = (): void => { shellFocused.value = document.hasFocus(); };
const treeRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
const isMac = onlyPreviewEnv.platform === 'darwin';
const isWindows = onlyPreviewEnv.platform === 'win32';
/**
 * Whether this surface owns a window.
 *
 * A Cowork tab has no traffic lights and no window of its own to minimize or maximize, so those
 * controls are not merely useless there — they are buttons whose only possible behaviour is to do
 * nothing. Close stays available in both hosts: the mount maps it to closing the window or the tab.
 */
const ownsWindow = onlyPreviewEnv.host !== 'cowork';
const hostToggleLabel = computed(() => {
  if (!ownsWindow) return onlyPreviewI18n.topbar.openInWindow;
  return onlyPreviewShellStore.hostToggle.state.canDock
    ? onlyPreviewI18n.topbar.moveToTab
    : onlyPreviewI18n.topbar.dockUnavailable;
});
const refreshHostToggleState = (): void => {
  void onlyPreviewShellStore.refreshHostToggleState();
};

const treeFocusRelativePath = computed(() => onlyPreviewShellStore.treeFocusRelativePath);
const indexProgressStyle = computed(() =>
  onlyPreviewShellStore.indexProgress?.phase === 'indexing'
    ? { transform: `scaleX(${onlyPreviewShellStore.indexProgressRatio})` }
    : undefined
);

/**
 * 状态栏左侧的面包屑,拆成 `lead` ＋ `tail` 两截。
 *
 * 拆开是为了截断的位置:`lead` 在一个会溢出省略的容器里,`tail`(选中的那个文件或文件夹)
 * 在容器外且不收缩 —— 于是路径太深时被切掉的是**中间**,而用户选中的东西始终看得见。
 * 整条塞进一个省略容器的话,深路径会把最重要的一段先切掉。
 */
const statusBreadcrumb = computed(() => {
  const crumb = resolveOnlyPreviewStatusBreadcrumb(onlyPreviewShellStore);
  if (!crumb) return null;
  return {
    lead: crumb.segments.slice(0, -1),
    tail: crumb.segments.at(-1) ?? '',
    title: crumb.title
  };
});

const selectedCharacterStatus = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.project.selectedCharacters, {
    count: onlyPreviewShellStore.selectedCharacterCount
  }).toUpperCase()
);

const previewDescriptor = computed(() => onlyPreviewShellStore.previewPresentation?.descriptor);
const selectedFileType = computed(() => {
  const entry = previewDescriptor.value;
  if (!entry) return '';
  return /\.md$/i.test(entry.relativePath) ? 'MARKDOWN' : entry.kind.toUpperCase();
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
  onlyPreviewRecentsStore.activePanel = 'project';
  void focusTreePath(onlyPreviewShellStore.focusTree());
};

// Locate moves the tree anchor to the previewed file, so the tree's own selection must collapse
// onto it — otherwise `isSelected` keeps answering for whatever was clicked before (an explicit
// `anchorPath`, or a multi-selection, both of which outrank `treeSelectedRelativePath`) and the
// located row lands with no highlight. That is exactly what happens after opening a file from
// global search, where the previewed file was never clicked in the tree at all.
const locateCurrentFile = async (): Promise<void> => {
  if (!canLocateCurrentPreview.value) return;
  onlyPreviewRecentsStore.activePanel = 'project';
  const relativePath = await onlyPreviewShellStore.locateSelectedFile();
  if (relativePath) await focusTreePath(relativePath, true);
};

const canLocateCurrentPreview = computed(() => {
  const fileRef = onlyPreviewShellStore.previewFileRef;
  return Boolean(
    onlyPreviewShellStore.projectionReady &&
    fileRef && fileRef.workspaceId === onlyPreviewShellStore.workspace?.workspaceId
  );
});

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

/**
 * plain `Cmd+C` = 复制**文件本身**（Finder 里 `Cmd+V` 能粘贴进去）。
 *
 * 判据在 `onlyPreviewCopyShortcut.service`,理由与改动史写在那里。这里只负责把 DOM 那两件事
 * （目标是不是可编辑控件、有没有文本选区）算出来喂给它 —— 它们是 main 看不到、也没法测的部分。
 */
const handleProjectItemCopyShortcut = (event: KeyboardEvent): boolean => {
  const target = event.target;
  const decision = resolveOnlyPreviewCopyShortcut(event, {
    isMac,
    // `editing` 是 `{ relativePath, draft, originalName } | null`,不是 boolean。
    editing: Boolean(onlyPreviewProjectAuthoring.editing),
    targetIsEditable:
      target instanceof HTMLElement &&
      target.matches(ONLY_PREVIEW_EDITABLE_TARGET_SELECTOR),
    // 只看 shell 自己这个文档的选区。空选区(`isCollapsed`)不算 —— 光标在那儿不等于选了东西。
    hasTextSelection: Boolean(
      window.getSelection()?.toString() && !window.getSelection()?.isCollapsed
    ),
    treeSelectedRelativePath:
      onlyPreviewShellStore.treeSelectedRelativePath ??
      (onlyPreviewShellStore.selectedRelativePath || null)
  });
  if (decision.kind === 'ignore') return false;
  event.preventDefault();
  void onlyPreviewShellStore.copyProjectItem(decision.relativePath, 'item');
  return true;
};

const handleShellKeydown = (event: KeyboardEvent): void => {
  if (handleOnlyPreviewProjectDeleteShortcut(
    event, onlyPreviewRecentsStore.activePanel === 'project' && !onlyPreviewProjectAuthoring.editing
  )) return;
  if (handleProjectItemCopyShortcut(event)) return;
  if (event.altKey && event.code === 'Digit1') {
    event.preventDefault();
    focusProjectTree();
    return;
  }
};

// A selection must not outlive its rows: opening another Project replaces every row, and a delete or
// an external change removes some of them.
watch(
  () => onlyPreviewShellStore.workspace?.workspaceId ?? '',
  () => {
    onlyPreviewTreeSelection.clear();
    onlyPreviewRecentsStore.resetWorkspace();
  }
);
watch(
  () => onlyPreviewShellStore.visibleRows.length,
  () => onlyPreviewTreeSelection.retain()
);

onMounted(() => {
  syncShellFocus();
  window.addEventListener('focus', syncShellFocus);
  window.addEventListener('blur', syncShellFocus);
  document.addEventListener('visibilitychange', syncShellFocus);
  subscribeOnlyPreviewProjectIntents();
  window.addEventListener('pagehide', flushProjectWidth);
  window.addEventListener('focus', refreshHostToggleState);
  void onlyPreviewShellStore.initialize();
  void onlyPreviewRecentsStore.initialize();
});

watch(() => onlyPreviewShellStore.focusProjectRevision, focusProjectTree);

watch(
  () => onlyPreviewShellStore.centerProjectRevision,
  () => {
    onlyPreviewRecentsStore.activePanel = 'project';
    void focusTreePath(onlyPreviewShellStore.centerProjectRelativePath, true);
  }
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
  window.removeEventListener('focus', syncShellFocus);
  window.removeEventListener('blur', syncShellFocus);
  document.removeEventListener('visibilitychange', syncShellFocus);
  onlyPreviewRecentsStore.dispose();
  window.removeEventListener('pagehide', flushProjectWidth);
  window.removeEventListener('focus', refreshHostToggleState);
  flushProjectWidth();
  resizeObserver?.disconnect();
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
});
</script>

<style lang="less">
@import './App.less';
</style>
