<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { xpcRenderer, createXpcRendererEmitter } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { updateStore } from '@renderer/home/src/store/update.store';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import type { OmniWindowHandler } from '@main/xpc/omniWindow.handler';

const omniWindowEmitter = createXpcRendererEmitter<OmniWindowHandler>('OmniWindowHandler');

const controlVisible = ref(false);
const isMac = ref(uaHelper.isMac);
const isWindows = ref(uaHelper.isWindows);
const maximized = ref(false);
const menubarClass = computed(() => {
  if (isMac.value) return 'omni-menubar--mac';
  if (isWindows.value) return 'omni-menubar--win';
  return '';
});
const updateTitle = computed(() => {
  if (!updateStore.updateInfo) return i18nHelper.menuBar.restartToUpdate;
  return i18nHelper.menuBar.updateToVersion.replace(
    '{version}',
    updateStore.updateInfo.version
  );
});

const toggleControl = () => {
  controlVisible.value = !controlVisible.value;
  xpcRenderer.send('OmniWindowHandler/toggleOmniControl');
};

const handleDblClick = () => {
  if (isWindows.value) {
    toggleMaximize();
  }
};

const minimize = () => omniWindowEmitter.minimize();

const toggleMaximize = async () => {
  await omniWindowEmitter.toggleMaximize();
  maximized.value = !maximized.value;
};

const close = () => omniWindowEmitter.close();

const handleRestartUpdate = (): void => {
  void updateStore.restartAndUpdate();
};

onMounted(async () => {
  if (isWindows.value) {
    maximized.value = await omniWindowEmitter.isMaximized();
  }
});
</script>

<template>
  <div class="omni-menubar" :class="menubarClass" @dblclick="handleDblClick">
    <div class="omni-menubar__left">
      <span class="omni-menubar__title">{{ i18nHelper.omni.title }}</span>
      <div class="omni-menubar__actions">
        <button
          class="omni-menubar__btn"
          :class="{ 'omni-menubar__btn--active': controlVisible }"
          @click="toggleControl"
        >
          ⊞ {{ i18nHelper.omni.layout }}
        </button>
      </div>
    </div>
    <button
      v-if="updateStore.updateAvailable"
      type="button"
      class="omni-menubar__update"
      :title="updateTitle"
      @click.stop="handleRestartUpdate"
    >
      {{ i18nHelper.menuBar.restartToUpdate }}
    </button>
    <div v-if="isWindows" class="omni-menubar__win-controls">
      <button class="omni-menubar__win-btn" @click.stop="minimize()">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button class="omni-menubar__win-btn" @click.stop="toggleMaximize()">
        <svg v-if="!maximized" width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor"/><rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor"/></svg>
      </button>
      <button class="omni-menubar__win-btn omni-menubar__win-btn--close" @click.stop="close()">
        <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </div>
</template>

<style lang="less">
@import './App.less';
</style>
