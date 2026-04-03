<template>
  <div
    ref="itemRef"
    :class="[
      'bl-dropdown-list-item',
      {
        'bl-dropdown-list-item--disabled': disabled,
        'bl-dropdown-list-item--selected': isSelected,
      },
    ]"
    :style="{ height: height }"
    @click="handleClick"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, inject, onMounted, onUnmounted, computed, type Ref } from 'vue';

interface Props {
  itemKey?: string | number | null;
  disabled?: boolean;
  height?: string;
}

const props = withDefaults(defineProps<Props>(), {
  itemKey: null,
  disabled: false,
  height: '40px',
});

const emit = defineEmits<{
  click: [key: string | number | null];
}>();

const itemRef = ref<HTMLElement | null>(null);

const context = inject<{
  registerItem: (el: HTMLElement) => void;
  unregisterItem: (el: HTMLElement) => void;
  selectedIndex: Ref<number>;
}>('bl-dropdown-list');

const isSelected = computed(() => {
  if (!context || !itemRef.value) return false;
  const enabledItems = Array.from(itemRef.value.parentElement?.querySelectorAll('.bl-dropdown-list-item:not(.bl-dropdown-list-item--disabled)') || []);
  const index = enabledItems.indexOf(itemRef.value);
  return index === context.selectedIndex.value;
});

const handleClick = () => {
  if (props.disabled) return;
  emit('click', props.itemKey);
};

onMounted(() => {
  if (itemRef.value && context) {
    context.registerItem(itemRef.value);
  }
});

onUnmounted(() => {
  if (itemRef.value && context) {
    context.unregisterItem(itemRef.value);
  }
});
</script>

<style lang="less">
.bl-dropdown-list-item {
  padding: 4px;
  cursor: pointer;
  width: 100%;
  display: flex;
  align-items: center;
  transition: background-color 0.2s;

  &:hover:not(&--disabled) {
    background-color: oklch(67.3% 0.182 276.935);
  }

  &--selected:not(&--disabled) {
    background-color: oklch(51.1% 0.262 276.966);
  }

  &--disabled {
    color: oklch(70.4% 0.04 256.788);
    cursor: not-allowed;
  }
}
</style>
