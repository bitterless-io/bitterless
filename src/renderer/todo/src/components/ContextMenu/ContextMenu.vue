<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu__backdrop"
      @click="close"
      @contextmenu.prevent="close"
    />
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu"
      :style="menuStyle"
    >
      <slot />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch, nextTick } from 'vue';

const MENU_MIN_WIDTH = 120;
const MENU_ESTIMATED_HEIGHT = 36;
const EDGE_MARGIN = 8;

const props = defineProps<{
  visible: boolean;
  anchorEl: HTMLElement | null;
  offsetX: number;
  offsetY: number;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const flippedX = ref(false);
const flippedY = ref(false);
const menuWidth = ref(MENU_MIN_WIDTH);
const menuHeight = ref(MENU_ESTIMATED_HEIGHT);

const close = () => {
  emit('update:visible', false);
};

const menuStyle = computed(() => {
  if (!props.anchorEl) return { display: 'none' };

  const rect = props.anchorEl.getBoundingClientRect();
  let left = rect.left + props.offsetX;
  let top = rect.top + props.offsetY;

  if (flippedX.value) {
    left = left - menuWidth.value;
  }
  if (flippedY.value) {
    top = top - menuHeight.value;
  }

  return {
    position: 'fixed' as const,
    left: `${left}px`,
    top: `${top}px`,
    zIndex: 9999,
  };
});

const adjustPosition = async () => {
  await nextTick();
  if (!menuRef.value || !props.anchorEl) return;

  const menuRect = menuRef.value.getBoundingClientRect();
  menuWidth.value = menuRect.width;
  menuHeight.value = menuRect.height;

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  const anchorRect = props.anchorEl.getBoundingClientRect();
  const rawLeft = anchorRect.left + props.offsetX;
  const rawTop = anchorRect.top + props.offsetY;

  flippedX.value = rawLeft + menuRect.width + EDGE_MARGIN > viewportW;
  flippedY.value = rawTop + menuRect.height + EDGE_MARGIN > viewportH;
};

watch(() => props.visible, async (val) => {
  if (val) {
    flippedX.value = false;
    flippedY.value = false;
    await adjustPosition();
  }
});

const onScroll = () => {
  if (props.visible) {
    close();
  }
};

window.addEventListener('scroll', onScroll, true);
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true);
});
</script>

<style lang="less">
@import './ContextMenu.less';
</style>
