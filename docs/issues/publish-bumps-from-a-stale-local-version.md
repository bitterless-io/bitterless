# 发布脚本从一个过期的本地版本号起跳,于是每次都要人工改 package.json 再重发

Status: fixed; owner verification pending (2026-09-23)

## Report

Ral 2026-09-23:「bl 的 Publish 脚本，我觉得需要更新，不要每次报错了，然后你再去改，然后我再重新发布。」

当天那一次的现场:

```
[publish.js] Running: node scripts/patch.js
✅ _version: 0.0.125 -> 0.0.126
...(SQLite migration audit,约 40 秒,全部通过)
[publish.js] Refusing semantic version reuse: 0.0.126 has local version_code 260923001823
             and remote versionCode 260922210845
```

## Confirmed cause

`main()` 的顺序是:

```
options.bump  → run scripts/patch.js     ← 只看本地 package.json 的 _version 起跳
              → yarn audit:sqlite-migrations   （~40 秒）
              → 建 OSS client
              → assertNoRemoteDowngrade        ← 第一次问远端
```

两件事叠在一起:

1. **起跳点只看本地。** `patch.js` 把 `_version` 的第三段 +1,不知道那个频道上已经发过什么。
   本地的 `_version` 一旦落后于远端(上一次发布改的是**工作区**的 `package.json`,没提交;
   换一台机器发布;或者像 2026-09-22 那样被人误还原回 HEAD),这一跳就正好落在一个**已经发布过**
   的语义版本上,而它的 `version_code` 必然与远端那一版不同 —— `assertReleaseOrder` 的第二条
   判据("semantic version reuse")拒绝,这是对的。
2. **第一次问远端在 40 秒的 migration audit 之后。** 明明 2 秒内就能知道会被拒,却要等审计跑完。

结果就是 Ral 说的那个循环:报错 → 人工把 `package.json` 改对 → 重新发布。
guard 本身没有错,错在**起跳之前没人问过远端**。

## Fix

### 修改 1 —— 起跳之前先跟远端对齐基线

`publish.js` 新增一个纯函数 `resolveReleaseBaseline(localPackage, remoteInfo)` 与它的落盘包装
`alignLocalReleaseBaseline()`,在 `patch.js` **之前**执行:

| 本地 vs 远端 | 动作 | 为什么 |
| --- | --- | --- |
| 远端没有 `version_info.json` | 不动 | 首发 |
| 远端版本 **更高** | 采纳远端的 `version / version_code` | 本地那份记录是过期的 |
| 版本相同、`version_code` 不同 | 采纳远端的 `version_code` | 这一版**已经发过**,本地丢了那条记录(2026-09-22 就是这一格) |
| 其余(本地领先或完全一致) | 不动 | 上一次发布中途失败留下的领先是有意义的,不要回退 |

对齐之后 `patch.js` 才起跳,于是 0.0.126 那一格会变成 0.0.127,不再撞车。

**故意不做的事**:远端领先时**不**去拉代码、不改任何源文件。版本守卫管的是「同一个频道上不要
撞车、不要回退」,不是「不要发布过期代码」;后者是人的判断,所以这里只把采纳动作**大声打印**出来。

`--dry-run` 没有 client,不做对齐,行为与今天完全一致。

### 修改 2 —— 把远端两道闸提到 migration audit 之前

`assertNoRemoteDowngrade` / `assertNoCrossChannelIdentityReuse` 移到
`yarn audit:sqlite-migrations` 之前。真正该被拒的那一发,现在 2 秒内就被拒,而不是 40 秒后。
审计本身一步不少,只是排在闸之后。

### 仍然是硬错误的情形(**刻意保留**)

- 本地时钟回退(`patch.js` 的 `新 version_code 必须晚于当前版本`)—— 时钟倒着走是真问题,
  凭空编一个号比报错糟。
- 对齐之后仍然触发 `assertReleaseOrder` 的任何一条 —— 那意味着出现了这四格之外的形态,
  应该有人看一眼。

## Scope

**仅 bitterless。** `micromeet-cowork` 的 `apps/cowork/scripts/publish.js` 是另一份更小的脚本,
既没有 `patch.js` 起跳,也没有远端版本守卫,不存在这个失败模式 —— 不按配对规则同改。

## Verification

- `scripts/release/publishReleaseBaseline.test.mjs`(新增):`resolveReleaseBaseline` 的判据表
  —— 首发 / 远端更高 / 同版本不同 code / 本地领先 / 完全一致,以及非法远端 code 仍然抛。
- 2026-09-22 那一次现场重放:本地 `0.0.125 + 260922143524`、远端 `0.0.126 + 260922210845`
  → 对齐成 `0.0.126 + 260922210845` → `patch.js` 起跳到 `0.0.127`,四条判据全部放行。
- **未跑真实发布** —— 上传到 OSS 是对外动作,按 root CLAUDE.md 需要 Ral 明确批准。
