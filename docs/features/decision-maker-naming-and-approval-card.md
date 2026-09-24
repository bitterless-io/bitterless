# 会话里统一叫 decision maker;审批卡片改主题蓝，并显示被点元素的截图

Status: Specced 2026-09-24 · 已实现 2026-09-24(card-198 审查通过)· card-202 审查通过(会话列表「待确认」)· #5 人工目检待 Ral(与 Decision Helper 的 E2E 一起)

Paired with `micromeet-cowork`:`docs/features/decision-maker-naming-and-approval-card.md`(同一份契约，只有 #3 的路径不同)。

## Request

Ral 2026-09-24,贴了一张 `ui_act` 不可逆闸的审批卡片(「Answered / 执行这个不可逆操作?click [data-coach-ref="e25"] / Jev 判不准(confidence 0.39) / …/#settings/DataControls」):

> Answer 的这个卡片，改成主题蓝色的效果，不要用黄色的效果或橙色的效果。这里不能体现 JEV。用户侧要改成 "decision maker" 的表述，
> 不能体现、不能展示成 "JEV",除了设置里面的 "JEV" 开关以外。会话过程中不应该展示 JEV,统一采用 decision maker 的表述。

## #1 命名规则

- **会话里(卡片、面板、工具返回、报错、快照说明、agent 转述的原因)一律叫 `decision maker`**,不出现 `Jev` / `jev`。
- **例外只有设置页:** Settings → Decision 里的 Jev 开关和它下面那两行说明保持原样(那里本来就是在管 Jev 这个开关)。
- 代码里的标识符、文件名、日志 scope、接口参数(如 `model: 'jev-latest'`)、文档不改 —— 用户看不到。
- 模型会读到的文字也改：模型把工具返回里的原因转述给人时，不能带出 Jev。

## #2 要改的文字(两仓都查过，除设置页外全部在主进程)

| 位置 | 现在 | 改成 |
|---|---|---|
| `uiActGate.ts` 审批卡片的原因(Cowork 中文) | `Jev 判不准(confidence …)` / `Jev 判为不可逆(…)` / `Jev 判不了(…)` | `decision maker 判不准(置信度 …)` / `decision maker 判为不可逆(置信度 …)` / `decision maker 判不了(…)` |
| `uiActGate.ts` 审批卡片的原因(BL 英文) | `Jev was not confident enough (…)` / `Jev classified it as irreversible (…)` / `Jev could not judge it (…)` | `The decision maker was not confident enough (…)` / `… classified it as irreversible (…)` / `… could not judge it (…)` |
| `jevDecision.service.ts` 失败原因(不拼进卡片原因，见下方 F6 条) | `Jev is switched off in Settings → Decision.` · `…for Jev.` · `jev request timed out` | `The decision maker is switched off in Settings → Decision.` · `…for the decision maker.` · `decision maker request timed out` |
| `snapshotSegment.ts` 快照选段说明(只进 `page_snapshot` 的一条 `info` trace,不回模型、录制不收) | `not segmented (jev …)` · `not segmented (jev picked none)` | `not segmented (decision maker …)` · `not segmented (decision maker picked none)` |
| 还没实现的 BJ4 NOTE(`ui-act-wait-hover-jev.md` #3.1) | `(Jev ready=0.86)` | `(decision maker ready=0.86)` —— 规格已同步 |

实现时再全文搜一遍 `Jev` / `jev`(字符串字面量)兜底;只放过设置页那三处 i18n 文案和非用户可见的标识符。
- **relay 返回的原始报错不原样给人看**(审查 F6):卡片上的原因只写失败类型和 HTTP 状态(如「decision maker 判不了(http 502)」),原始报错体只进日志 —— 上游的报错里可能带着 jev 字样。快照选段说明同样只写类型和状态(如 `not segmented (decision maker http 502)`),原文进日志;这句说明只进一条 `info` trace,不回模型、活动记录与录制都不收(BL 先做，lead 2026-09-24 认可，两仓一致)。
- 源码守卫的放行名单按「值 + 位置」匹配，不按值;扫描范围包括 `src/shared` 和 control 的 i18n;删掉匹配不到任何东西的条目。

## #3 审批卡片改主题蓝

适用范围：审批卡片(`ChatConfirm`)、它下面的回答面板(`ChatConfirmSheet`)、ask_user 决策卡(`DecisionRecord`)里等待态用到的琥珀色，以及表中「Ral 已定」一行列出的其它「等你」提示 ——
同一个对话里的「等你决定」统一一个颜色，不能一张黄一张蓝。

| | Cowork(Tailwind,`apps/cowork/src/renderer/control/src/task/`) | BL(Arco + Less,`src/renderer/maestro/control/src/task/`) |
|---|---|---|
| 主题蓝 | 品牌主色 `#155dfc` = Tailwind v4 `blue-600`:底色 `blue-50`,色条 / 图标 / 标题前缀 `blue-600`,正文 `blue-900`,说明 `blue-700` | Arco 主色变量 `rgb(var(--primary-1))` 底色 … `--primary-6` 色条 / 图标 … `--primary-7` 文字(由 BL 的 Royal Blue 主题接管) |
| 替换 | 所有 `amber-*` / `orange-*` / `yellow-*` | 所有 `--warning-*` |
| 边框 | **去掉** `border border-amber-300`:层次靠底色 + 左侧色条(无边框规则;这张卡片的样式本来就在重做) | **去掉** `border: 1px solid rgb(var(--warning-3))`,理由同左 |
| 不变 | 过期态(灰)、结构、文案、`name` 属性、BEM 类名 | 同左 |
| 已回答 vs 等待中 | 决策卡与审批卡片答完之后整体降到 70% 不透明度(沿用原 `ChatConfirm` 已回答态的做法),和等待中的蓝色区分开(审查 F8) | 同左 |
| **Ral 已定(2026-09-24:「颜色先都用蓝色的主题色」)** | ① 确认面板里「来源不明」的风险标记也用主题蓝(靠图标、字样、加粗提示风险，不另用红色);② 同一对话里其它琥珀色的「等你」提示一起改成主题蓝：状态条的等待色调、会话列表与标题栏的待回复点、TaskPart 的提示(顺带去掉它的边框)、MessageItem 的 `act` 标签。改完之后整个对话里「等你决定」只有一种颜色 | 同左(BL 对应的组件与 `.less`) |

**Ral 已定(2026-09-24,审查 N1:「1A 2A」)**
- ① 会话列表里的「等你确认」不再用圆点，改成蓝色小字「待确认」(英文 `To confirm`)。
  - 样式:11px、中等字重、主题蓝，**无底色、无边框**(有底色会像按钮)。
  - 位置：原来圆点的位置(在转圈和未读点前面)。保留 `name`、BEM 类名和悬停提示「等你确认」;会话标题照常截断，给它让位。
  - 未读仍是蓝色圆点，在跑仍是转圈，标题栏不变(小点 + 数字)。
- ② 卡住(stalled)提示保持琥珀色：它是警告，不是在等你;改成蓝色会像「正常在跑」。

## #4 顺带：卡片上的动作要写人看得懂的字(issue P2-01)

同一张卡片上，动作写成了 `click [data-coach-ref="e25"]`:`describeUiAction` 用 `readText` 取元素文字，而 `readText` 对 `<button>` 返回 `.value`(默认空串),
于是回落成选择器。decision maker 看到的也是这串选择器，这正是一个无害的点击被判成「判不准」、弹卡问人的原因。
详见 `docs/issues/approval-card-shows-selector-instead-of-button-text.md`。修法：闸单独用一个取标签的读法(`aria-label` → 可见文字 → `value` → `title`),
**不改 `readText`**(技能脚本的 `page.read()` 也在用它，语义不能变)。

### #4.1 卡片上显示被点元素的截图(Ral 2026-09-24 补充)

> 「click ref ID」这个表述用户是看不懂的，所以你需要将这个元素转换成一个 Base64 的图片 …… Confirm 的弹窗和 answer 的卡片里面都需要展示这个图片。
> 这个图片的显示尺寸需要限制：最宽限制在 120px,最高也是限制在 120px …… 如果是宽大于高的图片，或者是高大于宽的图片，都要适应这个最大的尺寸。

| 项 | 契约 |
|---|---|
| 截什么 | 闸要问人之前，对**这一条动作的目标元素**截一张图：用和点击同一份定位拿到元素的矩形，按矩形裁剪(`Page.captureScreenshot` 带 `clip`,JPEG,**审批这条路径用 `captureBeyondViewport: false`**),与录制点击缩略图的现成实现 `captureElementShot`(`capture/debuggerCapture.ts`)同一个做法 —— 抽成共用函数，不另写一套 |
| 截多大 | 截取时最长边压到 **240 px**(显示尺寸 120 的两倍，高清屏也清楚),JPEG 质量 60;数据量控制在十几 KB |
| 截不到 | **最多等 2 秒**;超时、元素没有框(0×0)、元素居中之后仍**完全**不在可视区域内、截图出错 → 不带图;只露出一部分(比视口还大的目标)时只截可见的那部分(审查 198-F1,lead 2026-09-24 定，两仓一致)，卡片照常显示文字。截图永远不能挡住审批，也不能变成新的失败路径(从未显示过的 tab 可能截不出图)。超时后设一个标记，迟到的截图**不再执行**,更不能在批准后的点击进行中落地。已知限制：闸放弃之后，页内定位仍可能把页面滚动一次 —— 滚到的正是批准后点击本来就要滚到的那个元素，可以接受(审查 N3) |
| 为什么不用 `captureBeyondViewport: true` | 审查 F2(2026-09-24)实测：它会把视口临时缩到 1×1 再恢复 —— 触发两次 `resize`、丢失悬停(`mouseleave` / `mouseenter`)、响应式断点来回翻、会随 resize 关闭的弹层被关掉(`debuggerCapture.ts` 原注释也写着 "forces a surface reflow … visible render glitch")。截图发生在批准的点击**之前**、同一页面上，悬停菜单里的目标可能因此消失，批准后反而点不到。`false` 裁出同样的图、没有这些副作用。**录制缩略图那条路径不变**(仍是 `true`,它截的是已经发生过的点击) |
| 带到哪 | 审批请求多一个可选字段(如 `image`:data URL),**确认弹窗 / 面板**(`ChatConfirmSheet`)和**时间线里的卡片**(`ChatConfirm`,含 Answered 之后)都显示它 |
| 怎么显示 | `max-width: 120px; max-height: 120px; width: auto; height: auto`(等比缩放、完整显示，不裁切):宽图宽顶到 120,高图高顶到 120,小图不放大。圆角、无边框，放在标题与原因之间(BL 的问题文字本来就是一整段、标题与原因连在一起，图放在这段之后、答案之前 —— 审查 198-F2) |
| 给谁看 | 只给人看;**不发给 decision maker**,也不进模型上下文 |
| 文字 | 标题写动作的人话描述(#4 的标签)。标签为空**且有图**时写「click this element」/「点击这个元素」(submit 写「submit this form」/「提交这个表单」),由图说明是哪一个;标签为空**又没图**时退回显示选择器 —— 总比一句看不出对象的话强(审查 F5)。判定输入和返回给模型的 ERROR:有标签写标签(如 `click "Delete all"`),没标签写选择器，从不写「点击这个元素」。**ACP 客户端收不到图**,所以 ACP 的权限请求按「没图」处理：有标签写标签，没标签写选择器(审查 N2;BL 没有 ACP 权限请求，不涉及) |

## #5 验收与任务

- 单测：原因文案不含 `Jev`;失败原因里的 `Jev` / `jev` 已替换;快照说明已替换;卡片 / 面板 / 决策卡的类名或 Less 里不再有琥珀 / 警告色，也没有 `border`;
  `<button>Delete all</button>` 这类元素在审批描述里显示成 `"Delete all"`,不再是选择器;`readText` 行为不变(回归);
  截图：矩形正常时审批请求带 data URL 且最长边 ≤ 240;截图超时 / 出错 / 0×0 时不带图、审批照常;卡片与面板的 `<img>` 带 120×120 的等比约束。
- 源码守卫：除设置页三处外，主进程与 control 渲染层的字符串字面量里不再出现 `Jev`。
- 两边 typecheck;BL 另跑 i18n 检查。不跑 E2E。
- 人看一眼：触发一次审批卡片，确认是主题蓝、没有边框、原因里写的是 decision maker、动作是按钮上的字，确认面板和卡片里都有元素截图且不超过 120×120;再在一个从没切到前台过的 agent tab 上触发一次：应当不带图，而不是一张空白图。
- 任务:micromeet-cowork `docs/plan/tasks/decision-maker-card-001.md`(先做);bitterless `docs/plan/tasks/decision-maker-card-198.md`(排在 builtin-wait-197 之后)。后续:micromeet-cowork `decision-maker-card-002.md`(ACP 文字、选段说明)、`decision-maker-card-003.md`(会话列表「待确认」);bitterless `decision-maker-card-202.md`(会话列表「待确认」,排在 198 审查之后)。
