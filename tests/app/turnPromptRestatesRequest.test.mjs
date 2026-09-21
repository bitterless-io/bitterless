// 这一轮要做什么,必须在提示词开头也说一遍。
//
// 底部本来就有一道围栏(`turn-prompt-buries-the-user-message.md` 那次加的),但围栏是**结构**判据,
// 没解决**位置**问题:指令仍然在 76,030 字符里的最后 144 字符,占 **0.189%**。
// 实测(2026-09-21)模型两次栽在这上面:
//  · 一次直接回「this turn came through with only page context and no instruction」—— 指令就在末尾;
//  · 一次从上面的参考材料里抓了个绝对路径(会话自己的 jsonl)当成任务目标,三个 Agent 扫完了它。
//
// 复述而不是重排:重排 76KB 会动到每一个已经调好的块(skills / tabs / workflows),回归面太大。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/main/agent/runtime/agentPrompt.ts'), 'utf8')

test('请求原文出现在提示词开头', () => {
  const at = source.indexOf("This turn's request, verbatim")
  assert.ok(at > 0, '复述必须存在')
  // 它必须排在这个回合提示词的第一个输出项 `dynamicPrefix` 之前 —— 排在后面就不是「开头」。
  assert.ok(at < source.indexOf('    dynamicPrefix,'), '复述必须在第一个输出项之前')
})

test('同时说明哪一份是权威,否则会被当成两件事', () => {
  assert.match(source, /authoritative copy is inside <user_message> below\. Same request, not two\./)
  assert.match(source, /'<user_message>',/, '末尾那份权威副本不能被顺手搬走')
})

test('复述有界,权威副本不裁', () => {
  assert.match(source, /clipText\(params\.message\.trim\(\), 600\)/, '复述是预览,要裁')
  const fenced = source.slice(source.indexOf("'<user_message>',"))
  assert.match(fenced, /params\.message,/, '末尾那份必须是完整原文')
})

test('空消息不留一行空复述', () => {
  assert.match(source, /params\.message\.trim\(\)\s*\?/, '空消息要跳过整段')
})
