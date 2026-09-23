<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  IconArrowLeft,
  IconArrowRight,
  IconRefresh,
  IconCommon
} from '@arco-design/web-vue/es/icon'
import {
  IconApps,
  IconHistory,
  IconCameraSpark,
  IconCircleFilled,
  IconLoader2,
  IconPlus,
  IconSettings,
  IconSparkles,
  IconSparklesFilled,
  IconX } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import type { TabInfo } from '@maestro-shared/coach.api'
import { MAESTRO_WORKBENCH_DISPLAY_URL } from '@maestro-shared/coach.api'
import IconBtn from '../../../../../common/components/IconBtn/IconBtn.vue'
import { menuBarStore } from './menuBar.store'
import { browserHistoryStore } from './browserHistory.store';
import { tabStore } from './tab.store'
import { updateStore } from '../../store/update.store'
import { layoutStore } from '../../store/layout.store'
import { captureStore } from '../../store/capture.store'
import { workbenchStore } from '../../store/workbench.store'
import './MenuBar.less'
import UserAvatar from './UserAvatar.vue'

// Shared style for the address-bar icon buttons: borderless,
// transparent, highlight on hover, soft scale-down on press; muted + no hover when disabled.
const navBtn = 'maestro-menu-bar__nav-button'
const addressValue = computed({
  get: () => workbenchStore.visible ? MAESTRO_WORKBENCH_DISPLAY_URL : menuBarStore.url,
  set: (value: string) => {
    if (!workbenchStore.visible) menuBarStore.url = value
  }
})
const workbenchChipAfterIndex = computed(() => {
  const lastPinned = tabStore.tabs.findLastIndex((tab) => tab.pinned)
  return Math.max(0, lastPinned)
})

function chipActive(tab: TabInfo): boolean {
  return tab.active && !workbenchStore.visible
}

/**
 * 收尾 pinned 组的那条竖线 —— 「最后一个 pinned tab 之后、第一个可关闭 tab 之前」。
 *
 * Workbench 打开时它**占掉**这个槽位:chip 自带一条左分隔,这条再画出来就落在 chip 右边,把它
 * 围成孤岛(Ral 2026-09-16)。写成具名函数而不是模板里的长 `v-if`,是因为两个前提互不相关 ——
 * 一个是 pinned 边界,一个是 Workbench 有没有占位 —— 混在一起下一个人读不出为什么。
 */
function pinnedGroupDivider(tab: TabInfo, i: number): boolean {
  if (workbenchStore.open && i === workbenchChipAfterIndex.value) return false
  const next = tabStore.tabs[i + 1]
  return tab.pinned && Boolean(next) && !next.pinned
}

async function onTabClick(id: string): Promise<void> {
  await workbenchStore.background()
  await tabStore.activate(id)
}

// The fixed Home tab is a bundled renderer, so its icon must be bundled too.
import bitterlessIcon from '@maestro-renderer/common/assets/icons/bitterless-icon.png'

// Handed to menuBarStore on mount — it is the address bar's controller, and the main process
// asks it to focus after the operator opens a blank tab.
const addressInput = ref<HTMLInputElement | null>(null)

/**
 * Hover dwell before the + button's mini-app menu pops.
 *
 * 600ms, and deliberately not shorter: a native `Menu.popup()` is modal the instant it appears, has
 * no hover-close, and CANNOT be clicked through. With a short dwell the common outcome is that the
 * menu opens first and the click lands on it instead of the button — from the operator's side,
 * "pressing + did not open a tab". Cancelling does not help: the timer can be cancelled, an already
 * open native menu cannot be clicked past. 600ms lets a click win even after a moment's hesitation,
 * while "stop and see what the options are" still opens the menu. Same value as micromeet-cowork.
 */
const NEW_TAB_MENU_DELAY_MS = 600
const newTabWrap = ref<HTMLElement | null>(null)
let newTabMenuTimer: number | null = null
function cancelNewTabMenu(): void {
  if (newTabMenuTimer === null) return
  window.clearTimeout(newTabMenuTimer)
  newTabMenuTimer = null
}
// The click MUST cancel first: the pointer usually stays on the button afterwards, and without this
// the menu pops 600ms later over the strip that was just rebuilt — with no hover-close to dismiss it.
function onNewTabClick(): void {
  cancelNewTabMenu()
  void tabStore.newTab()
}
function armNewTabMenu(): void {
  cancelNewTabMenu()
  // 窗口没焦点时不弹。后台窗口的 hover 是主进程补出来的(inactiveChromeHover.service.ts),
  // 而 `Menu.popup()` 是**原生**菜单:它一出现就抢焦点,于是「鼠标扫过后台窗口的 + 」会莫名
  // 把那扇窗叫到前台。Chrome 的 + 也没有 hover 菜单,这里按同一条收。
  if (!document.hasFocus()) return
  newTabMenuTimer = window.setTimeout(() => {
    newTabMenuTimer = null
    const el = newTabWrap.value
    if (!el) return
    // Main's Menu.popup needs an anchor in window-content DIP, and only the button knows its own.
    const rect = el.getBoundingClientRect()
    void tabStore.showNewTabMenu({ left: rect.left, bottom: rect.bottom })
  }, NEW_TAB_MENU_DELAY_MS)
}
onUnmounted(cancelNewTabMenu)
onUnmounted(() => menuBarStore.bindAddressInput(null));

// 页面类型切换器。按钮自己测 rect —— main 侧的 `Menu.popup` 需要一个锚点坐标(DIP),而只有
// renderer 知道那个 rect。菜单是原生的:操作区那个原生 view 画在这份 DOM 之上,超过一行的
// 下拉必被它盖住(和 + 的 hover 菜单、tab 右键菜单同一条理由)。
const pageTypeButton = ref<HTMLButtonElement | null>(null)
function openPageTypeMenu(): void {
  const el = pageTypeButton.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  void tabStore.showPageTypeMenu({ left: rect.left, bottom: rect.bottom })
}

onMounted(() => {
  menuBarStore.bindAddressInput(addressInput.value)
  menuBarStore.init()
  tabStore.init()
  updateStore.init()
  captureStore.init()
  layoutStore.init()
  void workbenchStore.init()
})

// Tab label: the operator's own alias when they set one, else the page <title>, else the URL host,
// else the localized new-tab label.
//
// The alias is checked BEFORE the fixed-Home short-circuit on purpose: a custom homepage is a
// composite mini-app tab that CAN be aliased (Ral 2026-09-14), and the default Home tab never has
// one because its `Alias…` menu item is disabled. Whitespace-only == no alias, so "clear and save"
// really does fall back to the page title.
function tabLabel(tab: TabInfo): string {
  const alias = tab.alias?.trim()
  if (alias) return alias
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

// Chrome-style "close several in a row": when a close control is clicked, freeze every tab's width to its
// current (uniform) value so closing a middle tab just shifts the rest left by exactly one tab
// — landing the next tab's close control right under the cursor. Cleared on mouseleave, when widths reflow.
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
    return chipActive(tab)
      ? 'maestro-menu-bar__tab--pinned-active'
      : 'maestro-menu-bar__tab--pinned'
  }
  return chipActive(tab)
    ? 'maestro-menu-bar__tab--active'
    : 'maestro-menu-bar__tab--idle'
}

function fixedTabClass(tab: TabInfo): string {
  if (tab.kind === 'home') return 'maestro-menu-bar__tab--pinned-size'
  return 'maestro-menu-bar__tab--browser-size'
}
</script>

<template>
  <!-- 78px top chrome = an Omni-derived 36px tab strip + the compact 42px address bar. The renderer-driven
       layout measures the body placeholders below this, so the native operation/
       control views sit at y=78 automatically. -->
  <div class="maestro-menu-bar">
    <!-- Tab strip (36px). One chip per open operation-view tab; new tabs appear when a
         page opens a new window. Click to switch, use the icon action to close. On macOS the left gutter
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
            @click="onTabClick(tab.id)"
            @contextmenu.prevent="tabStore.showMenu(tab.id)"
            @dragstart="tabStore.startDrag($event, tab.id)"
            @dragover.prevent="tabStore.dragOver($event, tab.id)"
            @drop.prevent="tabStore.finishDrag()"
            @dragend="tabStore.finishDrag()"
          >
            <!-- The favicon slot is ALWAYS 16px — only the title text compresses. Loading swaps
                 the icon in place, so the chip never reflows. -->
            <!-- 「被控制」优先于 loading:agent 驱动时页面本来就常在加载,
                 两个都显示会变成"转圈套转圈",而人要看的是**谁**在动它。 -->
            <span
              v-if="tab.controlled"
              class="maestro-menu-bar__controlled"
              :title="i18nHelper.menuBar.maestro.tabControlled"
              aria-hidden="true"
            >
              <span class="maestro-menu-bar__controlled-core"></span>
              <span class="maestro-menu-bar__controlled-orbit"></span>
            </span>
            <IconLoader2
              v-else-if="tab.loading"
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
            <span
              class="maestro-menu-bar__tab-label"
              :class="{ 'maestro-menu-bar__tab-label--pinned': tab.pinned }"
              >{{ tabLabel(tab) }}</span
            >
            <!-- Close action (closable tabs only). Absolutely positioned so it never widens the tab
                 — a compressed tab keeps showing its favicon. Visible on hover, or always on
                 the active tab. The pinned local Home tab is non-closable, so it has none. -->
            <IconBtn
              v-if="!tab.pinned && tabStore.tabs.length > 1"
              class="maestro-menu-bar__tab-close"
              :class="{ 'maestro-menu-bar__tab-close--active': chipActive(tab) }"
              draggable="false"
              :title="i18nHelper.menuBar.maestro.closeTab"
              :aria-label="i18nHelper.menuBar.maestro.closeTab"
              @click.stop="onCloseClick($event, tab.id)"
              @dragstart.stop.prevent
            >
              <IconX :size="14" stroke="2" aria-hidden="true" />
            </IconBtn>
          </div>
          <template v-if="workbenchStore.open && i === workbenchChipAfterIndex">
            <div class="maestro-menu-bar__tab-divider-wrap" aria-hidden="true">
              <div class="maestro-menu-bar__tab-divider"></div>
            </div>
            <div
              name="menubar__workbench__tab"
              class="maestro-menu-bar__tab maestro-menu-bar__tab--workbench"
              :class="workbenchStore.visible ? 'maestro-menu-bar__tab--pinned-active' : 'maestro-menu-bar__tab--pinned'"
              :title="i18nHelper.maestroWorkbench.title"
              role="tab"
              :aria-selected="workbenchStore.visible"
              tabindex="0"
              @click="workbenchStore.openTab()"
              @contextmenu.prevent="workbenchStore.showMenu()"
              @keydown.enter.self.prevent="workbenchStore.openTab()"
              @keydown.space.self.prevent="workbenchStore.openTab()"
            >
              <IconSettings class="maestro-menu-bar__favicon" :size="16" stroke="1.8" />
              <span class="maestro-menu-bar__tab-label">{{ i18nHelper.menuBar.maestro.workbenchTab }}</span>
              <IconBtn
                name="menubar__workbench__close"
                class="maestro-menu-bar__tab-close"
                :class="{ 'maestro-menu-bar__tab-close--active': workbenchStore.visible }"
                :title="i18nHelper.maestroWorkbench.close"
                :aria-label="i18nHelper.maestroWorkbench.close"
                @click.stop="workbenchStore.close()"
              >
                <IconX :size="14" stroke="2" aria-hidden="true" />
              </IconBtn>
            </div>
          </template>
          <!-- Divider after the pinned group, before the first closable browsing tab. An open
               Workbench chip owns this slot and brings its own left divider — see
               pinnedGroupDivider(). -->
          <div
            v-if="pinnedGroupDivider(tab, i)"
            class="maestro-menu-bar__tab-divider-wrap"
          >
            <div class="maestro-menu-bar__tab-divider"></div>
          </div>
        </template>
      </div>
      <!-- New-tab button — circular, vertically centered to the tab row, always visible.
           Click opens a blank operation view (empty, editable address bar) ready for a URL;
           hovering opens the mini-app menu, so several Zellij tabs can be opened. -->
      <div ref="newTabWrap" class="maestro-menu-bar__new-tab-wrap">
        <IconBtn
          class="maestro-menu-bar__new-tab"
          :title="i18nHelper.menuBar.maestro.newTab"
          :aria-label="i18nHelper.menuBar.maestro.newTab"
          @click="onNewTabClick()"
          @mouseenter="armNewTabMenu()"
          @mouseleave="cancelNewTabMenu()"
        >
          <IconPlus :size="16" stroke="2" aria-hidden="true" />
        </IconBtn>
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

    <!-- Address bar (42px). -->
    <header
      class="maestro-menu-bar__address-row"
    >
      <!-- Back / Forward / Reload, grouped in a subtle segmented cluster (data-slot="nav"). Back &
           Forward disable when there's no history that way; the pinned Home tab also disables
           history nav because its bundled local entry is fixed. -->
      <div data-slot="nav" class="maestro-menu-bar__navigation">
        <button
          :class="navBtn"
          :disabled="workbenchStore.visible || !menuBarStore.canGoBack"
          :title="i18nHelper.menuBar.maestro.back"
          :aria-label="i18nHelper.menuBar.maestro.back"
          type="button"
          @click="menuBarStore.back()"
        >
          <IconArrowLeft />
        </button>
        <button
          :class="navBtn"
          :disabled="workbenchStore.visible || !menuBarStore.canGoForward"
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
          :disabled="workbenchStore.visible"
          :aria-label="i18nHelper.menuBar.maestro.reload"
          type="button"
          @click="menuBarStore.reload()"
        >
          <IconRefresh />
        </button>
      </div>
      <!-- Page-type switcher (Website ⇄ any registered composite mini app). Sits between the nav
           cluster and the address input, and opens a NATIVE Electron menu for the same reason the
           + button's hover menu does: the operation view is a native view painted OVER this DOM.
           See docs/features/maestro-page-type-switcher.md. -->
      <button
        ref="pageTypeButton"
        name="menubar__pagetype__button"
        :class="[navBtn, 'menubar__pagetype__button']"
        :disabled="workbenchStore.visible"
        :title="i18nHelper.menuBar.maestro.pageType"
        :aria-label="i18nHelper.menuBar.maestro.pageType"
        type="button"
        @click="openPageTypeMenu()"
      >
        <IconApps />
      </button>
      <!-- First-party fixed-purpose tabs expose a stable display address but cannot be
           navigated away from their trusted entry; ordinary browser tabs keep the normal
           schemeless/pasted-address behavior. -->
      <input
        ref="addressInput"
        v-model="addressValue"
        :disabled="workbenchStore.visible || tabStore.activeLocked"
        :title="workbenchStore.visible || tabStore.activeLocked ? i18nHelper.menuBar.maestro.fixedAddressLocked : ''"
        class="maestro-menu-bar__address"
        :placeholder="i18nHelper.menuBar.maestro.addressPlaceholder"
        name="browser-history-address"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="browserHistoryStore.open"
        :aria-label="i18nHelper.menuBar.maestro.addressPlaceholder"
        @focus="browserHistoryStore.focus()"
        @click="browserHistoryStore.focus()"
        @input="browserHistoryStore.inputChanged()"
        @blur="browserHistoryStore.blur()"
        @compositionstart="browserHistoryStore.compositionStart()"
        @compositionend="browserHistoryStore.compositionEnd()"
        @keydown="menuBarStore.keydown($event)"
      />

      <IconBtn name="browser-history-toggle" class="maestro-menu-bar__history" size="mini" :aria-label="browserHistoryStore.open ? i18nHelper.browserHistory.hide : i18nHelper.browserHistory.show" :title="browserHistoryStore.open ? i18nHelper.browserHistory.hide : i18nHelper.browserHistory.show" :aria-expanded="browserHistoryStore.open" @mousedown.prevent @click="browserHistoryStore.toggle()"><IconHistory :size="18" /></IconBtn>
      <span v-if="browserHistoryStore.error && !browserHistoryStore.open" class="maestro-menu-bar__history-error" role="status">{{ i18nHelper.browserHistory.error }}</span>

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

        <UserAvatar />

        <!-- Update button — at the address bar's trailing edge. The compact label names the state
             it is in (Downloading / Update); the title preserves the target-version detail. -->
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
          <span class="maestro-menu-bar__update-label">{{
            updateStore.downloading
              ? i18nHelper.menuBar.downloadingUpdate
              : i18nHelper.menuBar.restartToUpdate
          }}</span>
        </button>
      </div>
    </header>
  </div>
</template>
