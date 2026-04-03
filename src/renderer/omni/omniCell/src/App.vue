<script setup lang="ts">
import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import { omniCellEnv } from './contextBridge/cellEnv.bridge';

const cellId = omniCellEnv.cellId;
const initialUrl = omniCellEnv.initialUrl || '';

const state = reactive({
  url: initialUrl,
  inputUrl: initialUrl,
  active: false,
});

// Listen for URL updates from main process
xpcRenderer.subscribe('omniCell/urlChanged', (payload) => {
  const data = payload.params as { cellId: string; url: string };
  if (data.cellId === cellId) {
    state.url = data.url;
    state.inputUrl = data.url;
  }
});

xpcRenderer.subscribe('omniCell/activeChanged', (payload) => {
  const data = payload.params as { activeCellId: string };
  state.active = data.activeCellId === cellId;
});

const goBack = () => {
  if (!cellId) return;
  xpcRenderer.send('OmniWindowHandler/cellGoBack', { cellId });
};

const goForward = () => {
  if (!cellId) return;
  xpcRenderer.send('OmniWindowHandler/cellGoForward', { cellId });
};

const refresh = () => {
  if (!cellId) return;
  xpcRenderer.send('OmniWindowHandler/cellRefresh', { cellId });
};

const navigate = () => {
  if (!cellId || !state.inputUrl) return;
  let url = state.inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  xpcRenderer.send('OmniWindowHandler/navigateCell', { cellId, url });
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    navigate();
  }
};

const onInputFocus = (e: FocusEvent) => {
  const target = e.target as HTMLInputElement;
  if (!target) return;
  requestAnimationFrame(() => target.select());
};
</script>

<template>
  <div class="omni-cell-menubar" :class="{ 'omni-cell-menubar--active': state.active }">
    <button class="omni-cell-menubar__nav-btn" title="后退" @click="goBack">
      ←
    </button>
    <button class="omni-cell-menubar__nav-btn" title="前进" @click="goForward">
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
        @keydown="onKeydown"
        @press-enter="navigate"
        @focus="onInputFocus"
      />
    </div>
  </div>
</template>

<style lang="less">
@import './App.less';
</style>
