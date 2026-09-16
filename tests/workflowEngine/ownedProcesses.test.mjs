import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, fork } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createJiti } from 'jiti'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/ownedProcesses.fixture.mjs', import.meta.url))
const jiti = createJiti(import.meta.url, { fsCache: false })
const { terminateOwnedProcesses } = await jiti.import(join(root, 'src/main/agent/workflowEngine/processTree.ts'))
const runFixture = async (...args) => JSON.parse((await promisify(execFile)(process.execPath, [fixture, ...args], { timeout: 15000 })).stdout)
const exists = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

test('public execFile/exec callbacks and promisify result/child/errors remain intact', { skip: process.platform === 'win32' }, async () => {
  assert.deepEqual(await runFixture('contracts', root), { mode: 'contracts', preserved: true, tracked: 7 })
})
for (const api of ['spawn', 'execFile', 'exec', 'fork']) test(`${api} creates an owned group and termination removes its real grandchild`, { skip: process.platform === 'win32' }, async () => {
  const result = await runFixture('tree', root, api)
  assert.equal(result.branchGone, true); assert.equal(result.leafGone, true)
})
test('a direct child exit cannot release a still-running descendant', { skip: process.platform === 'win32' }, async () => {
  const result = await runFixture('early-exit', root, 'execFile')
  assert.equal(result.branchGone, true); assert.equal(result.leafGone, true)
})
test('worker cleanup failure retains ownership until main-side cleanup confirms the real tree is gone', { skip: process.platform === 'win32' }, async () => {
  const result = await runFixture('release-failure', root, 'execFile')
  assert.equal(result.branchGone, true); assert.equal(result.leafGone, true)
})
test('main-side cleanup reaps the owned tree after its worker is force-killed', { skip: process.platform === 'win32' }, async () => {
  const worker = fork(fixture, ['hold', root, 'execFile'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const owned = new Map()
  let branch, leaf
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('worker fixture did not start')), 10000)
      worker.on('message', message => {
        if (message.event?.type === 'process.owned') owned.set(message.event.pid, message.event.group)
        if (message.ready) { branch = message.branch; leaf = message.leaf; clearTimeout(timer); resolve() }
      })
      worker.once('error', reject)
    })
    assert.equal(owned.get(branch), true)
    const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited
    await terminateOwnedProcesses(owned)
    assert.equal(exists(branch), false); assert.equal(exists(leaf), false)
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL')
    await terminateOwnedProcesses(owned).catch(() => {})
    if (leaf && exists(leaf)) process.kill(leaf, 'SIGKILL')
  }
})
test('accepted POSIX signals do not mean process termination was confirmed', async () => {
  const signals = []
  await assert.rejects(terminateOwnedProcesses(new Map([[85001, true]]), { platform: 'darwin', signal: (pid, signal) => signals.push([pid, signal]), isAlive: () => true, graceMs: 0, timeoutMs: 0 }), /termination was not confirmed/)
  assert.deepEqual(signals, [[-85001, 'SIGTERM'], [-85001, 'SIGKILL']])
})
test('Windows cleanup uses tree termination and propagates taskkill failure', async () => {
  const calls = []
  await terminateOwnedProcesses(new Map([[85002, false]]), { platform: 'win32', taskkill: async pid => { calls.push(pid) }, isAlive: () => false })
  assert.deepEqual(calls, [85002])
  await assert.rejects(terminateOwnedProcesses(new Map([[85002, false]]), { platform: 'win32', taskkill: async () => { throw Error('taskkill access denied') }, isAlive: () => false }), /taskkill access denied/)
  await assert.rejects(terminateOwnedProcesses(new Map([[85002, false]]), { platform: 'win32', taskkill: async () => {}, isAlive: () => true, timeoutMs: 0 }), /termination was not confirmed/)
})
