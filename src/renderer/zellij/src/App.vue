<template>
  <div name="zellij__app" class="zellij">
    <header name="zellij__toolbar" class="zellij__toolbar">
      <div class="zellij__identity">
        <IconTerminal2 :size="16" />
        <h1>{{ i18nHelper.zellij.title }}</h1>
        <span role="status" class="zellij__status">
          <!-- 颜色是状态的第二条通道,不是唯一通道 —— 文字标签照常在
               (docs/features/zellij-terminal-chrome.md #4)。 -->
          <span class="zellij__status-dot" :class="statusDotClass" aria-hidden="true"></span>
          {{ zellijStore.statusLabel }}
        </span>
      </div>
      <div class="zellij__actions">
        <IconBtn
          class="zellij__settings-button"
          :aria-label="i18nHelper.zellij.settings"
          :title="i18nHelper.zellij.settings"
          @click="zellijStore.openSettings()"
        >
          <IconSettings :size="16" />
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
        <p>{{ zellijStore.loadingLabel }}</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IconLoader2, IconSettings, IconTerminal2 } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { zellijStore } from './zellij.store';

/**
 * 状态点的颜色。三档,不是五档:`idle` / `starting` / `reconnecting` 对人是同一件事(还没好),
 * 分成三种黄只会制造一个没人读得懂的色表。出错这一档还要认 `errorMessage` —— 渲染层自己的
 * `error` 不在 snapshot 里,只看 `snapshot.status` 会把「调用抛了」显示成黄色的「正在打开」。
 */
const statusDotClass = computed(() => {
  if (zellijStore.errorMessage) return 'zellij__status-dot--error';
  return zellijStore.status === 'ready' ? 'zellij__status-dot--ready' : '';
});

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
