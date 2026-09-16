import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { join } from 'node:path'
import { createJiti } from 'jiti'

const [mode, root, api] = process.argv.slice(2)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

if (mode === 'branch') {
  const leaf = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  process.stdout.write(`${leaf.pid}\n`)
  if (api === 'early-exit') process.exit(0)
  setInterval(() => {}, 1000)
} else {
  const events = []
  process.parentPort = { on() {}, postMessage(event) { events.push(event); process.send?.({ event }) } }
  const jiti = createJiti(import.meta.url, { fsCache: false })
  const engine = join(root, 'src/main/agent/workflowEngine')
  const { terminateOwnedProcesses } = await jiti.import(join(engine, 'processTree.ts'))
  const { trackOwnedProcesses } = await jiti.import(join(engine, 'ownedProcesses.ts'))
  const original = { execFile: childProcess.execFile, exec: childProcess.exec, fork: childProcess.fork, spawn: childProcess.spawn }
  trackOwnedProcesses()
  trackOwnedProcesses()
  for (const name of Object.keys(original)) assert.equal(childProcess[name], original[name])

  if (mode === 'contracts') {
    const code = 'process.stdout.write("out");process.stderr.write("err")'
    const callbackOutput = await new Promise((resolve, reject) => {
      childProcess.execFile(process.execPath, ['-e', code], (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }))
    })
    assert.deepEqual(callbackOutput, { stdout: 'out', stderr: 'err' })
    const promise = promisify(childProcess.execFile)(process.execPath, ['-e', code])
    assert.ok(promise.child.pid)
    assert.deepEqual(await promise, callbackOutput)
    const buffer = await promisify(childProcess.execFile)(process.execPath, ['-e', code], { encoding: 'buffer' })
    assert.ok(Buffer.isBuffer(buffer.stdout)); assert.equal(buffer.stdout.toString(), 'out'); assert.equal(buffer.stderr.toString(), 'err')
    await assert.rejects(promisify(childProcess.execFile)(process.execPath, ['-e', code + ';process.exit(7)']), error => error.code === 7 && error.stdout === 'out' && error.stderr === 'err')
    const execPromise = promisify(childProcess.exec)('printf out; printf err >&2')
    assert.ok(execPromise.child.pid); assert.deepEqual(await execPromise, callbackOutput)
    await new Promise((resolve, reject) => childProcess.execFile('/usr/bin/true', error => error ? reject(error) : resolve()))
    await new Promise((resolve, reject) => childProcess.execFile('/usr/bin/true', { encoding: 'utf8' }, error => error ? reject(error) : resolve()))
    await wait(100)
    const owned = events.filter(event => event.type === 'process.owned')
    assert.equal(owned.length, 7)
    assert.ok(owned.every(event => event.group))
    assert.equal(events.filter(event => event.type === 'process.released').length, 7)
    process.stdout.write(JSON.stringify({ mode, preserved: true, tracked: owned.length }))
  } else {
    const fixture = process.argv[1]
    const args = [fixture, 'branch', root, mode === 'early-exit' || mode === 'release-failure' ? 'early-exit' : 'hold']
    let branch
    if (api === 'execFile') branch = childProcess.execFile(process.execPath, args)
    else if (api === 'exec') branch = childProcess.exec([process.execPath, ...args].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' '))
    else if (api === 'fork') branch = childProcess.fork(fixture, args.slice(1), { silent: true })
    else branch = childProcess.spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false })
    const closed = once(branch, 'close')
    const nativeKill = process.kill
    let deniedSignals = 0
    if (mode === 'release-failure') process.kill = function (pid, signal) {
      if (pid === -branch.pid && signal === 'SIGTERM' && deniedSignals === 0) {
        deniedSignals++
        throw Object.assign(new Error('Injected worker cleanup signal denial'), { code: 'EPERM' })
      }
      return nativeKill.call(this, pid, signal)
    }
    let leaf
    try {
      leaf = Number(String((await once(branch.stdout, 'data'))[0]).trim())
      assert.ok(leaf > 1)
      const ownership = events.find(event => event.type === 'process.owned' && event.pid === branch.pid)
      assert.deepEqual(ownership, { type: 'process.owned', pid: branch.pid, group: true })
      if (mode === 'hold') {
        process.send?.({ ready: true, branch: branch.pid, leaf })
        await new Promise(() => {})
      }
      if (mode === 'release-failure') {
        await closed
        const deadline = Date.now() + 6000
        while (deniedSignals === 0 && Date.now() < deadline) await wait(25)
        assert.equal(deniedSignals, 1)
        assert.equal(events.some(event => event.type === 'process.released' && event.pid === branch.pid), false)
      }
      if (mode !== 'early-exit') await terminateOwnedProcesses(new Map([[branch.pid, true]]))
      await closed
      if (mode === 'early-exit') {
        const deadline = Date.now() + 6000
        while (!events.some(event => event.type === 'process.released' && event.pid === branch.pid) && Date.now() < deadline) await wait(25)
        assert.ok(events.some(event => event.type === 'process.released' && event.pid === branch.pid))
      }
      assert.equal(alive(branch.pid), false)
      assert.equal(alive(leaf), false)
      // Main-side cleanup proves the tree is gone independently of the worker's advisory
      // release event. A failed worker-side signal deliberately retains that ownership.
      process.stdout.write(JSON.stringify({ mode, api, branchGone: true, leafGone: true }))
    } finally {
      process.kill = nativeKill
      await terminateOwnedProcesses(new Map([[branch.pid, true]])).catch(() => {})
      if (leaf && alive(leaf)) process.kill(leaf, 'SIGKILL')
    }
  }
}
