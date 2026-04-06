<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  nodeId: string;
  url?: string;
}>();

const emit = defineEmits<{
  (e: 'split', direction: 'h' | 'v', position: 'before' | 'after'): void;
  (e: 'updateUrl', url: string): void;
  (e: 'close'): void;
}>();

const localUrl = ref(props.url || '');

watch(() => props.url, (val) => {
  localUrl.value = val || '';
});

const splitLeft = () => emit('split', 'h', 'before');
const splitRight = () => emit('split', 'h', 'after');
const splitUp = () => emit('split', 'v', 'before');
const splitDown = () => emit('split', 'v', 'after');

const onUrlSubmit = () => {
  let url = localUrl.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
    localUrl.value = url;
  }
  emit('updateUrl', url);
};

const onInputFocus = (e: FocusEvent) => {
  const target = e.target as HTMLInputElement;
  if (!target) return;
  requestAnimationFrame(() => target.select());
};

const closePane = () => {
  emit('close');
};
</script>

<template>
  <div class="omni-pane-menubar">
    <div class="omni-pane-menubar__split-actions">
      <button class="omni-pane-menubar__btn" title="向左分裂" @click="splitLeft">←</button>
      <button class="omni-pane-menubar__btn" title="向上分裂" @click="splitUp">↑</button>
      <button class="omni-pane-menubar__btn" title="向下分裂" @click="splitDown">↓</button>
      <button class="omni-pane-menubar__btn" title="向右分裂" @click="splitRight">→</button>
    </div>
    <div class="omni-pane-menubar__url">
      <a-input
        v-model="localUrl"
        size="mini"
        placeholder="URL..."
        @press-enter="onUrlSubmit"
        @focus="onInputFocus"
      />
    </div>
    <button class="omni-pane-menubar__btn omni-pane-menubar__btn--close" title="关闭"
            @click.stop="closePane">✕</button>
  </div>
</template>

<style lang="less">
@import './OmniPaneMenuBar.less';
</style>
