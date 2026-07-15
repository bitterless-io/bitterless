<template>
  <div
    name="coin__app"
    class="coin-app"
    :class="{ 'coin-app--resizing': dividerDragging }"
  >
    <CoinWindowHeader :platform="platform" />

    <div name="coin__workspace" class="coin-app__workspace">
      <CoinAnalysisPane />
      <button
        name="coin__splitDivider"
        class="coin-split-divider"
        type="button"
        role="separator"
        aria-orientation="vertical"
        :aria-label="i18nHelper.coin.resizeChat"
        :aria-valuenow="chatWidth"
        aria-valuemin="320"
        aria-valuemax="460"
        @pointerdown="startDividerDrag"
        @keydown="handleDividerKeydown"
      ></button>
      <div class="coin-app__codex" :style="{ width: `${chatWidth}px` }">
        <CoinCodexPane />
      </div>
    </div>

    <CoinStatusBar />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { coinShellStore } from './coinShell.store';
import CoinAnalysisPane from './components/CoinAnalysisPane.vue';
import CoinCodexPane from './components/CoinCodexPane.vue';
import CoinStatusBar from './components/CoinStatusBar.vue';
import CoinWindowHeader from './components/CoinWindowHeader.vue';

const MIN_CODEX_WIDTH = 320;
const MAX_CODEX_WIDTH = 460;
const COMPACT_MAX_CODEX_WIDTH = 380;
const MIN_ANALYSIS_WIDTH = 475;
const DIVIDER_WIDTH = 5;
const platform = window.coin.platform;

const defaultChatWidth = (): number =>
  window.innerWidth > 1100
    ? 420
    : Math.min(COMPACT_MAX_CODEX_WIDTH, Math.max(MIN_CODEX_WIDTH, window.innerWidth * 0.38));

const maxChatWidth = (): number => {
  const responsiveMax = window.innerWidth <= 1100 ? COMPACT_MAX_CODEX_WIDTH : MAX_CODEX_WIDTH;
  return Math.max(
    MIN_CODEX_WIDTH,
    Math.min(responsiveMax, window.innerWidth - MIN_ANALYSIS_WIDTH - DIVIDER_WIDTH),
  );
};

const clampChatWidth = (value: number): number =>
  Math.round(Math.max(MIN_CODEX_WIDTH, Math.min(maxChatWidth(), value)));

const chatWidth = ref(clampChatWidth(defaultChatWidth()));
const dividerDragging = ref(false);
let dividerCustomized = false;

const updateChatWidthFromPointer = (event: PointerEvent): void => {
  chatWidth.value = clampChatWidth(window.innerWidth - event.clientX);
};

const stopDividerDrag = (): void => {
  if (!dividerDragging.value) return;
  dividerDragging.value = false;
  window.removeEventListener('pointermove', updateChatWidthFromPointer);
  window.removeEventListener('pointerup', stopDividerDrag);
  window.removeEventListener('pointercancel', stopDividerDrag);
};

const startDividerDrag = (event: PointerEvent): void => {
  event.preventDefault();
  dividerCustomized = true;
  dividerDragging.value = true;
  updateChatWidthFromPointer(event);
  window.addEventListener('pointermove', updateChatWidthFromPointer);
  window.addEventListener('pointerup', stopDividerDrag);
  window.addEventListener('pointercancel', stopDividerDrag);
};

const handleDividerKeydown = (event: KeyboardEvent): void => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  dividerCustomized = true;
  const adjustment = event.key === 'ArrowLeft' ? 16 : -16;
  chatWidth.value = clampChatWidth(chatWidth.value + adjustment);
};

const handleWindowResize = (): void => {
  chatWidth.value = clampChatWidth(
    dividerCustomized ? chatWidth.value : defaultChatWidth(),
  );
};

onMounted(() => {
  window.addEventListener('resize', handleWindowResize);
  void coinShellStore.initialize();
});

onBeforeUnmount(() => {
  stopDividerDrag();
  window.removeEventListener('resize', handleWindowResize);
});
</script>

<style lang="less">
@import './App.less';
</style>
