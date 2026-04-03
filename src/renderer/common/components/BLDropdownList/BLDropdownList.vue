<template>
  <a-dropdown v-bind="$attrs" @popup-visible-change="onVisibleChange">
    <slot />
    <template #content>
      <div
        ref="menuRef"
        class="bl-dropdown-list"
        tabindex="0"
        @keydown="onKeyDown"
      >
        <slot name="content" />
      </div>
    </template>
  </a-dropdown>
</template>

<script setup lang="ts">
import { ref, provide, onMounted, nextTick } from 'vue';

const menuRef = ref<HTMLElement | null>(null);
const selectedIndex = ref(-1);
const itemRefs = ref<HTMLElement[]>([]);

const registerItem = (el: HTMLElement) => {
  if (!itemRefs.value.includes(el)) {
    itemRefs.value.push(el);
  }
};

const unregisterItem = (el: HTMLElement) => {
  const index = itemRefs.value.indexOf(el);
  if (index > -1) {
    itemRefs.value.splice(index, 1);
  }
};

provide('bl-dropdown-list', {
  registerItem,
  unregisterItem,
  selectedIndex,
});

const onVisibleChange = (visible: boolean) => {
  if (visible) {
    nextTick(() => {
      menuRef.value?.focus();
      selectedIndex.value = -1;
      itemRefs.value = [];
    });
  }
};

const onKeyDown = (e: KeyboardEvent) => {
  const enabledItems = itemRefs.value.filter((el) => !el.classList.contains('bl-dropdown-list-item--disabled'));
  
  if (enabledItems.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % enabledItems.length;
    enabledItems[selectedIndex.value]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = selectedIndex.value <= 0 ? enabledItems.length - 1 : selectedIndex.value - 1;
    enabledItems[selectedIndex.value]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedIndex.value >= 0) {
      enabledItems[selectedIndex.value]?.click();
    }
  }
};
</script>

<style lang="less">
.bl-dropdown-list {
  outline: none;
  max-height: 200px;
  overflow-y: auto;
}
</style>
