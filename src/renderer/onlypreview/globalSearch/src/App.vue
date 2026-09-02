<template>
  <main
    name="onlypreview__globalSearchCanvas"
    class="onlypreview-global-search-canvas"
    @click="dismissFromTransparentCanvas"
  >
    <GlobalSearchWorkspace v-if="workspaceStyle" :style="workspaceStyle" />
  </main>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import GlobalSearchWorkspace from '../../shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue';
import { onlyPreviewGlobalSearchStore } from '../../shell/src/onlyPreviewGlobalSearch.store';
import { onlyPreviewGlobalSearchLayoutStore } from './onlyPreviewGlobalSearchLayout.store';

const FLOATING_GUTTER_PX = 24;

const workspaceStyle = computed<CSSProperties | null>(() => {
  const bounds = onlyPreviewGlobalSearchLayoutStore.layout?.workspaceBounds;
  if (!bounds) return null;
  return {
    position: 'absolute',
    left: `${bounds.x + FLOATING_GUTTER_PX}px`,
    top: `${bounds.y + FLOATING_GUTTER_PX}px`,
    width: `${Math.max(0, bounds.width - FLOATING_GUTTER_PX * 2)}px`,
    height: `${Math.max(0, bounds.height - FLOATING_GUTTER_PX * 2)}px`
  };
});

const dismissFromTransparentCanvas = (event: MouseEvent): void => {
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void onlyPreviewGlobalSearchStore.dismiss();
};
</script>

<style lang="less">
@import './App.less';
</style>
