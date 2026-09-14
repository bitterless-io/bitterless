# 代码高亮 —— 换成 shiki(真 TextMate 语法 ＋ GitHub 主题,语法按需加载)

Ral 2026-09-08:「当前 cowork bitterless 中的代码高亮都不好看,能不能将各个语言的高亮器
动态加载,外加,用 github 的高亮风格,例如 ts,js 高亮效果现在都很差」。

## 当前主题与降级契约（2026-09-14）

Ral 明确预览不再使用 `vs`。OnlyPreview 当前亮色契约使用 **GitHub Light**；主题首次需要时
加载并缓存，语言语法按文件类型或 Markdown 代码块的语言分别按需加载。主题就绪与语法就绪
分开处理，纯文本也使用 GitHub 配色；语法超时或不可用只降级成纯文本，不切换到 `vs`。

已确认旧实现的运行时缺陷：`@shikijs/monaco` 会接管 Monaco 的 `create/setTheme`，将主题名
直接转交 Shiki；旧的 `vs` 降级常量因此会触发 `Theme 'vs' not found`。真实依赖已复现，
修复与验证见 [Preview 旧主题报错](../issues/onlypreview-shiki-vs-theme-not-found.md)。
下文诊断和任务拆分保留为历史依据；其中的 monarch/`vs` 降级描述以本节为准。

## 诊断 —— 三个面,两个仓,坏的原因各不相同

| 面 | 现状 | 后果 |
| --- | --- | --- |
| OnlyPreview 文件预览(代码文件) | Monaco monarch 分词 ＋ `theme: 'vs'` | token 粗、颜色少 |
| OnlyPreview markdown 预览的代码块 | `marked` 默认输出,`onlyPreviewMarkdown.service.ts` **没有** `code` 覆写 | **零高亮** |
| cowork 聊天 markdown 代码块 | 92 行手写渲染器,直接吐 `<pre><code>` | **零高亮** |

并且:`shiki` 3.23 在**两个仓都是声明了但没人 import 的依赖**;bitterless 另外还声明了一个
同样没人 import 的 `highlight.js` 11.11,以及两仓都有的 `stream-monaco`(也没人 import)。

## 为什么偏偏 TS/JS 最难看

Monaco 在浏览器里上色用的是 **monarch**(正则分词器),**不是** VS Code 真正用的 TextMate 语法。
monarch 的 TS/JS 语法标关键字、字符串、注释、数字,但**不区分类型、函数、属性、JSX、装饰器**。
`theme: 'vs'` 又是 Monaco 里 token 颜色最少的一个,于是它产出的那几类 token 颜色也彼此接近。

两个原因叠乘,而且**恰好在 TS/JS 上叠得最狠** —— 那正是类型标注、JSX、装饰器承载最多信息量的地方。
所以「ts,js 高亮效果都很差」不是错觉,也不是主题单独造成的。

## 量出来的四个决定

### ① 用 shiki 接进 Monaco,而不是替掉 Monaco

`@shikijs/monaco` 的 `shikiToMonaco()` 把 shiki 的真 TextMate 语法 ＋ 真 VS Code 主题装进
Monaco 的分词器。**Monaco 本身留着** —— OnlyPreview 依赖它的三件事换不掉:find adapter
(`onlyPreviewMonacoFind.service.ts`)、选区字符计数、大文件的虚拟滚动。

**零新增依赖**:`@shikijs/monaco` 已经作为 shiki 3.23 的传递依赖装在 `node_modules` 里。

**不做**「用 shiki 渲染静态 HTML 替掉 Monaco」——那会同时失去上面三件。

### ② 引擎用纯 JS 的,不带 oniguruma WASM —— 实测等价

shiki 3 有两个引擎:`engine-oniguruma`(WASM,完整 TextMate 正则)和 `engine-javascript`
(纯 JS `RegExp`,部分语法的正则构造不支持)。文档口径是「JS 引擎有取舍」,所以**实测**了
分类器 `LANGUAGE_BY_EXTENSION` 会用到的全部语言:

| | |
| --- | --- |
| 测试语言数 | **30** |
| JS 引擎加载失败 | **0** |
| 与 oniguruma 输出有差异 | **0** |

最难的一例(TSX:装饰器、泛型、`#private`、正则字面量、模板串、JSX、`satisfies`)两引擎
**逐 token 一致** —— 204 token / 7 色 / 100% 着色。

> **一处测量假象,记下来省得别人重犯。** 第一轮实测报告 `cpp` 有差异(js 3 token/2 色 vs
> oniguruma 7/4)。那是我的样本错了 —— 那一轮 cpp 用的是默认样本 `const a = 1; // x`,
> 那不是合法 C++。换成真 C++(`#include`、模板、`[[nodiscard]]`、`constexpr`、命名空间)之后
> 两引擎一致:135 token / 7 色 / 100%。**差异来自样本,不来自引擎。**

结论:用 `engine-javascript`,省掉 WASM。哪天真加了 JS 引擎不支持的语言,`forgiving: false`
(默认)会**抛错**而不是静默降级,所以这条决定是可发现的,不是赌运气。

### ③ 语法按需 `import()` —— 这就是 Ral 要的「动态加载」

`@shikijs/langs` 是 **9.9 MB / 694 个文件**,`@shikijs/themes` 是 1.8 MB / 132 个文件。
`shiki` 的 bundled 入口会把它们**全部静态拉进来**。

所以用 `createHighlighterCore()` ＋ 每个语言一次 `import('@shikijs/langs/<id>')`,
主题同理。首次打开一个 `.ts` 只付 TS 语法那一份的代价。

### ④ 顺手砍掉 Monaco 的语言 worker —— 12 MB,零消费者

体积基线(cowork `out/renderer`,本次改动前):

| 产物 | 大小 |
| --- | --- |
| **`monacoeditorwork/ts.worker.bundle.js`** | **12 MB** |
| `assets/editor.api-*.js` | 4.3 MB |
| `assets/MonacoTextPreview-*.js` | 1.8 MB |
| `monacoeditorwork/css.worker.bundle.js` | 1.8 MB |
| renderer 总计 | **71 MB** |
| monaco 相关 chunk | **27 个** |

那个 12 MB 的 worker 是 **TypeScript 语言服务** —— 它提供补全和诊断,而这是一个**只读**预览器;
而且**它根本不负责上色**(上色是 monarch 在渲染进程里同步做的)。

它为什么在:`electron.vite.config.ts:296` 调 `monacoEditorPlugin({ customDistPath })` 时
**没传 `languageWorkers`**,插件按默认把全部 worker 都吐出来。没人要求过。

**消费者实测为零**:两个仓里 `languages.typescript` / `typescriptDefaults` /
`registerCompletionItemProvider` / `setDiagnosticsOptions` / `getWorker` **一处都没有**。
所以只保留 `editorWorkerService` 是安全删除,不是取舍。

## PQ-4 与一处路径风险

`MonacoTextPreview.vue` 与 `onlyPreviewMarkdown.service.ts` 两仓**逐字节相同** ——
PQ-4 边界内,所以改动**先在 bitterless 落地,再 re-vendor 到 micromeet-cowork**。

> ⚠️ 另一条会话已经把 bitterless 的 `src/main/onlypreview/**` 移到了
> `src/main/miniapps/onlypreview/**`(cowork 侧同样)。渲染进程侧 `src/renderer/onlypreview/**`
> 目前未动。**re-vendor 之前要重新核对路径**,别照着旧路径复制。

新增的 shiki 高亮器模块本身是两仓共用的新代码,放在搬入树里(而不是 `host/**`),
这样 cowork 侧只需 vendor,不需要自己维护一份。

## 任务拆分

| id | 内容 | 依赖 |
| --- | --- | --- |
| hl-001 | 共享 shiki 高亮器模块:`createHighlighterCore` ＋ 按需 `import()` 语法 ＋ JS 引擎 ＋ github 亮/暗双主题 ＋ 语言 id 归一 | — |
| hl-002 | `MonacoTextPreview.vue` 接 `shikiToMonaco`,主题随应用主题切换 | hl-001 |
| hl-003 | markdown 预览的代码块:`marked` 的 `code` 覆写走 shiki | hl-001 |
| hl-004 | `monacoEditorPlugin` 只留 `editorWorkerService`;砍掉 basic-languages 的静态引入;量改动前后体积 | hl-002 |
| hl-005 | cowork 聊天 markdown 的代码块(cowork 独有,不在搬入树里) | hl-001 |
| hl-006 | 守卫:语言 id 覆盖、主题存在、产物里不再出现 `ts.worker` | hl-002 hl-004 |

## hl-003 的一个前置发现:sanitizer 会把颜色全部剥掉

**天真地把 shiki 接进 markdown 渲染器,结果是零颜色** —— 而且不报任何错。

`onlyPreviewMarkdown.service.ts` 的输出过 DOMPurify,白名单是**刻意收紧**的
(它渲染的是不可信的本地 markdown):

```ts
ALLOWED_ATTR: interactiveLinks
  ? ['data-onlypreview-link', 'data-onlypreview-anchor', 'role', 'tabindex']
  : [],
ALLOWED_TAGS: [...ONLY_PREVIEW_MARKDOWN_TAGS],
```

而 shiki `codeToHtml` 的输出形如
`<pre class="shiki github-light" style="background-color:#fff;color:#24292e"><code><span class="line"><span style="color:#D73A49">const</span>…`
—— **`class` 和 `style` 都不在白名单里**,`span` 也不在标签白名单里。所以颜色会被逐个剥掉。

三条路,只有第三条既有颜色又不动安全边界:

| | 做法 | 为什么不选 |
| --- | --- | --- |
| A | 把 `style` 加进 `ALLOWED_ATTR` | 让不可信 markdown 能往预览里注入任意 CSS |
| B | 让 shiki 输出 CSS 类(`defaultColor: false`)＋ 放开 `class` | 比 A 轻,但仍然让不可信文档能带类名 |
| C ← **选它** | **先 sanitize,再替换代码块** | 代码块的外层标记是**我们生成的**,不是文档给的 |

C 的形状:渲染器的 `code()` 只吐一个 `<pre data-onlypreview-code="N"></pre>` 占位
(那个 `N` 是我们自己发的整数,加进白名单是安全的),sanitize 之后再把每个占位替换成 shiki 的输出。
被替换进去的 HTML 里,**代码文本由 shiki 转义**,外层标记由我们提供 —— 两者都不来自文档,
所以它本来就不需要过那份「不可信文档」的白名单。**白名单一个字符都不用放宽。**

`marked` 的 renderer 是**同步**的,而语法加载是异步的 —— 所以顺序是:先 walk 一遍 token 收集
出现过的语言、`await` 那几份语法,再同步 parse(语法就位后 `codeToHtml` 是同步的)。
这也顺带把"一份文档里出现 5 种语言"变成 5 次并发加载而不是 5 次串行。

## 两个要在实现时定的取舍

1. **首帧闪一下,还是首帧慢一点。** shiki 的语法加载是**异步**的,而 Monaco 建 model 是同步的。
   两条路:(a) 等语法到位再建 model —— 首帧稍慢,但不会先无色后上色;(b) 先建 model 再注册
   语法并重新分词 —— 首帧快,但会看到一次「白 → 有色」的跳变。**建议 (a) 并加一个有界超时**,
   超时就退回 monarch:一个大文件的语法加载不该把预览卡住,而 monarch 虽然粗但不是空白。
2. **`.tsx` / `.jsx` / `.vue` 的语言 id 现在是丢信息的。** 分类器把 `.tsx` → `typescript`、
   `.jsx` → `javascript`、`.vue` → `html`。shiki 有真正的 `tsx` / `jsx` / `vue` 语法,
   所以这三个映射应当同时修正 —— 否则 JSX 与 Vue SFC 的高亮仍然是残的。这属于本条改动
   自然要带的部分,不是额外需求。

## 三处必须更正的判断(2026-09-08 实测)

诊断那张表里关于 **cowork 聊天**的那一行是错的,连带影响两条「不做」。

### ① 那 92 行手写渲染器服务的不是聊天,是 Workbench 技能详情

聊天走的是 **`markstream-vue`** 的 `MarkdownRender`(`MessageItem.vue`),而且它**已经**配了
`:code-block-props="{ lightTheme: 'github-light' }"` ＋ `:is-dark="false"` —— 聊天那一面
在这次改动之前就是对的。手写那份(`control/src/markdown.ts`)的唯一消费方是
`WorkbenchSkillsView.vue` 的技能正文。

所以「ts,js 高亮很差」的实际来源只有**文件预览的 monarch**,而那正是 hl-002 修的。

### ② `stream-monaco` **有人用** —— 摘掉它会弄坏聊天

原文写「两仓都有的 `stream-monaco`(也没人 import)」,并把它列进「顺手摘掉」。**那是错的**:
它只是没被**我们的 `src/`** import。真实链条是

```
markstream-vue → stream-monaco → @shikijs/monaco + shiki
```

而聊天用 `markstream-vue`。**摘掉 `stream-monaco` 会让聊天的代码块失去高亮。**
(`highlight.js` 那条仍然成立 —— 那个确实没有消费者。)

这也解释了 `@shikijs/monaco` 为什么本来就装着:它是 `stream-monaco` 的依赖。

### ③ 那张 31 语言静态表并没有省下 9.9 MB —— 省的是别的东西

实测产物:**223 个语法 chunk,合计 6.1 MB**,全部按需加载。它们由 `stream-monaco` 使用 shiki
的 **bundled** 工厂(`createHighlighter`)带来,而两个渲染进程共享同一个 `assets/`,
所以那 6.1 MB **已经在产物里**,与我的静态表无关。

静态表真正省下的是:**预览渲染进程的 import 图不被全量语法拉入**(模板字符串 `import()` 会被
Vite 转成 glob)。这个价值仍然成立,但「避免 9.9 MB」的说法要收回。

**不追那 6.1 MB**:它是惰性的,而要压缩它就得去改第三方组件的语言集 —— 风险大于收益,
而且刚才 hl-004 已经拿掉了 19 MB 的**非惰性**体积。

## hl-005 已落地(2026-09-08)

`WorkbenchSkillsView.vue` 改用 `MarkdownRender`,props 与 `MessageItem.vue` 一致
(同一个渲染器、同一个 github-light —— 两处不该看起来不同)。

手写那份因此零消费方,已删除。它自己的文件头写着
「swap that in later if the heavy peer deps — mermaid/d2/monaco/shiki/katex — become worth
pulling」—— 它本来就是 markstream-vue 值得引入之前的占位,占位的使命已完成。

**代价为零**:`renderer` 总计仍是 53 MB,因为 `markstream-vue` 本来就在包里(聊天在用)。
收益是技能正文拿到真高亮,并且这个应用里的两份 markdown 实现减成一份。

> 已知限制(与聊天相同,非本次引入):`markstream-vue` 的 mermaid / katex / infographic 是
> **可选 peer deps 且未安装**,Vite 会把它们打成 stub —— 那三类内容不渲染。

## 不做

- **不换掉 Monaco。** find adapter、选区计数、大文件虚拟滚动都挂在它上面。
- **不引 `highlight.js` / `prism`。** 两个仓已经有 shiki,而且只有 shiki 同时给出真 TextMate
  语法和真 VS Code 主题 —— 也就是 Ral 要的那两件事。顺手把 bitterless 那个没人用的
  `highlight.js` 与两仓的 `stream-monaco` 一起摘掉。
- **不带 oniguruma WASM。** 见决定 ②,30/30 语言实测等价。
- **不用 `shiki` 的 bundled 入口。** 9.9 MB 语法全量静态拉入,与「动态加载」正相反。
