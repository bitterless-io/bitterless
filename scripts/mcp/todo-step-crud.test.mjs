#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMcpSourceHooks } from './fixtures/mcp-source-hooks.mjs';
import { getMcpBridgeEndpoint } from '../../src/shared/mcp/mcpBridge.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..', '..');
const helperFixture = join(scriptDirectory, 'fixtures', 'mcp-production-stdio.fixture.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-todo-step-crud-'));

const TODO_ID = '00000000000000000101';
const OTHER_TODO_ID = '00000000000000000102';
const DOMAIN_ID = '00000000000000000001';
const MISSING_TODO_ID = '00000000000000000999';
const STEP_A_ID = '00000000000000000201';
const STEP_B_ID = '00000000000000000202';
const CREATED_STEP_ID = '00000000000000000203';
const MISSING_STEP_ID = '00000000000000000888';
const FIXED_TIME = 1784764800000;

const createTodo = (overrides = {}) => ({
  id: TODO_ID,
  customer_id: 'customer-1',
  domain_id: DOMAIN_ID,
  title: 'Ship WhatsApp integration',
  status: 0,
  important: 0,
  due_at: FIXED_TIME,
  repeat_type: null,
  repeat_interval: 1,
  remind_at: null,
  last_remind_at: null,
  last_complete_at: null,
  week_day: null,
  monthly_day: null,
  yearly_day: null,
  note: '',
  source: 'ai',
  is_deleted: 0,
  position: 1,
  created_at: FIXED_TIME,
  updated_at: FIXED_TIME,
  ...overrides
});

const createStep = (overrides = {}) => ({
  id: STEP_A_ID,
  customer_id: 'customer-1',
  todo_id: TODO_ID,
  title: 'First Step',
  status: 0,
  is_deleted: 0,
  position: 1,
  created_at: FIXED_TIME + 1,
  updated_at: FIXED_TIME + 1,
  ...overrides
});

const state = {
  todos: new Map([[TODO_ID, createTodo()]]),
  steps: new Map([
    [STEP_A_ID, createStep()],
    [STEP_B_ID, createStep({ id: STEP_B_ID, title: 'Earlier repository Step', position: 0 })]
  ]),
  stepOrder: [STEP_B_ID, STEP_A_ID],
  listOverride: undefined,
  createReturnOverride: undefined,
  persistCreate: true,
  persistUpdate: true,
  persistStatus: true,
  persistDelete: true,
  calls: {
    createStep: [],
    updateStep: [],
    setStatus: [],
    deleteStep: [],
    createTodo: [],
    updateTodo: []
  },
  statusMutations: 0
};

const clone = (value) => value === undefined ? undefined : structuredClone(value);

const getTodoById = async ({ id }) => clone(state.todos.get(id));

const getDomains = async () => [{
  id: DOMAIN_ID,
  customer_id: 'customer-1',
  title: 'MCU',
  description: 'MCU work',
  is_deleted: 0,
  archived: 0,
  position: 0,
  created_at: FIXED_TIME,
  updated_at: FIXED_TIME
}];

const getSubTodosByTodoId = async ({ todoId }) => {
  if (state.listOverride !== undefined) return clone(state.listOverride);
  return state.stepOrder
    .map((id) => state.steps.get(id))
    .filter((step) => step?.todo_id === todoId)
    .map(clone);
};

const getSubTodoById = async ({ id }) => clone(state.steps.get(id));

const createSubTodo = async ({ todoId, title }) => {
  state.calls.createStep.push({ todoId, title });
  const step = createStep({
    id: CREATED_STEP_ID,
    todo_id: todoId,
    title,
    position: state.stepOrder.length,
    created_at: FIXED_TIME + 3,
    updated_at: FIXED_TIME + 3
  });
  if (state.persistCreate) {
    state.steps.set(step.id, step);
    if (!state.stepOrder.includes(step.id)) state.stepOrder.push(step.id);
  }
  return clone(state.createReturnOverride ?? step);
};

const updateSubTodoTitle = async ({ id, title }) => {
  state.calls.updateStep.push({ id, title });
  const step = state.steps.get(id);
  if (step && state.persistUpdate) {
    step.title = title;
    step.updated_at += 1;
  }
};

const setSubTodoStatus = async ({ id, status }) => {
  state.calls.setStatus.push({ id, status });
  const step = state.steps.get(id);
  if (!step) return undefined;
  if (state.persistStatus && step.status !== status) {
    step.status = status;
    step.updated_at += 1;
    state.statusMutations += 1;
  }
  return clone(step);
};

const deleteSubTodo = async ({ id }) => {
  state.calls.deleteStep.push({ id });
  if (!state.persistDelete) return;
  state.steps.delete(id);
  state.stepOrder = state.stepOrder.filter((stepId) => stepId !== id);
};

const createTodoCall = async (params) => {
  state.calls.createTodo.push(params);
  const todo = createTodo({
    id: OTHER_TODO_ID,
    domain_id: params.domainId,
    title: params.title,
    due_at: null,
    remind_at: null
  });
  state.todos.set(todo.id, todo);
  return clone(todo);
};

const updateTodo = async (params) => {
  state.calls.updateTodo.push(params);
  const todo = state.todos.get(params.id);
  if (!todo) return undefined;
  for (const field of ['title', 'due_at', 'remind_at', 'important', 'note']) {
    if (Object.hasOwn(params, field)) todo[field] = params[field];
  }
  return clone(todo);
};

installMcpSourceHooks({
  projectRoot,
  userDataPath: tempDirectory,
  normalizeUndefinedXpcResultsToNull: true,
  todoRepository: {
    createSubTodo,
    createTodo: createTodoCall,
    deleteSubTodo,
    getDomains,
    getSubTodoById,
    getSubTodosByTodoId,
    getTodoById,
    setSubTodoStatus,
    updateSubTodoTitle,
    updateTodo
  }
});

const { McpBridgeServer } = await import('../../src/main/mcp/mcpBridge.server.ts');

class PublicMcpClient {
  constructor(bridgePath) {
    this.child = spawn(process.execPath, [helperFixture, tempDirectory, bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk;
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        assert.ok(pending, `Unexpected MCP response id: ${String(response.id)}`);
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) {
          pending.reject(Object.assign(new Error(response.error.message), response.error));
        } else {
          pending.resolve(response.result);
        }
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 5000);
      this.pending.set(id, { reject, resolve, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }

  async close() {
    this.child.stdin.end();
    let timeout;
    const status = await Promise.race([
      new Promise((resolve) => {
        this.child.once('exit', (code, signal) => resolve({ code, signal }));
      }),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), 3000);
      })
    ]);
    clearTimeout(timeout);
    if (!status) this.child.kill('SIGKILL');
    assert.deepEqual(status, { code: 0, signal: null }, this.stderr);
  }
}

const assertEnvelope = (result, toolName, verb = 'succeeded') => {
  assert.deepEqual(result.content, [
    { type: 'text', text: `Bitterless ${toolName} ${verb}.` }
  ]);
  assert.ok(Object.hasOwn(result, 'structuredContent'));
  return result.structuredContent;
};

const assertStepFields = (step) => {
  assert.deepEqual(Object.keys(step).sort(), [
    'created_at',
    'customer_id',
    'id',
    'is_deleted',
    'position',
    'status',
    'title',
    'todo_id',
    'updated_at'
  ]);
  assert.match(step.id, /^\d{20}$/);
  assert.match(step.todo_id, /^\d{20}$/);
  assert.equal(step.customer_id, 'customer-1');
  assert.equal(step.is_deleted, 0);
};

const server = new McpBridgeServer();
const endpoint = getMcpBridgeEndpoint(tempDirectory);
const client = new PublicMcpClient(endpoint.path);

try {
  await server.start(endpoint);
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'todo-step-crud-contract-test', version: '0.1.0' }
  });

  const listed = await client.request('tools/list', {});
  const toolsByName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  const idSchema = { type: 'string', pattern: '^\\d{20}$' };
  const expectedStepSchemas = {
    'step.list': {
      type: 'object',
      required: ['todoId'],
      properties: { todoId: idSchema },
      additionalProperties: false
    },
    'step.create': {
      type: 'object',
      required: ['todoId', 'title'],
      properties: {
        todoId: idSchema,
        title: { type: 'string', minLength: 1, maxLength: 200 }
      },
      additionalProperties: false
    },
    'step.update': {
      type: 'object',
      required: ['id', 'title'],
      properties: {
        id: idSchema,
        title: { type: 'string', minLength: 1, maxLength: 200 }
      },
      additionalProperties: false
    },
    'step.complete': {
      type: 'object',
      required: ['id'],
      properties: { id: idSchema },
      additionalProperties: false
    },
    'step.uncomplete': {
      type: 'object',
      required: ['id'],
      properties: { id: idSchema },
      additionalProperties: false
    },
    'step.delete': {
      type: 'object',
      required: ['id'],
      properties: { id: idSchema },
      additionalProperties: false
    }
  };
  for (const [name, schema] of Object.entries(expectedStepSchemas)) {
    assert.deepEqual(toolsByName.get(name)?.inputSchema, schema, `${name} schema`);
  }
  assert.match(toolsByName.get('step.complete').description, /Idempotently/);
  assert.match(toolsByName.get('step.uncomplete').description, /Idempotently/);

  const domainListMetadata = toolsByName.get('domain.list');
  assert.match(domainListMetadata.description, /Focus\/star policy/);
  assert.match(domainListMetadata.description, /explicit priority intent/);
  assert.match(domainListMetadata.description, /unstar intent/);
  assert.match(domainListMetadata.description, /live-session blockers/);
  assert.match(domainListMetadata.description, /preserve-on-omission/);

  const createMetadata = toolsByName.get('todo.create');
  const createImportantMetadata = createMetadata.inputSchema.properties.important;
  assert.match(createMetadata.description, /star\/星标/);
  assert.match(createMetadata.description, /important\/重点/);
  assert.match(createMetadata.description, /priority\/优先/);
  assert.match(createMetadata.description, /Focus/);
  assert.match(createMetadata.description, /important=true/);
  assert.match(createMetadata.description, /blocking the current agent session/);
  assert.match(createMetadata.description, /due date, reminder, or ordinary backlog item alone/);
  assert.match(createImportantMetadata.description, /explicit star\/important\/priority\/Focus-placement intent/);

  const updateMetadata = toolsByName.get('todo.update');
  const updateImportantMetadata = updateMetadata.inputSchema.properties.important;
  assert.match(updateMetadata.description, /important=true/);
  assert.match(updateMetadata.description, /unstar\/取消星标/);
  assert.match(updateMetadata.description, /remove from Focus/);
  assert.match(updateMetadata.description, /important=false/);
  assert.match(updateMetadata.description, /blocking the current agent session/);
  assert.match(updateMetadata.description, /unrelated edit alone must not change the star/);
  assert.match(updateMetadata.description, /omit important to preserve its current state/);
  assert.match(updateImportantMetadata.description, /true stars\/adds to Focus/);
  assert.match(updateImportantMetadata.description, /false unstars\/removes from Focus/);
  assert.match(updateImportantMetadata.description, /omit this field to preserve the current state/);

  const domainList = assertEnvelope(
    await client.callTool('domain.list', {}),
    'domain.list',
    'completed'
  );
  assert.match(domainList.focus.description, /important=true/);
  assert.match(domainList.focus.description, /important=false/);
  assert.match(domainList.focus.rule, /explicit priority intent/);
  assert.match(domainList.focus.rule, /immediate human action blocks the current agent session/);
  assert.match(domainList.focus.rule, /due date, reminder, ordinary backlog item, or unrelated edit alone/);
  assert.match(domainList.focus.rule, /omit important to preserve the current state/);
  assert.match(domainList.focus.starPolicy.starWhen, /important=true/);
  assert.match(domainList.focus.starPolicy.starWhen, /star\/星标/);
  assert.match(domainList.focus.starPolicy.unstarWhen, /important=false/);
  assert.match(domainList.focus.starPolicy.unstarWhen, /unstar\/取消星标/);
  assert.match(domainList.focus.starPolicy.doNotStarWhen, /due date, reminder, ordinary backlog item/);
  assert.match(domainList.focus.starPolicy.preserveWhenOmitted, /omit important/);
  assert.match(domainList.focus.starPolicy.preserveWhenOmitted, /preserved/);

  const createDateSchema = toolsByName.get('todo.create').inputSchema.properties.dueAt;
  assert.deepEqual(createDateSchema.type, ['integer', 'null']);
  assert.equal(createDateSchema.minimum, 0);
  assert.equal(createDateSchema.maximum, Number.MAX_SAFE_INTEGER);
  assert.match(createDateSchema.description, /Prefer omitting when unspecified/);
  assert.match(createDateSchema.description, /null is accepted for compatibility/);
  assert.match(createDateSchema.description, /Never send an empty string/);
  const updateDateSchema = toolsByName.get('todo.update').inputSchema.properties.dueAt;
  assert.deepEqual(updateDateSchema.type, ['integer', 'null']);
  assert.equal(updateDateSchema.minimum, 0);
  assert.equal(updateDateSchema.maximum, Number.MAX_SAFE_INTEGER);
  assert.match(updateDateSchema.description, /null to clear/);
  assert.match(updateDateSchema.description, /never send an empty string/);

  for (const badValue of ['', -1, Number.MAX_SAFE_INTEGER + 1]) {
    const before = state.calls.createTodo.length;
    await assert.rejects(
      client.callTool('todo.create', {
        domainId: createTodo().domain_id,
        title: 'Must not be partially created',
        dueAt: badValue
      }),
      /dueAt must be a non-negative safe integer timestamp or null/
    );
    assert.equal(state.calls.createTodo.length, before);
  }
  const beforeCompatibleNullUpdateCalls = state.calls.updateTodo.length;
  const compatibleNullCreate = assertEnvelope(
    await client.callTool('todo.create', {
      domainId: DOMAIN_ID,
      title: 'Compatible null dates',
      dueAt: null,
      remindAt: null
    }),
    'todo.create'
  );
  assert.equal(compatibleNullCreate.todo.due_at, null);
  assert.equal(compatibleNullCreate.todo.remind_at, null);
  assert.equal(state.calls.updateTodo.length, beforeCompatibleNullUpdateCalls);

  const starredCreate = assertEnvelope(
    await client.callTool('todo.create', {
      domainId: DOMAIN_ID,
      title: 'Star this explicit priority',
      important: true
    }),
    'todo.create'
  );
  assert.equal(starredCreate.todo.important, 1);
  assert.deepEqual(state.calls.updateTodo.at(-1), {
    id: OTHER_TODO_ID,
    important: 1,
    actor: 'ai'
  });

  const preservedStar = assertEnvelope(
    await client.callTool('todo.update', {
      id: OTHER_TODO_ID,
      title: 'Edit without changing priority'
    }),
    'todo.update'
  );
  assert.equal(preservedStar.todo.important, 1);
  assert.equal(Object.hasOwn(state.calls.updateTodo.at(-1), 'important'), false);

  const unstarredUpdate = assertEnvelope(
    await client.callTool('todo.update', {
      id: OTHER_TODO_ID,
      important: false
    }),
    'todo.update'
  );
  assert.equal(unstarredUpdate.todo.important, 0);
  assert.deepEqual(state.calls.updateTodo.at(-1), {
    id: OTHER_TODO_ID,
    important: 0,
    actor: 'ai'
  });

  for (const badValue of ['', -1, Number.MAX_SAFE_INTEGER + 1]) {
    const before = state.calls.updateTodo.length;
    await assert.rejects(
      client.callTool('todo.update', { id: TODO_ID, remindAt: badValue }),
      /remindAt must be a non-negative safe integer timestamp or null/
    );
    assert.equal(state.calls.updateTodo.length, before);
  }
  const cleared = assertEnvelope(
    await client.callTool('todo.update', { id: TODO_ID, dueAt: null }),
    'todo.update'
  );
  assert.equal(cleared.todo.due_at, null);

  const initialList = assertEnvelope(
    await client.callTool('step.list', { todoId: TODO_ID }),
    'step.list',
    'completed'
  );
  assert.equal(initialList.todo.id, TODO_ID);
  assert.deepEqual(initialList.steps.map((step) => step.id), [STEP_B_ID, STEP_A_ID]);
  for (const step of initialList.steps) assertStepFields(step);

  const created = assertEnvelope(
    await client.callTool('step.create', { todoId: TODO_ID, title: '  Connect webhook  ' }),
    'step.create'
  );
  assert.equal(created.step.id, CREATED_STEP_ID);
  assert.equal(created.step.title, 'Connect webhook');
  assert.deepEqual(state.calls.createStep.at(-1), {
    todoId: TODO_ID,
    title: 'Connect webhook'
  });
  assertStepFields(created.step);

  const updated = assertEnvelope(
    await client.callTool('step.update', { id: CREATED_STEP_ID, title: '  Verify webhook  ' }),
    'step.update'
  );
  assert.equal(updated.step.title, 'Verify webhook');
  assert.deepEqual(state.calls.updateStep.at(-1), {
    id: CREATED_STEP_ID,
    title: 'Verify webhook'
  });

  const completed = assertEnvelope(
    await client.callTool('step.complete', { id: CREATED_STEP_ID }),
    'step.complete'
  );
  assert.equal(completed.step.status, 1);
  const completedAgain = assertEnvelope(
    await client.callTool('step.complete', { id: CREATED_STEP_ID }),
    'step.complete'
  );
  assert.equal(completedAgain.step.status, 1);
  assert.equal(state.statusMutations, 1);

  const uncompleted = assertEnvelope(
    await client.callTool('step.uncomplete', { id: CREATED_STEP_ID }),
    'step.uncomplete'
  );
  assert.equal(uncompleted.step.status, 0);
  const uncompletedAgain = assertEnvelope(
    await client.callTool('step.uncomplete', { id: CREATED_STEP_ID }),
    'step.uncomplete'
  );
  assert.equal(uncompletedAgain.step.status, 0);
  assert.equal(state.statusMutations, 2);

  const deleted = assertEnvelope(
    await client.callTool('step.delete', { id: CREATED_STEP_ID }),
    'step.delete'
  );
  assert.deepEqual(deleted, {
    deleted: true,
    id: CREATED_STEP_ID,
    todoId: TODO_ID
  });
  assert.equal(state.steps.has(CREATED_STEP_ID), false);

  for (const [tool, args] of [
    ['step.list', { todoId: '101' }],
    ['step.create', { todoId: '101', title: 'Step' }],
    ['step.update', { id: '201', title: 'Step' }],
    ['step.complete', { id: '201' }],
    ['step.uncomplete', { id: '201' }],
    ['step.delete', { id: '201' }]
  ]) {
    await assert.rejects(
      client.callTool(tool, args),
      /must be a 20-character decimal Snowflake string/
    );
  }

  const beforeCreateFailures = state.calls.createStep.length;
  await assert.rejects(
    client.callTool('step.create', { todoId: TODO_ID, title: '   ' }),
    /title must be a non-empty string/
  );
  await assert.rejects(
    client.callTool('step.create', { todoId: TODO_ID, title: 'x'.repeat(201) }),
    /title can contain at most 200 characters/
  );
  await assert.rejects(
    client.callTool('step.create', { todoId: MISSING_TODO_ID, title: 'Step' }),
    new RegExp(`Todo not found: ${MISSING_TODO_ID}`)
  );
  assert.equal(state.calls.createStep.length, beforeCreateFailures);

  const beforeUpdateFailures = state.calls.updateStep.length;
  await assert.rejects(
    client.callTool('step.update', { id: STEP_A_ID, title: '   ' }),
    /title must be a non-empty string/
  );
  await assert.rejects(
    client.callTool('step.update', { id: STEP_A_ID, title: 'x'.repeat(201) }),
    /title can contain at most 200 characters/
  );
  await assert.rejects(
    client.callTool('step.update', { id: MISSING_STEP_ID, title: 'Step' }),
    new RegExp(`Step not found: ${MISSING_STEP_ID}`)
  );
  assert.equal(state.calls.updateStep.length, beforeUpdateFailures);

  await assert.rejects(
    client.callTool('step.list', { todoId: MISSING_TODO_ID }),
    new RegExp(`Todo not found: ${MISSING_TODO_ID}`)
  );
  for (const tool of ['step.complete', 'step.uncomplete', 'step.delete']) {
    await assert.rejects(
      client.callTool(tool, { id: MISSING_STEP_ID }),
      new RegExp(`Step not found: ${MISSING_STEP_ID}`)
    );
  }

  const invalidRows = [
    createStep({ id: 'bad' }),
    createStep({ customer_id: '' }),
    createStep({ todo_id: 'bad' }),
    createStep({ title: 7 }),
    createStep({ status: 2 }),
    createStep({ is_deleted: 1 }),
    createStep({ position: 1.5 }),
    createStep({ created_at: -1 }),
    createStep({ updated_at: Number.MAX_SAFE_INTEGER + 1 })
  ];
  for (const invalidRow of invalidRows) {
    state.listOverride = [invalidRow];
    await assert.rejects(
      client.callTool('step.list', { todoId: TODO_ID }),
      /returned an invalid Step row/
    );
  }
  state.listOverride = [createStep(), createStep()];
  await assert.rejects(
    client.callTool('step.list', { todoId: TODO_ID }),
    /returned an invalid Step array result/
  );
  state.listOverride = {};
  await assert.rejects(
    client.callTool('step.list', { todoId: TODO_ID }),
    /returned an invalid array result/
  );
  state.listOverride = undefined;

  const originalStep = state.steps.get(STEP_A_ID);
  state.steps.set(STEP_A_ID, { ...originalStep, customer_id: 'another-customer' });
  await assert.rejects(
    client.callTool('step.update', { id: STEP_A_ID, title: 'Ownership must match' }),
    /customer does not match its parent Todo/
  );
  state.steps.set(STEP_A_ID, originalStep);

  const orphanStep = createStep({ id: CREATED_STEP_ID, todo_id: MISSING_TODO_ID });
  state.steps.set(CREATED_STEP_ID, orphanStep);
  state.stepOrder.push(CREATED_STEP_ID);
  await assert.rejects(
    client.callTool('step.complete', { id: CREATED_STEP_ID }),
    new RegExp(`Todo not found: ${MISSING_TODO_ID}`)
  );
  state.steps.delete(CREATED_STEP_ID);
  state.stepOrder = state.stepOrder.filter((id) => id !== CREATED_STEP_ID);

  state.persistCreate = false;
  await assert.rejects(
    client.callTool('step.create', { todoId: TODO_ID, title: 'Ignored create' }),
    new RegExp(`Step not found: ${CREATED_STEP_ID}`)
  );
  state.persistCreate = true;

  state.createReturnOverride = createStep({
    id: CREATED_STEP_ID,
    title: 'Invalid create result',
    is_deleted: 1
  });
  await assert.rejects(
    client.callTool('step.create', { todoId: TODO_ID, title: 'Invalid create result' }),
    /TodoistSyncRepository\.createSubTodo returned an invalid Step row/
  );
  state.createReturnOverride = undefined;
  state.steps.delete(CREATED_STEP_ID);
  state.stepOrder = state.stepOrder.filter((id) => id !== CREATED_STEP_ID);

  state.persistUpdate = false;
  await assert.rejects(
    client.callTool('step.update', { id: STEP_A_ID, title: 'Ignored update' }),
    /did not persist the requested Step title/
  );
  state.persistUpdate = true;

  state.persistStatus = false;
  await assert.rejects(
    client.callTool('step.complete', { id: STEP_A_ID }),
    /did not persist Step status 1/
  );
  state.persistStatus = true;

  state.persistDelete = false;
  await assert.rejects(
    client.callTool('step.delete', { id: STEP_A_ID }),
    /did not delete the requested Step/
  );
  state.persistDelete = true;

  console.log(
    '[todo-step-crud-test] public metadata, date safety, Step lifecycle, idempotence, row validation, and failure guards passed'
  );
} finally {
  await client.close();
  await server.stop();
  rmSync(tempDirectory, { force: true, recursive: true });
}
