<template>
  <div class="env-form">
    <div class="env-form__list">
      <div v-for="(value, key) in editableEnv" :key="key" class="env-form__row">
        <a-input
          v-model="editableEnv[key].field"
          :disabled="!isEditing"
          :placeholder="i18nHelper.common.envForm.fieldPlaceholder"
          class="env-form__field-input"
        />
        <a-input
          v-model="editableEnv[key].value"
          :disabled="!isEditing"
          :placeholder="i18nHelper.common.envForm.valuePlaceholder"
          class="env-form__value-input"
        />
        <a-button
          v-if="isEditing"
          type="text"
          status="danger"
          @click="removeRow(key)"
        >
          <icon-delete />
        </a-button>
      </div>
    </div>

    <div class="env-form__footer">
      <div class="env-form__footer-left">
        <a-button v-if="!isEditing" type="primary" @click="startEdit">
          {{ i18nHelper.common.envForm.edit }}
        </a-button>
        <a-button v-if="isEditing" @click="addRow">
          {{ i18nHelper.common.envForm.addVariable }}
        </a-button>
      </div>
      <div v-if="isEditing" class="env-form__footer-right">
        <a-button @click="cancelEdit">
          {{ i18nHelper.common.cancel }}
        </a-button>
        <a-button type="primary" @click="saveEdit">
          {{ i18nHelper.common.confirm }}
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { IconDelete } from '@arco-design/web-vue/es/icon';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

interface Props {
  modelValue: Record<string, string>;
}

interface Emits {
  (e: 'update:modelValue', value: Record<string, string>): void;
  (e: 'save', value: Record<string, string>): void;
  (e: 'cancel'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

interface EnvRow {
  field: string;
  value: string;
}

const isEditing = ref(false);
const editableEnv = ref<Record<string, EnvRow>>({});
const originalEnv = ref<Record<string, string>>({});

const initEditableEnv = (env: Record<string, string>): void => {
  editableEnv.value = {};
  for (const [key, value] of Object.entries(env)) {
    editableEnv.value[key] = { field: key, value };
  }
};

watch(() => props.modelValue, (newVal) => {
  if (!isEditing.value) {
    initEditableEnv(newVal);
  }
}, { immediate: true, deep: true });

const startEdit = (): void => {
  isEditing.value = true;
  originalEnv.value = { ...props.modelValue };
};

const addRow = (): void => {
  const newKey = `new_${Date.now()}`;
  editableEnv.value[newKey] = { field: '', value: '' };
};

const removeRow = (key: string): void => {
  delete editableEnv.value[key];
};

const cancelEdit = (): void => {
  isEditing.value = false;
  initEditableEnv(originalEnv.value);
  emit('cancel');
};

const saveEdit = (): void => {
  const result: Record<string, string> = {};
  for (const row of Object.values(editableEnv.value)) {
    if (row.field.trim()) {
      result[row.field.trim()] = row.value;
    }
  }
  isEditing.value = false;
  emit('update:modelValue', result);
  emit('save', result);
};
</script>

<style scoped>
@import './EnvForm.less';
</style>
