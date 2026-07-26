<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useThrottleFn } from '@vueuse/core';
import { Splitpanes, Pane } from 'splitpanes';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-vue';
import 'splitpanes/dist/splitpanes.css';
import OmniPaneMenuBar from './OmniPaneMenuBar.vue';
import todoIcon from '@renderer/common/assets/icons/menu-icons/todo.png';
import eyesOnAgentsIcon from '@renderer/common/assets/icons/eyes-on-agents.svg';
import translatorIcon from '@renderer/common/assets/icons/translator.svg';
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

interface SplitpanesResizeEvent {
  event?: Event;
  panes?: Array<{ min: number; max: number; size: number }>;
}

const isHorizontal = computed(() => props.node.direction === 'h');
const miniApps = computed<Array<{
  id: OmniMiniAppId;
  icon: string;
  name: string;
}>>(() => [
  {
    id: 'todo',
    icon: todoIcon,
    name: i18nHelper.miniApp.todo.name,
  },
  {
    id: 'eyesOnAgents',
    icon: eyesOnAgentsIcon,
    name: i18nHelper.miniApp.eyesOnAgents.name,
  },
  {
    id: 'translator',
    icon: translatorIcon,
    name: i18nHelper.miniApp.translator.name,
  },
]);

const failedMiniApp = computed(() => layoutStore.getMiniAppLoadFailure(props.node.id));
const miniAppFailureMessage = computed(() => {
  const failedId = failedMiniApp.value;
  if (!failedId) return '';
  const failedName = miniApps.value.find((miniApp) => miniApp.id === failedId)?.name ?? failedId;
  return i18nHelper.omni.miniAppLoadFailed.replace('{name}', failedName);
});

// Suppress spurious @resize events fired during splitpanes initial mount/render
const isMounted = ref(false);
let mountTimer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  mountTimer = setTimeout(() => {
    isMounted.value = true;
    mountTimer = null;
  }, 200);
});
onBeforeUnmount(() => {
  isMounted.value = false;
  if (mountTimer) clearTimeout(mountTimer);
  mountTimer = null;
});

const throttledApplyLayout = useThrottleFn(() => {
  layoutStore.applyLayout();
}, 50, true, false);

const onResize = (event: SplitpanesResizeEvent) => {
  if (!isMounted.value) return;
  if (layoutStore.structureChanging) return;
  if (!event?.event) return;
  if (!event?.panes || !Array.isArray(event.panes)) return;
  const sizes = event.panes.map((pane) => pane.size);
  if (!layoutStore.updateSizes(props.node.id, sizes)) return;
  throttledApplyLayout();
};

const onResizeEnd = async (event: SplitpanesResizeEvent) => {
  if (!isMounted.value) return;
  if (layoutStore.structureChanging) return;
  if (!event?.event) return;
  if (!event.panes || !Array.isArray(event.panes)) return;
  const sizes = event.panes.map((pane) => pane.size);
  if (!layoutStore.updateSizes(props.node.id, sizes)) return;
  await layoutStore.syncLayout();
};

const handleSplit = async (nodeId: string, direction: 'h' | 'v', position: 'before' | 'after') => {
  layoutStore.structureChanging = true;
  try {
    layoutStore.splitPane(nodeId, direction, position);
    await layoutStore.syncLayout();
    await nextTick();
    await nextTick();
  } finally {
    layoutStore.structureChanging = false;
  }
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
  layoutStore.structureChanging = true;
  try {
    layoutStore.removePane(nodeId);
    await layoutStore.syncLayout();
    await nextTick();
    await nextTick();
  } finally {
    layoutStore.structureChanging = false;
  }
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
          <div
            v-if="miniAppFailureMessage"
            class="omni-pane__miniapp-error"
            role="alert"
          >
            <IconAlertTriangle :size="15" aria-hidden="true" />
            <span>{{ miniAppFailureMessage }}</span>
          </div>
          <a-button
            v-for="miniApp in miniApps"
            :key="miniApp.id"
            name="omniPane__miniApp"
            class="omni-pane__miniapp-item"
            :class="{ 'omni-pane__miniapp-item--active': node.miniAppId === miniApp.id }"
            type="text"
            size="mini"
            long
            :aria-pressed="node.miniAppId === miniApp.id"
            @click="handleMiniAppSelect(node.id, miniApp.id)"
          >
            <img class="omni-pane__miniapp-icon" :src="miniApp.icon" alt="" />
            <span class="omni-pane__miniapp-name">{{ miniApp.name }}</span>
            <IconCheck
              v-if="node.miniAppId === miniApp.id"
              class="omni-pane__miniapp-check"
              :size="16"
              aria-hidden="true"
            />
          </a-button>
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
          :key="child.id"
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
