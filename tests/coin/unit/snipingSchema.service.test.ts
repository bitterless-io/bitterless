import assert from 'node:assert/strict';
import test from 'node:test';
import type { SnipingJsonObject } from '../../../src/shared/sniping/snipingBridge.type';
import { SnipingDraftController } from '../../../src/renderer/coin/src/views/sniping/snipingDraft.service';
import {
  compileSnipingForm,
  stripDerivedSnipingConfig,
  validateSnipingDraft,
} from '../../../src/renderer/coin/src/views/sniping/snipingSchema.service';

const FLAP_SCHEMA: SnipingJsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    chain_id: { type: 'integer', const: 56 },
    quote_token_address: {
      type: 'string', minLength: 42, maxLength: 42, pattern: '^0x[0-9a-f]{40}$',
    },
    quote_token_label: { type: 'string', maxLength: 32 },
    spend_amount_decimal: {
      type: 'string', minLength: 1, maxLength: 78,
      pattern: '^(0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
    },
    declared_quote_token_decimals: { type: 'integer', minimum: 0, maximum: 36 },
    spend_amount_atomic: {
      type: 'string', minLength: 1, maxLength: 78, pattern: '^(0|[1-9][0-9]*)$',
    },
    max_slippage_bps: { type: 'integer', minimum: 0, maximum: 5000 },
    max_gas_units: { type: 'string', minLength: 1, maxLength: 8, pattern: '^[1-9][0-9]*$' },
    max_gas_cost_wei: {
      type: 'string', minLength: 1, maxLength: 78, pattern: '^[1-9][0-9]*$',
    },
    provider_reference_ids: {
      type: 'array', minItems: 1, maxItems: 4, uniqueItems: true,
      items: {
        type: 'string', minLength: 1, maxLength: 64,
        pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
      },
    },
    finality_mode: { type: 'string', const: 'finalized' },
    backfill_chunk_blocks: { type: 'integer', minimum: 1, maximum: 2000 },
    max_backfill_blocks: { type: 'integer', minimum: 512, maximum: 50000 },
    reorg_lookback_blocks: { type: 'integer', minimum: 1, maximum: 512 },
    poll_interval_ms: { type: 'integer', minimum: 1000, maximum: 60000 },
    receipt_timeout_ms: { type: 'integer', minimum: 1000, maximum: 30000 },
    state_read_timeout_ms: { type: 'integer', minimum: 1000, maximum: 30000 },
    max_events_per_minute: { type: 'integer', minimum: 1, maximum: 10000 },
  },
  required: [
    'chain_id', 'quote_token_address', 'quote_token_label', 'spend_amount_decimal',
    'declared_quote_token_decimals', 'max_slippage_bps', 'max_gas_units',
    'max_gas_cost_wei', 'provider_reference_ids', 'finality_mode', 'backfill_chunk_blocks',
    'max_backfill_blocks', 'reorg_lookback_blocks', 'poll_interval_ms',
    'receipt_timeout_ms', 'state_read_timeout_ms', 'max_events_per_minute',
  ],
  unevaluatedProperties: false,
};

const hint = (
  group: string,
  label: string,
  order: number,
  options: { unit?: string | null; derived?: boolean; readOnly?: boolean; advanced?: boolean } = {},
): SnipingJsonObject => ({
  group,
  label,
  order,
  unit: options.unit ?? null,
  derived: options.derived ?? false,
  read_only: options.readOnly ?? false,
  advanced_only: options.advanced ?? false,
});

const FLAP_UI: SnipingJsonObject = {
  schema: 'bl-sniping-ui-hints-v1',
  groups: [
    { id: 'target', label: 'Target and spend', order: 10 },
    { id: 'risk', label: 'Simulation limits', order: 20 },
    { id: 'runtime', label: 'Advanced observation', order: 30 },
  ],
  fields: {
    quote_token_address: hint('target', 'Quote token address', 10),
    quote_token_label: hint('target', 'Display label', 20),
    spend_amount_decimal: hint('target', 'Simulation spend', 30, { unit: 'quote token' }),
    declared_quote_token_decimals: hint('target', 'Declared decimals', 40, { unit: 'decimals' }),
    spend_amount_atomic: hint('target', 'Derived atomic spend', 50, {
      unit: 'quote-token atomic', derived: true, readOnly: true,
    }),
    max_slippage_bps: hint('risk', 'Maximum slippage', 10, { unit: 'bps' }),
    max_gas_units: hint('risk', 'Maximum gas units', 20, { unit: 'gas' }),
    max_gas_cost_wei: hint('risk', 'Native gas coverage', 30, { unit: 'wei' }),
    provider_reference_ids: hint('runtime', 'Provider profiles', 10, { advanced: true }),
    finality_mode: hint('runtime', 'Finality', 20, { readOnly: true, advanced: true }),
  },
};

const FLAP_DEFAULT: SnipingJsonObject = {
  chain_id: 56,
  quote_token_address: '0x0000000000000000000000000000000000000000',
  quote_token_label: 'SPCX',
  spend_amount_decimal: '1',
  declared_quote_token_decimals: 18,
  spend_amount_atomic: '1000000000000000000',
  max_slippage_bps: 500,
  max_gas_units: '500000',
  max_gas_cost_wei: '3000000000000000',
  provider_reference_ids: ['bsc-primary'],
  finality_mode: 'finalized',
  backfill_chunk_blocks: 500,
  max_backfill_blocks: 10000,
  reorg_lookback_blocks: 64,
  poll_interval_ms: 5000,
  receipt_timeout_ms: 10000,
  state_read_timeout_ms: 10000,
  max_events_per_minute: 1000,
};

const clone = <T>(value: T): T => structuredClone(value);
const uiParts = (value: SnipingJsonObject): {
  groups: SnipingJsonObject[];
  fields: Record<string, SnipingJsonObject>;
} => value as unknown as {
  groups: SnipingJsonObject[];
  fields: Record<string, SnipingJsonObject>;
};

test('the current Flap v1 schema compiles into one ordered generic form', () => {
  const form = compileSnipingForm(FLAP_SCHEMA, FLAP_UI);
  assert.equal(form.supported, true);
  assert.deepEqual(form.groups.map((group) => group.id), ['target', 'risk', 'runtime']);
  assert.equal(form.fields.length, 10);
  assert.deepEqual(form.fields.map((field) => field.key), [
    'quote_token_address', 'quote_token_label', 'spend_amount_decimal',
    'declared_quote_token_decimals', 'spend_amount_atomic', 'max_slippage_bps',
    'max_gas_units', 'max_gas_cost_wei', 'provider_reference_ids', 'finality_mode',
  ]);
  assert.deepEqual(form.derivedKeys, ['spend_amount_atomic']);
  assert.deepEqual(form.readOnlyKeys, ['finality_mode']);
  assert.partialDeepStrictEqual(
    form.fields.find((field) => field.key === 'spend_amount_atomic'),
    { derived: true, readOnly: true, unit: 'quote-token atomic' },
  );
  assert.deepEqual(validateSnipingDraft(form, stripDerivedSnipingConfig(FLAP_DEFAULT, form)), []);
});

test('generated fields and Advanced JSON mutate one canonical draft and never submit derived values', () => {
  const form = compileSnipingForm(FLAP_SCHEMA, FLAP_UI);
  const draft = new SnipingDraftController();
  const reset = draft.reset(FLAP_DEFAULT, form);
  assert.equal('spend_amount_atomic' in reset.value, false);
  assert.equal(reset.changed, false);

  const structured = draft.setField('quote_token_label', 'GME');
  assert.equal(structured.value.quote_token_label, 'GME');
  assert.equal(JSON.parse(structured.json).quote_token_label, 'GME');
  assert.equal(structured.changed, true);

  const advanced = draft.setJson(JSON.stringify({
    ...structured.value,
    quote_token_label: 'SPCX',
    spend_amount_atomic: 'must-be-recomputed',
  }));
  assert.equal(advanced.value.quote_token_label, 'SPCX');
  assert.equal('spend_amount_atomic' in advanced.value, false);
  assert.equal('spend_amount_atomic' in draft.payload(), false);
  assert.match(advanced.json, /"quote_token_label": "SPCX"/);

  const invalid = draft.setJson('{');
  assert.equal(invalid.jsonError, 'SNIPING_DRAFT_JSON_INVALID');
  assert.throws(() => draft.payload(), /SNIPING_DRAFT_JSON_INVALID/);
});

test('non-derived read-only fields retain only an existing baseline across every draft path', () => {
  const schema = clone(FLAP_SCHEMA);
  const properties = schema.properties as SnipingJsonObject;
  properties.locked_policy = { type: 'string', minLength: 1, maxLength: 32 };
  (schema.required as string[]).push('locked_policy');
  const ui = clone(FLAP_UI);
  uiParts(ui).fields.locked_policy = hint('risk', 'Locked policy', 40, { readOnly: true });
  const form = compileSnipingForm(schema, ui);
  assert.deepEqual(form.readOnlyKeys, ['locked_policy', 'finality_mode']);

  const draft = new SnipingDraftController();
  draft.reset({ ...FLAP_DEFAULT, locked_policy: 'server' }, form);
  assert.equal(draft.setField('locked_policy', 'renderer').value.locked_policy, 'server');
  const advanced = draft.setJson(JSON.stringify({
    ...draft.snapshot.value,
    locked_policy: 'renderer',
    spend_amount_atomic: 'renderer-derived',
  }));
  assert.equal(advanced.value.locked_policy, 'server');
  assert.equal('spend_amount_atomic' in advanced.value, false);
  assert.equal(draft.payload().locked_policy, 'server');

  const absent = new SnipingDraftController();
  absent.reset(FLAP_DEFAULT, form);
  absent.setField('locked_policy', 'injected');
  absent.setJson(JSON.stringify({ ...absent.snapshot.value, locked_policy: 'injected' }));
  assert.equal('locked_policy' in absent.payload(), false);
});

test('local validation exposes exact JSON pointers for bounded primitive and array failures', () => {
  const form = compileSnipingForm(FLAP_SCHEMA, FLAP_UI);
  const invalid = stripDerivedSnipingConfig(clone(FLAP_DEFAULT), form);
  delete invalid.quote_token_address;
  invalid.declared_quote_token_decimals = 37;
  invalid.provider_reference_ids = ['duplicate', 'duplicate'];
  invalid.finality_mode = 'latest';
  assert.deepEqual(validateSnipingDraft(form, invalid), [
    { path: '/quote_token_address', keyword: 'required' },
    { path: '/declared_quote_token_decimals', keyword: 'type' },
    { path: '/provider_reference_ids', keyword: 'type' },
    { path: '/finality_mode', keyword: 'const' },
  ]);
});

test('enum, const and string-array item constraints stay exact and deterministic', () => {
  const schema = clone(FLAP_SCHEMA);
  const properties = schema.properties as SnipingJsonObject;
  properties.risk_mode = { type: 'string', enum: ['strict', 'balanced'] };
  (schema.required as string[]).push('risk_mode');
  const ui = clone(FLAP_UI);
  uiParts(ui).fields.risk_mode = hint('risk', 'Risk mode', 40);
  const form = compileSnipingForm(schema, ui);
  assert.equal(form.supported, true);
  assert.deepEqual(form.fields.find((field) => field.key === 'risk_mode')?.enumValues, [
    'strict', 'balanced',
  ]);

  const valid = { ...stripDerivedSnipingConfig(FLAP_DEFAULT, form), risk_mode: 'strict' };
  assert.deepEqual(validateSnipingDraft(form, valid), []);
  assert.deepEqual(validateSnipingDraft(form, { ...valid, risk_mode: 'fast' }), [
    { path: '/risk_mode', keyword: 'type' },
  ]);
  assert.deepEqual(validateSnipingDraft(form, { ...valid, finality_mode: 'latest' }), [
    { path: '/finality_mode', keyword: 'const' },
  ]);
  assert.deepEqual(validateSnipingDraft(form, {
    ...valid,
    provider_reference_ids: ['Good', 'good'],
  }), [{ path: '/provider_reference_ids', keyword: 'type' }]);
  assert.deepEqual(validateSnipingDraft(form, {
    ...valid,
    provider_reference_ids: ['good', 'good'],
  }), [{ path: '/provider_reference_ids', keyword: 'type' }]);
});

test('unsupported JSON Schema keywords fail closed instead of rendering an incomplete form', () => {
  for (const mutate of [
    (schema: SnipingJsonObject): void => { schema.oneOf = []; },
    (schema: SnipingJsonObject): void => {
      (schema.properties as SnipingJsonObject).quote_token_address = {
        type: 'string', format: 'evm-address', minLength: 42, maxLength: 42,
      };
    },
    (schema: SnipingJsonObject): void => {
      (schema.properties as SnipingJsonObject).provider_reference_ids = {
        type: 'array', minItems: 1, maxItems: 4, uniqueItems: false,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      };
    },
  ]) {
    const schema = clone(FLAP_SCHEMA);
    mutate(schema);
    assert.equal(compileSnipingForm(schema, FLAP_UI).supported, false);
  }
});

test('UI hint v1 invariants reject drift, ambiguity and writable derived fields', () => {
  const invalidUiSchemas: Array<[SnipingJsonObject, string[]]> = [];
  const extraRoot = clone(FLAP_UI);
  extraRoot.version = 2;
  invalidUiSchemas.push([extraRoot, []]);

  const duplicateGroupOrder = clone(FLAP_UI);
  uiParts(duplicateGroupOrder).groups[1].order = 10;
  invalidUiSchemas.push([duplicateGroupOrder, []]);

  const duplicateFieldOrder = clone(FLAP_UI);
  uiParts(duplicateFieldOrder).fields.quote_token_label.order = 10;
  invalidUiSchemas.push([duplicateFieldOrder, []]);

  const writableDerived = clone(FLAP_UI);
  uiParts(writableDerived).fields.spend_amount_atomic.read_only = false;
  invalidUiSchemas.push([writableDerived, []]);

  const invalidUnit = clone(FLAP_UI);
  uiParts(invalidUnit).fields.max_slippage_bps.unit = '';
  invalidUiSchemas.push([invalidUnit, []]);

  const unknownGroup = clone(FLAP_UI);
  uiParts(unknownGroup).fields.max_slippage_bps.group = 'missing';
  invalidUiSchemas.push([unknownGroup, []]);

  for (const [ui, derivedKeys] of invalidUiSchemas) {
    assert.deepEqual(compileSnipingForm(FLAP_SCHEMA, ui), {
      supported: false, groups: [], fields: [], derivedKeys, readOnlyKeys: [],
      safeAdvanced: false,
    });
  }
});

test('a release with no visible owner-editable hint falls back to Advanced JSON', () => {
  const ui = clone(FLAP_UI);
  for (const field of Object.values(uiParts(ui).fields)) {
    if (field.derived !== true) field.advanced_only = true;
  }
  const form = compileSnipingForm(FLAP_SCHEMA, ui);
  assert.deepEqual(form, {
    supported: false, groups: [], fields: [], derivedKeys: ['spend_amount_atomic'],
    readOnlyKeys: ['finality_mode'],
    safeAdvanced: true,
  });
  const draft = new SnipingDraftController().reset(FLAP_DEFAULT, form);
  assert.equal('spend_amount_atomic' in draft.value, false);
  assert.equal('spend_amount_atomic' in JSON.parse(draft.json), false);

  const unsupportedSchema = clone(FLAP_SCHEMA);
  unsupportedSchema.oneOf = [];
  const unsupportedForm = compileSnipingForm(unsupportedSchema, FLAP_UI);
  assert.deepEqual(unsupportedForm, {
    supported: false, groups: [], fields: [], derivedKeys: ['spend_amount_atomic'],
    readOnlyKeys: ['finality_mode'],
    safeAdvanced: true,
  });
  const unsupportedController = new SnipingDraftController();
  const unsupportedDraft = unsupportedController.reset(FLAP_DEFAULT, unsupportedForm);
  assert.equal('spend_amount_atomic' in unsupportedDraft.value, false);
  assert.equal('spend_amount_atomic' in unsupportedController.payload(), false);
});

test('an exact empty UI schema safely enables Advanced JSON while malformed hints fail closed', () => {
  assert.deepEqual(compileSnipingForm(FLAP_SCHEMA, {}), {
    supported: false,
    safeAdvanced: true,
    groups: [],
    fields: [],
    derivedKeys: [],
    readOnlyKeys: [],
  });
  assert.deepEqual(compileSnipingForm(FLAP_SCHEMA, { schema: 'unknown' }), {
    supported: false,
    safeAdvanced: false,
    groups: [],
    fields: [],
    derivedKeys: [],
    readOnlyKeys: [],
  });
});
