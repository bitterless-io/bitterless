<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-vue';
import OmniPane from './components/OmniPane.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { layoutStore } from './store/layout.store';
import { flattenOmniPaneTreePixels } from '@shared/omni/omniLayout.service';
import type { OmniMiniAppLoadState } from '@shared/omni/omni.types';

const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const updateViewport = (): void => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
};
const terminalPanels = computed(() =>
  flattenOmniPaneTreePixels(layoutStore.tree, { x: 0, y: 0, ...viewport.value }).flatMap((cell) => {
    const state = layoutStore.getZellijLoadState(cell.id);
    return state ? [{ ...cell, state }] : [];
  })
);
const terminalError = (state: OmniMiniAppLoadState): string =>
  state.error && Object.prototype.hasOwnProperty.call(i18nHelper.zellij.errors, state.error)
    ? i18nHelper.zellij.errors[state.error]
    : i18nHelper.zellij.errors['operation-failed'];

onMounted(async () => {
  window.addEventListener('resize', updateViewport);
  try {
    await layoutStore.loadLayout();
    // syncLayout() removed — main process restoreSavedLayout() already applies the layout on open
  } finally {
    globalThis.dispatchEvent(new Event('omni-control-layout-ready'));
  }
});
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));
</script>

<template>
  <div class="omni-control" :class="{ 'omni-control--editing': layoutStore.controlVisible }">
    <div
      v-if="layoutStore.controlVisible && layoutStore.layoutRecoveryError"
      name="omniControl__layoutRecovery"
      class="omni-control__recovery"
      role="alert"
    >
      <IconAlertTriangle :size="15" aria-hidden="true" />
      <span>{{ i18nHelper.omni.layoutRecoveryError }}</span>
    </div>
    <OmniPane
      v-if="layoutStore.controlVisible"
      :key="layoutStore.structureRevision"
      :node="layoutStore.tree"
    />
    <template v-else>
      <section
        v-for="panel in terminalPanels"
        :key="panel.id"
        name="omniControl__terminalState"
        class="omni-control__terminal-state"
        :style="{
          left: `${panel.x}px`,
          top: `${panel.y}px`,
          width: `${panel.width}px`,
          height: `${panel.height}px`
        }"
        :role="panel.state.status === 'failed' ? 'alert' : 'status'"
        aria-live="polite"
      >
        <template v-if="panel.state.status === 'starting'">
          <IconLoader2 :size="28" class="omni-control__terminal-spinner" aria-hidden="true" />
          <p>{{ i18nHelper.zellij.opening }}</p>
        </template>
        <template v-else>
          <IconAlertTriangle :size="24" aria-hidden="true" />
          <p>{{ terminalError(panel.state) }}</p>
          <a-button size="small" type="text" @click="layoutStore.retryZellij(panel.id)">{{
            i18nHelper.zellij.retry
          }}</a-button>
        </template>
      </section>
    </template>
  </div>
</template>

<style lang="less">
@import './App.less';
</style>
