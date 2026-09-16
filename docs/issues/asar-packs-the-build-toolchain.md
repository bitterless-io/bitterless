# app.asar 里装着一整套构建工具链 —— 打包被 220 MiB 闸门拦下

状态:fixed · 2026-09-16 · 由 `yarn publish_preview:mac_arm` 的 afterPack 失败引出

## 现象

```text
⨯ [desktop-package-audit] FAILED
- app.asar is 223.62 MiB, above the 220.00 MiB limit
```

## 原因

按 asar header 逐包拆解,与上一份能过闸的产物(207.1 MiB)对比,新增量可以逐条归因,
**全部是构建期工具**:

| 新增 | asar 内 MiB | 来路 |
|---|---:|---|
| `@typescript/typescript-darwin-arm64` | 22.6 → 实际 0.0 packed | tsc 原生二进制(含 `.node`,被自动 unpack) |
| `@rolldown/binding-darwin-arm64` | 同上 | rolldown 原生绑定 |
| `lightningcss-darwin-arm64` | 同上 | CSS 编译器原生绑定 |
| `typescript` / `vite` / `vitest` / `@vitest` / `rolldown` / `lightningcss` / `chai` | 9.04 | 上述三者的 JS 部分 |

根因是 `package.json` 把 `@kimchi-dev/kimchi-workflows` 声明在 **`dependencies`**,
而它自己的 `dependencies` 里带着 `typescript@^7.0.2` 和 `vitest@4.1.10`;electron-builder
只打生产依赖闭包,于是整条工具链跟着进包。

**但"把它挪到 devDependencies"是错的**,这条路走不通:

- `out/main/workflow-engine.worker.mjs:2`、`out/main/workflow-author.mjs:2` 以裸 specifier
  `import` 它的 `/flow`、`/engine` 子路径(不被 bundle 内联),
  `src/main/agent/workflowEngine/loader.ts:43` 还会 `require.resolve()` 它来拼 jiti 的 alias 表。
  挪走 = 首次跑 workflow 就 `MODULE_NOT_FOUND`。
- `typescript` / `vitest` 是 kimchi **自己**声明的依赖,不是我们能改的字段。

所以只能在打包层排除:kimchi 只用到 `./flow` 和 `./engine` 两个导出,
`typescript` / `vitest` 只被 `dist/host`、`dist/verification`、`dist/testing` 用到
(`./host` `./extension` `./testing` 三个导出在 `src/`、`out/main`、`out/preload` 里都搜不到)。
上游的正解是让 kimchi 把它们降成 devDependency / optional peer;在那之前,靠下面的守卫兜住。

顺带查出一批**一直躺在包里**的构建期产物,同属"不该打进去的东西":

| 项 | asar MiB | .app MiB | 判据 |
|---|---:|---:|---|
| `node-llama-cpp/llama/gitRelease.bundle` | 25.78 | 25.78 | llama.cpp 源码的 git bundle,只有 `cloneLlamaCppRepo()` 与 `node-llama-cpp source download` CLI 会读;打包后 `getLlama.js` 在 Electron 下默认 `build: "never"`,且 `canBuild` 还要求 `!runningInsideAsar` —— 两重不可达。推理跑的是 `@node-llama-cpp/mac-arm64-metal` 的预编译二进制 |
| `node_modules/**/*.d.{ts,mts,cts}` | 5.55 | 5.55 | 2500+ 个声明文件;Node 的解析路径不会加载它们,workflow 的 `.ts` 由 jiti 直接抹类型 |
| `@earendil-works/pi-coding-agent/docs/**` | 2.19 | 2.19 | 5 张 README 截图,配套的 `.md` 早被 `!**/*.md` 排掉了 |
| 应用自己的垃圾:`*.tsbuildinfo` / `docs/` / `out/tests/` / `skills/` / `.claude/` | 0.59 | 0.59 | 23 个文件,零运行时可达性;`skills/` 走 `extraResources` 另发 |
| `better-sqlite3-multiple-ciphers/{deps,src}/**` + `binding.gyp` | 0 | 13.57 | C 编译输入;整个模块因含 `.node` 被 electron-builder 自动 unpack,所以**对 asar 闸门是 0**,只对 .app 闸门有效。加载走 `require('bindings')('better_sqlite3.node')`,其 12 条候选路径没有 `deps` 段 |

> 一条容易看错的账:失败产物里 **88.73 MiB 的"肥肉"在 `app.asar.unpacked`**,
> 它们对 `app.asar` 这个文件的字节数贡献是 **0**。审计日志此前只打一个总数,
> 很容易把 unpacked 的原生二进制算到 asar 闸门头上。

## 改动

### 1. 排除(`electron-builder.tmp.yml`)

六组排除,全部是 `files:` 里的否定行。注意 **`electron-builder.yml` 是生成物**
(`.gitignore:24` 忽略它,`scripts/before.js:83` 每次构建都从 `.tmp.yml` 重新生成),
改可见的那份会在下次打包时被静默丢弃。

`node-llama-cpp` 那条只排单个文件,**绝不能写 `llama/**`**:
`binariesGithubRelease.json` 被 `dist/config.js` 在顶层 await 里读,
`grammars/` 被 `getGrammarsFolder()` 解析,排掉它们会让 `import('node-llama-cpp')` 直接抛。

工具链那组统一带 `**/` 前缀,因为 yarn 可能把它们提升到根 `node_modules/`,
也可能嵌在 `@kimchi-dev/kimchi-workflows/node_modules/` 下,两种形态都要盖住。

`esbuild` **故意保留**:它可以经 `@earendil-works/pi-coding-agent` → `pi-agent-core` →
`@earendil-works/chord` 到达,排一个生产依赖可能 require 的包,换来的只有 0.12 MiB。

### 2. 守卫(`scripts/package/desktopPackage.audit.cjs`)

排除规则住在一个生成物的模板里,没有守卫的话它"消失"是无声的。所以断言**产物**而不是配置:

- `FORBIDDEN_PACKED_PATHS` 拒绝清单,**同时扫 asar 条目与 `app.asar.unpacked` 目录树**
  —— better-sqlite3 的 `deps/` 只存在于 unpacked 那边,只查 asar 永远看不见它回来。
  失败信息直接写明「改 `electron-builder.tmp.yml`,`electron-builder.yml` 是生成的」。
- 把最大那条排除所依赖的前提钉死:断言**包内**的
  `node_modules/node-llama-cpp/dist/bindings/getLlama.js` 仍然同时含有
  `runningInElectron` 与 `"never"`。哪天升级翻转了这个默认值,构建当场红,
  而不是发出一个会试图往签名包里 `git clone` llama.cpp 的应用。
- 体积日志拆成 `packed / unpacked` 两列,让上面那条"看错账"不会再发生第二次。

### 3. 闸门重新定基

实测(2026-09-16,`yarn build_preview:mac_arm`,已签名+公证+staple 的 `Bitterless Preview.app`):

|  | 修前 | 修后 | 旧闸门 | 新闸门 | 余量 |
|---|---:|---:|---:|---:|---:|
| `app.asar` | 223.62 MiB | **179.69 MiB** | 220 | **195** | 15.31 MiB / 8.5% |
| `app.asar.unpacked` | 88.73 MiB | **28.79 MiB** | —(不计入 asar 闸门) | — | — |
| `.app` 总计 | 649.21 MiB | **544.32 MiB** | 650 | **600** | 55.68 MiB / 10.2% |

**不放宽到 250 MiB。** 这次触闸不是因为闸门太紧,而是因为上一份"能过"的产物已经
占到限额的 97% —— 一个没有余量的闸门,下个月还会红;一个放到 250 的闸门,什么都拦不住
(而且它连这次也拦不住:kimchi 工具链落在 asar 上的真实成本是 9.04 MiB,不是 58)。

`maxAppBytes` 必须在同一次改动里一起调:失败产物的 .app 是 649.21 MiB,
距 650 只剩 0.79 MiB。只修 asar 的话,下一次构建会换成 .app 闸门红,同一个 afterPack,
另一条报错。.app 的余量给得比 asar 松,是因为它被 Electron Framework(217.63 MiB)与
maestro-tools(118.31 MiB)主导,Electron 大版本升级会一步跳 30–50 MiB;
一个会因为合法升级而红的闸门,只会被条件反射地调高,而不会被读。

### 4. 依赖快照

`desktopPackageAudit.test.mjs` 里那条 `dependency classification` 用例,断言的是
`Object.keys(package.json.dependencies)` 的**精确列表**。这次它**如期变红**
—— 这正是它存在的理由:新增一个运行时依赖必须是一次有意的快照更新。
本次把 `@kimchi-dev/kimchi-workflows`、`jiti`、`typebox` 三个补进去,并写明各自为什么是 external。

## 保留清单(查过,但不动)

- `out/renderer` 62.93 MiB —— 应用自己的渲染产物(Monaco、shiki、wasm parser 等),
  是「review 代码瘦身」的战场,不是排除目标。今后的余量只能从这里来。
- `playwright` 包装包 3.15 MiB —— 换成 `playwright-core` 是干净的
  (`playwright/index.js` 就是 `module.exports = require('playwright-core')`),
  但它动的是 agent 抓网页那条路径,而那些调用点用 try/catch 吞错误,改错了会退化成
  "页面内容静默为空"。要单独做,并配一个打包态 web-fetch 冒烟用例。两个闸门都不需要这 3 MiB。
- 各包的 `src/` 树 7.55 MiB —— 逐个验证是安全的,但为了这点字节要多维护 9 条规则,
  而且离 `node_modules/**/src/**` 这种一刀切只差一次手滑;那会是致命的:
  有 26 个已打包的包,入口点解析路径里带 `src/` 段(`debug`、`electron-log`、`node-fetch`、
  `gaxios`/`google-auth-library`/`gcp-metadata` 的 main 是 `build/{cjs/,}src/index.js`)。
- `moment/locale`(0.50)—— `electronLanguages` 发 7 种语言,砍了会在其中几种里显示英文日期。
- `LICENSE` / `ThirdPartyNotices`(2.45)—— 法律义务。
