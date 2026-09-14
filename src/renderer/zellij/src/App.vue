<template>
  <div name="zellij__app" class="zellij">
    <header name="zellij__toolbar" class="zellij__toolbar">
      <div class="zellij__identity">
        <IconTerminal2 :size="20" />
        <h1>{{ i18nHelper.zellij.title }}</h1>
        <span role="status" class="zellij__status">{{ zellijStore.statusLabel }}</span>
      </div>
      <div class="zellij__actions">
        <IconBtn
          class="zellij__settings-button"
          :aria-label="i18nHelper.zellij.settings"
          :title="i18nHelper.zellij.settings"
          @click="zellijStore.openSettings()"
        >
          <IconSettings :size="18" />
        </IconBtn>
      </div>
    </header>

    <div v-if="zellijStore.errorMessage" name="zellij__error" class="zellij__error" role="alert">
      <span>{{ zellijStore.errorMessage }}</span>
      <a-button size="mini" type="text" @click="zellijStore.initialize()">{{
        i18nHelper.zellij.retry
      }}</a-button>
    </div>

    <main
      ref="terminalRegion"
      name="zellij__terminal"
      class="zellij__terminal"
      :aria-busy="zellijStore.opening"
    >
      <div
        v-if="zellijStore.opening"
        name="zellij__loading"
        class="zellij__loading"
        role="status"
        aria-live="polite"
      >
        <IconLoader2 :size="28" class="zellij__loading-icon" aria-hidden="true" />
        <p>{{ i18nHelper.zellij.opening }}</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { IconLoader2, IconSettings, IconTerminal2 } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { zellijStore } from './zellij.store';

const terminalRegion = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
let mounted = true;
onMounted(async () => {
  observer = new ResizeObserver(() => {
    if (terminalRegion.value) void zellijStore.setBounds(terminalRegion.value);
  });
  if (terminalRegion.value) observer.observe(terminalRegion.value);
  await zellijStore.load();
  if (mounted) {
    await zellijStore.initialize();
    if (mounted && terminalRegion.value) await zellijStore.setBounds(terminalRegion.value);
  }
});
onBeforeUnmount(() => {
  mounted = false;
  observer?.disconnect();
});
</script>

<style lang="less">
@import './App.less';
</style>
