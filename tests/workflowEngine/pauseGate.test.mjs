import test from 'node:test'
import assert from 'node:assert/strict'
import {createJiti} from 'jiti'
const {PauseGate}=await createJiti(import.meta.url,{fsCache:false}).import('../../src/main/agent/workflowEngine/pauseGate.ts')
const tick=()=>new Promise(r=>setImmediate(r))
test('an active boundary drains before paused; resume continues without restarting',async()=>{
 const c=new AbortController(),states=[],gate=new PauseGate(c.signal,s=>states.push(s))
 await gate.enter();gate.pause();assert.deepEqual(states,[])
 let next=false;const pending=gate.enter().then(()=>{next=true})
 gate.leave();await tick();assert.deepEqual(states,[true]);assert.equal(next,false)
 gate.resume();await pending;assert.equal(next,true);assert.deepEqual(states,[true,false]);gate.leave()
})
test('Stop wakes every paused waiter and rejects without entering work',async()=>{
 const c=new AbortController(),gate=new PauseGate(c.signal);gate.pause()
 const waits=[gate.enter(),gate.checkpoint()];c.abort(new Error('Stopped'))
 for(const pending of waits)await assert.rejects(pending,/Stopped/)
})
