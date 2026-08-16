<template>
  <div name="trench__sniping__generated-form" class="sniping-form">
    <section
      v-for="group in visibleGroups"
      :key="group.id"
      name="trench__sniping__form-group"
      class="sniping-form__group"
    >
      <header class="sniping-form__group-title">{{ group.label }}</header>
      <div class="sniping-form__grid">
        <label
          v-for="field in fieldsFor(group.id)"
          :key="field.key"
          name="trench__sniping__form-field"
          class="sniping-form__field"
          :class="{ 'sniping-form__field--wide': field.type === 'string-array' }"
        >
          <span class="sniping-form__label">
            {{ field.label }}
            <small v-if="field.unit">{{ field.unit }}</small>
          </span>
          <a-select
            v-if="field.enumValues"
            :model-value="fieldValue(field.key)"
            :disabled="disabled || field.readOnly || field.derived"
            size="small"
            @change="updateEnumerated(field, $event)"
          >
            <a-option v-for="option in field.enumValues" :key="String(option)" :value="option">
              {{ option }}
            </a-option>
          </a-select>
          <a-input-number
            v-else-if="field.type === 'integer'"
            :model-value="numberValue(field.key)"
            :min="field.minimum"
            :max="field.maximum"
            :disabled="disabled || field.readOnly || field.derived"
            size="small"
            hide-button
            @update:model-value="updateInteger(field.key, $event)"
          />
          <a-switch
            v-else-if="field.type === 'boolean'"
            :model-value="booleanValue(field.key)"
            :disabled="disabled || field.readOnly || field.derived"
            size="small"
            @change="updateBoolean(field.key, $event)"
          />
          <a-input
            v-else-if="field.type === 'string'"
            :model-value="stringValue(field.key)"
            :disabled="disabled || field.readOnly || field.derived"
            size="small"
            @update:model-value="updateString(field.key, $event)"
          />
          <a-textarea
            v-else
            :model-value="arrayValue(field.key)"
            :disabled="disabled || field.readOnly || field.derived"
            :auto-size="{ minRows: 2, maxRows: 4 }"
            @update:model-value="updateArray(field.key, $event)"
          />
          <span v-if="issueFor(field.key)" class="sniping-form__issue" role="alert">
            {{ issueFor(field.key) }}
          </span>
        </label>
      </div>
    </section>

    <div v-if="derivedFields.length" name="trench__sniping__derived-fields" class="sniping-form__derived">
      <span class="sniping-form__group-title">{{ t('trench.sniping.derived') }}</span>
      <dl>
        <div v-for="field in derivedFields" :key="field.key">
          <dt>{{ field.label }}</dt>
          <dd>{{ storedValue(field.key) }} <small v-if="field.unit">{{ field.unit }}</small></dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SnipingJsonObject, SnipingJsonValue } from '@shared/sniping/snipingBridge.type';
import type {
  SnipingCompiledForm,
  SnipingDraftIssue,
  SnipingFormField,
} from '../../views/sniping/snipingSchema.service';

const props = defineProps<{
  form: SnipingCompiledForm;
  value: SnipingJsonObject;
  storedValueSource: SnipingJsonObject;
  issues: SnipingDraftIssue[];
  disabled: boolean;
  derivedPending: boolean;
}>();
const emit = defineEmits<{ change: [key: string, value: SnipingJsonValue] }>();
const { t } = useI18n();

const visibleFields = computed(() => props.form.fields.filter((field) => !field.advancedOnly && !field.derived));
const derivedFields = computed(() => props.form.fields.filter((field) => field.derived));
const visibleGroups = computed(() => props.form.groups.filter((group) =>
  visibleFields.value.some((field) => field.group === group.id)));
const fieldsFor = (groupId: string): SnipingFormField[] =>
  visibleFields.value.filter((field) => field.group === groupId);
const issueFor = (key: string): string => {
  const issue = props.issues.find((item) => item.path === `/${key}`);
  return issue ? `${issue.path} · ${issue.keyword}` : '';
};
const stringValue = (key: string): string => typeof props.value[key] === 'string'
  ? String(props.value[key])
  : '';
const numberValue = (key: string): number | undefined => typeof props.value[key] === 'number'
  ? Number(props.value[key])
  : undefined;
const booleanValue = (key: string): boolean => props.value[key] === true;
const fieldValue = (key: string): SnipingJsonValue | undefined => props.value[key];
const arrayValue = (key: string): string => Array.isArray(props.value[key])
  ? (props.value[key] as SnipingJsonValue[]).join('\n')
  : '';
const storedValue = (key: string): string => {
  if (props.derivedPending) return t('trench.sniping.configuration.derivedPending');
  const value = props.storedValueSource[key];
  return value === undefined || value === null ? '—' : Array.isArray(value) ? value.join(', ') : String(value);
};
const updateString = (key: string, value: unknown): void => emit('change', key, String(value ?? ''));
const updateEnumerated = (field: SnipingFormField, value: unknown): void => {
  const option = field.enumValues?.find((candidate) => Object.is(candidate, value));
  if (option !== undefined) emit('change', field.key, option);
};
const updateInteger = (key: string, value: unknown): void => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) emit('change', key, value);
};
const updateBoolean = (key: string, value: unknown): void => emit('change', key, value === true);
const updateArray = (key: string, value: unknown): void => emit(
  'change',
  key,
  String(value ?? '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean),
);
</script>

<style lang="less">
@import './SnipingGeneratedConfigForm.less';
</style>
