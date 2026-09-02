<script setup lang="ts">
import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { omniCellEnv } from './contextBridge/cellEnv.bridge';

const cellId = omniCellEnv.cellId;
const initialUrl = omniCellEnv.initialUrl || '';
const isMiniApp = omniCellEnv.contentMode === 'miniapp';

const state = reactive({
  url: initialUrl,
  inputUrl: initialUrl,
});

// Listen for URL updates from main process
xpcRenderer.subscribe('omniCell/urlChanged', (payload) => {
  const data = payload.params as { cellId: string; url: string };
  if (data.cellId === cellId) {
    state.url = data.url;
    state.inputUrl = data.url;
  }
});

const goBack = () => {
  if (!cellId || isMiniApp) return;
  xpcRenderer.send('OmniWindowHandler/cellGoBack', { cellId });
};

const goForward = () => {
  if (!cellId || isMiniApp) return;
  xpcRenderer.send('OmniWindowHandler/cellGoForward', { cellId });
};

const refresh = () => {
  if (!cellId) return;
  xpcRenderer.send('OmniWindowHandler/cellRefresh', { cellId });
};

const navigate = () => {
  if (!cellId || !state.inputUrl || isMiniApp) return;
  let url = state.inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  xpcRenderer.send('OmniWindowHandler/navigateCell', { cellId, url });
};

const onInputFocus = (e: FocusEvent) => {
  if (isMiniApp) return;
  const target = e.target as HTMLInputElement;
  if (!target) return;
  requestAnimationFrame(() => target.select());
};
</script>

<template>
  <div class="omni-cell-menubar" :class="{ 'omni-cell-menubar--miniapp': isMiniApp }">
    <button class="omni-cell-menubar__nav-btn" title="后退" :disabled="isMiniApp" @click="goBack">
      ←
    </button>
    <button class="omni-cell-menubar__nav-btn" title="前进" :disabled="isMiniApp" @click="goForward">
      →
    </button>
    <button class="omni-cell-menubar__nav-btn" title="刷新" @click="refresh">
      ↻
    </button>
    <div class="omni-cell-menubar__url-input">
      <a-input
        v-model="state.inputUrl"
        size="small"
        placeholder="输入 URL..."
        :readonly="isMiniApp"
        @press-enter="navigate"
        @focus="onInputFocus"
      />
    </div>
  </div>
</template>

<style lang="less">
@import './App.less';
</style>
