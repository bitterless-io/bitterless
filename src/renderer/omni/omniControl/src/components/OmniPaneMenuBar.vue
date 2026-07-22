<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconX,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { OmniContentMode } from '../types/layout.types';

const props = defineProps<{
  nodeId: string;
  displayUrl?: string;
  contentMode: OmniContentMode;
}>();

const emit = defineEmits<{
  (e: 'split', direction: 'h' | 'v', position: 'before' | 'after'): void;
  (e: 'updateUrl', url: string): void;
  (e: 'updateContentMode', contentMode: OmniContentMode): void;
  (e: 'close'): void;
}>();

const localUrl = ref(props.displayUrl || '');

watch(
  () => props.displayUrl,
  () => {
    localUrl.value = props.displayUrl || '';
  },
);

const splitLeft = () => emit('split', 'h', 'before');
const splitRight = () => emit('split', 'h', 'after');
const splitUp = () => emit('split', 'v', 'before');
const splitDown = () => emit('split', 'v', 'after');

const onUrlSubmit = () => {
  if (props.contentMode === 'miniapp') return;
  let url = localUrl.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
    localUrl.value = url;
  }
  emit('updateUrl', url);
};

const onInputFocus = (e: FocusEvent) => {
  if (props.contentMode === 'miniapp') return;
  const target = e.target as HTMLInputElement;
  if (!target) return;
  requestAnimationFrame(() => target.select());
};

const onContentModeChange = (value: unknown) => {
  if (value !== 'browser' && value !== 'miniapp') return;
  emit('updateContentMode', value);
};

const closePane = () => {
  emit('close');
};
</script>

<template>
  <div class="omni-pane-menubar">
    <div class="omni-pane-menubar__split-actions">
      <a-button
        class="omni-pane-menubar__btn"
        type="text"
        size="mini"
        :title="i18nHelper.omni.splitLeft"
        :aria-label="i18nHelper.omni.splitLeft"
        @click="splitLeft"
      >
        <IconColumnInsertLeft :size="14" aria-hidden="true" />
      </a-button>
      <a-button
        class="omni-pane-menubar__btn"
        type="text"
        size="mini"
        :title="i18nHelper.omni.splitUp"
        :aria-label="i18nHelper.omni.splitUp"
        @click="splitUp"
      >
        <IconRowInsertTop :size="14" aria-hidden="true" />
      </a-button>
      <a-button
        class="omni-pane-menubar__btn"
        type="text"
        size="mini"
        :title="i18nHelper.omni.splitDown"
        :aria-label="i18nHelper.omni.splitDown"
        @click="splitDown"
      >
        <IconRowInsertBottom :size="14" aria-hidden="true" />
      </a-button>
      <a-button
        class="omni-pane-menubar__btn"
        type="text"
        size="mini"
        :title="i18nHelper.omni.splitRight"
        :aria-label="i18nHelper.omni.splitRight"
        @click="splitRight"
      >
        <IconColumnInsertRight :size="14" aria-hidden="true" />
      </a-button>
    </div>
    <div
      class="omni-pane-menubar__url"
      :class="{ 'omni-pane-menubar__url--readonly': contentMode === 'miniapp' }"
    >
      <a-input
        v-model="localUrl"
        size="mini"
        :placeholder="i18nHelper.omni.urlPlaceholder"
        :input-attrs="{ 'aria-label': i18nHelper.omni.urlInput }"
        :readonly="contentMode === 'miniapp'"
        @press-enter="onUrlSubmit"
        @focus="onInputFocus"
      />
    </div>
    <a-select
      class="omni-pane-menubar__content-select"
      size="mini"
      :model-value="contentMode"
      :aria-label="i18nHelper.omni.contentType"
      @change="onContentModeChange"
    >
      <a-option value="browser">{{ i18nHelper.omni.website }}</a-option>
      <a-option value="miniapp">{{ i18nHelper.omni.miniApp }}</a-option>
    </a-select>
    <a-button
      class="omni-pane-menubar__btn omni-pane-menubar__btn--close"
      type="text"
      status="danger"
      size="mini"
      :title="i18nHelper.omni.closePane"
      :aria-label="i18nHelper.omni.closePane"
      @click.stop="closePane"
    >
      <IconX :size="14" aria-hidden="true" />
    </a-button>
  </div>
</template>

<style lang="less">
@import './OmniPaneMenuBar.less';
</style>
