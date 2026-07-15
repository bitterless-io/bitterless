<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import MenuBar from '../../components/MenuBar/MenuBar.vue'
import { layoutStore } from '../../store/layout.store'
import appLogo from '@maestro-renderer/common/assets/icons/app-logo.png'
import './Layout.less'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

// ── Native-view geometry ───────────────────────────────────────────────────────
// The operation/control placeholders are invisible anchors: the main process layers
// the operationView / controlView WebContentsViews exactly over their rects. We
// measure them and push the bounds whenever the layout changes, so editing the CSS
// here (or the MenuBar height) is enough to move the native views.
const operationPlaceholder = ref<HTMLElement | null>(null)
const controlPlaceholder = ref<HTMLElement | null>(null)

function reportBounds(): void {
  const op = operationPlaceholder.value?.getBoundingClientRect()
  const ct = controlPlaceholder.value?.getBoundingClientRect()
  if (!op || !ct) return
  coach
    .setViewBounds({
      operation: { x: op.x, y: op.y, width: op.width, height: op.height },
      control: { x: ct.x, y: ct.y, width: ct.width, height: ct.height }
    })
    .catch(() => {})
}

// Coalesce bursts (resize drags fire many events) into one report per frame.
let rafId = 0
function scheduleReport(): void {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    reportBounds()
  })
}
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  reportBounds()
  window.addEventListener('resize', scheduleReport)
  resizeObserver = new ResizeObserver(scheduleReport)
  if (operationPlaceholder.value) resizeObserver.observe(operationPlaceholder.value)
  if (controlPlaceholder.value) resizeObserver.observe(controlPlaceholder.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleReport)
  resizeObserver?.disconnect()
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="maestro-layout">
    <MenuBar />

    <!-- Body: geometry anchors for the native views (covered once they paint). -->
    <div class="maestro-layout__body">
      <div ref="operationPlaceholder" class="maestro-layout__operation">
        <!-- Boot splash: the operation view stays hidden until AI-CRMS finishes loading
             (coachWindow.helper defers setVisible), so this centered loader shows in the meantime
             and is covered the instant the page paints — no blank/black area, no about:blank hop. -->
        <div class="maestro-layout__splash">
          <img :src="appLogo" alt="" class="maestro-layout__logo" />
        </div>
      </div>
      <!-- Control panel: width → 0 when the sidebar is toggled off. The width TRANSITION eases
           the placeholder, and the ResizeObserver above fires each frame → setViewBounds, so the
           native operation/control views animate along with it (operation reflows to full width).
           Native views aren't DOM-composited, so this is a per-frame resize — if it stutters on
           heavy pages, drop `transition-[width] duration-200 ease-out` for an instant toggle. -->
      <div
        ref="controlPlaceholder"
        class="maestro-layout__control"
        :class="{ 'maestro-layout__control--open': layoutStore.sidebarOpen }"
      ></div>
    </div>
  </div>
</template>
