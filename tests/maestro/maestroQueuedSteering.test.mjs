import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import ts from 'typescript';

const agentDir = resolve(import.meta.dirname, '../../src/main/agent');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const observe = promise => {
  const state = { settled: false, value: undefined };
  state.promise = promise.then(value => { state.settled = true; state.value = value; return value; });
  return state;
};
const message = (id, text = id) => ({ messageId: id, turnId: 'turn-fixture', text });

// Execute the production host, inbox, adapter session and protocol. Only disk logging and the
// native SDK boundary are replaced; no production scheduling method is patched or copied here.
const loadProduction = () => {
  const cache = new Map(), logs = [];
  const load = file => {
    if (file === resolve(agentDir, 'runtime/modelIoLog.ts')) {
      return { modelIoLog: { append: entry => logs.push(entry), openSession: () => undefined, sessionDir: '/fixture/no-io' } };
    }
    if (file === resolve(agentDir, 'prompt/projectInstructions.ts')) {
      return { readProjectInstructions: () => assert.fail('No project reads in steering tests') };
    }
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const { outputText, diagnostics } = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    });
    assert.deepEqual(diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error), []);
    const nativeRequire = createRequire(file);
    new Function('require', 'module', 'exports', outputText)(id => {
      if (id.startsWith('.')) return load(resolve(dirname(file), `${id}.ts`));
      assert.ok(['os', 'path', 'url'].includes(id) || id.startsWith('node:'), `Unexpected dependency: ${id}`);
      return nativeRequire(id);
    }, module, module.exports);
    return module.exports;
  };
  return {
    ...load(resolve(agentDir, 'BaseAgent.ts')),
    ...load(resolve(agentDir, 'runtime/piRuntimeSession.ts')),
    ...load(resolve(agentDir, 'steering/turnSteeringInbox.ts')),
    logs
  };
};

// A controllable native SDK: steer is queue-only, a test explicitly advances a native safe
// point, and prompt resolves separately. This makes final-settled and preflight gaps observable.
const nativeFixture = ({ queueSupported = true, autoStart = true, accepting } = {}) => {
  let listener, active;
  const pending = [];
  const calls = { prompts: [], steer: [], followUp: [], consumed: [], subscribed: 0, unsubscribed: 0, aborted: 0, clears: 0 };
  const emit = event => listener?.(event);
  const user = text => {
    calls.consumed.push(text);
    emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text }] } });
  };
  const start = () => {
    assert.ok(active, 'A native root must be reserved before it can start');
    assert.equal(active.started, false, 'A native root starts only once');
    active.started = true;
    native.isStreaming = true;
    user(active.text);
  };
  const native = {
    isStreaming: false, isCompacting: false, steeringMode: 'one-at-a-time',
    subscribe(callback) {
      assert.equal(listener, undefined, 'Only one subscription owns this runtime');
      listener = callback;
      calls.subscribed++;
      return () => { listener = undefined; calls.unsubscribed++; };
    },
    async prompt(text, options) {
      assert.equal(active, undefined, 'The host must never start concurrent native roots');
      calls.prompts.push({ text, options });
      const gate = deferred();
      active = { text, gate, started: false };
      if (autoStart) start();
      return gate.promise;
    },
    getSteeringMessages: () => [...pending],
    async followUp(text) { calls.followUp.push(text); assert.fail('Safe-point steering must not use end-of-run followUp'); },
    async abort() {
      calls.aborted++;
      if (active) finish({ stopReason: 'aborted' });
    },
    ...(queueSupported ? {
      async steer(text) { calls.steer.push(text); pending.push(text); if (accepting) await accepting.promise; },
      clearQueue() { calls.clears++; return { steering: pending.splice(0), followUp: [] }; }
    } : {})
  };
  const finish = ({ text = 'answer', stopReason = 'stop', errorMessage, usage } = {}) => {
    assert.ok(active, 'Only the current native root may settle');
    emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason, errorMessage, usage } });
    const run = active;
    active = undefined;
    native.isStreaming = false;
    run.gate.resolve();
  };
  const fail = error => {
    assert.ok(active);
    const run = active;
    active = undefined;
    native.isStreaming = false;
    run.gate.reject(error);
  };
  return {
    native, calls, emit, start, finish, fail,
    safePoint() {
      assert.ok(active?.started, 'Safe-point consumption requires the original native run');
      const text = pending.shift();
      assert.notEqual(text, undefined, 'There must be native steering to consume');
      user(text);
    },
    get pending() { return [...pending]; }
  };
};

const hostFixture = ({ native = nativeFixture(), creating } = {}) => {
  const production = loadProduction();
  const session = new production.PiRuntimeSession(native.native);
  const creations = [], usage = [], stream = [];
  const agent = new production.BaseAgent({
    runtime: { async createSession(options) { creations.push(options); if (creating) await creating.promise; return session; } },
    providerId: 'fixture', modelId: 'fixture-model', authPath: '/fixture/auth.json',
    buildTools: () => [], builtinTools: [],
    describeTarget: () => ({ providerLabel: 'Fixture', modelLabel: 'Fixture', supplier: 'test' }),
    onUsage: (delta, total) => usage.push(structuredClone({ delta, total })),
    onStream: text => stream.push(text)
  });
  const inbox = new production.TurnSteeringInbox();
  return {
    ...production, native, session, agent, inbox, creations, usage, stream,
    run: (timeoutMs = 2000) => observe(agent.prompt('original root', timeoutMs, { steeringInbox: inbox, messageId: 'root', turnId: 'turn-fixture' }))
  };
};

test('explicit Pi enqueue never calls prompt during idle, preflight or compaction, and reports only actual consumption', async () => {
  const p = loadProduction(), n = nativeFixture();
  const session = new p.PiRuntimeSession(n.native), consumed = [];
  const unsubscribe = session.subscribe(event => { if (event.type === 'steering_consumed') consumed.push(event.messageId); });
  await session.enqueueSteering(message('idle', 'same text'));
  n.native.isCompacting = true;
  await session.enqueueSteering(message('compacting', 'same text'));
  assert.deepEqual(n.calls.prompts, []);
  assert.deepEqual(n.calls.steer, ['same text']); // compaction holds the second message outside native queue
  n.emit({ type: 'compaction_end', reason: 'threshold', aborted: false });
  n.native.isCompacting = false;
  assert.deepEqual(n.calls.steer, ['same text', 'same text']);
  assert.deepEqual(consumed, []);
  assert.deepEqual(session.takePendingSteering(), [message('idle', 'same text'), message('compacting', 'same text')]);
  assert.deepEqual(session.takePendingSteering(), []);
  assert.deepEqual(n.pending, []);
  unsubscribe();
});

test('a reserved root accepts preparing messages without starting a second run; duplicate IDs share one receipt', async () => {
  const creating = deferred(), n = nativeFixture({ autoStart: false });
  const h = hostFixture({ native: n, creating });
  const root = h.run();
  const firstMessage = message('first', '  raw first\n<context page="one"/>');
  const first = h.inbox.enqueue(firstMessage);
  assert.equal(h.inbox.enqueue({ ...firstMessage, text: 'duplicate must not replace original' }), first);
  const receipt = observe(first);
  await setImmediate();
  assert.equal(root.settled, false);
  assert.equal(receipt.settled, false);
  assert.deepEqual(n.calls.prompts, []);
  creating.resolve();
  await setImmediate();
  assert.deepEqual(n.calls.prompts.map(call => call.text), ['original root']);
  assert.equal(n.native.isStreaming, false);
  assert.deepEqual(n.calls.steer, [firstMessage.text]);
  assert.equal(receipt.settled, false, 'Native queue acceptance is not delivery');
  n.start();
  n.safePoint();
  assert.deepEqual(await receipt.promise, { outcome: 'delivered' });
  assert.equal(h.inbox.enqueue(firstMessage), first, 'A consumed message ID still shares its receipt during the run');
  assert.equal(root.settled, false, 'Delivery need not await the whole root completion');
  n.finish();
  assert.equal((await root.promise).ok, true);
  assert.equal(n.calls.subscribed, 1);
  assert.equal(n.calls.unsubscribed, 1);
  assert.equal(h.creations.length, 1);
  assert.deepEqual(n.calls.consumed, ['original root', firstMessage.text]);
});

test('native next-safe-point delivery is FIFO for identical text with distinct IDs and does not abort tools', async () => {
  const h = hostFixture(), root = h.run();
  await setImmediate();
  h.native.emit({ type: 'tool_execution_start', toolName: 'fixture_read', args: {} });
  const one = observe(h.inbox.enqueue(message('same-1', 'same text')));
  const two = observe(h.inbox.enqueue(message('same-2', 'same text')));
  await setImmediate();
  assert.deepEqual(h.native.calls.steer, ['same text', 'same text']);
  assert.equal(one.settled, false);
  assert.equal(two.settled, false);
  assert.equal(h.native.calls.aborted, 0);
  h.native.emit({ type: 'tool_execution_end', toolName: 'fixture_read', result: { content: [{ type: 'text', text: 'tool finished' }] } });
  h.native.safePoint();
  assert.deepEqual(await one.promise, { outcome: 'delivered' });
  assert.equal(two.settled, false);
  assert.equal(root.settled, false);
  h.native.safePoint();
  assert.deepEqual(await two.promise, { outcome: 'delivered' });
  assert.equal(h.native.calls.prompts.length, 1);
  assert.equal(h.native.calls.aborted, 0);
  h.native.finish();
  assert.equal((await root.promise).ok, true);
  assert.equal(h.native.calls.followUp.length, 0);
});

test('a final-settled residual continues serially under the same subscription and cumulative usage', async () => {
  const h = hostFixture(), root = h.run();
  await setImmediate();
  h.native.finish({ usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0.1 } } });
  // The native run has gone idle, but the host has not checked/closed its inbox yet.
  const late = observe(h.inbox.enqueue(message('late', 'late exact text')));
  await setImmediate();
  assert.equal(root.settled, false);
  assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root', 'late exact text']);
  assert.deepEqual(await late.promise, { outcome: 'delivered' });
  assert.equal(h.native.calls.subscribed, 1);
  assert.equal(h.native.calls.unsubscribed, 0);
  assert.equal(h.usage.filter(item => item.total.totalTokens === 0).length, 1);
  h.native.finish({ text: 'continued answer', usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, cost: { total: 0.2 } } });
  assert.equal((await root.promise).ok, true);
  assert.equal(h.usage.at(-1).total.totalTokens, 17);
  assert.equal(h.usage.at(-1).total.input, 7);
  assert.equal(h.usage.at(-1).total.output, 10);
  assert.equal(h.native.calls.unsubscribed, 1);
  assert.equal(h.creations.length, 1);
  assert.equal(h.logs.filter(entry => entry.kind === 'prompt').length, 1);
  assert.equal(h.logs.filter(entry => entry.kind === 'turn_end').length, 1);
  const after = await h.inbox.enqueue(message('after-close'));
  assert.equal(after.outcome, 'failed');
  assert.equal(h.native.calls.prompts.length, 2);
});

test('native queue capability missing retains FIFO and falls back to safe serial continuation', async () => {
  const h = hostFixture({ native: nativeFixture({ queueSupported: false }) }), root = h.run();
  await setImmediate();
  const first = observe(h.inbox.enqueue(message('one', 'first')));
  const second = observe(h.inbox.enqueue(message('two', 'second')));
  await setImmediate();
  assert.equal(first.settled, false);
  assert.equal(second.settled, false);
  assert.equal(h.native.calls.prompts.length, 1);
  h.native.finish();
  await setImmediate();
  assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root', 'first']);
  assert.equal(second.settled, false);
  h.native.finish();
  await setImmediate();
  assert.deepEqual(await first.promise, { outcome: 'delivered' });
  assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root', 'first', 'second']);
  h.native.finish();
  assert.deepEqual(await second.promise, { outcome: 'delivered' });
  assert.equal((await root.promise).ok, true);
  assert.equal(h.native.calls.subscribed, 1);
  assert.equal(h.native.calls.unsubscribed, 1);
  assert.equal(h.native.calls.aborted, 0);
});

test('a settling root waits for the in-flight native enqueue write before draining its remaining message', async () => {
  const accepting = deferred(), h = hostFixture({ native: nativeFixture({ accepting }) }), root = h.run();
  await setImmediate();
  const pending = observe(h.inbox.enqueue(message('writing', 'arrived during native queue update')));
  await setImmediate();
  h.native.finish();
  await setImmediate();
  assert.equal(root.settled, false);
  assert.equal(pending.settled, false);
  assert.equal(h.native.calls.prompts.length, 1);
  assert.equal(h.native.calls.unsubscribed, 0);
  accepting.resolve();
  await setImmediate();
  assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root', 'arrived during native queue update']);
  assert.deepEqual(await pending.promise, { outcome: 'delivered' });
  h.native.finish();
  assert.equal((await root.promise).ok, true);
  assert.deepEqual(h.native.calls.consumed, ['original root', 'arrived during native queue update']);
  assert.equal(h.native.calls.unsubscribed, 1);
});

test('the public BaseAgent steering call accepts the preparing window and delivers at a native safe point', async () => {
  const creating = deferred(), h = hostFixture({ creating }), root = h.run();
  const pending = observe(h.agent.steerActiveTurn('public steering'));
  await setImmediate();
  assert.equal(pending.settled, false);
  assert.equal(h.native.calls.prompts.length, 0);
  creating.resolve();
  await setImmediate();
  h.native.safePoint();
  assert.deepEqual(await pending.promise, { outcome: 'delivered' });
  assert.equal(root.settled, false);
  h.native.finish();
  await root.promise;
  assert.deepEqual(await h.agent.steerActiveTurn('after turn'), { outcome: 'idle' });
  assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root']);
});

test('Stop cancels unconsumed native messages without replaying them as new roots', async () => {
  const h = hostFixture(), root = h.run();
  await setImmediate();
  const pending = observe(h.inbox.enqueue(message('stop-pending')));
  await setImmediate();
  assert.equal(pending.settled, false);
  await h.agent.abort();
  assert.equal((await pending.promise).outcome, 'failed');
  assert.match(pending.value.error, /stopp|reset/i);
  await root.promise;
  assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root']);
  assert.deepEqual(h.session.takePendingSteering(), []);
  assert.deepEqual(h.native.pending, []);
  assert.equal(h.native.calls.unsubscribed, 1);
});

test('Stop during session preparation fails pending receipts and never starts the original or queued root', async () => {
  const creating = deferred(), h = hostFixture({ creating }), root = h.run();
  const pending = observe(h.inbox.enqueue(message('preparing-stop')));
  const stopped = h.agent.abort();
  creating.resolve();
  await stopped;
  assert.equal((await pending.promise).outcome, 'failed');
  await root.promise;
  assert.deepEqual(h.native.calls.prompts, []);
  assert.deepEqual(h.native.calls.steer, []);
});

test('runtime rejection and terminal provider failure fail pending receipts without a serial retry', async () => {
  for (const terminalEvent of [false, true]) {
    const h = hostFixture(), root = h.run();
    await setImmediate();
    const pending = observe(h.inbox.enqueue(message(`fail-${terminalEvent}`)));
    await setImmediate();
    if (terminalEvent) h.native.finish({ stopReason: 'error', errorMessage: 'provider fixture failure' });
    else h.native.fail(new Error('native fixture failure'));
    await root.promise;
    assert.equal((await pending.promise).outcome, 'failed');
    assert.match(pending.value.error, /failure/);
    assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root']);
    assert.deepEqual(h.native.pending, []);
    assert.deepEqual(h.session.takePendingSteering(), []);
    assert.equal(h.native.calls.unsubscribed, 1);
  }
});

test('session startup rejection fails the reserved inbox without touching native prompt', async () => {
  const creating = deferred(), h = hostFixture({ creating }), root = h.run();
  const pending = h.inbox.enqueue(message('start-failed'));
  creating.reject(new Error('fixture auth unavailable'));
  assert.equal((await root.promise).ok, false);
  assert.equal((await pending).outcome, 'failed');
  assert.deepEqual(h.native.calls.prompts, []);
  assert.equal(h.native.calls.subscribed, 0);
});

test('turn timeout aborts the native run and fails queued messages without restarting a root', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = hostFixture(), root = h.run(100);
  await setImmediate();
  const pending = observe(h.inbox.enqueue(message('timed-out')));
  await setImmediate();
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal((await root.promise).ok, false);
  assert.match(root.value.error, /timed out/);
  assert.equal((await pending.promise).outcome, 'failed');
  assert.match(pending.value.error, /timed out/);
  assert.ok(h.native.calls.aborted >= 1);
  assert.deepEqual(h.native.calls.prompts.map(call => call.text), ['original root']);
  assert.deepEqual(h.native.pending, []);
  assert.equal(h.native.calls.unsubscribed, 1);
});

test('two live sessions keep matching message IDs, queue consumption and cleanup isolated', async () => {
  const a = hostFixture(), b = hostFixture(), rootA = a.run(), rootB = b.run();
  await setImmediate();
  const receiptA = observe(a.inbox.enqueue(message('same-id', 'A context')));
  const receiptB = observe(b.inbox.enqueue(message('same-id', 'B context')));
  await setImmediate();
  a.native.safePoint();
  assert.deepEqual(await receiptA.promise, { outcome: 'delivered' });
  assert.equal(receiptB.settled, false);
  a.native.finish();
  await rootA.promise;
  assert.equal(rootB.settled, false);
  assert.deepEqual(b.native.pending, ['B context']);
  b.native.safePoint();
  assert.deepEqual(await receiptB.promise, { outcome: 'delivered' });
  b.native.finish();
  await rootB.promise;
  assert.deepEqual(a.native.calls.consumed, ['original root', 'A context']);
  assert.deepEqual(b.native.calls.consumed, ['original root', 'B context']);
});

test('compaction progress for manual sessions clears on attempt/end/reset and ignores a previous session', async () => {
  const {BaseAgent}=loadProduction(), updates=[], listeners=[]
  const agent=new BaseAgent({runtime:{async createSession(){return {subscribe(fn){listeners.push(fn);return()=>{}},abort:async()=>{},prompt:async()=>{}}}},
    providerId:'fixture',modelId:'fixture',authPath:'/fixture/auth',buildTools:()=>[],builtinTools:[],
    describeTarget:()=>({providerLabel:'Fixture',modelLabel:'Fixture',supplier:'test'}),onCompaction:state=>updates.push(state)})
  await agent.init()
  listeners[0]({type:'compaction_start'})
  listeners[0]({type:'compaction_retry',attempt:1,maxAttempts:3,delayMs:2000,error:'temporary failure'})
  assert.equal(updates.at(-1).retry.attempt,1)
  listeners[0]({type:'compaction_attempt',attempt:1,maxAttempts:3});assert.equal(updates.at(-1).retry,undefined)
  listeners[0]({type:'compaction_end',aborted:true});assert.equal(updates.at(-1).active,false)
  agent.reset();await agent.init();listeners[1]({type:'compaction_start'})
  const count=updates.length
  listeners[0]({type:'compaction_retry',attempt:2,maxAttempts:3,delayMs:2000,error:'stale'})
  listeners[0]({type:'compaction_end'})
  assert.equal(updates.length,count);assert.equal(updates.at(-1).active,true)
  agent.reset();assert.equal(updates.at(-1).active,false)
})
