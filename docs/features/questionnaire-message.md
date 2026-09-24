# 问卷消息 —— bitterless 侧(Maestro)

**状态:** 🚧 待实施(2026-09-24),排在 Cowork 实现之后。**来源:** Ral 2026-09-24。
**配对:** 共通功能(chat —— 在这里叫 Maestro)。**实现合同以 Cowork 那份为准:**
`micromeet-cowork/docs/features/questionnaire-message.md`。本文只写 bitterless 侧的接线差异;
两边行为、schema、事件名、工具名、阈值**完全相同**。
**设计依据:** overmind `areas/agent-runtime/questionnaire/questionnaire.html`。

## 0 · 同名同形的部分

schema(`src/shared/questionnaire.type.ts`)· 事件名常量 · `sqliteWriteLock` · `QuestionnaireService` ·
上下文渲染与 `transformContext` 变换 · 三个 builtin 工具 · JEV 预答与归档检查 ·
卡片与展开面的 `.vue` / `.less`(两端都用 Arco + Less + BEM)。

移植时**以 Cowork 的实现为源**,两边的差异只允许出现在下表的接线点上。

## 1 · 接线差异

| 关注点 | Cowork | bitterless |
|---|---|---|
| DAO 与建表 | `apps/cowork/src/preload/sqlite/` | **`src/preload/maestro/sqlite/`**(Maestro 会话所在的那个加密库,与 `maestroChat.dao.ts` 同库) |
| JEV | **只经 `main/decision/decisionHelper.ts`**,传 `{ threshold: 0.6 }`(合同 #6.0) | 同左;由 `decision-helper-199` 实现,**Ral review 过它的代码之后**才能接 |
| 上下文挂点 | `main/agent/runtime/piRuntimeSession.ts` · `keepLatestSkillCatalog.ts` | 同路径同名 |
| 工具先例 | `main/agent/tools/decisionTools.ts` | 同路径同名 |
| 消息列表 | `renderer/control/src/MessageItem.vue` | **`renderer/maestro/control/src/MessageItem.vue`** |
| i18n | Cowork 的 messages 文件 | **`src/renderer/common/i18n/{en,zh}.ts`,经 `i18nHelper.*` 取**,不用 `$t()` |

## 2 · bitterless 自己的规矩(移植时必须遵守)

- 组件默认 `size="mini"`;BEM 类**扁平**写(不用 `&` 嵌套);颜色用 `oklch()`。
- 业务状态放 `*.store.ts`(`State` 后缀的类包 `reactive`,导出 `…Store` 单例);`.vue` 只渲染与绑定。
- 遍历用 `for` / `for...of` / `map`,**不用 `forEach`**;语句带分号;只用顶部静态 import 与别名路径。
- xpc handler 方法只收 0 或 1 个参数。
- SQLite 时间字段一律整数。
- **会话里一律叫 decision maker**(Ral 2026-09-24):卡片、展开面、工具返回、上下文正文里不出现 `Jev`;
  BL 的英文文案同样写 "decision maker"。代码标识符与接口字段(如 `by: 'jev'`)不改。

## 3 · 验证

- 与 Cowork 同一组单测在本仓通过。
- typecheck **不新增** error —— 本仓 HEAD 上有存量 error,要对比基线判断。
- i18n 检查 · build;**`yarn build` 会改写 package.json 的 `name`,提交前必须还原成 `Bitterless`。**
- 不跑 Electron E2E。
