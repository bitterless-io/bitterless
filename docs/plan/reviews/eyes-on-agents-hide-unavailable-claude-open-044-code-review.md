# Code Review 报告

- 范围：`eyes-on-agents-hide-unavailable-claude-open-044` 最终重新冻结 diff 的 Vue / Less / i18n / MJS 变更，以及 UI aggregate 接线
- 日期：2026-08-18
- 增量结论：**PASS — 0 个 open 044 finding。** 第一轮审查发现的 P2（More 被改成父级 trigger 后，内层 `@click.stop` 阻断 Dropdown）已关闭：最终实现恢复直接 `a-button` trigger，并以 CSS 伪元素承载 CLI-only 未读点。430 行的新 focused test 未命中 TS-1 / TS-2，真实点击覆盖 CLI Preview 与普通 Domain 菜单，键盘 Enter / 双击覆盖 Codex、Desktop-mapped Claude、CLI-only Claude，且非 idle 未读不展示。Focused test 5/5、UI aggregate 63/63、strict UI typecheck、renderer i18n 与 `git diff --check` 均通过；未发现 TS-2、FE-1、FE-2 或剩余 P1 / P2 / P3。`ui-source.test.mjs` 在 HEAD 基线已有 1970 行的 TS-1 债务，043 冻结点为 1945 行，044 再缩短至 1944 行，未新增或扩大该债务。`package.json` 的审查仅覆盖 focused test 接入 UI aggregate；无关的既有 `name` 运行时变更不属于 044。

## 文件清单

| # | 文件 | 问题数 |
|---|------|--------|
| 1 | `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue` | 0 |
| 2 | `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less` | 0 |
| 3 | `src/renderer/common/i18n/en.ts` | 0 |
| 4 | `src/renderer/common/i18n/zh.ts` | 0 |
| 5 | `scripts/eyes-on-agents/thread-card-open-capability.test.mjs` | 0 |
| 6 | `scripts/eyes-on-agents/ui-source.test.mjs` | 1 |
| 7 | `package.json`（仅 `test:eyes-on-agents:ui`） | 0 |

## 问题清单

### 6. `scripts/eyes-on-agents/ui-source.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 6.1 | 1-1944 | TS-1 | 既有文件仍超过 800 行上限；HEAD 基线为 1970 行，043 拆出 provider logo 合同后为 1945 行，044 再减少 1 行，因此没有新增或扩大该债务 | 后续继续按 Thread Card、Connections、Search 等功能合同拆分；044 已新增独立 430 行 rendered-DOM 测试，无需在本任务扩大范围 |
