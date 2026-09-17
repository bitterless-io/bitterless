import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { computed, reactive, ref } from 'vue'
const root=resolve(import.meta.dirname,'../..')
const parse=file=>{const text=readFileSync(resolve(root,file),'utf8').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1];return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true)}
const compile=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const app=parse('src/renderer/maestro/control/src/ControlApp.vue')
let callback
const visit=node=>{if(ts.isCallExpression(node)&&node.arguments[0]?.getText(app)==="'coach/agent-compaction'")callback=node.arguments[1].getText(app);ts.forEachChild(node,visit)}
visit(app);assert.ok(callback)
const statusTree=parse('src/renderer/maestro/control/src/ResponseStatus.vue')
const declaration=statusTree.statements.filter(ts.isVariableStatement).flatMap(node=>[...node.declarationList.declarations]).find(node=>node.name.getText(statusTree)==='status')
const locale=readFileSync(resolve(root,'src/renderer/common/i18n/zh.ts'),'utf8')
const copy=Object.fromEntries(['compacting','compactionRetry','compactionWait','compactionQueued'].map(key=>[key,new RegExp(key+": '([^']+)'",'u').exec(locale)[1]]))

test('manual compaction status counts down retries, clears each phase and isolates chats',()=>{
  const sessions=reactive([{id:'a'},{id:'b'}]), errors=[]
  const store={sessions,pushErrorCard:(...args)=>errors.push(args)},exports={}
  new Function('exports','messageStore',compile('exports.handle = '+callback))(exports,store)
  const props={session:sessions[0]},tick=ref(Date.now()),turn=computed(()=>props.session.turn)
  new Function('exports','computed','props','tick','turn','confirming','waiting','live','i18nHelper',compile('exports.status = '+declaration.initializer.getText(statusTree)))(exports,computed,props,tick,turn,{value:undefined},{value:undefined},{value:[]},{maestroControl:{responseStatus:copy}})
  const send=state=>exports.handle({params:{sessionId:'a',...state}})
  send({active:true})
  assert.equal(exports.status.value.text,'正在压缩')
  send({active:true,retry:{attempt:2,maxAttempts:3,delayMs:2000,error:'503 overloaded'}})
  tick.value=sessions[0].compactionRetry.startedAt
  assert.match(exports.status.value.text,/2\/3/);assert.equal(exports.status.value.meta,'等待 2 秒 · 503 overloaded')
  tick.value+=2500;assert.equal(exports.status.value.meta,'等待 0 秒 · 503 overloaded')
  send({active:true});assert.equal(sessions[0].compactionRetry,undefined);assert.equal(exports.status.value.text,'正在压缩')
  exports.handle({params:{sessionId:'b',active:true,retry:{attempt:1,maxAttempts:2,delayMs:10,error:'other chat'}}})
  assert.equal(sessions[0].compactionRetry,undefined)
  send({active:false,errorMessage:'summary failed'});assert.equal(exports.status.value,null);assert.equal(errors.length,1)
  send({active:true,retry:{attempt:1,maxAttempts:3,delayMs:500,error:'retry'}})
  send({active:false,aborted:true});assert.equal(sessions[0].compactionRetry,undefined);assert.equal(exports.status.value,null)
  exports.handle({params:{sessionId:'missing',active:false,errorMessage:'stale'}});assert.equal(errors.length,1)
})
