# ConfigDao 未注册时 XPC 返回 `null`,`configStore.list()` 的调用方会崩在解引用上

- **状态**:🔧 已加空值兜底(2026-09-21)
- **来源**:micromeet-cowork 2026-09-21 实测崩溃(`[coach:integration:scheduler] tick failed TypeError: Cannot read properties of null (reading 'filter')`)
- **配对**:`micromeet-cowork/docs/issues/xpc-config-list-resolves-null-before-preload.md` —— 同根因,按配对开发规则两侧同改

## 根因

`configStore` 是 `createXpcMainEmitter<ConfigApi>('ConfigDao')`,而 `ConfigDao` 是 **preload 侧**
的 `XpcPreloadHandler`。channel 未注册时 electron-xpc **解析成 `null` 而不是 reject**
(`node_modules/electron-xpc/dist/main/index.js:249`):

```js
const entry = this.registry.get(handleName);
if (entry == null) {
  return null;          // ← 不抛,直接 null
}
```

`webContents` 已销毁 / 已崩溃 / port 不存在也走同一条 `return null`。
类型签名 `Promise<ConfigEntry[]>` 在运行时是假的。

## 本仓受影响的位置

| 位置 | 解引用方式 |
| --- | --- |
| `src/main/maestro/apidoc/apiDoc.service.ts:812` | `for...of rows` |
| `src/main/maestro/retirement/crmsResidueCleanup.ts:66` | `for...of entries` |

`.get()` 的调用方不受影响 —— 一律 `entry?.options`,可选链已兜住。

BL 这侧**没有实测崩溃报告**:两处都不在启动即跑的定时器上(cowork 那侧是 30s 调度器的首拍,
所以每次主进程启动必崩)。这里按同根因预防性加固。

## 修法

`?? []`,不改 rejection 语义。没有改 `ConfigApi` 的返回类型 —— 那会牵动整个 DAO 类型面,单列。

## 验证

- `yarn typecheck`
