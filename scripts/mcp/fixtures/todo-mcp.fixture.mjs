#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const toTodoId = (value) => String(value).padStart(20, '0');
const DOMAIN_ID = toTodoId(7);
const ARCHIVED_DOMAIN_ID = toTodoId(8);
const toolNames = [
  'domain.list',
  'domain.archived.list',
  'domain.description.update',
  'event.list',
  'event.wait',
  'todo.list',
  'todo.get',
  'todo.status',
  'todo.create',
  'todo.update',
  'todo.complete',
  'todo.uncomplete',
  'todo.delete',
  'todo.move',
  'step.list',
  'step.create',
  'step.update',
  'step.complete',
  'step.uncomplete',
  'step.delete'
];

const readOption = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const mode = readOption('--mode', 'normal');
const stateFile = readOption('--state-file', null);

const loadState = () => {
  if (!stateFile || !existsSync(stateFile)) {
    return {
      calls: [],
      listSnapshots: [],
      nextId: 4242,
      nextSession: 1,
      nextStepId: 8421,
      steps: [],
      todos: []
    };
  }
  return JSON.parse(readFileSync(stateFile, 'utf8'));
};

const state = loadState();
state.listSnapshots ??= [];
state.nextStepId ??= 8421;
state.steps ??= [];
const sessionId = state.nextSession;
state.nextSession += 1;

const saveState = () => {
  if (stateFile) writeFileSync(stateFile, JSON.stringify(state, null, 2));
};

saveState();

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const respond = (id, result) => {
  write({ jsonrpc: '2.0', id, result });
};

const respondError = (id, message) => {
  write({
    jsonrpc: '2.0',
    id,
    error: { code: -32000, message }
  });
};

const toolResult = (structuredContent) => {
  return {
    content: [{ type: 'text', text: 'fixture response' }],
    structuredContent
  };
};

const recordCall = (name, args) => {
  state.calls.push({ args, name, sessionId });
  saveState();
};

const getTodo = (id) => {
  return state.todos.find((todo) => todo.id === id);
};

const getStep = (id) => {
  return state.steps.find((step) => step.id === id);
};

const statusResult = (ids) => {
  const summary = { active: 0, completed: 0, deleted: 0, missing: 0 };
  const items = ids.map((id) => {
    const todo = getTodo(id);
    const itemState = !todo
      ? 'missing'
      : todo.deleted
        ? 'deleted'
        : todo.status === 1
          ? 'completed'
          : 'active';
    summary[itemState] += 1;
    return {
      id,
      state: itemState,
      exists: itemState === 'active' || itemState === 'completed',
      completed: itemState === 'completed',
      deleted: itemState === 'deleted',
      title: todo?.title ?? null,
      domain_id: todo && !todo.deleted ? todo.domain_id : null
    };
  });
  return { items, summary };
};

const handleCreate = (id, args) => {
  if (
    args.domainId !== DOMAIN_ID ||
    args.important !== false ||
    typeof args.title !== 'string' ||
    Object.hasOwn(args, 'dueAt') ||
    Object.hasOwn(args, 'remindAt')
  ) {
    respondError(id, 'fixture received invalid todo.create arguments');
    return;
  }
  const todo = {
    id: toTodoId(state.nextId),
    domain_id: DOMAIN_ID,
    title: args.title,
    status: 0,
    important: 0,
    note: args.note,
    source: 'ai',
    deleted: false,
    fixtureRole: 'owned'
  };
  state.nextId += 1;

  if (mode === 'delayed-commit') {
    state.pendingTodo = todo;
    saveState();
    return;
  }

  state.todos.push(todo);

  if (mode === 'same-title-decoys') {
    state.todos.push(
      {
        ...todo,
        id: toTodoId(state.nextId),
        source: 'human',
        fixtureRole: 'human-decoy'
      },
      {
        ...todo,
        id: toTodoId(state.nextId + 1),
        note: 'wrong ownership marker',
        fixtureRole: 'wrong-marker-decoy'
      }
    );
    state.nextId += 2;
  }

  if (mode === 'ambiguous-owned') {
    state.todos.push({ ...todo, id: toTodoId(state.nextId), fixtureRole: 'owned-duplicate' });
    state.nextId += 1;
  }

  if (mode === 'wrong-response-id') {
    const decoy = {
      ...todo,
      id: toTodoId(state.nextId),
      title: 'Unrelated human todo',
      note: 'not a smoke todo',
      source: 'human',
      fixtureRole: 'wrong-id-decoy'
    };
    state.nextId += 1;
    state.todos.push(decoy);
    saveState();
    respond(id, toolResult({ todo: { ...todo, id: decoy.id } }));
    return;
  }

  saveState();

  if (mode === 'create-timeout' || mode === 'same-title-decoys' || mode === 'ambiguous-owned') {
    return;
  }
  if (mode === 'create-malformed') {
    process.stdout.write('{malformed create response\n');
    return;
  }
  respond(id, toolResult({ todo }));
};

const handleStepCreate = (id, args) => {
  const todo = getTodo(args.todoId);
  if (!todo || todo.deleted || typeof args.title !== 'string' || args.title.length === 0) {
    respondError(id, 'fixture received invalid step.create arguments');
    return;
  }
  const now = 1_700_000_001_000 + state.nextStepId;
  const step = {
    id: toTodoId(state.nextStepId),
    customer_id: 'fixture-customer',
    todo_id: todo.id,
    title: args.title,
    status: 0,
    is_deleted: 0,
    position: state.steps.length,
    created_at: now,
    updated_at: now,
    fixtureRole: 'owned'
  };
  state.nextStepId += 1;
  state.steps.push(step);

  if (mode === 'step-update-assertion') {
    const decoyTodo = {
      id: toTodoId(state.nextId),
      domain_id: DOMAIN_ID,
      title: 'Unrelated human todo with a Step',
      status: 0,
      important: 0,
      note: 'not owned by the smoke run',
      source: 'human',
      deleted: false,
      fixtureRole: 'human-step-decoy-parent'
    };
    state.nextId += 1;
    state.todos.push(decoyTodo);
    state.steps.push({
      ...step,
      id: toTodoId(state.nextStepId),
      todo_id: decoyTodo.id,
      title: 'Unrelated human Step',
      fixtureRole: 'human-step-decoy'
    });
    state.nextStepId += 1;
  }

  saveState();
  respond(id, toolResult({ step }));
};

const handleTool = (id, name, args) => {
  recordCall(name, args);

  if (name === 'domain.list') {
    respond(
      id,
      toolResult({
        domains: [
          {
            id: DOMAIN_ID,
            title: 'Others',
            description: 'Fixture domain',
            archived: 0,
            is_deleted: 0
          }
        ],
        focus: { id: 'focus', title: 'Focus' }
      })
    );
    return;
  }

  if (name === 'domain.archived.list') {
    const archivedDomain = {
      id: ARCHIVED_DOMAIN_ID,
      title: 'Archived fixture domain',
      description: 'Fixture historical context',
      archived: mode === 'archived-active-row' ? 0 : 1,
      is_deleted: mode === 'archived-deleted-row' ? 1 : 0,
      position: 2,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_100
    };
    if (mode === 'archived-description-missing') delete archivedDomain.description;
    const result = { domains: [archivedDomain] };
    if (mode === 'archived-extra-field') result.focus = { id: 'focus' };
    respond(id, toolResult(result));
    return;
  }

  if (name === 'todo.create') {
    handleCreate(id, args);
    return;
  }

  if (name === 'todo.list') {
    const todos = state.todos.filter((todo) => {
      return !todo.deleted && todo.status === 0 && todo.domain_id === args.domainId;
    });
    state.listSnapshots.push({ ids: todos.map((todo) => todo.id), sessionId });
    saveState();
    respond(
      id,
      toolResult({
        domains: [{ id: DOMAIN_ID, title: 'Others' }],
        todos,
        todosByDomain: { [DOMAIN_ID]: todos }
      })
    );
    if (mode === 'delayed-commit' && state.pendingTodo && !state.delayedCommitReleased) {
      state.todos.push(state.pendingTodo);
      delete state.pendingTodo;
      state.delayedCommitReleased = true;
      state.delayedCommitReleasedAfterList = state.listSnapshots.length;
      saveState();
    }
    return;
  }

  if (name === 'todo.get') {
    respond(id, toolResult({ ...getTodo(args.id) }));
    return;
  }

  if (name === 'todo.update') {
    const todo = getTodo(args.id);
    Object.assign(todo, {
      title: args.title ?? todo.title,
      important: args.important === undefined ? todo.important : args.important ? 1 : 0,
      note: args.note === undefined ? todo.note : args.note
    });
    saveState();
    const responseTodo =
      mode === 'post-create-assertion'
        ? { ...todo, title: 'fixture returned the wrong updated title' }
        : todo;
    respond(id, toolResult({ todo: responseTodo }));
    return;
  }

  if (name === 'todo.complete' || name === 'todo.uncomplete') {
    const todo = getTodo(args.id);
    todo.status = name === 'todo.complete' ? 1 : 0;
    saveState();
    respond(id, toolResult({ todo }));
    return;
  }

  if (name === 'todo.status') {
    respond(id, toolResult(statusResult(args.ids)));
    return;
  }

  if (name === 'todo.delete') {
    const todo = getTodo(args.id);
    if (todo) todo.deleted = true;
    for (const step of state.steps) {
      if (step.todo_id === args.id) step.is_deleted = 1;
    }
    saveState();
    respond(id, toolResult({ deleted: true, id: args.id }));
    return;
  }

  if (name === 'step.list') {
    const todo = getTodo(args.todoId);
    const steps = state.steps
      .filter((step) => step.todo_id === args.todoId && step.is_deleted === 0)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    respond(id, toolResult({ todo, steps }));
    return;
  }

  if (name === 'step.create') {
    handleStepCreate(id, args);
    return;
  }

  if (name === 'step.update') {
    const step = getStep(args.id);
    if (!step || step.is_deleted !== 0 || typeof args.title !== 'string') {
      respondError(id, 'fixture received invalid step.update arguments');
      return;
    }
    step.title = args.title;
    step.updated_at += 1;
    saveState();
    const responseStep =
      mode === 'step-update-assertion'
        ? { ...step, title: 'fixture returned the wrong updated Step title' }
        : step;
    respond(id, toolResult({ step: responseStep }));
    return;
  }

  if (name === 'step.complete' || name === 'step.uncomplete') {
    const step = getStep(args.id);
    if (!step || step.is_deleted !== 0) {
      respondError(id, 'fixture received an unknown Step id');
      return;
    }
    step.status = name === 'step.complete' ? 1 : 0;
    step.updated_at += 1;
    saveState();
    respond(id, toolResult({ step }));
    return;
  }

  if (name === 'step.delete') {
    const step = getStep(args.id);
    if (!step || step.is_deleted !== 0) {
      respondError(id, 'fixture received an unknown Step id');
      return;
    }
    step.is_deleted = 1;
    step.updated_at += 1;
    saveState();
    respond(id, toolResult({ deleted: true, id: step.id, todoId: step.todo_id }));
    return;
  }

  respondError(id, `Unknown fixture tool: ${name}`);
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    respondError(null, error.message);
    return;
  }

  if (request.method === 'notifications/initialized') return;
  if (request.method === 'initialize') {
    respond(request.id, {
      protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'bitterless-todo-fixture', version: '0.1.0' }
    });
    return;
  }
  if (request.method === 'tools/list') {
    respond(request.id, {
      tools: toolNames.map((name) => ({
        name,
        description: `${name} fixture`,
        inputSchema: { type: 'object' }
      }))
    });
    return;
  }
  if (request.method === 'tools/call') {
    handleTool(request.id, request.params?.name, request.params?.arguments ?? {});
    return;
  }
  respondError(request.id ?? null, `Unknown fixture method: ${request.method}`);
});

rl.on('close', () => {
  if (mode === 'helper-nonzero') process.exitCode = 7;
  if (mode === 'non-terminating') setInterval(() => {}, 1000);
});
