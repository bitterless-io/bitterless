<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@cowork-shared/coach.api'
import MenuBar from '../../components/MenuBar/MenuBar.vue'
import { layoutStore } from '../../store/layout.store'
import appLogo from '@cowork-renderer/common/assets/icons/app-logo.png'

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
  <div class="flex min-h-0 flex-1 flex-col">
    <MenuBar />

    <!-- Body: geometry anchors for the native views (covered once they paint). -->
    <div class="relative flex min-h-0 flex-1">
      <div ref="operationPlaceholder" class="relative min-w-0 flex-1 bg-white">
        <!-- Boot splash: the operation view stays hidden until AI-CRMS finishes loading
             (coachWindow.helper defers setVisible), so this centered loader shows in the meantime
             and is covered the instant the page paints — no blank/black area, no about:blank hop. -->
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <img :src="appLogo" alt="" class="h-14 w-14 rounded-2xl opacity-95" />
        </div>
      </div>
      <!-- Control panel: width → 0 when the sidebar is toggled off. The width TRANSITION eases
           the placeholder, and the ResizeObserver above fires each frame → setViewBounds, so the
           native operation/control views animate along with it (operation reflows to full width).
           Native views aren't DOM-composited, so this is a per-frame resize — if it stutters on
           heavy pages, drop `transition-[width] duration-200 ease-out` for an instant toggle. -->
      <div
        ref="controlPlaceholder"
        class="shrink-0 bg-[#f7f8fa] transition-[width] duration-200 ease-out"
        :class="layoutStore.sidebarOpen ? 'w-[480px]' : 'w-0'"
      ></div>
    </div>
  </div>
</template>
