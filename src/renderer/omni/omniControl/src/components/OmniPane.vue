<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useThrottleFn } from '@vueuse/core';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import OmniPaneMenuBar from './OmniPaneMenuBar.vue';
import todoIcon from '@renderer/common/assets/icons/menu-icons/todo.png';
import eyesOnAgentsIcon from '@renderer/common/assets/icons/eyes-on-agents.svg';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  getNodeContentMode,
  getNodeDisplayUrl,
  layoutStore,
} from '../store/layout.store';
import type {
  OmniContentMode,
  OmniMiniAppId,
  OmniPaneNode,
} from '../types/layout.types';

const props = defineProps<{
  node: OmniPaneNode;
}>();

const isHorizontal = computed(() => props.node.direction === 'h');

// Suppress spurious @resize events fired during splitpanes initial mount/render
const isMounted = ref(false);
onMounted(() => {
  setTimeout(() => { isMounted.value = true; }, 200);
});

const throttledApplyLayout = useThrottleFn(() => {
  layoutStore.applyLayout();
}, 50, { leading: false, trailing: true });

const onResize = (event: { panes: { min: number; max: number; size: number }[] }) => {
  if (!isMounted.value) return;
  if (layoutStore.splitting) return;
  if (!event?.panes || !Array.isArray(event.panes)) return;
  const sizes = event.panes.map((p) => p.size);
  layoutStore.updateSizes(props.node.id, sizes);
  throttledApplyLayout();
};

const onResizeEnd = (event: { panes: { min: number; max: number; size: number }[] }) => {
  if (layoutStore.splitting) return;
  if (event?.panes && Array.isArray(event.panes)) {
    const sizes = event.panes.map((p) => p.size);
    layoutStore.updateSizes(props.node.id, sizes);
  }
  layoutStore.syncLayout();
};

const handleSplit = async (nodeId: string, direction: 'h' | 'v', position: 'before' | 'after') => {
  layoutStore.splitting = true;
  layoutStore.splitPane(nodeId, direction, position);
  layoutStore.syncLayout();
  await nextTick();
  await nextTick();
  layoutStore.splitting = false;
};

const handleUrlUpdate = (nodeId: string, url: string) => {
  layoutStore.updateUrl(nodeId, url);
  layoutStore.navigateCell(nodeId, url);
  // syncLayout() removed: navigateCell drives main process navigation; URL is reflected back
  // via omniControl/cellUrlChanged subscriber without needing a full layout sync
};

const handleContentModeUpdate = async (nodeId: string, contentMode: OmniContentMode) => {
  layoutStore.updateContentMode(nodeId, contentMode);
  await layoutStore.syncLayout();
};

const handleMiniAppSelect = async (nodeId: string, miniAppId: OmniMiniAppId) => {
  layoutStore.updateMiniApp(nodeId, miniAppId);
  await layoutStore.syncLayout();
};

const handleClose = async (nodeId: string) => {
  await nextTick();
  layoutStore.removePane(nodeId);
  layoutStore.syncLayout();
};
</script>

<template>
  <div class="omni-pane">
    <!-- Leaf node: show pane menubar -->
    <template v-if="node.type === 'leaf'">
      <OmniPaneMenuBar
        :node-id="node.id"
        :display-url="getNodeDisplayUrl(node)"
        :content-mode="getNodeContentMode(node)"
        @split="(dir, pos) => handleSplit(node.id, dir, pos)"
        @update-url="(url) => handleUrlUpdate(node.id, url)"
        @update-content-mode="(contentMode) => handleContentModeUpdate(node.id, contentMode)"
        @close="handleClose(node.id)"
      />
      <div class="omni-pane__preview">
        <div
          v-if="getNodeContentMode(node) === 'miniapp'"
          class="omni-pane__miniapp-list"
        >
          <button
            class="omni-pane__miniapp-item"
            :class="{ 'omni-pane__miniapp-item--active': node.miniAppId !== 'eyesOnAgents' }"
            type="button"
            @click="handleMiniAppSelect(node.id, 'todo')"
          >
            <img class="omni-pane__miniapp-icon" :src="todoIcon" alt="" />
            <span class="omni-pane__miniapp-name">{{ i18nHelper.miniApp.todo.name }}</span>
          </button>
          <button
            class="omni-pane__miniapp-item"
            :class="{ 'omni-pane__miniapp-item--active': node.miniAppId === 'eyesOnAgents' }"
            type="button"
            @click="handleMiniAppSelect(node.id, 'eyesOnAgents')"
          >
            <img class="omni-pane__miniapp-icon" :src="eyesOnAgentsIcon" alt="" />
            <span class="omni-pane__miniapp-name">{{ i18nHelper.miniApp.eyesOnAgents.name }}</span>
          </button>
        </div>
        <template v-else>
          <span class="omni-pane__preview-id">{{ node.id.slice(0, 6) }}</span>
          <span class="omni-pane__preview-url">{{ getNodeDisplayUrl(node) }}</span>
        </template>
      </div>
    </template>

    <!-- Split node: render nested Splitpanes -->
    <template v-else-if="node.type === 'split' && node.children">
      <Splitpanes
        :horizontal="!isHorizontal"
        :maximize-panes="false"
        class="omni-pane__splitpanes"
        @resize="onResize"
        @resized="onResizeEnd"
      >
        <Pane
          v-for="(child, i) in node.children"
          :size="node.sizes?.[i] ?? 50"
        >
          <OmniPane :node="child" />
        </Pane>
      </Splitpanes>
    </template>
  </div>
</template>

<style lang="less">
@import './OmniPane.less';
</style>
