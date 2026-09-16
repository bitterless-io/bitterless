import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'
const root = fileURLToPath(new URL('../../', import.meta.url))
const jiti = createJiti(import.meta.url, { fsCache:false, alias:{electron:fileURLToPath(new URL('./electronStub.cjs',import.meta.url))} })
const {WorkflowSupervisor} = await jiti.import(join(root,'src/main/agent/workflowEngine/supervisor.ts'))
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
class Child extends EventEmitter {
 constructor(pid){super();this.pid=pid;this.commands=[];this.exited=false}
 postMessage(message){this.commands.push(message)}
 message(event){this.emit('message',event)}
 spawn(pid){this.pid=pid;this.emit('spawn')}
 exit(){if(!this.exited){this.exited=true;this.emit('exit',0)}}
}
async function harness(options={}) {
 const directory=await mkdtemp(join(tmpdir(),'workflow-lifecycle-')),children=[],signals=[],trees=[]
 const supervisor=new WorkflowSupervisor({storageDir:directory,workflowWorkerPath:'engine',agentWorkerPath:'agent',broadcast(){},executeTool:options.executeTool??(async()=>'')},{
  fork(){const child=new Child(options.delayedSpawn || (options.delayedAgent && children.length > 0)?undefined:91000+children.length);children.push(child);return child},
  signal(pid,signal){signals.push({pid,signal});if(options.signal)return options.signal(pid,signal,children);children.find(child=>child.pid===pid)?.exit()},
  async terminateOwnedProcesses(owned){trees.push([...owned]);await options.cleanupTrees?.(owned,children)},
  terminationGraceMs:options.grace??10,terminationTimeoutMs:options.timeout??100
 })
 const run=await supervisor.start({sessionId:'chat',input:'probe',entry:{kind:'builtin',name:'mini-demo'}},{tools:options.tools??[],...options.runtime})
 const agent={id:'1',runId:run.id,sessionId:'chat',label:'Agent',prompt:'work',status:'running',currentAction:'Thinking',queuedAt:Date.now(),logs:[]}
 const addAgent=()=>{children[0].message({type:'agent.update',agent});children[0].message({type:'attempt.start',attempt:{id:'1:1',rowId:1,turnId:'turn1',prompt:'work',opts:{}}});return children[1]}
 return {directory,children,signals,trees,supervisor,run,agent,addAgent,async close(){for(const child of children)child.exit();await supervisor.dispose();await rm(directory,{recursive:true,force:true})}}
}

test('relay credentials reach only the selected Agent worker and never the engine or durable snapshots',async()=>{
 const relay={providerId:'ai-crms',modelId:'qwen-selected',apiKey:'fixture-jwt-never-persist',baseUrl:'https://relay.example',headers:{'x-iid':'42'},model:{name:'Selected',contextWindow:262144,maxTokens:8192}}
 const h=await harness({runtime:{providerId:relay.providerId,modelId:relay.modelId,thinkingLevel:'low',authPath:'/private/auth.json',relay}})
 try{
  h.children[0].message({type:'ready'})
  const initial=h.children[0].commands.find(message=>message.type==='engine.start')
  assert.deepEqual(initial.runtime,{providerId:'ai-crms',modelId:'qwen-selected',thinkingLevel:'low'})
  const attempt={id:'1:1',rowId:1,turnId:'one',prompt:'work',opts:{},providerId:'ai-crms',modelId:'qwen-selected'}
  h.children[0].message({type:'attempt.start',attempt});h.children[1].message({type:'ready'})
  assert.deepEqual(h.children[1].commands.find(message=>message.type==='agent.start').runtime.relay,relay)
  h.children[0].message({type:'attempt.start',attempt:{...attempt,id:'2:1',rowId:2,modelId:'unselected-model'}})
  assert.equal(h.children.length,2)
  assert.match(h.children[0].commands.find(message=>message.type==='attempt.result'&&message.id==='2:1').error.message,/selected provider and model/)
  await h.supervisor.stopRun('chat',h.run.id)
  for(const value of [await h.supervisor.list(),JSON.parse(await readFile(join(h.directory,'runs.json'),'utf8')),h.children[0].commands])assert.equal(JSON.stringify(value).includes(relay.apiKey),false)
 }finally{await h.close()}
})

test('stop before spawn blocks late engine.start and kills a PID appearing after the original escalation window',async()=>{
 const h=await harness({delayedSpawn:true,timeout:800,grace:20})
 try {
  const stopping=h.supervisor.stopRun('chat',h.run.id)
  await sleep(350)
  h.children[0].spawn(92000);h.children[0].message({type:'ready'})
  await stopping
  assert.equal(h.children[0].commands.some(message=>message.type==='engine.start'),false)
  assert(h.signals.some(signal=>signal.pid===92000))
  assert.equal((await h.supervisor.list()).runs[0].status,'stopped')
 } finally {await h.close()}
})

test('stop before agent spawn blocks its late start without killing the sibling engine',async()=>{
 const h=await harness({delayedAgent:true})
 try {
  h.children[0].message({type:'ready'})
  const child=h.addAgent()
  const stopping=h.supervisor.stopAgent('chat',h.run.id,'1');await tick()
  child.spawn(92001);child.message({type:'ready'});await stopping
  assert.equal(child.commands.some(message=>message.type==='agent.start'),false)
  assert.equal(h.children[0].exited,false)
  assert.equal((await h.supervisor.list()).runs[0].agents[0].status,'stopped')
 } finally {await h.close()}
})

test('a cleanup timeout is retryable; later spawn is still reaped and never starts work',async()=>{
 const h=await harness({delayedSpawn:true,timeout:20})
 try {
  await assert.rejects(h.supervisor.stopRun('chat',h.run.id),/termination was not confirmed/)
  assert.equal((await h.supervisor.list()).runs[0].status,'stopping')
  h.children[0].spawn(92002);h.children[0].message({type:'ready'})
  await h.supervisor.stopRun('chat',h.run.id)
  assert.equal((await h.supervisor.list()).runs[0].status,'stopped')
  assert.equal(h.children[0].commands.some(message=>message.type==='engine.start'),false)
  assert(h.signals.some(signal=>signal.pid===92002))
 } finally {await h.close()}
})

test('failed Agent cleanup clears both worker and attempt promises so a second stop can succeed',async()=>{
 let fail=true
 const h=await harness({signal(pid,_signal,children){if(pid===91001&&fail)throw Object.assign(new Error('blocked signal'),{code:'EPERM'});children.find(child=>child.pid===pid)?.exit()}})
 try {
  h.children[0].message({type:'ready'});h.addAgent()
  await assert.rejects(h.supervisor.stopAgent('chat',h.run.id,'1'),/blocked signal/)
  assert.equal((await h.supervisor.list()).runs[0].agents[0].status,'stopping')
  fail=false;await h.supervisor.stopAgent('chat',h.run.id,'1')
  assert.equal((await h.supervisor.list()).runs[0].agents[0].status,'stopped')
  assert.equal(h.children[0].commands.filter(message=>message.type==='attempt.result').length,1)
 } finally {fail=false;await h.close()}
})

test('stop waits for late ownership discovered during worker exit and retries failed tree cleanup',async()=>{
 let fail=true, release
 const h=await harness({cleanupTrees:async(owned)=>{if(fail)throw new Error('tree still alive');if(owned.has(93002))await new Promise(resolve=>{release=resolve})},signal(pid,_signal,children){const child=children.find(child=>child.pid===pid);child?.message({type:'process.owned',pid:93002,group:true});child?.exit()}})
 try {
  h.children[0].message({type:'process.owned',pid:93001,group:true})
  await assert.rejects(h.supervisor.stopRun('chat',h.run.id),/tree still alive/)
  assert.equal((await h.supervisor.list()).runs[0].status,'stopping')
  fail=false;const retry=h.supervisor.stopRun('chat',h.run.id);await tick()
  assert.equal((await h.supervisor.list()).runs[0].status,'stopping');assert.equal(typeof release,'function')
  release();await retry
  assert.equal((await h.supervisor.list()).runs[0].status,'stopped')
  assert(h.trees.some(batch=>batch.some(([pid])=>pid===93001)))
  assert(h.trees.some(batch=>batch.some(([pid])=>pid===93002)))
 } finally {fail=false;release?.();await h.close()}
})

for(const finalStatus of ['completed','failed'])test(`supervisor preserves, orders and deduplicates tool logs across retry and ${finalStatus} snapshots`,async()=>{
 const h=await harness()
 try {
  h.children[0].message({type:'ready'});const worker=h.addAgent();worker.message({type:'ready'})
  worker.message({type:'agent.action',action:'read · source.ts',log:'read · source.ts'})
  const original=(await h.supervisor.list()).runs[0].agents[0].logs[0]
  const retry={ts:original.ts+1,text:'Agent: retry 1/1'}
  h.children[0].message({type:'agent.update',agent:{...h.agent,status:'retrying',logs:[retry]}})
  h.children[0].message({type:'agent.update',agent:{...h.agent,status:'running',logs:[retry]}})
  let row=(await h.supervisor.list()).runs[0].agents[0]
  assert.deepEqual(row.logs,[original,retry])
  const extra=Array.from({length:45},(_,i)=>({ts:retry.ts+i+1,text:`step ${i}`}))
  h.children[0].message({type:'agent.update',agent:{...h.agent,logs:extra}})
  h.children[0].message({type:'agent.update',agent:{...h.agent,status:finalStatus,logs:[]}})
  row=(await h.supervisor.list()).runs[0].agents[0]
  assert.equal(row.logs.length,40);assert.deepEqual(row.logs,extra.slice(-40))
  await h.supervisor.stopRun('chat',h.run.id)
  const disk=JSON.parse(await readFile(join(h.directory,'runs.json'),'utf8'))
  assert.deepEqual(disk.runs[0].agents[0].logs,extra.slice(-40))
 } finally {await h.close()}
})

async function loadAgentWorker(close=async()=>{}) {
 const require=createRequire(import.meta.url),ts=require('typescript')
 const code=ts.transpileModule(await readFile(join(root,'src/main/agent/workflowEngine/agent.worker.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 let command;const calls={session:0,turn:0,toolResult:0},events=[]
 const mocks={
  './workerPort':{onCommand(listener){command=listener},send(event){events.push(event)}},
  './ownedProcesses':{trackOwnedProcesses(){}},
  './protocol':{wireError:error=>({name:error.name,message:error.message})},
  './piAgentSession':{WorkflowPiSession:class{constructor(){calls.session++} async turn(){calls.turn++;return {text:'answer'}} close(){return close()}}},
  './agentHostTools':{AgentHostTools:class{tools(){return []}cancelAll(){}async settled(){}accept(){calls.toolResult++}}}
 }
 const module={exports:{}}
 new Function('require','module','exports',code)(name=>{if(!(name in mocks))throw Error(`Unexpected import ${name}`);return mocks[name]},module,module.exports)
 return {command,calls,events}
}
const agentStart={type:'agent.start',request:{sessionId:'chat'},runtime:{tools:[]},runId:'run',attempt:{id:'attempt',rowId:1,turnId:'turn1',prompt:'work',opts:{}}}
test('agent worker does not initialize a session after abort-before-start',async()=>{
 const worker=await loadAgentWorker();worker.command({type:'abort'});worker.command(agentStart);await tick()
 assert.deepEqual(worker.calls,{session:0,turn:0,toolResult:0});assert(worker.events.some(event=>event.type==='attempt.done'))
})
test('agent worker keeps a session across turns, receives tool acknowledgements while closing, and waits before done',async()=>{
 let release;const worker=await loadAgentWorker(()=>new Promise(resolve=>{release=resolve}))
 worker.command(agentStart);await tick()
 worker.command({type:'agent.turn',turnId:'turn2',prompt:'repair'});await tick()
 assert.equal(worker.calls.session,1);assert.equal(worker.calls.turn,2)
 assert.equal(worker.events.filter(event=>event.type==='agent.turn.done').length,2)
 assert.equal(worker.events.some(event=>event.type==='attempt.done'),false)
 worker.command({type:'abort'});await tick()
 worker.command({type:'tool.result',callId:'pending',result:'settled'})
 assert.equal(worker.calls.toolResult,1);assert.equal(worker.events.some(event=>event.type==='attempt.done'),false)
 release();await tick();assert.equal(worker.events.filter(event=>event.type==='attempt.done').length,1)
})
test('agent worker never acknowledges failed cleanup as done',async()=>{
 const worker=await loadAgentWorker(async()=>{throw Error('tool did not settle')})
 worker.command(agentStart);await tick();worker.command({type:'abort'});await tick()
 assert.equal(worker.events.some(event=>event.type==='attempt.done'),false)
 assert(worker.events.some(event=>event.type==='agent.action'&&event.action.includes('cleanup was not confirmed')))
})

test('failure log arriving after terminal state appends without changing status or clearing tool work',async()=>{
 const h=await harness()
 try {
  const worker=h.addAgent()
  worker.message({type:'agent.action',action:'read · source.ts',log:'read · source.ts'})
  const original=(await h.supervisor.list()).runs[0].agents[0].logs[0]
  h.children[0].message({type:'agent.update',agent:{...h.agent,status:'failed',logs:[]}})
  const failure={ts:original.ts+1,text:'Agent failed: fixture failure'}
  h.children[0].message({type:'agent.update',agent:{...h.agent,status:'completed',logs:[failure]}})
  h.children[0].message({type:'agent.update',agent:{...h.agent,status:'running',logs:[failure]}})
  const row=(await h.supervisor.list()).runs[0].agents[0]
  assert.equal(row.status,'failed');assert.deepEqual(row.logs,[original,failure])
  await h.supervisor.stopRun('chat',h.run.id)
  const disk=JSON.parse(await readFile(join(h.directory,'runs.json'),'utf8'))
  assert.deepEqual(disk.runs[0].agents[0].logs,[original,failure])
 }finally{await h.close()}
})

test('direct whole-run stop exposes engine cleanup failure in persisted snapshot and allows retry',async()=>{
 let fail=true
 const h=await harness({signal(pid,_signal,children){if(fail)throw Object.assign(new Error('engine signal blocked'),{code:'EPERM'});children.find(child=>child.pid===pid)?.exit()}})
 try {
  await assert.rejects(h.supervisor.stopRun('chat',h.run.id),/engine signal blocked/)
  const failed=(await h.supervisor.list()).runs[0]
  assert.equal(failed.status,'stopping');assert.match(failed.error,/资源清理尚未确认.*engine signal blocked/)
  fail=false;await h.supervisor.stopRun('chat',h.run.id)
  const recovered=(await h.supervisor.list()).runs[0]
  assert.equal(recovered.status,'stopped');assert.equal(recovered.error,undefined)
 }finally{fail=false;await h.close()}
})

test('turn relay keeps the worker alive, rejects stale results, and cleanup ACK waits for owned resources',async()=>{
 let release
 const h=await harness({cleanupTrees:()=>new Promise(resolve=>{release=resolve})})
 try {
  const engine=h.children[0];engine.message({type:'ready'});const worker=h.addAgent();worker.message({type:'ready'})
  worker.message({type:'agent.turn.done',turnId:'turn1',result:{text:'needs repair'}})
  assert.equal(h.signals.length,0)
  assert.equal(engine.commands.filter(message=>message.type==='attempt.result').length,0)
  engine.message({type:'attempt.turn',id:'1:1',turnId:'turn2',prompt:'repair output'})
  assert.deepEqual(worker.commands.at(-1),{type:'agent.turn',turnId:'turn2',prompt:'repair output'})
  worker.message({type:'agent.turn.done',turnId:'turn1',result:{text:'stale'}})
  worker.message({type:'agent.turn.done',turnId:'turn2',result:{text:'repaired'}})
  assert.equal(engine.commands.filter(message=>message.type==='attempt.turn.result').length,2)
  worker.message({type:'process.owned',pid:94001,group:true})
  engine.message({type:'attempt.cancel',id:'1:1'});await sleep(20)
  worker.message({type:'agent.turn.done',turnId:'turn2',result:{text:'late'}})
  engine.message({type:'attempt.turn',id:'1:1',turnId:'turn3',prompt:'too late'})
  assert.equal(worker.commands.some(message=>message.type==='agent.turn'&&message.turnId==='turn3'),false)
  assert.equal(engine.commands.some(message=>message.type==='attempt.result'),false)
  release();await tick();await tick()
  const done=engine.commands.filter(message=>message.type==='attempt.result')
  assert.equal(done.length,1);assert.equal(done[0].error,undefined)
  assert.equal(worker.exited,true);assert.equal(engine.exited,false)
 }finally{release?.();await h.close()}
})

test('cleanup ACK waits for host callback settlement after worker exit and keeps late cancellation delivery',async()=>{
 let settle,signal
 const h=await harness({tools:[{name:'host',description:'test',params:[]}],executeTool:async(_request,value)=>{signal=value;return new Promise(resolve=>{settle=resolve})}})
 try {
  const engine=h.children[0];engine.message({type:'ready'});const worker=h.addAgent();worker.message({type:'ready'})
  worker.message({type:'tool.request',request:{sessionId:'chat',runId:h.run.id,agentId:'1',callId:'call',toolName:'host',args:{}}});await tick()
  const stopping=h.supervisor.stopAgent('chat',h.run.id,'1');await sleep(20)
  worker.message({type:'tool.cancel',callId:'call'})
  assert.equal(signal.aborted,true)
  assert.equal(worker.exited,true)
  assert.equal(engine.commands.some(message=>message.type==='attempt.result'),false)
  assert.equal((await h.supervisor.list()).runs[0].agents[0].status,'stopping')
  settle('settled');await stopping
  assert.equal(engine.commands.filter(message=>message.type==='attempt.result').length,1)
  assert.equal((await h.supervisor.list()).runs[0].agents[0].status,'stopped')
 }finally{settle?.('settled');await h.close()}
})

test('normal cleanup receives a bounded graceful window but done alone never releases owned resources',async()=>{
 let release
 const h=await harness({grace:100,cleanupTrees:()=>new Promise(resolve=>{release=resolve})})
 try {
  const engine=h.children[0];engine.message({type:'ready'});const worker=h.addAgent();worker.message({type:'ready'})
  worker.message({type:'process.owned',pid:94002,group:true})
  engine.message({type:'attempt.cancel',id:'1:1'});await tick()
  assert.equal(worker.commands.at(-1).type,'abort')
  assert.equal(h.signals.length,0)
  worker.message({type:'attempt.done'});await tick()
  assert.equal(typeof release,'function')
  assert.equal(engine.commands.some(message=>message.type==='attempt.result'),false)
  release();await tick();await tick()
  assert.equal(worker.exited,true)
  assert.equal(engine.commands.filter(message=>message.type==='attempt.result').length,1)
 }finally{release?.();await h.close()}
})

test('native Kimchi cancellation becomes stopped only after worker cleanup',async()=>{
 const h=await harness()
 try {
  const engine=h.children[0];engine.message({type:'ready'});const worker=h.addAgent();worker.message({type:'ready'})
  engine.message({type:'engine.done',error:{name:'WorkflowCancelledError',message:'Workflow cancelled'}})
  assert.equal((await h.supervisor.list()).runs[0].status,'running')
  worker.message({type:'attempt.done'})
  const run=await h.supervisor.waitForRun(h.run.id)
  assert.equal(run.status,'stopped');assert.equal(run.agents[0].status,'stopped')
  assert.equal(worker.exited,true);assert.equal(engine.exited,true)
 }finally{await h.close()}
})

for(const prior of ['failed-agent','stopped-chat'])test(`a fresh workflow isolates reused Agent IDs after ${prior}`,{timeout:5000},async()=>{
 const h=await harness()
 try {
  const oldEngine=h.children[0];oldEngine.message({type:'ready'})
  const oldWorker=h.addAgent();oldWorker.message({type:'ready'})
  let request
  if(prior==='failed-agent') {
   oldEngine.message({type:'agent.update',agent:{...h.agent,status:'failed',error:'old submission failed',endedAt:Date.now()}})
   oldEngine.message({type:'engine.done',result:'partial result'})
   const old=await h.supervisor.waitForRun(h.run.id)
   assert.equal(old.status,'completed');assert.equal(old.agents[0].status,'failed')
   request=await h.supervisor.retryRequest('chat',h.run.id)
   assert.deepEqual(request.entry,h.run.entry);assert.equal(request.input,h.run.input)
  } else {
   // Exercise both the per-Agent stopped set and the whole-chat stop flag.
   await h.supervisor.stopAgent('chat',h.run.id,'1')
   await h.supervisor.stopSession('chat')
   const old=await h.supervisor.waitForRun(h.run.id)
   assert.equal(old.status,'stopped');assert.equal(old.agents[0].status,'stopped')
   request={sessionId:'chat',entry:{kind:'builtin',name:'mini-demo'},input:'fresh command',origin:'shortcut'}
  }
  assert.equal(oldEngine.exited,true);assert.equal(oldWorker.exited,true)
  const next=await h.supervisor.start(request,{tools:[]})
  assert.notEqual(next.id,h.run.id);assert.equal(next.status,'running');assert.deepEqual(next.agents,[])
  const engine=h.children[2];engine.message({type:'ready'})
  const agent={...h.agent,runId:next.id,queuedAt:Date.now()}
  engine.message({type:'agent.update',agent})
  engine.message({type:'attempt.start',attempt:{id:'1:1',rowId:1,turnId:'turn1',prompt:'fresh work',opts:{}}})
  const worker=h.children[3];assert.ok(worker,'reused Agent and attempt IDs must launch a new worker')
  worker.message({type:'ready'})
  assert.equal(worker.commands.find(command=>command.type==='agent.start').runId,next.id)
  assert.equal(engine.commands.some(command=>command.type==='abort'||command.type==='agent.stop'),false)
  assert.equal(worker.commands.some(command=>command.type==='abort'),false)
  const live=(await h.supervisor.list()).runs.find(run=>run.id===next.id)
  assert.equal(live.agents[0].status,'running');assert.equal(live.agents[0].error,undefined)
  // Late events from the cleaned-up attempt cannot close or overwrite the new run.
  oldEngine.message({type:'agent.update',agent:{...h.agent,status:'stopped',error:'stale'}})
  oldWorker.message({type:'agent.turn.done',turnId:'turn1',result:{text:'stale',cancelled:true}})
  worker.message({type:'agent.turn.done',turnId:'turn1',result:{text:'new result'}})
  const forwarded=engine.commands.filter(command=>command.type==='attempt.turn.result')
  assert.equal(forwarded.length,1);assert.equal(forwarded[0].result.text,'new result');assert.equal(forwarded[0].error,undefined)
  engine.message({type:'agent.update',agent:{...agent,status:'completed',output:'new result',endedAt:Date.now()}})
  engine.message({type:'engine.done',result:'new result'})
  const complete=await h.supervisor.waitForRun(next.id)
  assert.equal(complete.status,'completed');assert.equal(complete.error,undefined)
  assert.equal(complete.agents[0].status,'completed');assert.equal(complete.agents[0].output,'new result')
  assert.equal(complete.agents[0].error,undefined);assert.equal(engine.exited,true);assert.equal(worker.exited,true)
  const retained=(await h.supervisor.list()).runs.find(run=>run.id===h.run.id)
  assert.equal(retained.agents[0].status,prior==='failed-agent'?'failed':'stopped')
 }finally{await h.close()}
})
