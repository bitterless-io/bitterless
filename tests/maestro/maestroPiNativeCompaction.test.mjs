import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import ts from 'typescript'
import * as pi from '@earendil-works/pi-coding-agent'
import { Agent } from '@earendil-works/pi-agent-core'
const root = resolve(import.meta.dirname, '../..')
const cache = new Map()
function load(file) {
  if(cache.has(file)) return cache.get(file).exports
  const module = {exports:{}}; cache.set(file,module)
  const output = ts.transpileModule(readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
  new Function('require','module','exports',output)(name=>name.startsWith('.') ? load(resolve(dirname(file),name+'.ts')) : createRequire(file)(name), module,module.exports)
  return module.exports
}
const native = load(join(root,'src/main/agent/runtime/piNativeCompaction.ts'))
const { createPiResourceLoader, normalizePiEvent } = load(join(root,'src/main/agent/runtime/piRuntimeProtocol.ts'))
const { PiRuntimeSession, applyPiSessionPolicy } = load(join(root,'src/main/agent/runtime/piRuntimeSession.ts'))
const { convertToLlm } = await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js')))
const { createAssistantMessageEventStream } = await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js')))
const model = { id:'fixture',name:'fixture',provider:'fixture',api:'openai-completions',baseUrl:'https://fixture.invalid',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:65536,maxTokens:4096 }
const usage = (input=0)=>({input,output:1,cacheRead:0,cacheWrite:0,totalTokens:input+1,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}})
const assistant = (text,extra={})=>({role:'assistant',content:[{type:'text',text}],api:model.api,provider:model.provider,model:model.id,usage:usage(),stopReason:'stop',timestamp:Date.now(),...extra})
function seed(manager,count=7,size=30000) {
  for(let i=0;i<count;i++) {
    manager.appendMessage({role:'user',content:`fixture turn ${i} `+'a'.repeat(size),timestamp:i*2+1})
    manager.appendMessage(assistant(`completed ${i}`,{timestamp:i*2+2,usage:{...usage(),totalTokens:0,output:0}}))
  }
}
function harness({file,fail=false,overflow=false,prompt,holdSummary,retry,failures=0,compactionSettings}={}) {
  const manager = file ? pi.SessionManager.open(file,undefined,root) : pi.SessionManager.inMemory(root)
  const settings=pi.SettingsManager.inMemory({compaction:compactionSettings||{...native.PI_COMPACTION_SETTINGS},retry:retry||{enabled:false}})
  const calls=[],events=[],state={},preparations=[]; let session,mainCalls=0,focus=prompt
  const streamFn=async(_model,context,options)=>{
    const summary=!context.systemPrompt.includes('SYSTEM KEEP TABLE TWO')
    calls.push({summary,context:structuredClone(context),options})
    if(summary&&holdSummary) await holdSummary(options)
    const stream=createAssistantMessageEventStream()
    if(summary&&failures-- > 0) {
      stream.push({type:'error',reason:'error',error:assistant('',{stopReason:'error',errorMessage:'503 overloaded Bearer secretfixturetoken123'})})
    } else if(summary&&fail) {
      stream.push({type:'error',reason:'error',error:assistant('',{stopReason:'error',errorMessage:'summary window exceeded'})})
    } else if(!summary&&overflow&&mainCalls++===0) {
      stream.push({type:'error',reason:'error',error:assistant('',{stopReason:'error',errorMessage:'maximum context length is 65536 tokens',usage:usage(0)})})
    } else stream.push({type:'done',reason:'stop',message:assistant(summary?'Native fixture summary':'done')})
    return stream
  }
  const extension=native.createPiCompactionExtension({...pi,compact:async(...args)=>{preparations.push(args[0]);return pi.compact(...args)}},{getPrompt:()=>focus,getStream:()=>streamFn,getRetry:()=>settings.getRetrySettings(),state})
  const loader=createPiResourceLoader(pi,'SYSTEM KEEP TABLE TWO\nRules must remain byte exact.',undefined,[extension])
  const agent=new Agent({convertToLlm,streamFn,initialState:{model,messages:manager.buildSessionContext().messages}})
  session=new pi.AgentSession({agent,sessionManager:manager,settingsManager:settings,cwd:root,resourceLoader:loader,modelRuntime:{hasConfiguredAuth:()=>true,getModel:()=>model,getAuth:async()=>({auth:{apiKey:'test-fixture',headers:{'x-fixture':'yes'}},env:{FIXTURE:'1'}})},initialActiveToolNames:[]})
  const runtime=new PiRuntimeSession(session,undefined,undefined,state)
  runtime.subscribe(event=>events.push(event))
  return {session,runtime,manager,calls,events,state,preparations,setFocus:value=>{focus=value},sync:()=>{agent.state.messages=manager.buildSessionContext().messages}}
}

test('native manual checkpoint preserves system, exact focus and file operations across repeated compaction and disk reload',async(t)=>{
  const dir=mkdtempSync(join(tmpdir(),'bl-native-compact-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const file=join(dir,'session.jsonl');const h=harness({file,prompt:'Preserve EXACT-TASK-ABC.'});t.after(()=>h.session.dispose())
  h.manager.appendMessage({role:'user',content:'read fixture',timestamp:1})
  h.manager.appendMessage(assistant('',{content:[{type:'toolCall',id:'read1',name:'read',arguments:{path:'/fixture/a.ts'}}],timestamp:2}))
  h.manager.appendMessage({role:'toolResult',toolCallId:'read1',toolName:'read',content:[{type:'text',text:'file contents'}],isError:false,timestamp:3})
  seed(h.manager);h.sync();const system=h.session.systemPrompt,rawCount=h.manager.getEntries().length
  const first=await h.runtime.compact()
  assert.ok(first.estimatedTokensAfter<first.tokensBefore)
  assert.equal(h.session.systemPrompt,system)
  const summaryCalls=h.calls.filter(c=>c.summary)
  assert.ok(summaryCalls.some(c=>JSON.stringify(c.context).includes('EXACT-TASK-ABC')))
  assert.ok(summaryCalls.every(c=>!JSON.stringify(c.context).includes('SYSTEM KEEP TABLE TWO')))
  assert.ok(h.manager.getEntries().length>rawCount)
  const entry=h.manager.getEntries().findLast(e=>e.type==='compaction')
  assert.equal(entry.fromHook,true);assert.equal(entry.details.hostCompaction,'host-native-compact-v1');assert.ok(entry.details.readFiles.includes('/fixture/a.ts'))
  seed(h.manager,4);h.sync();await h.runtime.compact()
  assert.ok(h.manager.getEntries().findLast(e=>e.type==='compaction').details.readFiles.includes('/fixture/a.ts'))
  const loaded=pi.SessionManager.open(file,undefined,root)
  assert.deepEqual(loaded.buildSessionContext().messages,h.session.messages)
  assert.equal(loaded.getEntries().filter(e=>e.type==='compaction').length,2)
  assert.ok(JSON.stringify(loaded.getEntries()).includes('file contents'))
  assert.equal(h.events.filter(e=>e.type==='compaction_end'&&e.ok).length,2)
})

test('native threshold and overflow enter same hook through normal prompt',async(t)=>{
  for(const overflow of [false,true]) {
    const h=harness({overflow});t.after(()=>h.session.dispose());seed(h.manager,overflow?4:8,30000);h.sync()
    await h.runtime.prompt({text:'Continue the fixture.'})
    assert.ok(h.events.some(e=>e.type==='compaction_end'&&e.ok&&e.reason===(overflow?'overflow':'threshold')),JSON.stringify(h.events))
    assert.ok(h.calls.some(c=>c.summary&&JSON.stringify(c.context).includes('Preserve unfinished, uncancelled')))
    assert.ok(h.calls.some(c=>!c.summary&&JSON.stringify(c.context).includes('Native fixture summary')))
    assert.ok(h.manager.getEntries().some(e=>e.type==='compaction'))
  }
})

test('summary failure cancels native checkpoint without unfocused fallback; error reaches caller',async(t)=>{
  const h=harness({fail:true});t.after(()=>h.session.dispose());seed(h.manager);h.sync()
  const before=h.manager.getEntries().length
  await assert.rejects(h.runtime.compact(),/summary window exceeded/)
  assert.equal(h.manager.getEntries().length,before)
  assert.ok(h.calls.filter(c=>c.summary).length<=2,'at most native history/prefix pair; no fallback invocation')
  assert.ok(h.events.some(e=>e.type==='compaction_end'&&!e.ok&&e.errorMessage?.includes('summary window exceeded')))
})

test('configured focus snapshots before auth and blank resets default',async()=>{
  let focus='first',release
  const authWait=new Promise(done=>{release=done}),calls=[]
  const fake={compact:async(...args)=>{calls.push(args);return{summary:'x',details:{readFiles:[],modifiedFiles:[]}}}}
  const ext=native.createPiCompactionExtension(fake,{getPrompt:()=>focus,getStream:()=>undefined,getRetry:()=>undefined,state:{}})
  const handler=ext.handlers.get('session_before_compact')[0]
  const event={preparation:{fileOps:{read:new Set(),written:new Set(),edited:new Set()}},branchEntries:[],signal:new AbortController().signal}
  const ctx={model,modelRegistry:{getApiKeyAndHeaders:async()=>{await authWait;return{ok:true}}}}
  const pending=handler(event,ctx);focus='second';release();await pending
  assert.equal(calls[0][4],'first')
  focus=' \n ';await handler(event,ctx);assert.equal(calls[1][4],native.DEFAULT_COMPACT_PROMPT)
})

test('steering holds FIFO while compacting and only consumes after native delivery, including failure and cancellation',async()=>{
  for(const aborted of [false,true]) {
    const queued=[],events=[];let emit
    const fake={isCompacting:false,subscribe:fn=>{emit=fn;return()=>{}},steer:async text=>queued.push(text),clearQueue:()=>{},abort:async()=>{},prompt:async()=>{}}
    const wrapper=new PiRuntimeSession(fake);wrapper.subscribe(e=>events.push(e))
    fake.isCompacting=true;emit({type:'compaction_start',reason:'threshold'})
    await wrapper.enqueueSteering({messageId:'a',text:'user A'});await wrapper.enqueueSteering({messageId:'b',text:'background B'})
    assert.deepEqual(queued,[]);assert.equal(events.filter(e=>e.type==='steering_consumed').length,0)
    emit({type:'compaction_end',reason:'threshold',aborted,errorMessage:aborted?undefined:'failure'});fake.isCompacting=false
    assert.deepEqual(queued,['user A','background B'])
    emit({type:'message_start',message:{role:'user',content:'user A'}})
    assert.equal(events.filter(e=>e.type==='steering_consumed').length,1)
    assert.equal(events.findLast(e=>e.type==='compaction_end').ok,false)
    assert.deepEqual(wrapper.takePendingSteering(),[{messageId:'b',text:'background B'}])
  }
})

test('native result normalization reports failure/aborted and disabled child policy stays off',()=>{
  const result=normalizePiEvent({type:'compaction_end',result:{tokensBefore:900,estimatedTokensAfter:200},aborted:false})[0]
  assert.equal(result.afterTokens,200);assert.equal(result.ok,true)
  assert.equal(normalizePiEvent({type:'compaction_end',aborted:true})[0].ok,false)
  let enabled;applyPiSessionPolicy({setAutoCompactionEnabled:value=>{enabled=value}},undefined,false);assert.equal(enabled,false)
})

test('pure split-turn prefix keeps Pi template without applying history focus',async(t)=>{
  const h=harness({prompt:'HISTORY-FOCUS-ONLY'});t.after(()=>h.session.dispose())
  h.manager.appendMessage({role:'user',content:'one huge turn '+ 'p'.repeat(120000),timestamp:1})
  h.manager.appendMessage(assistant('recent suffix '+ 's'.repeat(90000),{timestamp:2,usage:{...usage(),totalTokens:0,output:0}}))
  h.sync();await h.runtime.compact()
  const calls=h.calls.filter(c=>c.summary)
  assert.equal(calls.length,1)
  assert.ok(JSON.stringify(calls[0].context).includes('PREFIX of a turn'))
  assert.ok(!JSON.stringify(calls[0].context).includes('HISTORY-FOCUS-ONLY'))
  assert.ok(h.session.messages.some(message=>JSON.stringify(message).includes('recent suffix')))
})

test('aborting native summary keeps the previous checkpoint and reports cancellation',async(t)=>{
  let started;const began=new Promise(done=>{started=done})
  const h=harness({holdSummary: options=>new Promise((_,reject)=>{
    started();options.signal.addEventListener('abort',()=>{const error=new Error('cancelled');error.name='AbortError';reject(error)},{once:true})
  })});t.after(()=>h.session.dispose());seed(h.manager);h.sync()
  const before=h.manager.getEntries().length
  const pending=h.runtime.compact();await began;await h.runtime.abort()
  await assert.rejects(pending,/cancel/i)
  assert.equal(h.manager.getEntries().length,before)
  assert.ok(h.events.some(e=>e.type==='compaction_end'&&e.aborted&&!e.ok))
})

test('child auto-compaction disabled leaves large child history untouched',async(t)=>{
  const h=harness();t.after(()=>h.session.dispose());seed(h.manager,8);h.sync()
  applyPiSessionPolicy(h.session,undefined,false)
  await h.runtime.prompt({text:'Child fixture completion.'})
  assert.equal(h.calls.filter(call=>call.summary).length,0)
  assert.equal(h.manager.getEntries().filter(entry=>entry.type==='compaction').length,0)
})

const { withCompactionAwareTimeout } = load(join(root,'src/main/agent/runtime/compactionAwareTimeout.ts'))
test('ordinary turn timeout pauses throughout compaction and resumes its remaining budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const listeners = new Set()
  const session = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const emit = event => { for (const listener of listeners) listener(event) }
  let finish
  const operation = new Promise(resolve => { finish = resolve })
  const running = withCompactionAwareTimeout(() => operation, session, 100, () => new Error('normal turn timed out'))
  const outcome = running.then(() => 'done', error => error.message)
  t.mock.timers.tick(40)
  emit({type:'compaction_start'})
  t.mock.timers.tick(60_000)
  emit({type:'compaction_end',ok:false,aborted:true})
  t.mock.timers.tick(59)
  let settled = false; void outcome.then(() => { settled = true })
  await Promise.resolve(); assert.equal(settled, false)
  t.mock.timers.tick(1)
  assert.equal(await outcome, 'normal turn timed out')
  assert.equal(listeners.size, 0)
  finish()
})

test('turn finishing after a long native compaction clears its deadline and subscription', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const listeners = new Set()
  const session = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  let finish
  const running = withCompactionAwareTimeout(() => new Promise(resolve => { finish = resolve }), session, 100, () => new Error('unexpected timeout'))
  for (const listener of listeners) listener({type:'compaction_start'})
  t.mock.timers.tick(600_000)
  for (const listener of listeners) listener({type:'compaction_end',ok:true})
  finish('done')
  assert.equal(await running, 'done')
  t.mock.timers.tick(600_000)
  assert.equal(listeners.size, 0)
})

const { prepareCompaction } = await import(pathToFileURL(join(root,'node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js')))
test('real native repeated prefix-only split preserves previous checkpoint history and file details', async t => {
  const h = harness(); t.after(() => h.session.dispose())
  seed(h.manager)
  h.manager.appendMessage({role:'user',content:'Unfinished UNIQUE-OLDER-COMMITMENT '+ 'p'.repeat(120000),timestamp:1})
  h.manager.appendMessage(assistant('short recent answer'))
  h.sync(); await h.runtime.compact()
  for(let round=0;round<2;round++) {
    if (round) {
      h.manager.appendMessage({role:'user',content:'another long turn '+ 'q'.repeat(120000),timestamp:2})
      h.manager.appendMessage(assistant('short reply'));h.sync();await h.runtime.compact()
    }
    const before = h.manager.getEntries().findLast(entry => entry.type==='compaction').summary
    h.manager.appendMessage(assistant('new suffix '+ 'n'.repeat(90000))); h.sync()
    const preparation = prepareCompaction(h.manager.getBranch(),native.PI_COMPACTION_SETTINGS)
    assert.equal(preparation.messagesToSummarize.length,0,`prefix-only round ${round}`)
    assert.equal(preparation.isSplitTurn,true)
    assert.ok(preparation.turnPrefixMessages.length)
    assert.equal(preparation.previousSummary,before)
    await h.runtime.compact()
    const after = h.manager.getEntries().findLast(entry => entry.type==='compaction')
    assert.ok(after.summary.startsWith(before+'\n\n---\n\n**Turn Context (split turn):**\n\n'))
    assert.ok(after.details.hostCompaction)
    assert.ok(h.session.messages.some(message=>JSON.stringify(message).includes(before.split('\n')[0])))
  }
})

test('split compatibility does not duplicate a fixed native result beginning with No prior history', () => {
  const separator='\n\n---\n\n**Turn Context (split turn):**\n\n'
  const previous='No prior history.'+separator+'an earlier preserved prefix'
  const preparation={isSplitTurn:true,turnPrefixMessages:[{}],messagesToSummarize:[],previousSummary:previous}
  const fixed={summary:previous+separator+'new prefix',usage:{input:1},details:{readFiles:['a']}}
  assert.equal(native.preserveSplitTurnHistory(preparation,fixed),fixed)
  const affected={...fixed,summary:'No prior history.'+separator+'new prefix'}
  const repaired=native.preserveSplitTurnHistory(preparation,affected)
  assert.equal(repaired.summary,fixed.summary)
  assert.equal(repaired.usage,affected.usage);assert.equal(repaired.details,affected.details)
  assert.equal(native.preserveSplitTurnHistory({...preparation,messagesToSummarize:[{}]},affected),affected)
  assert.equal(native.preserveSplitTurnHistory({...preparation,previousSummary:''},affected).summary,separator+'new prefix')
})

test('manual native instructions add to configured focus for exactly one run', async t => {
  const h=harness({prompt:'PERSISTED-FOCUS'});t.after(()=>h.session.dispose());seed(h.manager);h.sync()
  await h.runtime.compact('TEMPORARY-FOCUS')
  assert.ok(h.calls.some(call=>JSON.stringify(call.context).includes('PERSISTED-FOCUS\\n\\nTEMPORARY-FOCUS')))
  h.calls.length=0;seed(h.manager);h.sync();await h.runtime.compact()
  assert.ok(h.calls.some(call=>JSON.stringify(call.context).includes('PERSISTED-FOCUS')))
  assert.ok(h.calls.every(call=>!JSON.stringify(call.context).includes('TEMPORARY-FOCUS')))
})

test('native retry callbacks expose wait, attempt and recovery while redacting provider credentials', async t => {
  const h=harness({failures:1,retry:{enabled:true,maxRetries:2,baseDelayMs:1}});t.after(()=>h.session.dispose());seed(h.manager);h.sync()
  await h.runtime.compact('Retry fixture')
  const progress=h.events.filter(event=>['compaction_retry','compaction_attempt','compaction_retry_finished'].includes(event.type))
  assert.deepEqual(progress.map(event=>event.type),['compaction_retry','compaction_attempt','compaction_retry_finished'])
  assert.equal(progress[0].attempt,1);assert.equal(progress[0].maxAttempts,2);assert.equal(progress[0].delayMs,1)
  assert.match(progress[0].error,/REDACTED/);assert.doesNotMatch(progress[0].error,/secretfixturetoken/)
  assert.equal(h.events.at(-1).type,'compaction_end');assert.equal(h.events.at(-1).ok,true)
  const count=h.events.length;h.state.onEvent({type:'compaction_retry_finished'});assert.equal(h.events.length,count,'late progress after end is ignored')
})

test('native retry exhaustion and cancellation preserve checkpoint and clear progress at end', async t => {
  for(const cancel of [false,true]) {
    const h=harness({failures:10,retry:{enabled:true,maxRetries:1,baseDelayMs:cancel?10000:1}});t.after(()=>h.session.dispose());seed(h.manager);h.sync()
    if(cancel) h.runtime.subscribe(event=>{if(event.type==='compaction_retry')void h.runtime.abort()})
    const before=h.manager.getEntries().length
    await assert.rejects(h.runtime.compact())
    assert.equal(h.manager.getEntries().length,before)
    assert.equal(h.events.at(-1).type,'compaction_end');assert.equal(h.events.at(-1).ok,false)
    assert.equal(Boolean(h.events.at(-1).aborted),cancel)
  }
})

test('manual threshold and overflow all use the same resolved known-model preparation settings', async t => {
  const {resolvePiCompactionSettings}=load(join(root,'src/main/agent/runtime/piCompactionPolicy.ts'))
  const settings=resolvePiCompactionSettings({provider:'openai-codex',id:'gpt-6-astra',contextWindow:65536})
  assert.deepEqual(settings,{enabled:true,reserveTokens:13107,keepRecentTokens:6553})
  for(const mode of ['manual','threshold','overflow']) {
    const h=harness({overflow:mode==='overflow',compactionSettings:settings});t.after(()=>h.session.dispose())
    seed(h.manager,mode==='overflow'?4:9);h.sync()
    if(mode==='manual')await h.runtime.compact('per-run focus');else await h.runtime.prompt({text:'continue'})
    assert.ok(h.preparations.length)
    assert.ok(h.events.some(event=>event.type==='compaction_start'&&event.reason===mode))
    for(const preparation of h.preparations)assert.deepEqual(preparation.settings,settings)
  }
})
