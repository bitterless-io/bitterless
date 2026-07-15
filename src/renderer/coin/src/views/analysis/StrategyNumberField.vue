<template>
  <label class="coin-strategy-field">
    <span>{{ label }}</span>
    <a-input-number
      :model-value="modelValue ?? undefined"
      size="small"
      :min="min"
      :max="max"
      :step="step"
      :precision="precision"
      :disabled="disabled"
      hide-button
      @update:model-value="updateValue"
      @change="$emit('change')"
    >
      <template v-if="suffix" #suffix>{{ suffix }}</template>
    </a-input-number>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: number | null;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: number | null): void;
  (event: 'change'): void;
}>();

const updateValue = (value: number | undefined): void => {
  emit('update:modelValue', typeof value === 'number' && Number.isFinite(value) ? value : null);
};
</script>
