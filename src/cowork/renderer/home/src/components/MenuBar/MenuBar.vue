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
import type { TabInfo } from '@cowork-shared/coach.api'
import { menuBarStore } from './menuBar.store'
import { tabStore } from './tab.store'
import { updateStore } from '../../store/update.store'
import { layoutStore } from '../../store/layout.store'
import { captureStore } from '../../store/capture.store'
import { workbenchStore } from '../../store/workbench.store'

// Shared style for the address-bar icon buttons: borderless,
// transparent, highlight on hover, soft scale-down on press; muted + no hover when disabled.
const navBtn =
  'no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[16px] text-gray-600 transition hover:bg-black/10 hover:text-gray-800 active:scale-95 active:bg-black/15 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent'
// Bundled AI-CRMS favicon (downloaded from https://mcu.micromeet.ai/favicon.ico). Vite
// inlines it (<4KB) into the build, so the pinned tab's icon shows offline / with no fetch.
import crmsFavicon from '@cowork-renderer/common/assets/icons/crms-favicon.png'

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
      ? 'border-transparent bg-white text-[#165dff]'
      : 'border-[#165dff]/25 bg-[#165dff]/10 text-[#165dff] hover:bg-[#165dff]/15'
  }
  return tab.active
    ? 'border-transparent bg-white text-gray-800'
    : 'border-transparent bg-black/5 text-gray-500 hover:bg-black/10'
}

function fixedTabClass(tab: TabInfo): string {
  if (tab.kind === 'ai-crms') return 'w-[96px] shrink-0 cursor-default'
  return 'w-[200px] min-w-[48px] shrink cursor-default'
}

function debuggerTitle(tab?: TabInfo): string {
  if (!tab) return 'Debugger unavailable'
  if (!tab.debuggerEnabled) return 'Debugger off for this tab — click to attach'
  if (!tab.debuggerAttached) return 'Debugger on — attaching'
  return 'Debugger attached — click to detach'
}
</script>

<template>
  <!-- 96px top chrome = a 48px tab strip + a 48px address bar. The renderer-driven
       layout measures the body placeholders below this, so the native operation/
       control views sit at y=96 automatically. -->
  <div class="relative z-10 flex h-24 shrink-0 flex-col">
    <!-- Tab strip (48px). One chip per open operation-view tab; new tabs appear when a
         page opens a new window. Click to switch, × to close. On macOS the left gutter
         clears the native traffic lights (hiddenInset). -->
    <div
      :class="[
        'drag flex h-12 shrink-0 items-end border-b border-gray-200 bg-gradient-to-b from-[#e7edf3] to-[#dde5ed] pr-2',
        menuBarStore.isMac ? 'pl-[90px]' : 'pl-[18px]'
      ]"
      @mouseleave="unlockTabWidths"
    >
      <!-- Tabs COMPRESS to fit (no scroll): each shrinks toward its 48px min; when they
           can't shrink further, overflowing tabs are clipped (not shown). The new-tab
           button lives OUTSIDE this region so it stays visible no matter the tab count. -->
      <div class="flex min-w-0 items-end gap-1 overflow-hidden">
        <template v-for="(tab, i) in tabStore.tabs" :key="tab.id">
          <div
            :title="tabLabel(tab)"
            :draggable="!tab.pinned"
            style="cursor: default"
            class="no-drag group relative flex h-9 select-none items-center gap-1.5 overflow-hidden rounded-t-md border border-b-0 px-3 text-[13px]"
            :class="[
              tabClass(tab),
              // Fixed system tabs never shrink or drag; closable browser tabs compress to fit.
              fixedTabClass(tab),
              tabStore.isDragging(tab.id) ? 'opacity-70' : ''
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
              class="h-4 w-4 shrink-0 rounded-sm"
              @error="markFaviconFailed(tab.favicon)"
            />
            <IconCommon v-else class="shrink-0 text-[16px] text-gray-400" />
            <span class="min-w-0 flex-1 select-none truncate" :class="tab.pinned ? 'font-medium' : 'pr-5'">{{
              tabLabel(tab)
            }}</span>
            <!-- Close × (closable tabs only). Absolutely positioned so it never widens the tab
                 — a compressed tab keeps showing its favicon. Visible on hover, or always on
                 the active tab. The pinned AI-CRMS home tab is non-closable, so it has none. -->
            <button
              v-if="!tab.pinned && tabStore.tabs.length > 1"
              class="absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[15px] leading-none text-gray-500 hover:bg-black/10 hover:text-gray-800"
              :class="tab.active ? 'flex' : 'hidden group-hover:flex'"
              draggable="false"
              style="cursor: default"
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
            class="flex h-9 shrink-0 items-center self-end px-0.5"
          >
            <div class="h-5 w-px bg-black/15"></div>
          </div>
        </template>
      </div>
      <!-- New-tab button — circular, vertically centered to the tab row, always visible.
           Opens a blank operation view (empty, editable address bar) ready for a URL. -->
      <div class="flex h-9 shrink-0 items-center self-end pl-1.5">
        <button
          class="no-drag flex h-7 w-7 items-center justify-center rounded-full text-[16px] text-gray-500 hover:bg-black/10 hover:text-gray-700"
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
      class="relative flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-gradient-to-b from-[#f7f9fb] to-[#edf2f6] px-3"
    >
      <!-- Back / Forward / Reload, grouped in a subtle segmented cluster (data-slot="nav"). Back &
           Forward disable when there's no history that way; the pinned AI-CRMS tab also disables
           history nav so it cannot expose the internal about:blank bootstrap page. -->
      <div data-slot="nav" class="flex shrink-0 items-center gap-0.5 rounded-[10px] bg-black/5 p-0.5">
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
        class="h-8 min-w-[160px] flex-1 rounded-lg border border-gray-300 bg-white px-2.5 text-[13px] outline-none transition hover:border-gray-400 focus:border-[#165dff] focus:ring-2 focus:ring-[#165dff]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:hover:border-gray-300"
        placeholder="Enter address"
        @keydown.enter="menuBarStore.go()"
      />

      <!-- Trailing actions (data-slot="actions"): a hairline divider sets the cluster off from the
           address field, then the capture toggle, sidebar toggle, and the conditional Update pill. -->
      <div data-slot="actions" class="flex shrink-0 items-center gap-1">
        <div class="h-5 w-px shrink-0 bg-black/15" aria-hidden="true"></div>

        <!-- Debugger toggle — per active tab. Default ON; turn OFF before sensitive external
             logins, then turn it back ON to restore capture / snapshot / replay. -->
        <button
          :class="[
            navBtn,
            !tabStore.activeTab?.debuggerEnabled
              ? '!bg-amber-50 !text-amber-700 hover:!bg-amber-100 hover:!text-amber-800'
              : !tabStore.activeTab?.debuggerAttached
                ? '!text-gray-400'
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
          class="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#165dff] transition hover:bg-[#165dff]/10 active:scale-95 active:bg-[#165dff]/15 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
          :class="captureStore.snapshotting ? 'animate-pulse' : ''"
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
          class="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:bg-black/10 active:scale-95 active:bg-black/15"
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
          <IconCircleFilled :size="14" :class="captureStore.recording ? 'text-red-500 animate-pulse' : 'text-gray-400'" />
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
          :class="[navBtn, workbenchStore.visible ? 'bg-white !text-[#165dff] shadow-sm hover:bg-white hover:!text-[#165dff]' : '']"
          :aria-pressed="workbenchStore.visible"
          :title="workbenchStore.visible ? 'Hide Workbench' : 'Show Workbench'"
          type="button"
          @click="workbenchStore.toggle()"
        >
          <IconTools :size="18" stroke="1.8" />
        </button>

        <!-- Update button — at the address bar's trailing edge. Shows disabled "Updating" as soon
             as the main process finds a newer build, then turns into the enabled "Update" button
             once the silent download finishes. The label text sits above the shimmer band. -->
        <button
          v-if="updateStore.ready"
          class="update-btn no-drag relative flex h-7 shrink-0 items-center overflow-hidden rounded-full bg-[#165dff] px-3.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-[#0e4fd6]"
          :class="updateStore.downloading ? 'cursor-not-allowed opacity-70 hover:bg-[#165dff]' : ''"
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
          <span class="relative z-[1]">{{ updateStore.downloading ? 'Updating' : 'Update' }}</span>
        </button>
      </div>

      <!-- Simulated page-load progress, pinned to the bar's bottom edge. -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
        <div
          class="h-full bg-[#165dff] transition-[width,opacity] duration-200 ease-out"
          :style="{ width: menuBarStore.progress + '%', opacity: menuBarStore.loading ? 1 : 0 }"
        ></div>
      </div>
    </header>
  </div>
</template>

<style scoped>
/* Shimmer sweep for the Update button — a soft diagonal light band crossing the pill to draw the
   eye, with a brief pause between sweeps. The label (span z-[1]) stays above it. The button itself
   is relative + overflow-hidden (Tailwind) so the band is clipped to the pill. Honors reduced-motion. */
@keyframes update-shimmer {
  0% {
    transform: translateX(-130%) skewX(-18deg);
  }
  55%,
  100% {
    transform: translateX(280%) skewX(-18deg);
  }
}
.update-btn::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 42%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  transform: translateX(-130%) skewX(-18deg);
  animation: update-shimmer 2.6s ease-in-out infinite;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .update-btn::after {
    animation: none;
    opacity: 0;
  }
}
</style>
