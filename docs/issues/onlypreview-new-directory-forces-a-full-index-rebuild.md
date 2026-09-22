# 在索引没见过的目录里建文件,会触发一次全量重建

Status: root cause confirmed and fixed; owner testing pending.

Ral 2026-09-22:存个盘机器就发顿。追查基准里「增量新增很贵」的异常时定位到,与那条异常同源。

## 结论

**触发条件是父目录还不在索引树里**,和文件本身、批次大小、索引大小都无关。

对照实验(`tmp/onlypreview-index-bench/probe-why.mjs`),两次都在 `state=ready`、
`treeMetadataReady=true`、索引已就绪的前提下:

| 动作 | 诊断事件 | 结论 |
| --- | --- | --- |
| 往**已在树里**的目录加一个文件 | (无) | 纯增量 |
| 往**新建**的目录加一个文件 | `candidate-plan → candidate-backup → traversal-index → promotion-commit` | 全量重建 |

逐批探测(`probe-add.mjs`)把两者的量级分开了:第一批(建了新目录)1532.8 ms 并带着重建的五个事件;
之后每一批都干净,**1.6–2.8 ms 每文件**,与删除同一量级。

在参考机的真实索引上,一次这样的重建是 **2.75 GB 克隆 + 41,855 条目遍历**。而触发它的动作是
日常动作:新建功能目录再建文件、git checkout 带出新目录、解压、脚手架生成。

## 根因

`watch-reconciler.mjs` 的 `readParentDirectoryTreeEntry`:

```js
const existingParent = treeByPath.get(parentRelativePath);
if (existingParent?.nodeKind !== 'directory') return { valid: false, entry: undefined };
```

父目录不在索引树里就判 `valid: false`,四个调用点据此把 `requiresFullReconcile` 置真。

**「必须早就见过」从来不是安全所在。** 安全所在是这一行后面那一整段校验:在工作区根内、
`realpath` 与自身相等(这一条等于宣告整条路径上没有符号链接)、`lstat` 确实是目录。
那段校验才是权威,而它在这一行之后 —— 也就是说,一个完全合法的新目录会在真正被检查之前就被拒掉。

## 修法

`readParentDirectoryTreeEntry` 现在从父目录向上收集树里还没有的层,直到碰到树里已有的目录为止,
然后**由外向内**逐层校验并补进树。单层校验抽成 `readDirectoryTreeEntry`,与改动前逐字相同。

变更携带的 `parentEntry`(单个)改成 `parentEntries`(整条链),落树的那个循环逐层落,
`pathHasAncestorIn` 的守卫对每一层都跑。

仍然升级成全量的情形,一条没减:

- 任何一层过不了校验(不在根内、是符号链接、不是目录、realpath 对不上)。
- 树里存在同名条目却不是目录 —— 那时的分歧不止这一个文件,重建才是对的。

## 影响面

**不变的:**

- 每一层的校验规则逐字未改,只是现在对缺失的每一层各跑一次,而不是见到缺失就整棵重来。
- 深度上限与策略排除都作用在**变更的文件**上,在此之前判定,未触碰;文件在深度内,它的祖先必然也在。
- 目录条目的形状(`toTreeDirectoryEntry`)未改 —— 原来就是用它来产生直接父目录的条目,
  现在只是产生得更多。搜索排除是渲染时按策略算的,不存在条目上,所以不存在"少标一个排除位"的分歧。
- 全量重建路径本身未触碰。

**变的:**

- 新目录里建文件:从「一次全量重建」变成「一次增量」。用户侧只会变快、变安静。
- 新目录条目现在经增量路径进树,而不是经重建进树。终态一致(守卫钉住:文件真的进了索引、
  可被搜到、整条祖先链都在树里)。

## 守卫

`tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs` 三条(cowork 同源):

1. 新目录里建文件 → 不重建、文件进索引、可搜到、新目录进树。
2. 嵌套新目录 `a/b/c/deep.txt` → 不重建、整条链 `a` / `a/b` / `a/b/c` 都在树里。
3. 链上有符号链接目录 → **仍然**升级成全量。安全没有放松。
