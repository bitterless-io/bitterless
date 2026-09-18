import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

/**
 * 一个挡住流程的确认,**必须有地方能点**。
 *
 * 2026-09-18 的真实故障:状态条写着「Waiting on you · 允许 agent 运行 run_skill_file」,
 * 面板上一个按钮都没有,Ral 只能在输入框里打「允许」,而那条消息又被当成 steer 排进当前回合。
 *
 * 根因是**顺序**。`askOperator` 建的是 `transient` 任务(审批不该在时间线上占一张卡),
 * 而 `turn.service.bindTask` 对 `transient` 直接返回 null。cowork 的 `applyTaskSnapshot` 把
 * `syncTaskConfirm` 排在绑定**之后**,于是 `if (!bound) continue` 先走一步,
 * `type: 'confirm'` 消息一条都没生成 —— 而底部操作面 `ChatConfirmSheet` 只认这种消息。
 *
 * 所以这条守卫钉的是顺序本身:**确认卡的同步必须发生在任何 transient / 绑定失败的提前返回之前**。
 * 这是源码顺序断言,和 `check-agent-runtime.mjs` 那一族同一路数 —— 行为测试测不到「两条 continue
 * 的相对位置」,而这正是出事的地方。
 */
const root = resolve(import.meta.dirname, '../..')
const bl = existsSync(join(root, 'src/main/maestro'))
const storePath = join(root, bl ? 'src/renderer/maestro/control/src/store/message.store.ts' : 'src/renderer/control/src/store/message.store.ts')
const source = readFileSync(storePath, 'utf8')

/** 注释先剥掉 —— 解释这条规则的注释里就写着 `if (!bound) continue`,不剥的话守卫会去匹配自己的说明。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const applyTaskSnapshot = (() => {
  const at = source.indexOf('applyTaskSnapshot(')
  assert.ok(at > 0, 'message.store must still have applyTaskSnapshot')
  // 取到下一个同缩进的方法为止 —— 够用,且不引入一个 TS parser。
  const rest = source.slice(at)
  const end = rest.indexOf('\n  private syncTaskConfirm')
  assert.ok(end > 0, 'syncTaskConfirm should follow applyTaskSnapshot in this file')
  return stripComments(rest.slice(0, end))
})()

test('the confirm card is synced before any early return, so a transient approval still gets a card', () => {
  const sync = applyTaskSnapshot.indexOf('syncTaskConfirm(')
  assert.ok(sync > 0, 'applyTaskSnapshot must sync the confirm card')
  const transient = applyTaskSnapshot.indexOf('task.transient')
  const bailOnBinding = applyTaskSnapshot.indexOf('if (!bound) continue')
  assert.ok(bailOnBinding > 0, 'applyTaskSnapshot still bails when a task has no timeline binding')
  assert.ok(
    sync < bailOnBinding,
    'syncTaskConfirm must run BEFORE the binding bail — bindTask returns null for transient approval tasks, ' +
    'so a confirm synced after it never produces the message ChatConfirmSheet renders its buttons from'
  )
  if (transient > 0) {
    assert.ok(sync < transient, 'syncTaskConfirm must also precede the explicit transient skip')
  }
})

test('the confirm card is routed by ownership, not by the timeline binding it does not have', () => {
  assert.doesNotMatch(
    applyTaskSnapshot.slice(0, applyTaskSnapshot.indexOf('syncTaskConfirm(')),
    /const bound =/,
    'the session for a confirm card must be resolved without first requiring a task-card binding'
  )
})

test('the action sheet caps its detail so the buttons cannot be pushed out of view', () => {
  const sheet = bl
    ? readFileSync(join(root, 'src/renderer/maestro/control/src/task/ChatConfirmSheet.less'), 'utf8')
    : readFileSync(join(root, 'src/renderer/control/src/task/ChatConfirmSheet.vue'), 'utf8')
  const detail = sheet.slice(sheet.indexOf('chat-confirm-sheet__detail'))
  assert.match(
    detail.slice(0, 400),
    bl ? /max-height:\s*\d+px/ : /max-h-\d+/,
    'detail is clipText(…, 4000); without a ceiling it pushes the action row off screen'
  )
  assert.match(detail.slice(0, 400), /overflow-y[:-]\s*auto|overflow-y-auto/, 'the capped detail must scroll')
})

/**
 * 「等你确认」和那张能点的卡必须同源。Ral 2026-09-18:「不能只有 waiting on you 而没 confirm 入口,
 * 点击允许/拒绝后 waiting on you 也就不能再被显示(之前还是会显示)」。
 *
 * 两个方向都出过错:卡还没生成时状态条已经在喊(指向一个不存在的按钮);人点完之后
 * `resolveConfirm` 万一没对上会返回 ok:false,任务上的 `pendingConfirm` 永不清除,状态条就一直挂着。
 * 所以判据必须是**未被回答的 confirm 消息**,而不是任务注册表上的那个字段。
 */
test('the waiting indicator is driven by an unanswered confirm card, never by the registry alone', () => {
  const status = stripComments(readFileSync(
    join(root, bl ? 'src/renderer/maestro/control/src/ResponseStatus.vue' : 'src/renderer/control/src/ResponseStatus.vue'), 'utf8'
  ))
  // 判据抽成了 store 上的 `pendingConfirmMessages`(按钮、状态条、会话列表黄点共用一条),
  // 所以状态条这边断言「用了那条共用判据」,判据本身的 `!answer` 在 store 里断言。
  assert.match(status, /pendingConfirmMessages\(/, 'the status must read the same pending predicate the sheet renders from')
  const storeSource = stripComments(readFileSync(join(root, bl ? 'src/renderer/maestro/control/src/store/message.store.ts' : 'src/renderer/control/src/store/message.store.ts'), 'utf8'))
  assert.match(storeSource, /type === 'confirm'/, 'the shared predicate reads the confirm messages')
  assert.match(storeSource, /!\s*\w+\.confirm\.answer/, 'an ANSWERED card must stop the indicator')
  assert.doesNotMatch(
    status,
    /const confirming = computed\(\(\) => live\.value\.find\(\(task\) => task\.state\.pendingConfirm\)\)/,
    'confirming must not come from pendingConfirm alone — that is what showed a prompt with no button, and kept showing it after the click'
  )
})
