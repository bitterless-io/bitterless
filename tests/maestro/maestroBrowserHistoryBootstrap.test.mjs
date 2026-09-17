import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const entry = resolve(root, 'src/renderer/maestro/history/src/history.ts');
const mocks = {
  vue: `export const nextTick=()=>Promise.resolve(); export const createApp=()=>({use(){return this;},mount(){globalThis.runtime.phases.push('mount');}});`,
  '@arco-design/web-vue': 'export default {};',
  '@renderer/common/i18n/i18n.helper': 'export const i18n={};',
  '@renderer/common/i18n/rendererLanguage': 'export const initializeRendererLanguage=()=>globalThis.runtime.language();',
  './history.store': 'export const historyStore={init:()=>globalThis.runtime.init()};',
  './HistoryApp.vue': 'export default {};',
};
const bundle = await build({ entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,tsconfig:resolve(root,'tsconfig.web.json'),plugins:[{name:'bootstrap-boundary',setup(context){
  context.onResolve({filter:/.*/},({path})=>Object.hasOwn(mocks,path)?{path,namespace:'mock'}:/\.(less|css)$/.test(path)?{path,namespace:'style'}:undefined);
  context.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:mocks[path],loader:'js'}));
  context.onLoad({filter:/.*/,namespace:'style'},()=>({contents:'',loader:'js'}));
  // Capture the real entry's launched Promise so failures are asserted instead of unhandled.
  context.onLoad({filter:/\/history\/src\/history\.ts$/},()=>({contents:readFileSync(entry,'utf8').replace('void bootstrap();','globalThis.bootstrapResult = bootstrap();'),loader:'ts'}));
}}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture(){
  const language=deferred(),snapshot=deferred(),logs=[];
  const runtime={phases:[],language:()=>{runtime.phases.push('language');return language.promise;},init:()=>{runtime.phases.push('snapshot');return snapshot.promise;}};
  const context={runtime,console:{info:(...args)=>logs.push(args)}};
  runInNewContext(bundle.outputFiles[0].text,context);
  return{language,snapshot,logs,runtime,promise:context.bootstrapResult};
}

test('actual history entry mounts Vue before waiting for snapshot and logs each completed phase',async()=>{
  const f=fixture();assert.deepEqual(f.runtime.phases,['language']);f.language.resolve();await settle();
  assert.deepEqual(f.runtime.phases,['language','mount','snapshot']);
  assert.ok(f.logs.some(([line])=>line.includes('renderer.vue-mount.success')));
  assert.equal(f.logs.some(([line])=>line.includes('renderer.snapshot.success')),false);
  f.snapshot.resolve();await f.promise;assert.ok(f.logs.some(([line])=>line.includes('renderer.snapshot.success')));
});

test('bootstrap failure logs safe classification at its exact phase and does not fake subsequent success',async()=>{
  const f=fixture();const rejected=assert.rejects(f.promise,/private-sentinel/);
  f.language.reject(Object.assign(new Error('private-sentinel https://private.invalid'),{code:'private-code'}));await rejected;
  assert.deepEqual(f.runtime.phases,['language']);
  assert.ok(f.logs.some(([line])=>line.includes('renderer.bootstrap.failure')&&line.includes('"reason":"language"')));
  assert.equal(JSON.stringify(f.logs).includes('private-'),false);assert.equal(JSON.stringify(f.logs).includes('https://'),false);
  for(const args of f.logs)assert.equal(args.length,1);
});
