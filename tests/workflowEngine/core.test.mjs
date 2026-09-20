import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { createJiti } from 'jiti'
const root = fileURLToPath(new URL('../../', import.meta.url))
const aliases = { electron: fileURLToPath(new URL('./electronStub.cjs', import.meta.url)) }
const dependencyResolver = createJiti(import.meta.url)
const jiti = createJiti(import.meta.url, { alias: aliases, fsCache: false })
class Child extends EventEmitter {
 constructor(pid){super();this.pid=pid;this.sent=[]}
 postMessage(message){this.sent.push(message)}
 message(message){this.emit('message',message)}
 exit(){this.emit('exit',0)}
}
const runtime={providerId:'fixture',modelId:'fixture',thinkingLevel:'low',authPath:'/not-persisted/auth',systemPrompt:'secret runtime prompt',tools:[{name:'web_fetch',description:'fetch',params:[]}]}
const request={sessionId:'chat-a',entry:{kind:'builtin',name:'agent-task'},input:'test',cwd:root}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function harness(executeTool=async()=> 'result') {
 const storageDir=await mkdtemp(join(tmpdir(),'workflow-supervisor-')),children=[],signals=[]
 const {WorkflowSupervisor}=await jiti.import(join(root,'src/main/agent/workflowEngine/supervisor.ts'))
 const deps={workflowWorkerPath:'engine',agentWorkerPath:'agent',storageDir,broadcast(){},executeTool}
 const supervisor=new WorkflowSupervisor(deps,{fork(){const child=new Child(70000+children.length);children.push(child);return child},signal(pid,signal){signals.push({pid,signal});const child=children.find(child=>child.pid===pid);if(child)child.exit()},async terminateOwnedProcesses(owned){for(const [pid,group] of owned)signals.push({pid:group?-pid:pid,signal:'SIGKILL'})}})
 const run=await supervisor.start(request,runtime);children[0].message({type:'ready'})
 const addAgent=(id)=>children[0].message({type:'agent.update',agent:{id:String(id),runId:run.id,sessionId:request.sessionId,label:`Agent ${id}`,prompt:'work',status:'running',currentAction:'Thinking',queuedAt:Date.now(),logs:[]}})
 const startAgent=(id)=>{addAgent(id);children[0].message({type:'attempt.start',attempt:{id:`${id}:1`,rowId:id,prompt:'work',opts:{},providerId:'fixture',modelId:'fixture'}});children.at(-1).message({type:'ready'});return children.at(-1)}
 return {supervisor,run,children,signals,deps,storageDir,addAgent,startAgent,cleanup:async()=>{await supervisor.dispose();await rm(storageDir,{recursive:true,force:true})}}
}

test('single stop awaits tool cleanup, preserves sibling, rejects late state overwrite',async()=>{
 let sawAbort=false, release
 const h=await harness((_req,signal)=>new Promise(resolve=>{release=()=>resolve('cancelled');signal.addEventListener('abort',()=>{sawAbort=true})}))
 try{
  const first=h.startAgent(1),second=h.startAgent(2)
  first.message({type:'tool.request',request:{sessionId:request.sessionId,runId:h.run.id,agentId:'1',callId:'call',toolName:'web_fetch',args:{}}});await tick()
  const stopping=h.supervisor.stopAgent(request.sessionId,h.run.id,'1');await tick()
  assert.equal(sawAbort,true);let snapshot=await h.supervisor.list();assert.equal(snapshot.runs[0].agents[0].status,'stopping');assert.equal(snapshot.runs[0].agents[1].status,'running')
  release();await stopping;snapshot=await h.supervisor.list();assert.equal(snapshot.runs[0].agents[0].status,'stopped')
  h.children[0].message({type:'agent.update',agent:{...snapshot.runs[0].agents[0],status:'completed'}})
  assert.equal((await h.supervisor.list()).runs[0].agents[0].status,'stopped');assert.equal(h.signals.some(s=>s.pid===second.pid),false)
  const contents=await readFile(join(h.storageDir,'runs.json'),'utf8');assert.equal(contents.includes(runtime.authPath),false);assert.equal(contents.includes(runtime.systemPrompt),false)
 }finally{await h.cleanup()}
})

test('queued stop prevents dispatch; full stop reaps owned process groups',async()=>{
 const h=await harness()
 try{h.addAgent(1);await h.supervisor.stopAgent(request.sessionId,h.run.id,'1');h.children[0].message({type:'attempt.start',attempt:{id:'1:1',rowId:1,prompt:'late',opts:{},providerId:'fixture',modelId:'fixture'}});assert.equal(h.children.length,1)
 h.children[0].message({type:'process.owned',pid:80000,group:true});await h.supervisor.stopRun(request.sessionId,h.run.id);assert.equal((await h.supervisor.waitForRun(h.run.id)).status,'stopped');assert(h.signals.some(s=>s.pid===-80000&&s.signal==='SIGKILL'))
 }finally{await h.cleanup()}
})

test('chat scope enforced; unfinished snapshots fail on restart',async()=>{
 const h=await harness()
 try{h.addAgent(1);await assert.rejects(h.supervisor.stopRun('other-chat',h.run.id),/does not belong/)
 await new Promise(resolve=>setTimeout(resolve,30))
 const {WorkflowSupervisor}=await jiti.import(join(root,'src/main/agent/workflowEngine/supervisor.ts'));const restarted=new WorkflowSupervisor(h.deps,{fork(){throw Error('must not spawn')},signal(){}})
 const restored=await restarted.list();assert.equal(restored.runs[0].status,'failed');assert.equal(restored.runs[0].agents[0].status,'failed');await restarted.dispose()
 }finally{await h.cleanup()}
})

test('new start is fenced if stopSession arrives during initial persistence',async()=>{
 const h=await harness()
 try {
  const next=h.supervisor.start({...request,sessionId:'chat-b'},runtime)
  await h.supervisor.stopSession('chat-b')
  const run=await next
  assert.equal(run.status,'stopped')
  assert.equal(h.children.length,1)
 } finally {await h.cleanup()}
})

test('task activity exposes useful work without storing raw commands or URL credentials',async()=>{
 const {toolActivity}=await jiti.import(join(root,'src/main/agent/workflowEngine/toolActivity.ts'))
 assert.equal(toolActivity('read',{path:'/work/src/session.ts',token:'secret'}),'read · session.ts')
 assert.equal(toolActivity('web_fetch',{url:'https://user:password@example.test/docs?token=secret#hash'}),'web_fetch · example.test/docs')
 assert.equal(toolActivity('bash',{command:'API_KEY=secret curl example.test'}),'bash')
})
