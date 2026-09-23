# 压缩包与二进制被当作文本读进索引;tmp 只靠 per-workspace 配置挡着

Status: implemented; owner testing pending.

Ral 2026-09-23,在两个打包版同时卡死之后:「tmp/ Temp 需要排除被索引。帮我检查一下 RAR 文件是否
被排除索引。所有的压缩包类型、二进制类型的文件后缀都应该被排除索引。」

## 检查结果:RAR 原来**没有**被排除

`classifySearchMediaType` 的兜底是:

```js
if (METADATA_ONLY_EXTENSIONS.has(extension)) return 'unknown';
return 'text';          // ← 扩展名不认识就当文本
```

而 `decodeSearchText` 只做 BOM 判别 + `TextDecoder('utf-8')`,**没有任何二进制嗅探**。于是一个
`.rar` / `.7z` / `.node` / `.pyc` / `.ttf` 会被整份读进来、解码成一串 U+FFFD、再切块送进 FTS5
trigram 与中日韩倒排。

唯一拦住过它们的是体积:`MAX_TEXT_BYTES = 1 MiB`。也就是说 **大的二进制侥幸躲掉了,小的全进了
索引** —— 而小的恰恰是最多的那一类。这同时解释了索引 6.2 倍的放大率里有一部分纯属垃圾。

## 改动

1. `ARCHIVE_EXTENSIONS` 与 `BINARY_EXTENSIONS` 两张表,在兜底之前判定为 `'unknown'`(只进元数据:
   文件名仍可搜,内容不读)。**只挡确定是二进制的扩展名** —— `.gltf`(JSON)、`.svg`(XML)这类
   看着像二进制、实际是文本的一律不进表,错杀一个文本扩展名就是让它从此搜不到。兜底仍是 `'text'`,
   没列进 `TEXT_EXTENSIONS` 的源码扩展名不受影响。
2. `tmp` / `temp` 进硬策略 `CORE_EXCLUDED_DIRECTORY_NAMES`。原来只有 per-workspace 配置里的
   `tmp/**` 挡着,**没有那份配置的工作区完全不受保护**。
3. 目录名按**小写**比对。原来是精确匹配,`Temp` / `TMP` 一律漏网,而 macOS 的卷默认大小写不敏感。
4. `SEARCH_ENGINE_IDENTITY` 纳入这两张扩展名表。不纳入的话,改了「哪些扩展名不读内容」,已经建好的
   索引不会察觉,旧的二进制垃圾会一直留到下一次因为别的原因重建为止。身份正是「不动 schema 版本
   也能让旧索引失效」的机制,这类策略变更本来就该走它。

## 影响面

- **一次性全量重建。** 第 2 与第 4 条都改变了引擎身份,所以每个已存在的索引在下次打开时会重建一次。
  这正是让旧的二进制垃圾与 tmp 残留离开索引的方式,不可避免,也只发生一次。
- **搜索结果会变。** 以前能搜到的二进制乱码片段不再出现 —— 那是修复,不是回归。文件名仍然可搜。
- **`tmp/` 下的东西不再可搜。** 按定义那是草稿区;CLAUDE.md 也把它规定为「不持久、不评审」。
- 未触碰:体积上限、敏感文件规则、glob 配置语义、遍历与 reconcile 的其余判据。

## 守卫

`tests/onlypreview/onlyPreviewPythonGoExclusions.test.mjs`(cowork 同源,追加在本仓自己的文件里):

- 15 种压缩包 + 16 种二进制必须是 `'unknown'`;`.gltf` / `.md` / 未知扩展名必须仍是 `'text'`。
- `tmp` / `Temp` / `TMP` / `tEmP` 以及嵌套形式必须被硬策略排除;`tmpfile.txt` / `src/tmpl/` /
  `templates/` 不许误伤。
- 引擎身份的组成逐字钉住,包含两张新表。

## 不是这次的原因

调查 2026-09-23 卡死时一度以为触发源是 agent 往 `tmp/playground/` 解压 RAR。**那是误判**:
两个索引里 `tmp/*` 的条目数都是 **0**,per-workspace 配置的 `tmp/**` 一直在生效,且
`pathIsDefinitelyPhysicallyExcluded` 会把 `tmp/` 下的变更在进入 reconcile 之前就分流掉。
而且那次解压发生在 02:31:40,而重建在 02:30:42 就已经开始了。

卡死的真正机制见 `onlypreview-two-editions-rebuild-the-same-workspace.md`。
