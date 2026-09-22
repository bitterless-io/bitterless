# dev server 只绑 IPv6 → renderer 的动态 import 偶发取不回来(按形状同步,本仓未报过)

Status: fixed 2026-09-22;code-verified,owner testing pending(需要**重启 dev server** 才生效)。

**本仓没有报过这个现象。** 完整的现场、否证过程与根因推导在 Cowork 那份:
[`micromeet-cowork:docs/issues/control-app-async-chunk-fetch-failure.md`](../../../micromeet-cowork/docs/issues/control-app-async-chunk-fetch-failure.md)。
这里只记为什么本仓也成立、以及改了什么。

## 为什么本仓也成立

两条都是本仓的既有事实:

1. `electron.vite.config.ts` 的 renderer 段**没有** `server` 配置 ⇒ 用 Vite 默认的
   `host: 'localhost'`。Node 17+ 的 DNS 顺序是 `verbatim`,而开发机 `/etc/hosts` 里 `localhost`
   同时指向 `127.0.0.1` 与 `::1`,所以 `server.listen('localhost')` 只绑上第一个解析结果 ——
   在 Cowork 上实测就是只有 `TCP [::1]:5173 (LISTEN)`,`curl http://127.0.0.1:5173/…` 连不上。
   两仓用同一台开发机、同一个 `/etc/hosts`、同一个 electron-vite。
2. `ELECTRON_RENDERER_URL` 由 electron-vite 的 `resolveHostname(conf.host)` 推出,`host` 为
   undefined 时映射成**字面量 `localhost`** —— 那个双栈名字。于是 renderer 里每条相对 import 都
   解析到它,Chromium 在两个地址族之间选/赛,一部分请求落在 `::1`(成功)、一部分落在
   `127.0.0.1`(`ERR_CONNECTION_REFUSED`)。

对动态 import 来说,连接被拒暴露出来就是 `TypeError: Failed to fetch dynamically imported
module` —— 一个不指向任何真实代码问题的错误。本仓的
[`ControlAuthApp.vue`](../../src/renderer/maestro/control/src/ControlAuthApp.vue) 同样把受保护的那棵树
放在登录之后才 `import()`,那是页面生命周期里最晚发出的一批请求,也就是最可能撞上"这次挑了另一个
地址族"的一批。

## 改了什么

| # | 落点 | 改动 |
|---|---|---|
| 1 | [`electron.vite.config.ts`](../../electron.vite.config.ts) renderer 段 | 加 `server: { host: '127.0.0.1' }` —— 绑死一个地址族;`resolveHostname('127.0.0.1')` 原样返回,所以 `ELECTRON_RENDERER_URL` 也变成 `http://127.0.0.1:5173`,**绑定地址与 origin 逐字一致,不再经过名字解析** |
| 2 | [`ControlAuthApp.vue`](../../src/renderer/maestro/control/src/ControlAuthApp.vue) | 有界重试 + 可见兜底面 + 失败进日志。**这一条是防御,不是修复** —— 连接被拒不会因为等 300ms 就变好;但它把"面板莫名变白"变成"一条带堆栈的日志 + 一个能点的兜底面",而正是那条日志让 Cowork 侧的第二轮定位成为可能 |

选 IPv4 而不是 `[::1]`:`host: true` / `0.0.0.0` 会把 dev server 暴露到局域网,而 `[::1]` 形式的
origin 在别处更容易踩坑。

## 验证

- `renderer/maestro` + `renderer/common` + `renderer/home` + `shared` 合并 surface 跑 `vue-tsc`:
  诊断全部落在既有的 `src/renderer/home/**` 与 `src/shared/pathHelper`,`ControlAuthApp.vue` 零诊断。
- `electron.vite.config.ts` 改后仍能 `resolveConfig`,且 `config.renderer.server.host` 为
  `127.0.0.1`(手动跑 electron-vite 的 `resolveConfig` 验证)。
- **已知不对称**:Cowork 侧把这条钉进了 `controlLoginBundle.test.mjs`(那是它唯一会真的
  `resolveConfig` 的测试);本仓没有对应的配置解析测试,只靠 `electron.vite.config.ts` 里那段注释
  挡着。哪天本仓加了配置解析测试,应当把同一条断言补上。
- **没有验证的**:真实 `yarn dev` 行为。`server.host` 不热更新,必须重启 dev server;重启后
  `lsof -nP -iTCP:5173` 应当显示 IPv4 监听。
