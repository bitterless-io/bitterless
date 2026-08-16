import type { SnipingJsonObject, SnipingJsonValue } from '@shared/sniping/snipingBridge.type';

export type SnipingFormFieldType = 'string' | 'integer' | 'boolean' | 'string-array';

export interface SnipingFormGroup {
  id: string;
  label: string;
  order: number;
}

export interface SnipingFormField {
  key: string;
  label: string;
  group: string;
  order: number;
  unit: string | null;
  type: SnipingFormFieldType;
  required: boolean;
  derived: boolean;
  readOnly: boolean;
  advancedOnly: boolean;
  constValue?: SnipingJsonValue;
  enumValues?: SnipingJsonValue[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  itemMinLength?: number;
  itemMaxLength?: number;
  itemPattern?: string;
}

export interface SnipingCompiledForm {
  supported: boolean;
  safeAdvanced: boolean;
  groups: SnipingFormGroup[];
  fields: SnipingFormField[];
  derivedKeys: string[];
  readOnlyKeys: string[];
}

export interface SnipingDraftIssue {
  path: string;
  keyword: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const finiteInteger = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) ? Number(value) : undefined;

const ROOT_SCHEMA_KEYS = new Set(['$schema', 'type', 'properties', 'required', 'unevaluatedProperties']);
const FIELD_SCHEMA_KEYS = new Set([
  'type', 'const', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern',
  'minItems', 'maxItems', 'uniqueItems', 'items',
]);
const ITEM_SCHEMA_KEYS = new Set(['type', 'minLength', 'maxLength', 'pattern']);
const EMPTY_FORM: SnipingCompiledForm = {
  supported: false,
  safeAdvanced: false,
  groups: [],
  fields: [],
  derivedKeys: [],
  readOnlyKeys: [],
};

interface SnipingVerifiedUiOwnership {
  derivedKeys: string[];
  readOnlyKeys: string[];
}

const verifiedUiOwnership = (
  ui: Record<string, unknown> | null,
  properties: Record<string, unknown> | null,
): SnipingVerifiedUiOwnership | null => {
  if (ui && Object.keys(ui).length === 0) return { derivedKeys: [], readOnlyKeys: [] };
  const fields = record(ui?.fields);
  if (
    !ui || !properties || !fields || !exactKeys(ui, ['schema', 'groups', 'fields']) ||
    ui.schema !== 'bl-sniping-ui-hints-v1' || !Array.isArray(ui.groups) ||
    ui.groups.length < 1 || ui.groups.length > 16
  ) return null;
  const groups = ui.groups.map(record);
  if (groups.some((group) => !group || !exactKeys(group, ['id', 'label', 'order']) ||
    typeof group.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(group.id) ||
    typeof group.label !== 'string' || group.label.length < 1 || group.label.length > 64 ||
    !Number.isSafeInteger(group.order) || Number(group.order) < 0 || Number(group.order) > 1_000)) return null;
  const groupIds = groups.map((group) => String(group?.id));
  const groupOrders = groups.map((group) => Number(group?.order));
  if (new Set(groupIds).size !== groupIds.length || new Set(groupOrders).size !== groupOrders.length) return null;
  const derivedKeys: string[] = [];
  const readOnlyKeys: string[] = [];
  const fieldOrders = new Set<string>();
  for (const [key, raw] of Object.entries(fields)) {
    const hint = record(raw);
    if (
      !Object.hasOwn(properties, key) || !hint ||
      !exactKeys(hint, ['group', 'label', 'order', 'unit', 'derived', 'read_only', 'advanced_only']) ||
      typeof hint.group !== 'string' || !groupIds.includes(hint.group) ||
      typeof hint.label !== 'string' || hint.label.length < 1 || hint.label.length > 64 ||
      !Number.isSafeInteger(hint.order) || Number(hint.order) < 0 || Number(hint.order) > 1_000 ||
      (hint.unit !== null && (typeof hint.unit !== 'string' || hint.unit.length < 1 || hint.unit.length > 32)) ||
      typeof hint.derived !== 'boolean' || typeof hint.read_only !== 'boolean' ||
      typeof hint.advanced_only !== 'boolean' || (hint.derived && !hint.read_only) ||
      fieldOrders.has(`${hint.group}:${hint.order}`)
    ) return null;
    fieldOrders.add(`${hint.group}:${hint.order}`);
    if (hint.derived) derivedKeys.push(key);
    else if (hint.read_only) readOnlyKeys.push(key);
  }
  return { derivedKeys: derivedKeys.sort(), readOnlyKeys: readOnlyKeys.sort() };
};

const primitiveMatches = (type: SnipingFormFieldType, value: unknown): boolean => {
  if (type === 'string' || type === 'string-array') return typeof value === 'string';
  if (type === 'integer') return Number.isSafeInteger(value);
  return typeof value === 'boolean';
};

const boundedPattern = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 256) return false;
  try { new RegExp(value); return true; } catch { return false; }
};

const validBounds = (
  minimum: unknown,
  maximum: unknown,
  required: boolean,
): boolean => {
  if (!required && minimum === undefined && maximum === undefined) return true;
  if (minimum !== undefined && finiteInteger(minimum) === undefined) return false;
  if (maximum !== undefined && finiteInteger(maximum) === undefined) return false;
  return minimum === undefined || maximum === undefined || Number(minimum) <= Number(maximum);
};

const fieldType = (schema: Record<string, unknown>): SnipingFormFieldType | null => {
  if (schema.type === 'string') return 'string';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type !== 'array') return null;
  const items = record(schema.items);
  return items?.type === 'string' ? 'string-array' : null;
};

const compileField = (
  key: string,
  schema: Record<string, unknown>,
  hint: Record<string, unknown>,
  required: Set<string>,
  groupIds: Set<string>,
): SnipingFormField | null => {
  if (Object.keys(schema).some((schemaKey) => !FIELD_SCHEMA_KEYS.has(schemaKey))) return null;
  if (!exactKeys(hint, [
    'group', 'label', 'order', 'unit', 'derived', 'read_only', 'advanced_only',
  ])) return null;
  const type = fieldType(schema);
  if (
    !type || typeof hint.group !== 'string' || !groupIds.has(hint.group) ||
    typeof hint.label !== 'string' || hint.label.length < 1 || hint.label.length > 64 ||
    !Number.isSafeInteger(hint.order) || Number(hint.order) < 0 || Number(hint.order) > 1_000 ||
    (hint.unit !== null && (typeof hint.unit !== 'string' || hint.unit.length < 1 || hint.unit.length > 32)) ||
    typeof hint.derived !== 'boolean' || typeof hint.read_only !== 'boolean' ||
    typeof hint.advanced_only !== 'boolean' || (hint.derived === true && hint.read_only !== true)
  ) return null;
  if (schema.pattern !== undefined && !boundedPattern(schema.pattern)) return null;
  if (
    !validBounds(schema.minimum, schema.maximum, type === 'integer' && schema.const === undefined && schema.enum === undefined) ||
    !validBounds(schema.minLength, schema.maxLength, type === 'string' && schema.const === undefined && schema.enum === undefined) ||
    !validBounds(schema.minItems, schema.maxItems, type === 'string-array')
  ) return null;
  if (schema.const !== undefined && schema.enum !== undefined) return null;
  if (schema.const !== undefined && !primitiveMatches(type, schema.const)) return null;
  let enumValues: SnipingJsonValue[] | undefined;
  if (schema.enum !== undefined) {
    if (
      !Array.isArray(schema.enum) || schema.enum.length < 1 || schema.enum.length > 256 ||
      schema.enum.some((value) => !primitiveMatches(type, value)) ||
      new Set(schema.enum.map((value) => JSON.stringify(value))).size !== schema.enum.length
    ) return null;
    enumValues = schema.enum as SnipingJsonValue[];
  }
  if (type === 'string-array') {
    const items = record(schema.items);
    if (
      !items || Object.keys(items).some((schemaKey) => !ITEM_SCHEMA_KEYS.has(schemaKey)) ||
      items.type !== 'string' || schema.uniqueItems !== true ||
      !validBounds(items.minLength, items.maxLength, true) ||
      (items.pattern !== undefined && !boundedPattern(items.pattern))
    ) return null;
  }
  const items = type === 'string-array' ? record(schema.items) : null;
  return {
    key,
    label: hint.label,
    group: hint.group,
    order: Number(hint.order),
    unit: hint.unit as string | null,
    type,
    required: required.has(key),
    derived: hint.derived,
    readOnly: hint.read_only || schema.const !== undefined,
    advancedOnly: hint.advanced_only,
    ...(schema.const === undefined ? {} : { constValue: schema.const as SnipingJsonValue }),
    ...(enumValues ? { enumValues } : {}),
    ...(finiteInteger(schema.minimum) === undefined ? {} : { minimum: Number(schema.minimum) }),
    ...(finiteInteger(schema.maximum) === undefined ? {} : { maximum: Number(schema.maximum) }),
    ...(finiteInteger(schema.minLength) === undefined ? {} : { minLength: Number(schema.minLength) }),
    ...(finiteInteger(schema.maxLength) === undefined ? {} : { maxLength: Number(schema.maxLength) }),
    ...(typeof schema.pattern === 'string' ? { pattern: schema.pattern } : {}),
    ...(finiteInteger(schema.minItems) === undefined ? {} : { minItems: Number(schema.minItems) }),
    ...(finiteInteger(schema.maxItems) === undefined ? {} : { maxItems: Number(schema.maxItems) }),
    ...(finiteInteger(items?.minLength) === undefined ? {} : { itemMinLength: Number(items?.minLength) }),
    ...(finiteInteger(items?.maxLength) === undefined ? {} : { itemMaxLength: Number(items?.maxLength) }),
    ...(typeof items?.pattern === 'string' ? { itemPattern: items.pattern } : {}),
  };
};

export const compileSnipingForm = (
  configSchema: SnipingJsonObject,
  uiSchema: SnipingJsonObject,
): SnipingCompiledForm => {
  const config = record(configSchema);
  const ui = record(uiSchema);
  const properties = record(config?.properties);
  const fieldsRecord = record(ui?.fields);
  const trustedOwnership = verifiedUiOwnership(ui, properties);
  const fallback = (): SnipingCompiledForm => ({
    ...EMPTY_FORM,
    safeAdvanced: trustedOwnership !== null,
    derivedKeys: trustedOwnership?.derivedKeys ?? [],
    readOnlyKeys: trustedOwnership?.readOnlyKeys ?? [],
  });
  if (
    !config || !ui || !properties || config.type !== 'object' ||
    config.unevaluatedProperties !== false || ui.schema !== 'bl-sniping-ui-hints-v1' ||
    Object.keys(config).some((key) => !ROOT_SCHEMA_KEYS.has(key)) ||
    (config.$schema !== undefined && config.$schema !== 'https://json-schema.org/draft/2020-12/schema') ||
    Object.keys(properties).length < 1 || Object.keys(properties).length > 64 ||
    !Array.isArray(config.required) ||
    config.required.some((key) => typeof key !== 'string' || !Object.hasOwn(properties, key)) ||
    new Set(config.required).size !== config.required.length
  ) return fallback();
  if (Object.keys(ui).length === 0) return fallback();
  if (
    !fieldsRecord || !exactKeys(ui, ['schema', 'groups', 'fields']) || !Array.isArray(ui.groups) ||
    ui.groups.length < 1 || ui.groups.length > 16
  ) return fallback();

  const groups: SnipingFormGroup[] = [];
  for (const raw of ui.groups) {
    const group = record(raw);
    if (
      !group || !exactKeys(group, ['id', 'label', 'order']) ||
      typeof group.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(group.id) ||
      typeof group.label !== 'string' || group.label.length < 1 || group.label.length > 64 ||
      !Number.isSafeInteger(group.order) || Number(group.order) < 0 || Number(group.order) > 1_000
    ) return fallback();
    groups.push({ id: group.id, label: group.label, order: Number(group.order) });
  }
  if (
    new Set(groups.map((group) => group.id)).size !== groups.length ||
    new Set(groups.map((group) => group.order)).size !== groups.length
  ) {
    return fallback();
  }
  const required = new Set(config.required as string[]);
  const groupIds = new Set(groups.map((group) => group.id));
  const fields: SnipingFormField[] = [];
  const fieldOrders = new Set<string>();
  for (const [key, rawHint] of Object.entries(fieldsRecord)) {
    const schema = record(properties[key]);
    const hint = record(rawHint);
    if (!schema || !hint) return fallback();
    const field = compileField(key, schema, hint, required, groupIds);
    if (!field || fieldOrders.has(`${field.group}:${field.order}`)) {
      return fallback();
    }
    fieldOrders.add(`${field.group}:${field.order}`);
    fields.push(field);
  }
  groups.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  fields.sort((left, right) => {
    const groupOrder = groups.findIndex((group) => group.id === left.group) -
      groups.findIndex((group) => group.id === right.group);
    return groupOrder || left.order - right.order || left.key.localeCompare(right.key);
  });
  if (!fields.some((field) => !field.advancedOnly && !field.derived)) {
    return fallback();
  }
  return {
    supported: true,
    safeAdvanced: true,
    groups,
    fields,
    derivedKeys: fields.filter((field) => field.derived).map((field) => field.key),
    readOnlyKeys: fields.filter((field) => field.readOnly && !field.derived).map((field) => field.key),
  };
};

export const stripDerivedSnipingConfig = (
  value: SnipingJsonObject,
  form: SnipingCompiledForm,
): SnipingJsonObject => {
  const next = structuredClone(value);
  for (const key of form.derivedKeys) delete next[key];
  return next;
};

export const validateSnipingDraft = (
  form: SnipingCompiledForm,
  value: SnipingJsonObject,
): SnipingDraftIssue[] => {
  if (!form.supported) return [];
  const issues: SnipingDraftIssue[] = [];
  for (const field of form.fields) {
    if (field.derived) continue;
    const current = value[field.key];
    if (current === undefined) {
      if (field.required) issues.push({ path: `/${field.key}`, keyword: 'required' });
      continue;
    }
    let valid = true;
    if (field.constValue !== undefined) valid = current === field.constValue;
    else if (field.enumValues) valid = field.enumValues.some((item) => item === current);
    else if (field.type === 'string') {
      valid = typeof current === 'string' &&
        (field.minLength === undefined || current.length >= field.minLength) &&
        (field.maxLength === undefined || current.length <= field.maxLength) &&
        (field.pattern === undefined || new RegExp(field.pattern).test(current));
    } else if (field.type === 'integer') {
      valid = Number.isSafeInteger(current) &&
        (field.minimum === undefined || Number(current) >= field.minimum) &&
        (field.maximum === undefined || Number(current) <= field.maximum);
    } else if (field.type === 'boolean') valid = typeof current === 'boolean';
    else {
      valid = Array.isArray(current) && current.every((item) => typeof item === 'string') &&
        (field.minItems === undefined || current.length >= field.minItems) &&
        (field.maxItems === undefined || current.length <= field.maxItems) &&
        current.every((item) => typeof item !== 'string' || (
          (field.itemMinLength === undefined || item.length >= field.itemMinLength) &&
          (field.itemMaxLength === undefined || item.length <= field.itemMaxLength) &&
          (field.itemPattern === undefined || new RegExp(field.itemPattern).test(item))
        )) &&
        new Set(current).size === current.length;
    }
    if (!valid) issues.push({ path: `/${field.key}`, keyword: field.constValue === undefined ? 'type' : 'const' });
  }
  return issues.slice(0, 20);
};
