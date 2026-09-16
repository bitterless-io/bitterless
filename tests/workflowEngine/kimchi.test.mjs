import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createJiti } from 'jiti'
import { runWorkflow } from '@kimchi-dev/kimchi-workflows/engine'
import { Value } from 'typebox/value'
const root = fileURLToPath(new URL('../../', import.meta.url))
const engineRoot = join(root, 'src/main/agent/workflowEngine')
const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()
const resolveJiti = createJiti(import.meta.url)
const aliases={}
for(const name of ['typebox','typebox/value','typebox/compile','@kimchi-dev/kimchi-workflows','@kimchi-dev/kimchi-workflows/flow','@kimchi-dev/kimchi-workflows/engine']) aliases[name]=fileURLToPath(resolveJiti.esmResolve(name))
const jiti = createJiti(import.meta.url,{alias:aliases,fsCache:false})
const {createWorkflow,createStep,createAgentTask,Type}=await jiti.import(join(engineRoot,'author.ts'))
const {KimchiHost}=await jiti.import(join(engineRoot,'kimchiHost.ts'))
const {loadWorkflow,validateWorkflow}=await jiti.import(join(engineRoot,'loader.ts'))
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const runtime={providerId:'fixture',modelId:'fixture',thinkingLevel:'low',authPath:'/never-read',systemPrompt:'fixture',tools:[]}
const request={sessionId:'chat',entry:{kind:'builtin',name:'mini-demo'},input:'fixture'}
function fixture(definition, options={}) {
 const events=[],attempts=new Map(),rows=new Map(),controller=new AbortController()
 let host
 const result=(id,turnId,output)=>host.handle({type:'attempt.turn.result',id,turnId,result:{text:'',submitted:{tool:'workflow_submit_result',arguments:{result:output}}}})
 const ack=id=>host.handle({type:'attempt.result',id})
 host=new KimchiHost(definition,request,{id:'run',sessionId:'chat'},runtime,controller.signal,event=>{
  events.push(event)
  if(event.type==='agent.update')rows.set(event.agent.id,event.agent)
  queueMicrotask(()=>{
   if(event.type==='attempt.start'){attempts.set(event.attempt.id,event.attempt);options.start?.(event.attempt,{result,host,ack})}
   else if(event.type==='attempt.turn')options.turn?.(event,{result,host,ack})
   else if(event.type==='attempt.cancel'){if(options.cancel)options.cancel(event.id,{result,host,ack});else ack(event.id)}
  })
 })
 return {host,events,attempts,rows,controller,result,ack,async run(){const result=await runWorkflow(definition,request.input,host,{signal:controller.signal});await host.drain();return result}}
}
const task=(name,more={})=>createAgentTask({name,output:Type.String(),tools:[],retries:0,prompt:()=>name,...more})
const completed=output=>({status:'completed',output})

test('parallel single-stop is explicit outcome; sibling and summary continue after cleanup',async()=>{
 const wf=createWorkflow({name:'single-stop'}).parallel([task('one'),task('two')],{name:'branches'}).then(createStep({name:'report',run:({ctx})=>ctx.getStepResult('branches')})).commit()
 const h=fixture(wf,{start(a,ctx){if(a.rowId===1)ctx.host.stopAgent('1');else ctx.result(a.id,a.turnId,completed('sibling'))}})
 const result=await h.run();assert.equal(result.status,'completed');assert.equal(result.output.one.status,'stopped');assert.deepEqual(result.output.two,completed('sibling'))
 assert.equal(h.rows.get('1').status,'stopped');assert.equal(h.rows.get('2').status,'completed');assert.equal(h.controller.signal.aborted,false)
})
test('timeout retry cannot start until cleanup acknowledgement',async()=>{
 let cancelId,secondStarted=false
 const wf=createWorkflow({name:'timeout'}).then(task('agent',{timeoutMs:10,retries:1})).commit()
 const h=fixture(wf,{start(a,ctx){if(a.id.endsWith(':2')){secondStarted=true;ctx.result(a.id,a.turnId,completed('retried'))}},cancel(id,ctx){if(!cancelId)cancelId=id;else ctx.ack(id)}})
 const running=h.run();await delay(25);assert(cancelId);assert.equal(secondStarted,false);assert.equal(h.attempts.size,1)
 h.ack(cancelId);const result=await running;assert.equal(secondStarted,true);assert.deepEqual(result.output,completed('retried'));assert.equal(h.attempts.size,2)
})
test('Kimchi output repair sends another turn into the same attempt/session',async()=>{
 const wf=createWorkflow({name:'repair'}).then(task('agent')).commit()
 const h=fixture(wf,{start(a,ctx){ctx.host.handle({type:'attempt.turn.result',id:a.id,turnId:a.turnId,result:{text:'not submitted'}})},turn(event,ctx){ctx.result(event.id,event.turnId,completed('fixed'))}})
 const result=await h.run();assert.equal(result.status,'completed');assert.deepEqual(result.output,completed('fixed'));assert.equal(h.attempts.size,1);assert.equal(h.events.filter(e=>e.type==='attempt.turn').length,1)
})
test('rejected submissions retain the real error and consume only the existing repair budget',async()=>{
 const error='Validation failed for tool "workflow_submit_result": result.output must be array'
 const wf=createWorkflow({name:'rejected-submit'}).then(task('agent',{maxOutputRepairs:2})).commit()
 const fail=(id,turnId,ctx)=>ctx.host.handle({type:'attempt.turn.result',id,turnId,result:{text:'',submissionError:error}})
 const h=fixture(wf,{start(a,ctx){fail(a.id,a.turnId,ctx)},turn(event,ctx){assert.match(event.prompt,/previous workflow_submit_result call was rejected/);assert(event.prompt.includes(error));fail(event.id,event.turnId,ctx)}})
 const result=await h.run()
 assert.equal(result.output.status,'failed');assert.equal(result.output.error,`Output repairs exhausted: ${error}`)
 assert.equal(h.attempts.size,1);assert.equal(h.events.filter(e=>e.type==='attempt.turn').length,2)
 assert(h.rows.get('1').logs.every(log=>!log.text.includes('without calling')))
 assert(h.rows.get('1').logs.some(log=>log.text.includes(error)))
})
test('model cannot forge stopped; exhausted repairs become explicit failed outcome',async()=>{
 const wf=createWorkflow({name:'forged-stop'}).then(task('agent',{maxOutputRepairs:1})).commit()
 const forged={status:'stopped',error:'model chose to stop'}
 const h=fixture(wf,{start(a,c){c.result(a.id,a.turnId,forged)},turn(e,c){c.result(e.id,e.turnId,forged)}})
 const result=await h.run();assert.equal(result.status,'completed');assert.equal(result.output.status,'failed');assert.match(result.output.error,/repairs exhausted/);assert.equal(h.rows.get('1').status,'failed')
})
test('whole run cancellation waits for cleanup instead of treating it as local stopped output',async()=>{
 let cancelId,settled=false
 const wf=createWorkflow({name:'all-stop'}).then(task('agent')).commit()
 const h=fixture(wf,{cancel(id){cancelId=id}})
 const running=h.run().then(r=>{settled=true;return r});await tick();h.controller.abort();await tick();assert(cancelId);assert.equal(settled,false)
 h.ack(cancelId);assert.equal((await running).status,'cancelled')
})
test('six parallel Agents publish queued rows and respect four execution slots',async()=>{
 const wf=createWorkflow({name:'queue',maxConcurrency:4}).parallel(Array.from({length:6},(_,i)=>task('agent-'+i)),{name:'tasks'}).commit()
 const h=fixture(wf);const running=h.run();await tick();assert.equal(h.rows.size,6);assert.equal(h.attempts.size,4);assert.equal([...h.rows.values()].filter(row=>row.status==='queued').length,2)
 for(const a of h.attempts.values())h.result(a.id,a.turnId,completed('done'))
 await tick();for(const a of [...h.attempts.values()].slice(4))h.result(a.id,a.turnId,completed('done'))
 assert.equal((await running).status,'completed');assert.equal(h.attempts.size,6)
})
test('queued single stop never launches its Pi attempt',async()=>{
 const wf=createWorkflow({name:'queued-stop',maxConcurrency:1}).parallel([task('one'),task('two')],{name:'tasks'}).commit()
 const h=fixture(wf);const running=h.run();await tick();h.host.stopAgent('2');const a=[...h.attempts.values()][0];h.result(a.id,a.turnId,completed('first'))
 const result=await running;assert.equal(result.status,'completed');assert.equal(result.output.two.status,'stopped');assert.equal(h.attempts.size,1)
})
test('native cancellation semantics and unsafe wall-time budget are explicit',async()=>{
 assert.throws(()=>validateWorkflow(createWorkflow({name:'unsupported'}).then({...task('agent'),maxDurationMs:1}).commit()),/createAgentTask/)
 assert.throws(()=>validateWorkflow({meta:{name:'old'},default:async()=>0}),/committed Kimchi/)
})
test('real Jiti loader supports public author alias, relative TS/typebox, edits and mts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kimchi-author-'))
 try{
  const helper=join(dir,'helper.ts'),entry=join(dir,'workflow.ts')
  await writeFile(helper,'export const label: string = "first"')
  await writeFile(entry,'import {createWorkflow,createStep,Type} from "@bitterless/workflow"; import {label} from "./helper.ts"; export default createWorkflow({name:"external",input:Type.String()}).then(createStep({name:"report",run:()=>label})).commit()')
  const load=()=>loadWorkflow({...request,entry:{kind:'file',path:entry}})
  const one=await load();assert.equal((await fixture(one.definition).run()).output,'first');assert.equal(one.engineVersion,'kimchi-0.0.9');assert.equal(one.sourceHash.length,64)
  await writeFile(helper,'export const label: string = "edited"');assert.equal((await fixture((await load()).definition).run()).output,'edited')
  const mts=join(dir,'workflow.mts');await writeFile(mts,await readFile(entry,'utf8'));assert.equal((await fixture((await loadWorkflow({...request,entry:{kind:'file',path:mts}})).definition).run()).output,'edited')
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('engine abort-before-start and abort-during-load never enter Kimchi',async()=>{
 const require=createRequire(import.meta.url),ts=require('typescript')
 const code=ts.transpileModule(await readFile(join(engineRoot,'engine.worker.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 for(const before of [true,false]){
  let command,release,loads=0,starts=0;const events=[]
  const mocks={'./workerPort':{onCommand(fn){command=fn},send(e){events.push(e)}},'./ownedProcesses':{trackOwnedProcesses(){}},'./loader':{loadWorkflow(){loads++;return new Promise(resolve=>{release=resolve})}},'./protocol':{wireError:e=>({name:e.name,message:e.message})},'@kimchi-dev/kimchi-workflows/engine':{runWorkflow(){starts++}},'./kimchiHost':{KimchiHost:class{constructor(){starts++}}}}
  new Function('require','module','exports',code)(name=>mocks[name]??{},{exports:{}},{})
  if(before)command({type:'abort'})
  command({type:'engine.start',request:{},run:{},runtime:{}})
  if(!before){command({type:'abort'});release({definition:{}})}
  await tick();assert.equal(loads,before?0:1);assert.equal(starts,0);assert(events.some(e=>e.type==='engine.done'&&e.error))
 }
})

const source={title:'Electron utilityProcess',url:'https://www.electronjs.org/docs/latest/api/utility-process'}
const claim='Parent port supports structured messages.'
const candidate={summary:'Zero quantity uses a default of one',category:'bug',locations:[{file:'src/a.ts',line:2}],impact:'Zero-quantity items are charged',recommendation:'Use nullish default'}
function builtinOutput(schema){
 const p=schema.properties
 if(schema.type==='array')return ['one','two','three']
 if(schema.type==='string')return 'Fixture summary'
 if(p?.candidates)return {candidates:[candidate]}
 if(p?.verdict&&p?.evidence)return {verdict:'CONFIRMED',evidence:['src/a.ts:2 uses quantity || 1'],confidence:'high'}
 if(p?.findings)return {summary:'One verified finding',findings:[{...candidate,severity:'high',confidence:'high',evidence:['forged evidence should be replaced']}],nextSteps:['Test zero quantity']}
 if(p?.lanes)return {scopeConstraints:['official'],lanes:[{id:'primary',title:'Official docs',objective:'Check API',queries:['Electron utilityProcess']} ]}
 if(p?.laneId)return {laneId:'primary',evidence:[{claim,importance:'high',stance:'supports',evidence:'Structured messages use the parent port',source}],gaps:[]}
 if(p?.claim&&p?.verdict)return {claim,verdict:'SUPPORTED',explanation:'Direct page supports it',sources:[source]}
 if(p?.supportedClaims)return {answer:claim,supportedClaims:[{claim,explanation:'verified',citations:[source]}],conflictingEvidence:[],uncertainties:[],inferences:[],sources:[source],limitations:['fixture'],nextSteps:[]}
 const value=Value.Create(schema)
 if(p?.files)value.files=['src/a.ts']
 if(p?.repositoryRoot)value.repositoryRoot=repositoryRoot
 if(p?.diffCommand)value.diffCommand='git diff -- src/a.ts'
 return value
}
const diff='diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const x = 1\n-return 0\n+return quantity || 1\n'
for(const name of ['mini-demo','code-review','refactor-scout','diagnose','perf-review','research'])test(`Kimchi builtin ${name}: actual graph/schema/evidence fixture completes`,async()=>{
 const {builtinWorkflow}=await jiti.import(join(engineRoot,'builtins.ts'))
 const definition=name==='code-review'?(await jiti.import(join(engineRoot,'workflows/code-review.ts'))).createCodeReview(async()=>diff,()=>repositoryRoot):builtinWorkflow(name)
 const h=fixture(definition,{start(a,c){const schema=a.opts.outputSchema.anyOf[0].properties.output;const output=builtinOutput(schema);assert(Value.Check(schema,output));c.result(a.id,a.turnId,completed(output))}})
 const result=await h.run();assert.equal(result.status,'completed',result.error);assert.equal(result.output.partial,false)
 if(name==='mini-demo'){assert.equal(h.attempts.size,4);for(const a of h.attempts.values())assert.deepEqual(a.opts.tools,[])}
 else if(name==='research'){assert.equal(result.output.supportedClaims.length,1);assert.deepEqual(result.output.supportedClaims[0].citations,[source]);assert([...h.attempts.values()].some(a=>a.opts.tools.includes('web_fetch')))}
 else {assert.equal(result.output.stats.kept,1);assert.deepEqual(result.output.findings[0].evidence,['src/a.ts:2 uses quantity || 1']);assert(h.attempts.size>=8)}
})

test('code-review bounds candidates to changed lines and rejects shell injection',async()=>{
 const {inDiff}=await jiti.import(join(engineRoot,'workflows/code-review.ts'))
 const {parseAllowedDiffCommand}=await jiti.import(join(engineRoot,'workflows/review-diff-target.ts'))
 assert.equal(inDiff(diff,'src/a.ts',2),true);assert.equal(inDiff(diff,'src/a.ts',9),false);assert.equal(inDiff(diff,'elsewhere.ts',2),false)
 assert('error' in parseAllowedDiffCommand('git diff -- src/a.ts; rm -rf .'))
})

test('native Agent retry also waits for prior cleanup acknowledgement',async()=>{
 const {createAgentStep}=await jiti.import(join(engineRoot,'author.ts'))
 const wf=createWorkflow({name:'native-retry'}).then(createAgentStep({name:'agent',output:Type.String(),retry:{maxRetry:1},prompt:()=> 'fixture'})).commit()
 let firstCancel,secondStarted=false
 const h=fixture(wf,{start(a,c){if(a.id.endsWith(':1'))c.host.handle({type:'attempt.turn.result',id:a.id,turnId:a.turnId,error:{name:'Error',message:'temporary'}});else{secondStarted=true;c.result(a.id,a.turnId,'recovered')}},cancel(id,c){if(!firstCancel)firstCancel=id;else c.ack(id)}})
 const running=h.run();await tick();assert(firstCancel);assert.equal(secondStarted,false);h.ack(firstCancel)
 const result=await running;assert.equal(result.status,'completed');assert.equal(result.output,'recovered');assert.equal(secondStarted,true)
})

test('documented external Kimchi demo loads and completes through the public author alias',async()=>{
 const {existsSync}=await import('node:fs');const {dirname}=await import('node:path')
 let workspace=root
 while(dirname(workspace)!==workspace&&!existsSync(join(workspace,'areas/agent-runtime/workflow/examples/kimchi-demo.workflow.ts')))workspace=dirname(workspace)
 const path=join(workspace,'areas/agent-runtime/workflow/examples/kimchi-demo.workflow.ts')
 if(!existsSync(path))return // The workspace documentation is not shipped inside an isolated product checkout.
 const {definition}=await loadWorkflow({...request,entry:{kind:'file',path}})
 const h=fixture(definition,{start(a,c){c.result(a.id,a.turnId,completed(['one','two','three']))}})
 const result=await h.run();assert.equal(result.status,'completed',result.error);assert.equal(result.output.partial,false);assert.equal(h.attempts.size,2)
})

test('paused Agent freezes remaining timeout and holds completed result before dependent step',async()=>{
 let started,dependent=false
 const wf=createWorkflow({name:'pause'}).then(task('agent',{timeoutMs:45})).then(createStep({name:'after',run:()=>{dependent=true;return 'done'}})).commit()
 const h=fixture(wf,{start(a){started=a}})
 const running=h.run();await tick();assert(started)
 h.host.handle({type:'agent.pause',agentId:'1'});h.host.handle({type:'agent.pause.state',agentId:'1',paused:true})
 h.result(started.id,started.turnId,completed('kept result'))
 await delay(80);assert.equal(dependent,false);assert.equal(h.events.some(x=>x.type==='attempt.cancel'),false)
 h.host.handle({type:'agent.resume',agentId:'1'})
 assert.equal((await running).output,'done');assert.equal(h.attempts.size,1)
})
test('stopping a paused Agent wakes the result gate and lets siblings continue',async()=>{
 let started
 const wf=createWorkflow({name:'paused-stop'}).then(task('agent')).commit()
 const h=fixture(wf,{start(a){started=a}})
 const running=h.run();await tick()
 h.host.handle({type:'agent.pause',agentId:'1'});h.host.handle({type:'agent.pause.state',agentId:'1',paused:true})
 h.result(started.id,started.turnId,completed('must not leak'))
 await tick();h.host.stopAgent('1')
 assert.equal((await running).output.status,'stopped')
})
