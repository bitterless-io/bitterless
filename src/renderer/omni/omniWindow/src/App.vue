<script setup lang="ts">
import { ref, computed } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';

const controlVisible = ref(false);
const isMac = ref(uaHelper.isMac);
const isWindows = ref(uaHelper.isWindows);

const menubarClass = computed(() => {
  if (isMac.value) return 'omni-menubar--mac';
  if (isWindows.value) return 'omni-menubar--win';
  return '';
});

const toggleControl = () => {
  controlVisible.value = !controlVisible.value;
  xpcRenderer.send('OmniWindowHandler/toggleOmniControl');
};
</script>

<template>
  <div class="omni-menubar" :class="menubarClass">
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
</template>

<style lang="less">
@import './App.less';
</style>
