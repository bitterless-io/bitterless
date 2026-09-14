# 打包被产物审计拦下:`canvas` 缺失 + asar 268 MiB 超限

状态:fixed · 2026-09-14 · 发现于 `yarn publish_preview:mac_arm` 的 afterPack

## 现象

```text
⨯ [desktop-package-audit] FAILED
- app.asar is missing external package roots: canvas (required by /out/main/app.main.js)
- app.asar is 268.45 MiB, above the 220.00 MiB limit
```

两条都是 **2026-09-12 那天**进来的,互相无关,凑巧同一次打包一起炸。

## 根因 ① `canvas` —— linkedom 的可选原生加速器,本来就该缺

`src/main/net/articleExtract.ts` 在 `e09809f`(2026-09-12)新增,主进程从此 `import { parseHTML } from 'linkedom'`。
linkedom 的 `commonjs/canvas.cjs` 是这样写的:

```js
try { canvas.exports = require("canvas") } catch { canvas.exports = requireCanvasShim() }
```

Vite 把这段 try/catch **原样内联**进 `out/main/app.main.js`,于是审计的 AST 扫描看见一个裸
`require("canvas")`,就要求 asar 里有 `node_modules/canvas`。

但 `canvas` **不是、也不该是依赖** —— 它要本机编译工具链才装得上,linkedom 正是为此自带
shim(`createCanvas` 返回一个 `getContext() → null` 的壳)。**缺席就是预期行为**,不是崩溃:
`articleExtract` 只用 linkedom 解析 HTML 给 Readability,从不碰 `<canvas>` 的像素。

判据本身没错 —— 它挡的是「打包产物里 require 了一个没随包发出去的外部包」这类真崩溃。
错的是把**带 catch 回退的可选 require** 也算进去。

## 根因 ② 268 MiB —— 一个本该被删掉的 61MB CLI 二进制被 sync 扫进了仓库,又被打进 asar

按包拆 asar,与 9 月 9 日那份能跑的 0.0.95 相比,**增量只有一处**:

| | 变化 |
|---|---|
| `packages/micromeet-cli` | **+60.8 MiB(全新)** |
| `out/main` | +0.7 MiB |
| 其他 | 无 |

`packages/micromeet-cli/release/micromeet-macos-arm64` —— 一个 61MB 的 Bun 编译产物,
mac arm64 专用,**全仓没有任何代码引用它**(只有文档提到)。

它是 [AI-CRMS 链路退役](../features/maestro-crms-retirement.md) 的遗留物。那份删除契约里:

- 决策 **D3**:vendored 的 `packages/micromeet-cli` → **移除**;
- 删除清单:`packages/micromeet-cli/` **整目录删**、删掉 `electron-builder{,.tmp}.yml` 的
  `'!packages/micromeet-cli/**'` 排除行、删掉 `.gitignore` 的 `packages/micromeet-cli/release/`。

后两件做了,**第一件没做**。于是两道原本各自兜底的闸同时消失:

1. `.gitignore` 那行没了 → 本地遗留的二进制变成可跟踪文件 → `chore: sync`(`git add -A`)
   在 `16136d8`(2026-09-12)把 61MB 提交进了仓库;
2. builder 的排除行没了 → electron-builder 把它当普通项目文件打进 **app.asar**。

CLI 现在归 `micromeet-cowork`(`apps/cli`),bitterless 侧不需要它的任何一份拷贝。

## 修复

1. **`packages/micromeet-cli/` 整目录删**(git rm)—— 补做退役契约 D3 漏掉的那一步。asar 回到
   ~207 MiB,重新落在 220 MiB 限额内。不重新加 `.gitignore` 行:那是已退役概念的债,而且仓库里
   已经没有任何脚本会往这个路径产出东西;超限这件事由审计的体积闸兜底 —— 这次正是它抓出来的。
2. 审计新增 `OPTIONAL_EXTERNAL_PACKAGES`(当前只有 `canvas`):**只有**这张表里的包缺席时不算失败,
   并打印一行说明它走了 shim。表外任何一个缺失的 external root 依旧硬红。

## 判据

`scripts/package/desktopPackageAudit.test.mjs`:
- 主进程 require 可选包(`canvas`)而 asar 里没有 → 通过,并在结果里仍如实列出该引用;
- 主进程 require 一个**不在表里**的包而 asar 里没有 → 依旧失败(反向锁,防止这张表被当成万能豁免)。
