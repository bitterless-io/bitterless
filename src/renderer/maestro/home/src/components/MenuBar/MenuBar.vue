<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import {
  IconArrowLeft,
  IconArrowRight,
  IconRefresh,
  IconPlus,
  IconCommon
} from '@arco-design/web-vue/es/icon'
import {
  IconCameraSpark,
  IconCircleFilled,
  IconLoader2,
  IconSettings,
  IconSettingsFilled,
  IconSparkles,
  IconSparklesFilled
} from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import type { TabInfo } from '@maestro-shared/coach.api'
import { menuBarStore } from './menuBar.store'
import { tabStore } from './tab.store'
import { updateStore } from '../../store/update.store'
import { layoutStore } from '../../store/layout.store'
import { captureStore } from '../../store/capture.store'
import { workbenchStore } from '../../store/workbench.store'
import './MenuBar.less'

// Shared style for the address-bar icon buttons: borderless,
// transparent, highlight on hover, soft scale-down on press; muted + no hover when disabled.
const navBtn = 'maestro-menu-bar__nav-button'
// The fixed Home tab is a bundled renderer, so its icon must be bundled too.
import bitterlessIcon from '@maestro-renderer/common/assets/icons/bitterless-icon.png'

onMounted(() => {
  menuBarStore.init()
  tabStore.init()
  updateStore.init()
  captureStore.init()
  layoutStore.init()
  void workbenchStore.init()
})

// Tab label: page <title> when known, else the URL host, else the localized new-tab label.
function tabLabel(tab: TabInfo): string {
  if (tab.kind === 'home') return i18nHelper.menuBar.maestro.homeTab
  if (tab.title?.trim()) return tab.title.trim()
  try {
    return new URL(tab.url).host || i18nHelper.menuBar.maestro.newTab
  } catch {
    return tab.url?.trim() || i18nHelper.menuBar.maestro.newTab
  }
}

// Favicons that errored / 404'd — fall back to the default icon instead of a broken image.
// Keyed by URL so a tab that later navigates to a page with a new favicon gets a fresh try.
const failedFavicons = reactive(new Set<string>())
function markFaviconFailed(url: string): void {
  if (url) failedFavicons.add(url)
}
// Icon to show: the fixed local Home tab's bundled icon, else the page favicon (if it loaded),
// else '' — meaning the template renders the default Arco icon.
function tabIconSrc(tab: TabInfo): string {
  if (tab.kind === 'home') return bitterlessIcon
  if (tab.favicon && !failedFavicons.has(tab.favicon)) return tab.favicon
  return ''
}

// Chrome-style "close several in a row": when a × is clicked, freeze every tab's width to its
// current (uniform) value so closing a middle tab just shifts the rest left by exactly one tab
// — landing the next tab's × right under the cursor. Cleared on mouseleave, when widths reflow.
const lockedTabWidth = ref<number | null>(null)
function onCloseClick(e: MouseEvent, id: string): void {
  const tabEl = (e.currentTarget as HTMLElement).parentElement
  if (tabEl) lockedTabWidth.value = tabEl.offsetWidth
  void tabStore.close(id)
}
function unlockTabWidths(): void {
  lockedTabWidth.value = null
}

// Tab chip classes. Fixed system tabs get persistent treatments so they never read as ordinary,
// closable browser tabs.
function tabClass(tab: TabInfo): string {
  if (tab.kind === 'home') {
    return tab.active
      ? 'maestro-menu-bar__tab--pinned-active'
      : 'maestro-menu-bar__tab--pinned'
  }
  return tab.active
    ? 'maestro-menu-bar__tab--active'
    : 'maestro-menu-bar__tab--idle'
}

function fixedTabClass(tab: TabInfo): string {
  if (tab.kind === 'home') return 'maestro-menu-bar__tab--pinned-size'
  return 'maestro-menu-bar__tab--browser-size'
}
</script>

<template>
  <!-- 84px top chrome = an Omni-derived 36px tab strip + the existing 48px address bar. The renderer-driven
       layout measures the body placeholders below this, so the native operation/
       control views sit at y=84 automatically. -->
  <div class="maestro-menu-bar">
    <!-- Tab strip (36px). One chip per open operation-view tab; new tabs appear when a
         page opens a new window. Click to switch, × to close. On macOS the left gutter
         clears the native traffic lights (hiddenInset). -->
    <div
      class="maestro-menu-bar__tabs"
      :class="{ 'maestro-menu-bar__tabs--mac': menuBarStore.isMac }"
      @mouseleave="unlockTabWidths"
    >
      <!-- Tabs COMPRESS to fit (no scroll): each shrinks toward its 48px min; when they
           can't shrink further, overflowing tabs are clipped (not shown). The new-tab
           button lives OUTSIDE this region so it stays visible no matter the tab count. -->
      <div class="maestro-menu-bar__tab-list">
        <template v-for="(tab, i) in tabStore.tabs" :key="tab.id">
          <div
            :title="tabLabel(tab)"
            :draggable="!tab.pinned"
            class="maestro-menu-bar__tab"
            :class="[
              tabClass(tab),
              // Fixed system tabs never shrink or drag; closable browser tabs compress to fit.
              fixedTabClass(tab),
              tabStore.isDragging(tab.id) ? 'maestro-menu-bar__tab--dragging' : ''
            ]"
            :style="!tab.pinned && lockedTabWidth ? { width: lockedTabWidth + 'px', flexShrink: 0 } : undefined"
            @click="tabStore.activate(tab.id)"
            @contextmenu.prevent="tabStore.showMenu(tab.id)"
            @dragstart="tabStore.startDrag($event, tab.id)"
            @dragover.prevent="tabStore.dragOver($event, tab.id)"
            @drop.prevent="tabStore.finishDrag()"
            @dragend="tabStore.finishDrag()"
          >
            <!-- The favicon slot is ALWAYS 16px — only the title text compresses. Loading swaps
                 the icon in place, so the chip never reflows. -->
            <IconLoader2
              v-if="tab.loading"
              :size="16"
              class="maestro-menu-bar__loading-icon"
              aria-hidden="true"
            />
            <img
              v-else-if="tabIconSrc(tab)"
              :src="tabIconSrc(tab)"
              alt=""
              class="maestro-menu-bar__favicon"
              @error="markFaviconFailed(tab.favicon)"
            />
            <IconCommon v-else class="maestro-menu-bar__fallback-icon" />
            <span class="maestro-menu-bar__tab-label" :class="{ 'maestro-menu-bar__tab-label--pinned': tab.pinned }">{{
              tabLabel(tab)
            }}</span>
            <!-- Close × (closable tabs only). Absolutely positioned so it never widens the tab
                 — a compressed tab keeps showing its favicon. Visible on hover, or always on
                 the active tab. The pinned local Home tab is non-closable, so it has none. -->
            <button
              v-if="!tab.pinned && tabStore.tabs.length > 1"
              class="maestro-menu-bar__tab-close"
              :class="{ 'maestro-menu-bar__tab-close--active': tab.active }"
              draggable="false"
              :title="i18nHelper.menuBar.maestro.closeTab"
              :aria-label="i18nHelper.menuBar.maestro.closeTab"
              type="button"
              @click.stop="onCloseClick($event, tab.id)"
              @dragstart.stop.prevent
            >
              ×
            </button>
          </div>
          <!-- Divider after the pinned group, before the first closable browsing tab. -->
          <div
            v-if="tab.pinned && tabStore.tabs[i + 1] && !tabStore.tabs[i + 1].pinned"
            class="maestro-menu-bar__tab-divider-wrap"
          >
            <div class="maestro-menu-bar__tab-divider"></div>
          </div>
        </template>
      </div>
      <!-- New-tab button — circular, vertically centered to the tab row, always visible.
           Opens a blank operation view (empty, editable address bar) ready for a URL. -->
      <div class="maestro-menu-bar__new-tab-wrap">
        <button
          class="maestro-menu-bar__new-tab"
          :title="i18nHelper.menuBar.maestro.newTab"
          :aria-label="i18nHelper.menuBar.maestro.newTab"
          type="button"
          @click="tabStore.newTab()"
        >
          <IconPlus />
        </button>
      </div>
      <!-- Agent-owned recording status. The fixed slot remains in the draggable tab strip so
           recording state cannot move the new-tab button. It is deliberately not interactive. -->
      <div
        name="menubar__capture__status"
        class="maestro-menu-bar__capture-status"
        role="status"
        :title="captureStore.recording ? i18nHelper.menuBar.maestro.recording : undefined"
        :aria-label="captureStore.recording ? i18nHelper.menuBar.maestro.recording : undefined"
      >
        <IconCircleFilled
          v-if="captureStore.recording"
          class="maestro-menu-bar__capture-status-icon"
          :size="14"
        />
      </div>
    </div>

    <!-- Address bar (48px). -->
    <header
      class="maestro-menu-bar__address-row"
    >
      <!-- Back / Forward / Reload, grouped in a subtle segmented cluster (data-slot="nav"). Back &
           Forward disable when there's no history that way; the pinned Home tab also disables
           history nav because its bundled local entry is fixed. -->
      <div data-slot="nav" class="maestro-menu-bar__navigation">
        <button
          :class="navBtn"
          :disabled="!menuBarStore.canGoBack"
          :title="i18nHelper.menuBar.maestro.back"
          :aria-label="i18nHelper.menuBar.maestro.back"
          type="button"
          @click="menuBarStore.back()"
        >
          <IconArrowLeft />
        </button>
        <button
          :class="navBtn"
          :disabled="!menuBarStore.canGoForward"
          :title="i18nHelper.menuBar.maestro.forward"
          :aria-label="i18nHelper.menuBar.maestro.forward"
          type="button"
          @click="menuBarStore.forward()"
        >
          <IconArrowRight />
        </button>
        <button
          :class="navBtn"
          :title="i18nHelper.menuBar.maestro.reload"
          :aria-label="i18nHelper.menuBar.maestro.reload"
          type="button"
          @click="menuBarStore.reload()"
        >
          <IconRefresh />
        </button>
      </div>
      <!-- First-party fixed-purpose tabs expose a stable display address but cannot be
           navigated away from their trusted entry; ordinary browser tabs keep the normal
           schemeless/pasted-address behavior. -->
      <input
        v-model="menuBarStore.url"
        :disabled="tabStore.activeLocked"
        :title="tabStore.activeLocked ? i18nHelper.menuBar.maestro.fixedAddressLocked : ''"
        class="maestro-menu-bar__address"
        :placeholder="i18nHelper.menuBar.maestro.addressPlaceholder"
        @keydown.enter="menuBarStore.go()"
      />

      <!-- Trailing actions (data-slot="actions"): a hairline divider sets the cluster off from the
           address field, then Snapshot, panel, Workbench, and the conditional Update pill. -->
      <div data-slot="actions" class="maestro-menu-bar__actions">
        <div class="maestro-menu-bar__actions-divider" aria-hidden="true"></div>

        <!-- Snapshot — only while capturing. Captures the current page into the capture trace. -->
        <button
          v-if="captureStore.recording && captureStore.recordActions"
          class="maestro-menu-bar__snapshot"
          :class="{ 'maestro-menu-bar__snapshot--busy': captureStore.snapshotting }"
          :disabled="captureStore.snapshotting"
          :title="i18nHelper.menuBar.maestro.captureSnapshot"
          :aria-label="i18nHelper.menuBar.maestro.captureSnapshot"
          type="button"
          @click="captureStore.snapshot()"
        >
          <IconCameraSpark :size="18" stroke="1.8" />
        </button>

        <!-- Sidebar (right control/AI panel) toggle — collapses the panel and reflows the operation
             view to full width (see layout.store.ts + Layout.vue). Filled sparkles = panel shown. -->
        <button
          :class="[navBtn, { 'maestro-menu-bar__nav-button--active': layoutStore.sidebarOpen }]"
          :aria-pressed="layoutStore.sidebarOpen"
          :title="layoutStore.sidebarOpen ? i18nHelper.menuBar.maestro.hidePanel : i18nHelper.menuBar.maestro.showPanel"
          type="button"
          @click="layoutStore.toggleSidebar()"
        >
          <IconSparklesFilled v-if="layoutStore.sidebarOpen" :size="18" stroke="1.8" />
          <IconSparkles v-else :size="18" stroke="1.8" />
        </button>

        <button
          :class="[navBtn, { 'maestro-menu-bar__nav-button--active': workbenchStore.visible }]"
          :aria-pressed="workbenchStore.visible"
          :title="workbenchStore.visible ? i18nHelper.menuBar.maestro.hideWorkbench : i18nHelper.menuBar.maestro.showWorkbench"
          type="button"
          @click="workbenchStore.toggle()"
        >
          <IconSettingsFilled v-if="workbenchStore.visible" :size="18" stroke="1.8" />
          <IconSettings v-else :size="18" stroke="1.8" />
        </button>

        <!-- Update button — at the address bar's trailing edge. The compact label stays unchanged
             while the disabled shimmer communicates downloading; the title preserves detail. -->
        <button
          v-if="updateStore.ready"
          class="maestro-menu-bar__update"
          :class="{ 'maestro-menu-bar__update--downloading': updateStore.downloading }"
          :disabled="updateStore.downloading"
          :title="
            updateStore.downloading
              ? updateStore.info
                ? i18nHelper.menuBar.maestro.downloadingVersion.replace('{version}', updateStore.info.version)
                : i18nHelper.menuBar.maestro.updating
              : updateStore.info
                ? i18nHelper.menuBar.updateToVersion.replace('{version}', updateStore.info.version)
                : i18nHelper.menuBar.maestro.update
          "
          type="button"
          @click="updateStore.install()"
        >
          <span class="maestro-menu-bar__update-label">{{ i18nHelper.menuBar.restartToUpdate }}</span>
        </button>
      </div>
    </header>
  </div>
</template>
