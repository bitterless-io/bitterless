// 退出必须有终点 —— 哪怕清理永远不返回。
//
// 见 micromeet-cowork docs/issues/ctrl-c-leaves-electron-running-and-teardown-xpc-noise.md:
// 那边的 `before-quit` 在等一个不会 settle 的 ACP 清理(`net.Server#close` 等所有连接结束),
// 于是 pending 标志永远为真,后面每一次退出都被同一个 guard 直接 return —— 菜单、Cmd-Q、托盘、
// 再按一次 Ctrl-C,全都没有反应,只能从外面 kill。
//
// BL 这边形状一样:`if (quitAttempt) return`。区别是 `.finally` 会清掉标志,所以**拒绝**是可恢复的;
// **挂住**不是。这里钉住的就是那条逃生路径。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/main/app.main.ts'), 'utf8')

test('清理有时间上限 —— 挂住的清理不能把进程永久留住', () => {
  assert.match(source, /QUIT_CLEANUP_TIMEOUT_MS/, '必须有上限')
  assert.match(source, /if \(!settled\) forceExit\(/, '超时要真的强退,而不是只打日志')
  assert.match(source, /try \{ await quitAfterCleanup\(\); \} finally \{ settled = true/, '正常完成要撤掉定时器')
})

test('清理挂住时再退一次,立刻走 —— 不是再被 guard 吞掉', () => {
  assert.match(source, /if \(quitAttempt\) \{ forceExit\(/, '第二次退出要强退')
  assert.doesNotMatch(source, /if \(quitAttempt\) return;/, '原来那个静默 return 正是 bug 本身')
})

test('强退走 app.exit,不是 app.quit', () => {
  // `app.quit()` 会重新进入 before-quit —— 正是要逃离的那个 handler。
  const at = source.indexOf('const forceExit')
  const body = source.slice(at, source.indexOf('\n};', at))
  assert.match(body, /app\.exit\(0\)/)
  assert.doesNotMatch(body, /app\.quit\(\)/)
})

test('Ctrl-C 有明确路径:第一次干净退出,第二次立刻走', () => {
  assert.match(source, /for \(const signal of \['SIGINT', 'SIGTERM'\]/, '两个信号都要接')
  assert.match(source, /if \(signalled\) \{ forceExit\(/, '第二个信号必须立刻退出')
})

test('拒绝仍然可重试 —— 只有挂住是致命的', () => {
  assert.match(source, /\.finally\(\(\) => \{ quitAttempt = null; \}\)/, '失败之后要复位,否则重试不会发生')
})

// ── dev 下 Ctrl-C:信号根本没到,所以不能指望信号。──────────────────────────────────────────

test('父进程一死,孤儿进程能自己发现 —— 这是 dev 看门狗的全部依据', async () => {
  // Ral 2026-09-21 的现场:^C 之后 shell 立刻回来,renderer 还在打
  // `[vite] server connection lost. Polling for restart…`,而 `[cowork app] SIGINT` 那行**从来没出现**。
  // handler 在 bundle 里(grep 得到),只是没跑 —— Ctrl-C 杀掉的是 electron-vite,
  // 这个进程是被**重新挂载父级**,不是被发信号(Chromium 当时打的那两行
  // `task_policy_set … invalid argument` 就是这次重挂)。
  //
  // 所以判据不能是信号,得是一个不需要任何人配合的事实:ppid 变了。
  const { spawn } = await import('node:child_process')
  const { writeFile, mkdtemp, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'ppid-'))
  const child = join(dir, 'child.cjs'), parent = join(dir, 'parent.cjs'), report = join(dir, 'report')
  // 结果写文件,不走 stdio:父进程一退,继承来的管道就没人读了,孤儿的输出会丢 —— 那是测试的
  // 缺陷,不是被测机制的缺陷。
  await writeFile(child, `
    const { writeFileSync } = require('node:fs')
    const startedUnder = process.ppid
    const t = setInterval(() => {
      if (process.ppid === startedUnder && process.ppid !== 1) return
      clearInterval(t); writeFileSync(${JSON.stringify(report)}, 'DETECTED ' + startedUnder + ' -> ' + process.ppid); process.exit(0)
    }, 50)
    setTimeout(() => { writeFileSync(${JSON.stringify(report)}, 'MISSED'); process.exit(1) }, 5000)
  `)
  await writeFile(parent, `
    const { spawn } = require('node:child_process')
    spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'ignore', detached: false })
    setTimeout(() => process.exit(0), 200)
  `)
  spawn(process.execPath, [parent], { stdio: 'ignore' })
  let output = ''
  for (let i = 0; i < 120 && !output; i++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    output = await readFile(report, 'utf8').catch(() => '')
  }
  assert.match(output, /DETECTED/, '父进程消失后 ppid 必须变化 —— 变不了的话看门狗就是死的')
})

test('看门狗只在 dev 开,并且先礼后兵', () => {
  const source = readFileSync(join(root, 'src/main/app.main.ts'), 'utf8')
  const watchdog = source.slice(source.indexOf('const startedUnder = process.ppid'))
  assert.match(source, /if \(!app\.isPackaged && !isE2E\)/, '打包版由系统启动,绝不能因为父进程没了就退出')
  assert.match(watchdog, /process\.ppid === startedUnder && process\.ppid !== 1/, '判据是 ppid 变化,不是信号')
  assert.ok(watchdog.indexOf('app.quit()') < watchdog.indexOf('forceExit'), '先请求干净退出,超时再强退')
  assert.match(watchdog, /watchdog\.unref\?\.\(\)/, '这个定时器自己不许把事件循环留住')
})
