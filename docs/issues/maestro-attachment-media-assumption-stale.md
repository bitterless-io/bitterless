# ~~Maestro 附件只发文本 @path —— 那个决定的依据可能已经过期~~ 【已撤回】

Status: **撤回(2026-08-28,同日提出同日撤回)** —— 中心证据是假阴性。
**`piRuntimeAdapter.ts` 不需要改动。** 保留本文是为了记下那个错误怎么产生的。

## 撤回结论

原文断言:pi 原生 media 不再需要 inline base64,所以
`piRuntimeAdapter.ts:171-174` 那段「Coach 只发文本 `@path`」的注释依据已过期,
且**附件可能事实上没进模型**。

**这个断言不成立。** 复核证据:

| 核实项 | 原文写的 | **实际** |
|---|---|---|
| `data:${item.mimeType};base64,${item.data}` 在 pi-ai 里 | 「一处都没有」 | **`dist/api/openai-completions.js:747` 与 `:891` 各一处,一字不差** |
| `ImageContent` 的形状 | 暗示已改成收 url | **`dist/types.d.ts:239-243` = `{ type: "image"; data: string; mimeType: string }` —— 只有 base64 data** |
| pi 的 content 联合类型里有没有文件/路径型 | 未查 | **没有。** 只有 `TextContent`(`:225`)/ `ThinkingContent`(`:230`)/ `ImageContent`(`:239`) |
| `url: string;` 在 `dist/types.d.ts` | 未查 | **0 次** |

⇒ **把附件交给 pi 原生 media 通道,今天仍然需要把文件读成 base64** ——
正是 `piRuntimeAdapter.ts:171-174` 那段注释说的。**该决定的依据完好,不要改它。**

原文的 A/B 二分(「模型只收到 `@path`」vs「附件事实上没进模型」)是建立在假前提上的,
一并作废。

## 那个错误是怎么产生的 —— 值得记住的部分

**假阴性来自目录范围的 grep,而范围本身没被验证。**

```bash
# 实际执行的
grep -rl "base64" node_modules/@earendil-works/pi-ai/dist/providers/*.js   # → 空
# 由此写下的结论
「base64 在整个 dist/providers/*.js 里出现 0 次」        ← 事实,但范围错
「pi 已经不用 base64 了」                                ← 越界推论,错
```

`pi-ai@0.80.x` 把 provider 模块从 `dist/providers/` 移到了 `dist/api/`。
`dist/providers/` 仍然存在(里面是 `openai.js` / `openai-codex.js` / `azure-openai-responses.js`
等**模型注册表**),所以目录还在、grep 有结果(空),**没有任何信号提示范围选错了**。

> **教训:当 grep 的结论是「一处都没有」时,先证明搜索范围是对的。**
> 「目录存在且有文件」不等于「要找的东西该在这个目录」。
> 依赖升级后,尤其要先确认模块搬没搬家 —— 这次正是
> [`maestro-parity-guards-silently-dead.md`](maestro-parity-guards-silently-dead.md)
> 里 `check-agent-runtime.mjs:31` ENOENT 的**同一次搬家**,而我把同一个事实读成了两个不同的结论。

## 残留的真问题(已窄化,不再是本文的主张)

原文唯一站得住的部分:

**`piRuntimeAdapter.ts:171-174` 记录了一个依赖第三方内部行为的决定,但没有引用任何锚点。**

- 注释说「pi SDK native media option expects inline base64 payloads」——**正确**,但没写在哪看到的
- 唯一钉住它的守卫断言曾锚在 `dist/providers/openai-completions.js`,该路径**已搬家**
  ⇒ 守卫崩了 29 天(见 guards issue)

⇒ **这是 guards issue 的 R1(断言锚在依赖内部结构上)的一个实例,不是一个独立缺陷。**
处置随 guards issue 一起:断言已重新指向 `dist/api/openai-completions.js`,
并应在同处断言 pi 版本,让下一次搬家**响亮地失败**而不是静默死掉。

**本文不再要求任何代码改动,也不需要真会话验证。**
