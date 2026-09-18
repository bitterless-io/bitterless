# 技能声明在包外的入口跑不了 —— `talk_to_contacts` 发不出消息

Status: fixed 2026-09-18.

Ral 2026-09-18:「我的目标是 我说通过 botandi 给我打招呼，cowork bl 能够有路径成功调用
talk_to_contacts 给我发消息，而不是重新写入脚本」。

## 同模型同工作区的 A/B

`pi --provider bailian --model qwen3.8-flash -p "botandi 给我打个招呼"`,cwd = overmind,
**5 步结束**:

1. `read .agents/skills/talk_to_contacts/SKILL.md`
2. `bash grep -n -i "botandi" areas/contacts/contacts.index.md`
3. `bash sed -n 328,348p areas/contacts/contacts.index.md`
4. `bash node areas/contacts/feishu.mjs send --to="BotAndI" --markdown --dry-run --text=…`
5. `bash node areas/contacts/feishu.mjs send --to="BotAndI" --markdown --text=…` → 发出

同一个模型在 cowork 里(会话 `5jj508vk7wgmu6hrnv7`)37 条没发出去;第二次会话发出去了,代价是
**往技能包里新写了两个脚本**(`scripts/feishu-run.mjs`、`scripts/net-probe.mjs`)。

差别不在模型的匹配能力 —— 两边第一步都正确读了同一个 SKILL.md。差别在**能不能执行 SKILL.md
写的那一行**。

## 根因

`talk_to_contacts/SKILL.md` 通篇写的是 `node areas/contacts/feishu.mjs <command>`(整整 22 处),
引擎在包外三层 —— 它被 `p2p`、`aliyun-finance-send`、`mcu-usage-report` 等多个技能共用,本来就不该
复制进任何一个包。而 `run_skill_file` 原来只认「文件在技能包内」:

```
Script must belong to an available skill package in the current Chat
```

于是这一类技能(Agent Skills 里最常见的「SKILL.md 是说明书、引擎在工作区别处」形态)
**发现得到、读得懂、就是跑不了**。模型唯一的出路是往包里写一个转发脚本 —— 那既不是用户要的,
也把一个只读技能变成了每次调用都要改写的技能。

## 修复:按「技能自己声明的入口」放行

`run_skill_file` 现在接受两种脚本:

1. **包内脚本** —— 一直支持的那条路,边界不变。
2. **包外但被 SKILL.md 逐字点名的引擎** —— 此时根换成**本 Chat 选中的工作区**,
   `node areas/contacts/feishu.mjs` 这种相对写法才成立。

边界是**换锚,不是放宽**:

- 仍然必须落在选中工作区内,按 `realpath` 判定 —— 软链接绕不过去;
- 必须被某个**当前可用**技能的 SKILL.md 写出来。声明是提交在仓库里的人写的文本,可审计,
  不是模型在调用现场自称的;
- 可用性(ready / 已分配 / 未禁用)、机构授权与调用后复核、60s 超时、输出上限、JWT 脱敏
  全部照旧。

两侧同一套规则:cowork `standardSkillTools.ts`、bitterless `skillCreatorTools.ts` 的 `declaringSkill`。

## 已一并修掉的三条(2026-09-18 同一轮)

### 没有 shell —— 而且**只有 AI-CRMS 这条链没有**

pi 的运行时其实一直带着 `bash`。日志里写得很清楚:

```
pi session ready (openai-codex/gpt-6-astra, 66 host tools, builtins: read/bash/edit/write/grep/find/ls)
```

但 **AI-CRMS 这条链根本不过 pi**:`aiCrmsRuntimeAdapter` 是自己实现的原生会话,只认
`options.tools` 里的宿主工具,内置工具一个都没有(当天的日志里只有
`coach:agent:ai-crms-request` / `ai-crms-tool-call`,没有一条 `pi-session-start`)。
`skillRuntime` 由 `activeLlmProvider === 'ai-crms'` 决定,Ral 用的正是这一条。

bitterless 只有 `PiRuntimeAdapter` 一个适配器,所以 **bl 侧没有这个缺口** —— 它的 `bash` 一直是真的。
按配对开发规则,这属于「另一侧本来就没有这个缺陷」,不需要为对齐而造一个重复的工具。

**修复:** cowork 新增 `run_shell`(`agent/tools/shellTools.ts`)。
**不内置任何 shell**(Ral:「系统一般有的尽量不要内置」)—— 解析全部交给 pi 的 `getShellConfig()`:
macOS/Linux `/bin/bash` → `which bash` → 兜底 `sh`;Windows 找 Git Bash → PATH 上的 `bash.exe`
(Cygwin/MSYS2/WSL)→ 都没有就退到 **PowerShell**(5.1 随 Windows 发行,必然在)。
内置只留 Bun,因为 Bun 是系统**不会**自带的那一个 —— 这正是那条界线。
边界:工作区即工作目录(`cwd` 只能往里走)、输出封顶 256KB、默认 120s 超时、取消时杀整个进程组、
JWT 形状脱敏。`hostToolCatalog` 里登记为 `category: 'act'` / `risk: 'write'`,策略缺省 `bypass`。

### 系统提示词谎报工具表

A1–A4 是 pi 原文逐字照搬,里面写着 `bash: Execute bash commands (ls, grep, find, etc.)` 和
grep/find/ls/edit/write。两条链**共用**这一段,于是在 AI-CRMS 下那七行是假的 —— 模型照着去找,
两次猜 `run_command`、一次猜 `grep_files`,全部拿回「Tool is not available」。
表 1 是 pi 平价常量、有守卫(`check-agent-runtime.mjs`)钉着,所以纠正写在表 2:
AI-CRMS 分支开头加一条工具表更正 + 一条 `run_shell` 说明,并把
「shell commands are unavailable in AI-CRMS」这类现在已经不成立的句子改掉。

### 目录一次没命中就回吐 40KB

`readHostToolCatalog` 在过滤 0 条时回退**全量** —— 这本身是为修另一个坑加的
(`agent-preview-capability-undiscoverable.md`:空结果让模型以为自己没有工具,转去乱翻文件系统)。
但全量 79 条 = 40,725 字符,一次没命中的 query 就把 40KB 灌进上下文。
现在回退成**精简清单**(name + category + risk + summary),并在 note 里告诉模型按 category 再查
完整的 useWhen/safety。回退的目的保住了,代价降下来了。

## 仍未做的

系统提示词整体瘦身:66 条技能目录 + `<available_skills>` XML 两种格式各渲染一遍,
系统提示词 56,768 字符。两种渲染只需要一种,但「三源完整」是硬契约,合并要单独一轮。
