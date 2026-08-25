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
  IconBug,
  IconBugOff,
  IconCircleFilled,
  IconLayoutSidebarRight,
  IconLayoutSidebarRightFilled,
  IconTools
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
// Bundled AI-CRMS favicon (downloaded from https://mcu.micromeet.ai/favicon.ico). Vite
// inlines it (<4KB) into the build, so the pinned tab's icon shows offline / with no fetch.
import crmsFavicon from '@maestro-renderer/common/assets/icons/crms-favicon.png'

onMounted(() => {
  menuBarStore.init()
  tabStore.init()
  updateStore.init()
  captureStore.init()
  void workbenchStore.init()
})

// Tab label: page <title> when known, else the URL host, else "New Tab".
function tabLabel(tab: { title: string; url: string }): string {
  if (tab.title?.trim()) return tab.title.trim()
  try {
    return new URL(tab.url).host || 'New Tab'
  } catch {
    return tab.url?.trim() || 'New Tab'
  }
}

// Favicons that errored / 404'd — fall back to the default icon instead of a broken image.
// Keyed by URL so a tab that later navigates to a page with a new favicon gets a fresh try.
const failedFavicons = reactive(new Set<string>())
function markFaviconFailed(url: string): void {
  if (url) failedFavicons.add(url)
}
// Icon to show: the AI-CRMS tab's bundled icon, else the page favicon (if it loaded),
// else '' — meaning the template renders the default Arco icon.
function tabIconSrc(tab: TabInfo): string {
  if (tab.kind === 'ai-crms') return crmsFavicon
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
  if (tab.kind === 'ai-crms') {
    return tab.active
      ? 'maestro-menu-bar__tab--pinned-active'
      : 'maestro-menu-bar__tab--pinned'
  }
  return tab.active
    ? 'maestro-menu-bar__tab--active'
    : 'maestro-menu-bar__tab--idle'
}

function fixedTabClass(tab: TabInfo): string {
  if (tab.kind === 'ai-crms') return 'maestro-menu-bar__tab--pinned-size'
  return 'maestro-menu-bar__tab--browser-size'
}

function debuggerTitle(tab?: TabInfo): string {
  if (!tab) return 'Debugger unavailable'
  if (!tab.debuggerEnabled) return 'Debugger off for this tab — click to attach'
  if (!tab.debuggerAttached) return 'Debugger on — attaching'
  return 'Debugger attached — click to detach'
}
</script>

<template>
  <!-- 92px top chrome = an Omni-derived 44px tab strip + the existing 48px address bar. The renderer-driven
       layout measures the body placeholders below this, so the native operation/
       control views sit at y=92 automatically. -->
  <div class="maestro-menu-bar">
    <!-- Tab strip (44px). One chip per open operation-view tab; new tabs appear when a
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
            <!-- The favicon is ALWAYS shown full-size (shrink-0) — only the title text
                 compresses. Falls back to a default Arco globe icon when there's no favicon. -->
            <img
              v-if="tabIconSrc(tab)"
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
                 the active tab. The pinned AI-CRMS home tab is non-closable, so it has none. -->
            <button
              v-if="!tab.pinned && tabStore.tabs.length > 1"
              class="maestro-menu-bar__tab-close"
              :class="{ 'maestro-menu-bar__tab-close--active': tab.active }"
              draggable="false"
              title="Close tab"
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
          title="New tab"
          type="button"
          @click="tabStore.newTab()"
        >
          <IconPlus />
        </button>
      </div>
    </div>

    <!-- Address bar (48px). -->
    <header
      class="maestro-menu-bar__address-row"
    >
      <!-- Back / Forward / Reload, grouped in a subtle segmented cluster (data-slot="nav"). Back &
           Forward disable when there's no history that way; the pinned AI-CRMS tab also disables
           history nav so it cannot expose the internal about:blank bootstrap page. -->
      <div data-slot="nav" class="maestro-menu-bar__navigation">
        <button
          :class="navBtn"
          :disabled="!menuBarStore.canGoBack"
          title="Back"
          type="button"
          @click="menuBarStore.back()"
        >
          <IconArrowLeft />
        </button>
        <button
          :class="navBtn"
          :disabled="!menuBarStore.canGoForward"
          title="Forward"
          type="button"
          @click="menuBarStore.forward()"
        >
          <IconArrowRight />
        </button>
        <button :class="navBtn" title="Reload" type="button" @click="menuBarStore.reload()">
          <IconRefresh />
        </button>
      </div>
      <!-- Address bar is read-only on the pinned home tab (AI-CRMS): it isn't meant to be
           navigated away from via the URL bar (the main process enforces this too). The
           scheme is hidden — a schemeless entry loads over http:// (http→https redirects
           are followed); a pasted http(s):// URL keeps its scheme. -->
      <input
        v-model="menuBarStore.url"
        :disabled="tabStore.activeLocked"
        :title="tabStore.activeLocked ? 'Pinned tab — locked' : ''"
        class="maestro-menu-bar__address"
        placeholder="Enter address"
        @keydown.enter="menuBarStore.go()"
      />

      <!-- Trailing actions (data-slot="actions"): a hairline divider sets the cluster off from the
           address field, then the capture toggle, sidebar toggle, and the conditional Update pill. -->
      <div data-slot="actions" class="maestro-menu-bar__actions">
        <div class="maestro-menu-bar__actions-divider" aria-hidden="true"></div>

        <!-- Debugger toggle — per active tab. Default ON; turn OFF before sensitive external
             logins, then turn it back ON to restore capture / snapshot / replay. -->
        <button
          :class="[
            navBtn,
            !tabStore.activeTab?.debuggerEnabled
              ? 'maestro-menu-bar__nav-button--debugger-off'
              : !tabStore.activeTab?.debuggerAttached
                ? 'maestro-menu-bar__nav-button--detached'
                : ''
          ]"
          :disabled="!tabStore.activeTab || tabStore.debuggerToggling"
          :title="debuggerTitle(tabStore.activeTab)"
          type="button"
          @click="tabStore.toggleActiveDebugger()"
        >
          <IconBug v-if="tabStore.activeTab?.debuggerEnabled" :size="18" stroke="1.8" />
          <IconBugOff v-else :size="18" stroke="1.8" />
        </button>

        <!-- Snapshot — only while capturing. Captures the current page into the capture trace. -->
        <button
          v-if="captureStore.recording && captureStore.recordActions"
          class="maestro-menu-bar__snapshot"
          :class="{ 'maestro-menu-bar__snapshot--busy': captureStore.snapshotting }"
          :disabled="captureStore.snapshotting"
          title="Capture page snapshot"
          type="button"
          @click="captureStore.snapshot()"
        >
          <IconCameraSpark :size="18" stroke="1.8" />
        </button>

        <!-- Capture toggle — ALWAYS visible. Grey idle (click to start), red + pulse while capturing
             (click to stop). Synced with the control panel record dot via the capture broadcasts. -->
        <button
          class="maestro-menu-bar__capture"
          :disabled="!tabStore.activeTab?.debuggerEnabled"
          :title="
            !tabStore.activeTab?.debuggerEnabled
              ? 'Turn Debugger on before capture'
              : captureStore.recording
                ? 'Stop capture'
                : 'Capture your actions for the Agent to learn from'
          "
          type="button"
          @click="captureStore.toggle()"
        >
          <IconCircleFilled class="maestro-menu-bar__capture-icon" :class="{ 'maestro-menu-bar__capture-icon--recording': captureStore.recording }" :size="14" />
        </button>

        <!-- Sidebar (right control/AI panel) toggle — collapses the panel and reflows the operation
             view to full width (see layout.store.ts + Layout.vue). Filled icon = panel shown. -->
        <button
          :class="navBtn"
          :title="layoutStore.sidebarOpen ? 'Hide panel' : 'Show panel'"
          type="button"
          @click="layoutStore.toggleSidebar()"
        >
          <IconLayoutSidebarRightFilled v-if="layoutStore.sidebarOpen" :size="18" stroke="1.8" />
          <IconLayoutSidebarRight v-else :size="18" stroke="1.8" />
        </button>

        <button
          :class="[navBtn, { 'maestro-menu-bar__nav-button--active': workbenchStore.visible }]"
          :aria-pressed="workbenchStore.visible"
          :title="workbenchStore.visible ? 'Hide Workbench' : 'Show Workbench'"
          type="button"
          @click="workbenchStore.toggle()"
        >
          <IconTools :size="18" stroke="1.8" />
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
                ? `Downloading ${updateStore.info.version}`
                : 'Updating'
              : updateStore.info
                ? `Update to ${updateStore.info.version}`
                : 'Update'
          "
          type="button"
          @click="updateStore.install()"
        >
          <span class="maestro-menu-bar__update-label">{{ i18nHelper.menuBar.restartToUpdate }}</span>
        </button>
      </div>

      <!-- Simulated page-load progress, pinned to the bar's bottom edge. -->
      <div class="maestro-menu-bar__progress-track">
        <div
          class="maestro-menu-bar__progress"
          :style="{ width: menuBarStore.progress + '%', opacity: menuBarStore.loading ? 1 : 0 }"
        ></div>
      </div>
    </header>
  </div>
</template>
