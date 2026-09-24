# `controlLoginPreviewWorkspace.test.mjs` 跑完不退出：夹具缺绑定，失败被测试自己变成了死等

Status: 根因已证实(2026-09-24),**修法已定**(Ral 2026-09-24「按照你建议的方式去修」)

任务：bitterless `docs/plan/tasks/unit-test-hang-201.md`(照搬 Cowork `unit-test-hang-001` 修好的共用测试)(排在 Decision Helper 之后)。

Paired with `micromeet-cowork`:`docs/issues/unit-tests-hang-after-fixture-drift.md`(完整分析与证据在那边;本仓的 `tests/onlypreview/controlLoginPreviewWorkspace.test.mjs`
与 cowork 的 `tests/unit/controlLoginPreviewWorkspace.test.mjs` 逐字节相同)。

## 现象与判定

`node --test tests/onlypreview/controlLoginPreviewWorkspace.test.mjs` 跑完最后一条用例后进程永远不退出(2026-09-24 实测 25 s 仍在，被杀),
汇总与失败原因都不会打印。测试必须能结束，失败必须报成失败 —— **是缺陷**。

## 根因

- **触发:** 本仓执行产品代码时缺的绑定是 `subscribeControlChannel`(`evaluate()` 里报 `subscribeControlChannel is not defined`),`channel.init()` 失败。
  cowork 那边缺的是 `AGENT_DECISIONS_CHANGED`,属于同一类夹具滞后。
- **变成挂起:** 第 239 行 `while (!h.adopting) await tick()` 没有上限;`init` 失败后 `h.adopting` 永远不会变真，`setImmediate` 无限转圈。
  node:test 默认没有单条超时。
- 本仓只有这一个文件受影响;cowork 另有 `sessionUndoAndTitle.test.mjs`,本仓没有。

## 修法方向

与 cowork 同一套：等待加上限(到点 `assert.fail` 并带上 `init` 的错误);测试脚本带 `--test-timeout`;补齐 `subscribeControlChannel`。
测试文件两仓逐字节相同，改一边就同步另一边。

## 另记：同一根因造成的既有失败(不挂住;2026-09-24 审查发现)

These tests don't hang, but the root cause is the same: the source evolved and the fixtures that extract it didn't. Both were confirmed on HEAD by review 2 of `uiact-wait-193` (`docs/plan/reviews/uiact-wait-193-2.md` F4 / F5).

| Test | Symptom | Cause |
|---|---|---|
| `tests/skillScopes/execution.test.mjs` | 26/26 fail: no stub for `@main/decision/jevDecision.service` | Since 6bf96d09, `skillScript.ts` and `requestExec.service.ts` have new dependencies the fixture's load map doesn't cover. After adding that stub, it next stops at `@maestro-main/drive/uiActGate`, `snapshotSegment` and `documentReader.service`. |
| `tests/maestro/uiActSelectorMiss.test.mjs` | 3/3 `ReferenceError: gateUiActions is not defined` | Since 6bf96d09, ui_act goes through the gate, and the fixture doesn't bind the gate. |

Fix these after `decision-helper-199`, which changes `skillScript.ts`'s dependencies to `decisionHelper`, so the stubs needed will be different. Either fold them into `unit-test-hang-201` or open a separate task.
